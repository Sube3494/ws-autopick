import { DedupeStore } from "./dedupe.js";
import { FailedEventStore } from "./failed-events.js";
import { logger } from "./logger.js";
import { MainSystemClient } from "./main-system-client.js";
import { MaiyatianClient } from "./maiyatian.js";
import { AppConfig, DeliveryEvent, UserConfig, UserRuntimeSnapshot } from "./types.js";
import { MaiyatianWsClient } from "./ws.js";

export class UserRunner {
  private readonly source: MaiyatianClient;
  private readonly dedupe: DedupeStore;
  private readonly ws: MaiyatianWsClient;
  private readonly orderIdentityByOrderId = new Map<string, { platform: string; orderNo: string }>();
  private wsConnected = false;
  private lastWsMessageAt?: string;
  private lastSuccessPushAt?: string;
  private lastError?: string;

  constructor(
    private readonly config: AppConfig,
    private readonly user: UserConfig,
    private readonly client: MainSystemClient,
    private readonly failedStore: FailedEventStore,
    private readonly onDelivered?: (apiKey: string) => void,
  ) {
    this.source = new MaiyatianClient(config, user);
    this.dedupe = new DedupeStore(config.dedupeTtlMs);
    this.ws = new MaiyatianWsClient(config, user, this.source.getWsUrl(), {
      fetchIdentity: () => this.source.fetchSessionIdentity(),
      onNotify: async (event) => {
        if (event.kind === "progress") {
          const progressEvent = this.buildProgressEvent(event.platformLabel, event.orderLabel, event.raw);
          if (progressEvent) {
            await this.process(progressEvent);
          }
          return;
        }

        if (event.kind !== "detail") {
          return;
        }
        const deliveryEvent = event.statusHint === "delete"
          ? await this.buildDeleteEvent(event.orderId)
          : await this.source.buildEventFromOrderId(event.orderId, event.statusHint);
        await this.process(deliveryEvent);
      },
      onStateChange: ({ connected, lastMessageAt, error }) => {
        this.wsConnected = connected;
        if (lastMessageAt) {
          this.lastWsMessageAt = lastMessageAt;
        }
        if (error) {
          this.lastError = error;
        }
      },
    });
  }

  start() {
    if (!this.user.enabled) {
      logger.info("connection disabled, skip runner", { label: this.user.label });
      return;
    }

    this.ws.start();
  }

  stop() {
    this.ws.stop();
  }

  snapshot(failedEventCount: number): UserRuntimeSnapshot {
    return {
      label: this.user.label,
      platform: this.user.platform,
      enabled: this.user.enabled,
      running: false,
      wsConnected: this.wsConnected,
      queueSize: 0,
      lastWsMessageAt: this.lastWsMessageAt,
      lastSuccessPushAt: this.lastSuccessPushAt,
      lastError: this.lastError,
      failedEventCount,
    };
  }

  private async process(event: DeliveryEvent) {
    if (event.kind === "upsert" && (!Array.isArray(event.payload.items) || event.payload.items.length === 0)) {
      logger.warn("skip invalid upsert event without items", {
        label: this.user.label,
        orderNo: event.orderNo,
        platform: event.platform,
      });
      return;
    }

    const dedupeKey = `${event.sourceLabel}:${event.eventId}`;
    if (this.dedupe.has(dedupeKey)) {
      return;
    }

    if (event.kind === "upsert") {
      this.orderIdentityByOrderId.set(event.payload.id, {
        platform: event.platform,
        orderNo: event.orderNo,
      });
    }

    try {
      await this.client.deliver(event);
      this.onDelivered?.(event.apiKey);
      this.dedupe.remember(dedupeKey);
      this.lastSuccessPushAt = new Date().toISOString();
    } catch (error) {
      const message = error instanceof Error ? error.message : "delivery failed";
      await this.failedStore.add(event, message);
      logger.error("event delivery failed, queued for retry", {
        label: this.user.label,
        kind: event.kind,
        orderNo: event.orderNo,
        error: message,
      });
    }
  }

  private async buildDeleteEvent(orderId: string): Promise<DeliveryEvent> {
    const cached = this.orderIdentityByOrderId.get(orderId);
    if (cached) {
      return {
        kind: "delete",
        sourceLabel: this.user.label,
        apiKey: this.user.apiKey,
        eventId: `${this.user.label}:${orderId}:delete`,
        platform: cached.platform,
        orderNo: cached.orderNo,
        rawPayload: {
          id: orderId,
          source: "ws-cache",
        },
      };
    }

    const fetched = await this.source.buildEventFromOrderId(orderId, "delete");
    if (fetched.kind === "upsert") {
      return {
        kind: "delete",
        sourceLabel: fetched.sourceLabel,
        apiKey: fetched.apiKey,
        eventId: `${this.user.label}:${orderId}:delete`,
        platform: fetched.platform,
        orderNo: fetched.orderNo,
        rawPayload: fetched.rawPayload,
      };
    }
    return fetched;
  }

  private buildProgressEvent(platformLabel: string, orderLabel: string, rawPayload: unknown): DeliveryEvent | null {
    for (const [orderId, identity] of this.orderIdentityByOrderId.entries()) {
      const { platform, orderNo } = identity;
      if (platformLabel.includes(normalizePlatformLabel(platform)) && matchOrderLabel(orderNo, orderLabel)) {
        return {
          kind: "progress",
          sourceLabel: this.user.label,
          apiKey: this.user.apiKey,
          eventId: `${this.user.label}:${orderId}:progress:pickCompleted`,
          platform,
          orderNo,
          progress: {
            pickCompleted: true,
          },
          rawPayload,
        };
      }
    }
    return null;
  }
}

function normalizePlatformLabel(platform: string) {
  if (platform.includes("美团")) return "美团";
  if (platform.includes("京东")) return "京东";
  if (platform.includes("淘宝")) return "淘宝";
  return platform.trim();
}

function matchOrderLabel(orderNo: string, orderLabel: string) {
  const normalized = String(orderNo || "").trim();
  return normalized.endsWith(orderLabel);
}
