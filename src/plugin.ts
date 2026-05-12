import { randomInt } from "node:crypto";
import { AppDatabase } from "./db.js";
import { FailedEventStore } from "./failed-events.js";
import { logger } from "./logger.js";
import { sendVerificationCode } from "./mailer.js";
import { MaiyatianClient } from "./maiyatian.js";
import { MainSystemClient } from "./main-system-client.js";
import { AppConfig, AuthUser, ConnectionUpdateInput, DashboardData, FailedEventFilters, FailedEventSummary, RuntimeSettings } from "./types.js";
import { UserRunner } from "./user-runner.js";

export class PluginRuntime {
  private readonly client: MainSystemClient;
  private readonly runners = new Map<number, UserRunner>();
  private readonly failedStore: FailedEventStore;
  private retryTimer?: NodeJS.Timeout;

  constructor(
    private readonly config: AppConfig,
    private readonly database: AppDatabase,
  ) {
    this.client = new MainSystemClient(config);
    this.failedStore = new FailedEventStore(database, config.failedRetryIntervalMs);
    this.applyRuntimeSettings(this.database.getRuntimeSettings());
  }

  async start() {
    await this.failedStore.ensure();
    await this.reloadConnections();
    this.restartRetryLoop();
    await this.replayFailedEvents();
  }

  async stop() {
    for (const runner of this.runners.values()) {
      runner.stop();
    }
    this.runners.clear();
    if (this.retryTimer) {
      clearInterval(this.retryTimer);
      this.retryTimer = undefined;
    }
  }

  async health() {
    const failedCount = await this.failedStore.count();
    return {
      ok: true,
      failedEventCount: failedCount,
      users: Array.from(this.runners.values()).map((runner) => runner.snapshot(failedCount)),
    };
  }

  isAuthorized(apiKey: string | null) {
    if (!apiKey) {
      return false;
    }
    return this.database.hasApiKey(apiKey);
  }

  async dashboardData(): Promise<DashboardData> {
    const failedCount = await this.failedStore.count();
    const failedEvents = (await this.failedStore.listAll(100)).map((record): FailedEventSummary => ({
      id: record.id,
      createdAt: record.createdAt,
      attempts: record.attempts,
      nextRetryAt: record.nextRetryAt,
      kind: record.event.kind,
      sourceLabel: record.event.sourceLabel,
      platform: record.event.platform,
      orderNo: record.event.orderNo,
      lastError: record.lastError,
    }));
    const snapshots = Array.from(this.runners.values()).map((runner) => runner.snapshot(failedCount));
    const users = this.database.listConnections().map((user) => {
      const snapshot = snapshots.find((item) => item.label === user.label);
      return {
        id: user.id,
        label: user.label,
        enabled: user.enabled,
        platform: user.platform,
        hasCookie: Boolean(String(user.cookie || "").trim()),
        cookie: user.cookie,
        apiKey: user.apiKey,
        wsConnected: snapshot?.wsConnected ?? false,
        lastSuccessPushAt: snapshot?.lastSuccessPushAt,
        lastWsMessageAt: snapshot?.lastWsMessageAt,
        lastError: snapshot?.lastError,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        lastUsedAt: user.lastUsedAt,
      };
    });

    return {
      publicBaseUrl: this.config.publicBaseUrl || `http://${this.config.host}:${this.config.port}`,
      pushBaseUrl: this.config.pushBaseUrl,
      failedEventCount: failedCount,
      failedEvents,
      users,
      settings: this.getRuntimeSettings(),
      authUsers: this.database.listUsers(),
    };
  }

  async listFailedEvents(filters: FailedEventFilters = {}) {
    return (await this.failedStore.listFiltered(filters)).map((record): FailedEventSummary => ({
      id: record.id,
      createdAt: record.createdAt,
      attempts: record.attempts,
      nextRetryAt: record.nextRetryAt,
      kind: record.event.kind,
      sourceLabel: record.event.sourceLabel,
      platform: record.event.platform,
      orderNo: record.event.orderNo,
      lastError: record.lastError,
    }));
  }

