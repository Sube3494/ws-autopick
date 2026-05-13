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
  private readonly pendingPicking = new Map<string, { resolve: () => void; promise: Promise<void> }>();
  private readonly mealCompleteTimers = new Map<string, NodeJS.Timeout>();
  private readonly mealCompleteCooldowns = new Map<string, number>();
  private readonly startupBackfillStatuses = ["confirm", "subscribe", "meal"];
  private readonly orderIdentityByOrderId = new Map<string, {
    platform: string;
    orderNo: string;
    sourceId?: string;
    dailyPlatformSequence?: number;
    logisticId?: string;
  }>();
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
        const instantStatusEvent = this.buildStatusProgressEvent(event.orderId, event.statusHint, event.raw);
        if (instantStatusEvent) {
          await this.process(instantStatusEvent);
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
    void this.backfillUnpickedOrders();
  }

  stop() {
    this.ws.stop();
    for (const timer of this.mealCompleteTimers.values()) {
      clearTimeout(timer);
    }
    this.mealCompleteTimers.clear();
    this.mealCompleteCooldowns.clear();
    this.pendingPicking.clear();
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

  async waitForPickingComplete(orderNo: string, timeoutMs: number) {
    const key = String(orderNo || "").trim();
    const entry = key ? this.pendingPicking.get(key) : null;
    if (!entry) {
      return true;
    }

    return await Promise.race([
      entry.promise.then(() => true as const),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), timeoutMs)),
    ]);
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
        sourceId: event.payload.sourceId || event.payload.id,
        dailyPlatformSequence: event.payload.dailyPlatformSequence,
        logisticId: event.payload.logisticId,
      });

      if (isAlreadyPickedLikeStatus(event.payload.status)) {
        this.resolvePickingOrder(event.orderNo);
      }
    }

    if (event.kind === "progress" && event.progress.pickCompleted) {
      this.resolvePickingOrder(event.orderNo);
    }

    if (event.kind === "delete") {
      this.resolvePickingOrder(event.orderNo);
    }

    try {
      await this.client.deliver(event);
      this.onDelivered?.(event.apiKey);
      this.dedupe.remember(dedupeKey);
      this.lastSuccessPushAt = new Date().toISOString();
      if (event.kind === "upsert") {
        this.scheduleMealCompleteIfNeeded(event);
      }
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
        sourceId: cached.sourceId || orderId,
        dailyPlatformSequence: cached.dailyPlatformSequence,
        logisticId: cached.logisticId,
        rawPayload: {
          id: orderId,
          source: "ws-cache",
        },
      };
    }

    const fetched = await this.source.buildEventFromOrderId(orderId, "delete").catch(() => null);
    if (fetched?.kind === "upsert") {
      return {
        kind: "delete",
        sourceLabel: fetched.sourceLabel,
        apiKey: fetched.apiKey,
        eventId: `${this.user.label}:${orderId}:delete`,
        platform: fetched.platform,
        orderNo: fetched.orderNo,
        sourceId: orderId,
        dailyPlatformSequence: fetched.payload.dailyPlatformSequence,
        logisticId: fetched.payload.logisticId,
        rawPayload: fetched.rawPayload,
      };
    }

    if (fetched?.kind === "delete") {
      return {
        ...fetched,
        sourceId: orderId,
      };
    }

    return {
      kind: "delete",
      sourceLabel: this.user.label,
      apiKey: this.user.apiKey,
      eventId: `${this.user.label}:${orderId}:delete`,
      platform: this.user.platform,
      orderNo: orderId,
      sourceId: orderId,
      rawPayload: {
        id: orderId,
        source: "ws-delete-fallback",
      },
    };
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

  private buildStatusProgressEvent(orderId: string, statusHint: string, rawPayload: unknown): DeliveryEvent | null {
    if (!statusHint || statusHint === "delete") {
      return null;
    }

    const identity = this.orderIdentityByOrderId.get(orderId);
    if (!identity?.platform || !identity.orderNo) {
      return null;
    }

    return {
      kind: "progress",
      sourceLabel: this.user.label,
      apiKey: this.user.apiKey,
      eventId: `${this.user.label}:${orderId}:progress:status:${statusHint}`,
      platform: identity.platform,
      orderNo: identity.orderNo,
      progress: {
        statusHint,
      },
      rawPayload,
    };
  }

  private scheduleMealCompleteIfNeeded(event: Extract<DeliveryEvent, { kind: "upsert" }>) {
    if (isAlreadyPickedLikeStatus(event.payload.status)) {
      this.resolvePickingOrder(event.orderNo);
      return;
    }

    const sourceId = String(event.payload.sourceId || event.payload.id || "").trim();
    if (!sourceId) {
      return;
    }

    const scheduleKey = `${event.sourceLabel}:${sourceId}`;
    const cooldownUntil = this.mealCompleteCooldowns.get(scheduleKey) || 0;
    if (cooldownUntil > Date.now()) {
      return;
    }
    if (this.mealCompleteTimers.has(scheduleKey)) {
      return;
    }

    this.registerPickingOrder(event.orderNo);
    const timer = setTimeout(() => {
      void this.runScheduledMealComplete(scheduleKey, event, sourceId);
    }, 60_000);
    this.mealCompleteTimers.set(scheduleKey, timer);
  }

  private async runScheduledMealComplete(
    scheduleKey: string,
    event: Extract<DeliveryEvent, { kind: "upsert" }>,
    sourceId: string,
  ) {
    this.mealCompleteTimers.delete(scheduleKey);

    try {
      const result = await this.source.submitMealComplete({
        platform: event.platform,
        dailyPlatformSequence: event.payload.dailyPlatformSequence || 0,
        orderNo: event.orderNo,
        sourceId,
      });

      if (!result.ok) {
        logger.warn("scheduled meal-complete failed", {
          label: this.user.label,
          orderNo: event.orderNo,
          status: result.status,
          text: String(result.text || "").slice(0, 200),
        });
        return;
      }

      logger.info("scheduled meal-complete succeeded", {
        label: this.user.label,
        orderNo: event.orderNo,
      });
      this.mealCompleteCooldowns.set(scheduleKey, Date.now() + this.config.mealCompleteCooldownMs);

      await this.process({
        kind: "progress",
        sourceLabel: this.user.label,
        apiKey: this.user.apiKey,
        eventId: `${this.user.label}:${sourceId}:progress:mealComplete`,
        platform: event.platform,
        orderNo: event.orderNo,
        progress: {
          pickCompleted: true,
        },
        rawPayload: result,
      });

      const refreshed = await this.source.buildEventFromOrderId(sourceId, "meal").catch(() => null);
      if (refreshed?.kind === "upsert") {
        await this.process(refreshed);
      }
    } catch (error) {
      logger.warn("scheduled meal-complete crashed", {
        label: this.user.label,
        orderNo: event.orderNo,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.resolvePickingOrder(event.orderNo);
    }
  }

  private async backfillUnpickedOrders() {
    for (const status of this.startupBackfillStatuses) {
      try {
        const orders = await this.source.fetchOrdersByStatus(status);
        for (const payload of orders) {
          const sourceId = String(payload.sourceId || payload.id || "").trim();
          if (!sourceId || isAlreadyPickedLikeStatus(payload.status)) {
            continue;
          }

          this.orderIdentityByOrderId.set(String(payload.id || sourceId), {
            platform: String(payload.platform || "").trim() || this.user.platform,
            orderNo: String(payload.orderNo || "").trim(),
            sourceId,
            dailyPlatformSequence: payload.dailyPlatformSequence,
            logisticId: payload.logisticId,
          });

          this.scheduleMealCompleteIfNeeded({
            kind: "upsert",
            sourceLabel: this.user.label,
            apiKey: this.user.apiKey,
            eventId: `${this.user.label}:${sourceId}:startup-backfill:${status}`,
            platform: String(payload.platform || "").trim() || this.user.platform,
            orderNo: String(payload.orderNo || "").trim(),
            payload,
            rawPayload: payload,
          });
        }
      } catch (error) {
        logger.warn("startup unpicked-order backfill failed", {
          label: this.user.label,
          status,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private registerPickingOrder(orderNo: string) {
    const key = String(orderNo || "").trim();
    if (!key || this.pendingPicking.has(key)) {
      return;
    }

    let resolve!: () => void;
    const promise = new Promise<void>((resolver) => {
      resolve = resolver;
    });
    this.pendingPicking.set(key, { resolve, promise });
  }

  private resolvePickingOrder(orderNo: string) {
    const key = String(orderNo || "").trim();
    if (!key) {
      return;
    }

    const entry = this.pendingPicking.get(key);
    if (!entry) {
      return;
    }

    entry.resolve();
    this.pendingPicking.delete(key);
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

function isAlreadyPickedLikeStatus(status?: string) {
  const text = String(status || "").trim();
  return /已拣货|拣货中|已完成|取消|删除|配送中/.test(text);
}
