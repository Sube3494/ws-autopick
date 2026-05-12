import path from "node:path";
import { randomBytes } from "node:crypto";
import { Database } from "bun:sqlite";
import { AppConfig, AuthUser, ConnectionUpdateInput, DeliveryEvent, FailedEventFilters, FailedEventRecord, RuntimeSettings, UserConfig } from "./types.js";

type ConnectionRow = {
  id: number;
  label: string;
  enabled: number;
  platform: string;
  cookie: string | null;
  api_key: string;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
};

type FailedEventRow = {
  id: string;
  created_at: string;
  attempts: number;
  next_retry_at: string;
  payload: string;
  last_error: string | null;
};

type AdminUserRow = {
  id: number;
  email: string;
  is_admin: number;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
};

type SessionRow = {
  user_id: number;
  expires_at: string;
};

export class AppDatabase {
  private readonly db: Database;

  constructor(config: AppConfig) {
    const filePath = config.dbPath || path.join(config.dataDir, "ws-autopick.sqlite");
    this.db = new Database(filePath, { create: true });
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS connections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        label TEXT NOT NULL UNIQUE,
        enabled INTEGER NOT NULL DEFAULT 1,
        platform TEXT NOT NULL DEFAULT '美团',
        cookie TEXT,
        api_key TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_used_at TEXT
      );
      CREATE TABLE IF NOT EXISTS failed_events (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        attempts INTEGER NOT NULL,
        next_retry_at TEXT NOT NULL,
        payload TEXT NOT NULL,
        last_error TEXT
      );
      CREATE TABLE IF NOT EXISTS app_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE,
        is_admin INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_login_at TEXT
      );
      CREATE TABLE IF NOT EXISTS verification_codes (
        email TEXT PRIMARY KEY,
        code TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(user_id) REFERENCES app_users(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS runtime_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    this.seedRuntimeSettings(config);
  }

  listConnections(): UserConfig[] {
    const rows = this.db.query<ConnectionRow, []>(`
      SELECT id, label, enabled, platform, cookie, api_key, created_at, updated_at, last_used_at
      FROM connections
      ORDER BY created_at ASC
    `).all();
    return rows.map(mapConnectionRow);
  }

  listActiveConnections(): UserConfig[] {
    const rows = this.db.query<ConnectionRow, []>(`
      SELECT id, label, enabled, platform, cookie, api_key, created_at, updated_at, last_used_at
      FROM connections
      WHERE enabled = 1 AND cookie IS NOT NULL AND TRIM(cookie) <> ''
      ORDER BY created_at ASC
    `).all();
    return rows.map(mapConnectionRow);
  }

  hasApiKey(apiKey: string) {
    const row = this.db.query<{ count: number }, [string]>(`
      SELECT COUNT(1) as count FROM connections WHERE api_key = ?
    `).get(apiKey);
    return Number(row?.count || 0) > 0;
  }

  findConnectionByApiKey(apiKey: string) {
    const normalized = apiKey.trim();
    if (!normalized) {
      return null;
    }

    const row = this.db.query<ConnectionRow, [string]>(`
      SELECT id, label, enabled, platform, cookie, api_key, created_at, updated_at, last_used_at
      FROM connections
      WHERE api_key = ?
    `).get(normalized);

    return row ? mapConnectionRow(row) : null;
  }

  createConnection(label: string, platform = "美团") {
    const now = new Date().toISOString();
    const apiKey = generateApiKey();
    this.db.query(`
      INSERT INTO connections (label, enabled, platform, cookie, api_key, created_at, updated_at)
      VALUES (?, 1, ?, NULL, ?, ?, ?)
    `).run(label.trim(), platform.trim() || "美团", apiKey, now, now);

    return this.getConnectionByLabel(label);
  }

  updateConnection(input: ConnectionUpdateInput) {
    const now = new Date().toISOString();
    const current = this.getConnectionById(input.id);
    this.db.query(`
      UPDATE connections
      SET label = ?, platform = ?, cookie = ?, enabled = ?, updated_at = ?
      WHERE id = ?
    `).run(
      input.label.trim(),
      input.platform.trim() || "美团",
      typeof input.cookie === "undefined" ? normalizeNullableText(current.cookie) : normalizeNullableText(input.cookie),
      input.enabled ? 1 : 0,
      now,
      input.id,
    );
    return this.getConnectionById(input.id);
  }

  toggleConnectionEnabled(id: number, enabled: boolean) {
    const now = new Date().toISOString();
    this.db.query(`
      UPDATE connections
      SET enabled = ?, updated_at = ?
      WHERE id = ?
    `).run(enabled ? 1 : 0, now, id);
    return this.getConnectionById(id);
  }

  updateConnectionCookieByApiKey(apiKey: string, cookie: string | undefined, enabled = true) {
    const now = new Date().toISOString();
    this.db.query(`
      UPDATE connections
      SET cookie = ?, enabled = ?, updated_at = ?
      WHERE api_key = ?
    `).run(
      normalizeNullableText(cookie),
      enabled ? 1 : 0,
      now,
      apiKey.trim(),
    );
    return this.getConnectionByApiKey(apiKey);
  }

  regenerateApiKey(id: number) {
    const now = new Date().toISOString();
    const apiKey = generateApiKey();
    this.db.query(`
      UPDATE connections
      SET api_key = ?, updated_at = ?
      WHERE id = ?
    `).run(apiKey, now, id);
    return this.getConnectionById(id);
  }

  deleteConnection(id: number) {
    this.db.query(`DELETE FROM connections WHERE id = ?`).run(id);
  }

  touchApiKey(apiKey: string) {
    this.db.query(`
      UPDATE connections
      SET last_used_at = ?, updated_at = ?
      WHERE api_key = ?
    `).run(new Date().toISOString(), new Date().toISOString(), apiKey);
  }

  addFailedEvent(event: DeliveryEvent, retryIntervalMs: number, lastError: string) {
    const now = new Date();
    const record: FailedEventRecord = {
      id: crypto.randomUUID(),
      createdAt: now.toISOString(),
      attempts: 1,
      nextRetryAt: new Date(now.getTime() + retryIntervalMs).toISOString(),
      event,
      lastError,
    };
    this.db.query(`
      INSERT INTO failed_events (id, created_at, attempts, next_retry_at, payload, last_error)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      record.id,
      record.createdAt,
      record.attempts,
      record.nextRetryAt,
      JSON.stringify(record.event),
      lastError,
    );
    return record;
  }

  listReadyFailedEvents(now = new Date()) {
    const rows = this.db.query<FailedEventRow, [string]>(`
      SELECT id, created_at, attempts, next_retry_at, payload, last_error
      FROM failed_events
      WHERE next_retry_at <= ?
      ORDER BY next_retry_at ASC
    `).all(now.toISOString());

    return rows.map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      attempts: row.attempts,
      nextRetryAt: row.next_retry_at,
      event: JSON.parse(row.payload) as DeliveryEvent,
      lastError: row.last_error || undefined,
    }));
  }

  listFailedEvents(limit = 100) {
    const rows = this.db.query<FailedEventRow, [number]>(`
      SELECT id, created_at, attempts, next_retry_at, payload, last_error
      FROM failed_events
      ORDER BY next_retry_at ASC, created_at ASC
      LIMIT ?
    `).all(limit);

    return rows.map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      attempts: row.attempts,
      nextRetryAt: row.next_retry_at,
      event: JSON.parse(row.payload) as DeliveryEvent,
      lastError: row.last_error || undefined,
    }));
  }

  listFailedEventsFiltered(filters: FailedEventFilters = {}) {
    const normalizedLimit = normalizeFailedEventLimit(filters.limit);
    const rows = this.db.query<FailedEventRow, [number]>(`
      SELECT id, created_at, attempts, next_retry_at, payload, last_error
      FROM failed_events
      ORDER BY next_retry_at ASC, created_at ASC
      LIMIT ?
    `).all(normalizedLimit);

    const label = String(filters.label || "").trim().toLowerCase();
    const platform = String(filters.platform || "").trim().toLowerCase();
    const orderNo = String(filters.orderNo || "").trim().toLowerCase();
    const kind = String(filters.kind || "").trim().toLowerCase();
    const error = String(filters.error || "").trim().toLowerCase();

    return rows
      .map((row) => ({
        id: row.id,
        createdAt: row.created_at,
        attempts: row.attempts,
        nextRetryAt: row.next_retry_at,
        event: JSON.parse(row.payload) as DeliveryEvent,
        lastError: row.last_error || undefined,
      }))
      .filter((row) => {
        if (label && !row.event.sourceLabel.toLowerCase().includes(label)) return false;
        if (platform && !row.event.platform.toLowerCase().includes(platform)) return false;
        if (orderNo && !row.event.orderNo.toLowerCase().includes(orderNo)) return false;
        if (kind && row.event.kind.toLowerCase() !== kind) return false;
        if (error && !String(row.lastError || "").toLowerCase().includes(error)) return false;
        return true;
      });
  }

  countFailedEvents() {
    const row = this.db.query<{ count: number }, []>(`SELECT COUNT(1) as count FROM failed_events`).get();
    return Number(row?.count || 0);
  }

  markFailedEventSucceeded(id: string) {
    this.db.query(`DELETE FROM failed_events WHERE id = ?`).run(id);
  }

  rescheduleFailedEvent(record: FailedEventRecord, retryIntervalMs: number, error: string) {
    const nextAttempts = record.attempts + 1;
    const nextDelayMs = Math.min(retryIntervalMs * nextAttempts, 5 * 60 * 1000);
    this.db.query(`
      UPDATE failed_events
      SET attempts = ?, next_retry_at = ?, last_error = ?
      WHERE id = ?
    `).run(
      nextAttempts,
      new Date(Date.now() + nextDelayMs).toISOString(),
      error,
      record.id,
    );
  }

  listUsers() {
    const rows = this.db.query<AdminUserRow, []>(`
      SELECT id, email, is_admin, created_at, updated_at, last_login_at
      FROM app_users
      ORDER BY created_at ASC
    `).all();
    return rows.map(mapAuthUser);
  }

  getUserCount() {
    const row = this.db.query<{ count: number }, []>(`SELECT COUNT(1) as count FROM app_users`).get();
    return Number(row?.count || 0);
  }

  upsertVerificationCode(email: string, code: string, expiresAt: string) {
    const now = new Date().toISOString();
    this.db.query(`
      INSERT INTO verification_codes (email, code, expires_at, created_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(email) DO UPDATE SET
        code = excluded.code,
        expires_at = excluded.expires_at,
        created_at = excluded.created_at
    `).run(email, code, expiresAt, now);
  }

  consumeVerificationCode(email: string, code: string) {
    const row = this.db.query<{ code: string; expires_at: string }, [string]>(`
      SELECT code, expires_at FROM verification_codes WHERE email = ?
    `).get(email);
    if (!row) {
      throw new Error("验证码不存在或已失效");
    }
    if (row.code !== code) {
      throw new Error("验证码不正确");
    }
    if (new Date(row.expires_at).getTime() < Date.now()) {
      this.db.query(`DELETE FROM verification_codes WHERE email = ?`).run(email);
      throw new Error("验证码已过期");
    }
    this.db.query(`DELETE FROM verification_codes WHERE email = ?`).run(email);
  }

  createOrLoginUser(email: string) {
    const existing = this.db.query<AdminUserRow, [string]>(`
      SELECT id, email, is_admin, created_at, updated_at, last_login_at
      FROM app_users
      WHERE email = ?
    `).get(email);
    const now = new Date().toISOString();
    if (!existing) {
      if (this.getUserCount() > 0) {
        throw new Error("该插件已绑定管理员邮箱，当前不允许新的账号注册");
      }
      const isAdmin = this.getUserCount() === 0 ? 1 : 0;
      this.db.query(`
        INSERT INTO app_users (email, is_admin, created_at, updated_at, last_login_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(email, isAdmin, now, now, now);
    } else {
      this.db.query(`
        UPDATE app_users
        SET last_login_at = ?, updated_at = ?
        WHERE email = ?
      `).run(now, now, email);
    }
    return this.getUserByEmail(email);
  }

  createSession(userId: number) {
    const token = randomBytes(32).toString("hex");
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
    this.db.query(`
      INSERT INTO sessions (token, user_id, expires_at, created_at)
      VALUES (?, ?, ?, ?)
    `).run(token, userId, expiresAt, now.toISOString());
    return token;
  }

  getSessionUser(token: string | null) {
    if (!token) return null;
    const row = this.db.query<SessionRow & AdminUserRow, [string, string]>(`
      SELECT s.user_id, s.expires_at, u.id, u.email, u.is_admin, u.created_at, u.updated_at, u.last_login_at
      FROM sessions s
      JOIN app_users u ON u.id = s.user_id
      WHERE s.token = ? AND s.expires_at > ?
    `).get(token, new Date().toISOString());
    if (!row) return null;
    return mapAuthUser(row);
  }

  deleteSession(token: string | null) {
    if (!token) return;
    this.db.query(`DELETE FROM sessions WHERE token = ?`).run(token);
  }

  getRuntimeSettings(): RuntimeSettings {
    const rows = this.db.query<{ key: string; value: string }, []>(`
      SELECT key, value FROM runtime_settings
    `).all();
    const map = new Map(rows.map((row) => [row.key, row.value]));
    return {
      pushBaseUrl: map.get("pushBaseUrl") || "",
      publicBaseUrl: map.get("publicBaseUrl") || "",
      pollIntervalMs: Number(map.get("pollIntervalMs") || 15000),
      httpTimeoutMs: Number(map.get("httpTimeoutMs") || 10000),
      maxListPages: Number(map.get("maxListPages") || 5),
      pageSize: Number(map.get("pageSize") || 20),
      failedRetryIntervalMs: Number(map.get("failedRetryIntervalMs") || 30000),
      dedupeTtlMs: Number(map.get("dedupeTtlMs") || 120000),
      wsHeartbeatIntervalMs: Number(map.get("wsHeartbeatIntervalMs") || 30000),
      wsReconnectBaseMs: Number(map.get("wsReconnectBaseMs") || 1000),
      wsReconnectMaxMs: Number(map.get("wsReconnectMaxMs") || 30000),
      statuses: JSON.parse(map.get("statuses") || "[]"),
    };
  }

  updateRuntimeSettings(input: RuntimeSettings) {
    const now = new Date().toISOString();
    const entries: Array<[string, string]> = [
      ["pushBaseUrl", input.pushBaseUrl],
      ["publicBaseUrl", input.publicBaseUrl],
      ["pollIntervalMs", String(input.pollIntervalMs)],
      ["httpTimeoutMs", String(input.httpTimeoutMs)],
      ["maxListPages", String(input.maxListPages)],
      ["pageSize", String(input.pageSize)],
      ["failedRetryIntervalMs", String(input.failedRetryIntervalMs)],
      ["dedupeTtlMs", String(input.dedupeTtlMs)],
      ["wsHeartbeatIntervalMs", String(input.wsHeartbeatIntervalMs)],
      ["wsReconnectBaseMs", String(input.wsReconnectBaseMs)],
      ["wsReconnectMaxMs", String(input.wsReconnectMaxMs)],
      ["statuses", JSON.stringify(input.statuses)],
    ];
    for (const [key, value] of entries) {
      this.db.query(`
        INSERT INTO runtime_settings (key, value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `).run(key, value, now);
    }
    return this.getRuntimeSettings();
  }

  private getConnectionById(id: number) {
    const row = this.db.query<ConnectionRow, [number]>(`
      SELECT id, label, enabled, platform, cookie, api_key, created_at, updated_at, last_used_at
      FROM connections
      WHERE id = ?
    `).get(id);
    if (!row) {
      throw new Error(`connection ${id} not found`);
    }
    return mapConnectionRow(row);
  }

  private getConnectionByLabel(label: string) {
    const row = this.db.query<ConnectionRow, [string]>(`
      SELECT id, label, enabled, platform, cookie, api_key, created_at, updated_at, last_used_at
      FROM connections
      WHERE label = ?
    `).get(label.trim());
    if (!row) {
      throw new Error(`connection ${label} not found`);
    }
    return mapConnectionRow(row);
  }

  private getConnectionByApiKey(apiKey: string) {
    const row = this.db.query<ConnectionRow, [string]>(`
      SELECT id, label, enabled, platform, cookie, api_key, created_at, updated_at, last_used_at
      FROM connections
      WHERE api_key = ?
    `).get(apiKey.trim());
    if (!row) {
      throw new Error("connection not found");
    }
    return mapConnectionRow(row);
  }

  private getUserByEmail(email: string) {
    const row = this.db.query<AdminUserRow, [string]>(`
      SELECT id, email, is_admin, created_at, updated_at, last_login_at
      FROM app_users
      WHERE email = ?
    `).get(email);
    if (!row) {
      throw new Error(`user ${email} not found`);
    }
    return mapAuthUser(row);
  }

  private seedRuntimeSettings(config: AppConfig) {
    const defaults = this.getRuntimeSettingsDefaults(config);
    const now = new Date().toISOString();
    for (const [key, value] of Object.entries(defaults)) {
      const stored = key === "statuses" ? JSON.stringify(value) : String(value);
      this.db.query(`
        INSERT OR IGNORE INTO runtime_settings (key, value, updated_at)
        VALUES (?, ?, ?)
      `).run(key, stored, now);
    }
  }

  private getRuntimeSettingsDefaults(config: AppConfig): RuntimeSettings {
    return {
      pushBaseUrl: config.pushBaseUrl,
      publicBaseUrl: config.publicBaseUrl || `http://${config.host}:${config.port}`,
      pollIntervalMs: config.pollIntervalMs,
      httpTimeoutMs: config.httpTimeoutMs,
      maxListPages: config.maxListPages,
      pageSize: config.pageSize,
      failedRetryIntervalMs: config.failedRetryIntervalMs,
      dedupeTtlMs: config.dedupeTtlMs,
      wsHeartbeatIntervalMs: config.wsHeartbeatIntervalMs,
      wsReconnectBaseMs: config.wsReconnectBaseMs,
      wsReconnectMaxMs: config.wsReconnectMaxMs,
      statuses: config.statuses,
    };
  }
}

function mapConnectionRow(row: ConnectionRow): UserConfig {
  return {
    id: row.id,
    label: row.label,
    enabled: row.enabled === 1,
    platform: row.platform,
    cookie: row.cookie || undefined,
    apiKey: row.api_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastUsedAt: row.last_used_at || undefined,
  };
}

function generateApiKey() {
  return `apk_in_${randomBytes(20).toString("hex")}`;
}

function normalizeNullableText(value: string | undefined) {
  const text = String(value || "").trim();
  return text || null;
}

function mapAuthUser(row: AdminUserRow): AuthUser {
  return {
    id: row.id,
    email: row.email,
    isAdmin: row.is_admin === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: row.last_login_at || undefined,
  };
}

function normalizeFailedEventLimit(value: number | undefined) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 100;
  }
  return Math.min(Math.floor(numeric), 500);
}