  getConnection(id: number) {
    return this.database.listConnections().find((item) => item.id === id) || null;
  }

  getRuntimeSettings() {
    return this.database.getRuntimeSettings();
  }

  async updateRuntimeSettings(input: RuntimeSettings) {
    const next = this.normalizeRuntimeSettings(input);
    const saved = this.database.updateRuntimeSettings(next);
    this.applyRuntimeSettings(saved);
    await this.reloadConnections();
    this.restartRetryLoop();
    return saved;
  }

  isSmtpReady() {
    return Boolean(this.config.smtpHost && this.config.smtpUser && this.config.smtpPass && this.config.smtpFrom);
  }

  async sendLoginCode(rawEmail: string) {
    if (!this.isSmtpReady()) {
      throw new Error("邮件发送功能还没配置好，请先完成初始设置后再重启服务");
    }

    const email = normalizeEmail(rawEmail);
    const code = createVerificationCode();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    this.database.upsertVerificationCode(email, code, expiresAt);
    await sendVerificationCode(this.config, email, code);

    return {
      email,
      expiresAt,
    };
  }

  async verifyLoginCode(rawEmail: string, rawCode: string) {
    const email = normalizeEmail(rawEmail);
    const code = String(rawCode || "").trim();
    if (!/^\d{6}$/.test(code)) {
      throw new Error("请输入 6 位验证码");
    }

    this.database.consumeVerificationCode(email, code);
    const user = this.database.createOrLoginUser(email);
    const token = this.database.createSession(user.id);

    return {
      user,
      token,
    };
  }

  getSessionUser(token: string | null): AuthUser | null {
    return this.database.getSessionUser(token);
  }

  deleteSession(token: string | null) {
    this.database.deleteSession(token);
  }

  async createConnection(label: string, platform: string) {
    const created = this.database.createConnection(label, platform);
    await this.reloadConnections();
    return created;
  }

  async updateConnection(input: ConnectionUpdateInput) {
    const updated = this.database.updateConnection(input);
    await this.reloadConnections();
    return updated;
  }

  async toggleConnection(id: number, enabled: boolean) {
    const updated = this.database.toggleConnectionEnabled(id, enabled);
    await this.reloadConnections();
    return updated;
  }

  async syncConnectionCookie(apiKey: string, cookie: string | undefined, enabled = true) {
    const updated = this.database.updateConnectionCookieByApiKey(apiKey, cookie, enabled);
    await this.reloadConnections();
    return updated;
  }

  async regenerateApiKey(id: number) {
    const updated = this.database.regenerateApiKey(id);
    await this.reloadConnections();
    return updated;
  }

  async listOrdersByStatus(apiKey: string, status: string) {
    const connection = this.requireConnectionByApiKey(apiKey);
    const client = new MaiyatianClient(this.config, connection);
    return client.fetchOrdersByStatus(status);
  }

  async listOrdersByDate(apiKey: string, date: string) {
    const connection = this.requireConnectionByApiKey(apiKey);
    const client = new MaiyatianClient(this.config, connection);
    return client.fetchOrdersByDate(date);
  }

  async deleteConnection(id: number) {
    this.database.deleteConnection(id);
    await this.reloadConnections();
  }

  touchApiKey(apiKey: string) {
    this.database.touchApiKey(apiKey);
  }

