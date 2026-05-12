import path from "node:path";
import { AppConfig } from "./types.js";

const DEFAULT_STATUSES = [
  "confirm",
  "subscribe",
  "delivery",
  "pickup",
  "delivering",
  "done",
  "cancel",
  "remind",
  "meal",
];

function readNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readBoolean(value: string | undefined, fallback: boolean) {
  if (typeof value === "undefined") {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function readStatuses(value: string | undefined) {
  if (!value) {
    return DEFAULT_STATUSES;
  }
  const items = value.split(",").map((item) => item.trim()).filter(Boolean);
  return items.length > 0 ? items : DEFAULT_STATUSES;
}

export function loadConfig(cwd: string): AppConfig {
  return {
    host: process.env.HOST?.trim() || "127.0.0.1",
    port: readNumber(process.env.PORT, 22800),
    pushBaseUrl: (process.env.PUSH_BASE_URL?.trim() || "http://127.0.0.1:3000").replace(/\/+$/, ""),
    publicBaseUrl: process.env.PUBLIC_BASE_URL?.trim()?.replace(/\/+$/, "") || undefined,
    dataDir: path.resolve(cwd, process.env.DATA_DIR?.trim() || "./data"),
    dbPath: path.resolve(cwd, process.env.DB_PATH?.trim() || "./data/ws-autopick.sqlite"),
    smtpHost: process.env.SMTP_HOST?.trim() || undefined,
    smtpPort: readNumber(process.env.SMTP_PORT, 465),
    smtpUser: process.env.SMTP_USER?.trim() || undefined,
    smtpPass: process.env.SMTP_PASS?.trim() || undefined,
    smtpFrom: process.env.SMTP_FROM?.trim() || undefined,
    smtpSecure: readBoolean(process.env.SMTP_SECURE, true),
    pollIntervalMs: readNumber(process.env.POLL_INTERVAL_MS, 15000),
    httpTimeoutMs: readNumber(process.env.HTTP_TIMEOUT_MS, 10000),
    maxListPages: readNumber(process.env.MAX_LIST_PAGES, 5),
    pageSize: readNumber(process.env.PAGE_SIZE, 20),
    failedRetryIntervalMs: readNumber(process.env.FAILED_RETRY_INTERVAL_MS, 30000),
    dedupeTtlMs: readNumber(process.env.DEDUPE_TTL_MS, 120000),
    statuses: readStatuses(process.env.MAIYATIAN_STATUSES),
    wsHeartbeatIntervalMs: readNumber(process.env.WS_HEARTBEAT_INTERVAL_MS, 30000),
    wsReconnectBaseMs: readNumber(process.env.WS_RECONNECT_BASE_MS, 1000),
    wsReconnectMaxMs: readNumber(process.env.WS_RECONNECT_MAX_MS, 30000),
  };
}
