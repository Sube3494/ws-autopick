import { logger } from "./logger.js";
import { AppConfig, MaiyatianSessionIdentity, UserConfig } from "./types.js";

type WsNotifyEvent =
  | {
      kind: "detail";
      orderId: string;
      statusHint: string;
      raw: unknown;
    }
  | {
      kind: "progress";
      platformLabel: string;
      orderLabel: string;
      raw: unknown;
    }
  | {
      kind: "ignore";
      reason: string;
      raw: unknown;
    };

type WsHooks = {
  fetchIdentity: () => Promise<MaiyatianSessionIdentity>;
  onNotify: (event: WsNotifyEvent) => Promise<void>;
  onStateChange: (state: { connected: boolean; lastMessageAt?: string; error?: string }) => void;
};

export class MaiyatianWsClient {
  private socket: WebSocket | null = null;
  private heartbeatTimer?: NodeJS.Timeout;
  private reconnectTimer?: NodeJS.Timeout;
  private reconnectAttempt = 0;
  private closedManually = false;

  constructor(
    private readonly config: AppConfig,
    private readonly user: UserConfig,
    private readonly wsUrl: string,
    private readonly hooks: WsHooks,
  ) {}

  start() {
    this.closedManually = false;
    void this.connect();
  }

  stop() {
    this.closedManually = true;
    this.clearTimers();
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }

  private async connect() {
    try {
      const identity = await this.hooks.fetchIdentity();
      const socket = new WebSocket(this.wsUrl);
      this.socket = socket;

      socket.addEventListener("open", () => {
        this.reconnectAttempt = 0;
        this.send({
          cmd: "login",
          data: {
            merchant_id: identity.merchantId,
            account_id: identity.accountId,
            shop: "0",
            city: "0",
          },
        });
        this.startHeartbeat();
        this.hooks.onStateChange({ connected: true });
        logger.info("ws connected", { label: this.user.label });
      });

      socket.addEventListener("message", (event) => {
        void this.handleMessage(String(event.data || ""));
      });

      socket.addEventListener("close", () => {
        this.hooks.onStateChange({ connected: false, error: "socket closed" });
        this.scheduleReconnect();
      });

      socket.addEventListener("error", () => {
        this.hooks.onStateChange({ connected: false, error: "socket error" });
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "ws connect failed";
      this.hooks.onStateChange({ connected: false, error: message });
      this.scheduleReconnect();
    }
  }

  private async handleMessage(raw: string) {
    this.hooks.onStateChange({
      connected: true,
      lastMessageAt: new Date().toISOString(),
    });

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      await this.hooks.onNotify({ kind: "ignore", reason: "invalid-json", raw });
      return;
    }

    const notify = parseWsNotify(parsed);
    await this.hooks.onNotify(notify);
  }

  private send(payload: unknown) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    this.socket.send(JSON.stringify(payload));
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.send({ cmd: "heartbeat", data: {} });
    }, this.config.wsHeartbeatIntervalMs);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  private scheduleReconnect() {
    if (this.closedManually || this.reconnectTimer) {
      return;
    }
    this.stopHeartbeat();

    const base = this.config.wsReconnectBaseMs;
    const max = this.config.wsReconnectMaxMs;
    const delay = Math.min(base * (2 ** this.reconnectAttempt), max);
    this.reconnectAttempt += 1;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connect();
    }, delay);
  }

  private clearTimers() {
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }
}

function parseWsNotify(input: unknown): WsNotifyEvent {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { kind: "ignore", reason: "non-object", raw: input };
  }

  const message = input as Record<string, unknown>;
  const cmd = String(message.cmd || "").trim().toLowerCase();
  if (cmd === "") {
    const progress = parseProgressText(String(message.msg || "").trim());
    return progress || { kind: "ignore", reason: "empty-cmd", raw: input };
  }

  if (cmd === "heartbeat" || cmd === "login" || cmd === "order_monitor") {
    return { kind: "ignore", reason: cmd, raw: input };
  }

  const isCancelCmd = cmd.includes("cancel") || cmd.includes("refund") || cmd.includes("close") || cmd === "order_change";

  if (cmd === "notify" || isCancelCmd || cmd === "order_status") {
    const nested = parseNestedNotify(message.msg, cmd);
    if (!nested) {
      return { kind: "ignore", reason: "notify-missing-body", raw: input };
    }
    return nested;
  }

  if (cmd === "expect") {
    const text = String(message.msg || "").trim();
    if (!text) {
      return { kind: "ignore", reason: "expect-empty-msg", raw: input };
    }
    let nested: unknown = message.msg;
    if (typeof text === "string" && text.startsWith("{")) {
      try {
        nested = JSON.parse(text);
      } catch {
        return { kind: "ignore", reason: "expect-invalid-json", raw: input };
      }
    }
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      const body = nested as Record<string, unknown>;
      const orderId = String(body.id || body.order_id || body.orderId || body.source_id || "").trim();
      const statusHint = normalizeNotifyStatusHint(body.type || body.cancel_status || body.status || "expect");
      if (orderId) {
        return {
          kind: "detail",
          orderId,
          statusHint,
          raw: nested,
        };
      }
    }
    return { kind: "ignore", reason: "expect-missing-id", raw: input };
  }

  return { kind: "ignore", reason: `unsupported-cmd:${cmd}`, raw: input };
}

function parseNestedNotify(value: unknown, parentCmd?: string): WsNotifyEvent | null {
  if (!value) return null;

  let nested: unknown = value;
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return null;
    try {
      nested = JSON.parse(text);
    } catch {
      return { kind: "ignore", reason: "notify-invalid-json", raw: value };
    }
  }

  if (!nested || typeof nested !== "object" || Array.isArray(nested)) {
    return { kind: "ignore", reason: "notify-non-object", raw: nested };
  }

  const body = nested as Record<string, unknown>;
  const orderId = String(body.id || body.order_id || body.orderId || body.source_id || "").trim();
  
  const rawStatusCandidates = [
    body.type,
    body.cancel_status,
    body.cancelStatus,
    body.status,
    body.action,
    body.event_type,
    body.eventType,
    parentCmd,
  ];

  let statusHint = "";
  for (const candidate of rawStatusCandidates) {
    statusHint = normalizeNotifyStatusHint(candidate);
    if (statusHint) break;
  }

  if (!statusHint && parentCmd && (parentCmd.includes("cancel") || parentCmd.includes("refund"))) {
    statusHint = "cancel";
  }

  if (!orderId || !statusHint) {
    return { kind: "ignore", reason: "notify-missing-id-or-type", raw: nested };
  }

  return {
    kind: "detail",
    orderId,
    statusHint,
    raw: nested,
  };
}

function normalizeNotifyStatusHint(value: unknown) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return "";
  if (
    raw.includes("cancel") ||
    raw.includes("refund") ||
    raw.includes("close") ||
    raw.includes("rollback") ||
    raw.includes("取消") ||
    raw.includes("退款") ||
    raw.includes("关闭") ||
    raw === "99" ||
    raw === "10"
  ) {
    return "cancel";
  }
  return raw;
}

function parseProgressText(text: string): WsNotifyEvent | null {
  if (!text) return null;
  const match = text.match(/^(.+?)(\d+)号订单上报拣货成功$/);
  if (!match) {
    return null;
  }

  return {
    kind: "progress",
    platformLabel: match[1].trim(),
    orderLabel: match[2].trim(),
    raw: text,
  };
}