  private async replayFailedEvents() {
    const records = await this.failedStore.listReady();
    for (const record of records) {
      try {
        await this.client.deliver(record.event);
        await this.failedStore.markSucceeded(record.id);
        logger.info("replayed failed event", {
          label: record.event.sourceLabel,
          kind: record.event.kind,
          orderNo: record.event.orderNo,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "replay failed";
        if (shouldDropFailedEvent(message)) {
          await this.failedStore.markSucceeded(record.id);
          logger.warn("dropped permanent failed event", {
            id: record.id,
            label: record.event.sourceLabel,
            error: message,
          });
          continue;
        }

        await this.failedStore.reschedule(record, message);
        logger.warn("failed event replay postponed", {
          id: record.id,
          label: record.event.sourceLabel,
          error: message,
        });
      }
    }
  }

  private async reloadConnections() {
    for (const runner of this.runners.values()) {
      runner.stop();
    }
    this.runners.clear();

    const users = this.database.listActiveConnections();
    for (const user of users) {
      const runner = new UserRunner(this.config, user, this.client, this.failedStore, (apiKey) => {
        this.touchApiKey(apiKey);
      });
      this.runners.set(user.id, runner);
      runner.start();
    }
  }

  private restartRetryLoop() {
    if (this.retryTimer) {
      clearInterval(this.retryTimer);
      this.retryTimer = undefined;
    }

    this.failedStore.setRetryIntervalMs(this.config.failedRetryIntervalMs);
    this.retryTimer = setInterval(() => {
      void this.replayFailedEvents();
    }, this.config.failedRetryIntervalMs);
  }

  private requireConnectionByApiKey(apiKey: string) {
    const connection = this.database.findConnectionByApiKey(apiKey);
    if (!connection) {
      throw new Error("connection not found");
    }
    if (!String(connection.cookie || "").trim()) {
      throw new Error(`label ${connection.label} missing cookie`);
    }
    return connection;
  }

  private applyRuntimeSettings(settings: RuntimeSettings) {
    this.config.pushBaseUrl = settings.pushBaseUrl.replace(/\/+$/, "");
    this.config.publicBaseUrl = settings.publicBaseUrl.replace(/\/+$/, "") || undefined;
    this.config.pollIntervalMs = settings.pollIntervalMs;
    this.config.httpTimeoutMs = settings.httpTimeoutMs;
    this.config.maxListPages = settings.maxListPages;
    this.config.pageSize = settings.pageSize;
    this.config.failedRetryIntervalMs = settings.failedRetryIntervalMs;
    this.config.dedupeTtlMs = settings.dedupeTtlMs;
    this.config.wsHeartbeatIntervalMs = settings.wsHeartbeatIntervalMs;
    this.config.wsReconnectBaseMs = settings.wsReconnectBaseMs;
    this.config.wsReconnectMaxMs = settings.wsReconnectMaxMs;
    this.config.statuses = settings.statuses;
  }

  private normalizeRuntimeSettings(input: RuntimeSettings): RuntimeSettings {
    const statuses = Array.isArray(input.statuses)
      ? input.statuses.map((item) => String(item || "").trim()).filter(Boolean)
      : [];

    return {
      pushBaseUrl: String(input.pushBaseUrl || "").trim().replace(/\/+$/, ""),
      publicBaseUrl: String(input.publicBaseUrl || "").trim().replace(/\/+$/, ""),
      pollIntervalMs: normalizePositiveNumber(input.pollIntervalMs, this.config.pollIntervalMs),
      httpTimeoutMs: normalizePositiveNumber(input.httpTimeoutMs, this.config.httpTimeoutMs),
      maxListPages: normalizePositiveNumber(input.maxListPages, this.config.maxListPages),
      pageSize: normalizePositiveNumber(input.pageSize, this.config.pageSize),
      failedRetryIntervalMs: normalizePositiveNumber(input.failedRetryIntervalMs, this.config.failedRetryIntervalMs),
      dedupeTtlMs: normalizePositiveNumber(input.dedupeTtlMs, this.config.dedupeTtlMs),
      wsHeartbeatIntervalMs: normalizePositiveNumber(input.wsHeartbeatIntervalMs, this.config.wsHeartbeatIntervalMs),
      wsReconnectBaseMs: normalizePositiveNumber(input.wsReconnectBaseMs, this.config.wsReconnectBaseMs),
      wsReconnectMaxMs: normalizePositiveNumber(input.wsReconnectMaxMs, this.config.wsReconnectMaxMs),
      statuses: statuses.length > 0 ? statuses : this.config.statuses,
    };
  }
}

function normalizePositiveNumber(value: unknown, fallback: number) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function shouldDropFailedEvent(message: string) {
  return message.includes("400: {\"error\":\"Invalid order payload\"}");
}

function normalizeEmail(email: string) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new Error("请输入正确的邮箱地址");
  }
  return normalized;
}

function createVerificationCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}
