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
    deliveryId?: string;
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
    const isOfflineLike = event.kind === "upsert" && (
      isOfflineLikePlatform(event.platform)
      || String(event.payload.channelTag || "").trim().toLowerCase() === "other"
      || Boolean(event.payload.delivery)
    );

    if (event.kind === "upsert" && (!Array.isArray(event.payload.items) || event.payload.items.length === 0)) {
      if (isOfflineLike) {
        // 对于线下交易/手工发单/跑腿订单，若无商品明细则补充手工配送占位商品，确保能推送到主系统入库
        event.payload.items = [
          {
            productName: "手工配送占位商品",
            productNo: "__manual_delivery_placeholder__",
            quantity: 1,
          },
        ];
      } else {
        logger.warn("skip invalid upsert event without items", {
          label: this.user.label,
          orderNo: event.orderNo,
          platform: event.platform,
        });
        return;
      }
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
        deliveryId: event.payload.deliveryId,
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
        deliveryId: cached.deliveryId,
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
        deliveryId: fetched.payload.deliveryId,
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
      const { platform } = identity;
      if (isPlatformMatched(platform, platformLabel) && matchOrderIdentity(identity, orderLabel)) {
        return {
          kind: "progress",
          sourceLabel: this.user.label,
          apiKey: this.user.apiKey,
          eventId: `${this.user.label}:${orderId}:progress:pickCompleted`,
          platform,
          orderNo: identity.orderNo,
          sourceId: identity.sourceId || orderId,
          dailyPlatformSequence: identity.dailyPlatformSequence,
          deliveryId: identity.deliveryId,
          progress: {
            pickCompleted: true,
            statusHint: "meal",
          },
          rawPayload,
        };
      }
    }

    // 兜底推送：若本地内存尚未缓存具体订单，直接使用识别到的平台别名和流水号构造进度推给主系统，
    // 主系统会通过数据库内 platformAliases 与 dailyPlatformSequence 精准定位该订单并更新
    const resolvedPlatform = normalizePlatformKey(platformLabel) || platformLabel;
    const seqNum = Number(orderLabel);
    return {
      kind: "progress",
      sourceLabel: this.user.label,
      apiKey: this.user.apiKey,
      eventId: `${this.user.label}:progress:broadcast:${resolvedPlatform}:${orderLabel}`,
      platform: resolvedPlatform,
      orderNo: `#${orderLabel}`,
      dailyPlatformSequence: Number.isFinite(seqNum) && seqNum > 0 ? seqNum : undefined,
      progress: {
        pickCompleted: true,
        statusHint: "meal",
      },
      rawPayload,
    };
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
      sourceId: identity.sourceId || orderId,
      dailyPlatformSequence: identity.dailyPlatformSequence,
      deliveryId: identity.deliveryId,
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
        sourceId,
        dailyPlatformSequence: event.payload.dailyPlatformSequence,
        deliveryId: event.payload.deliveryId,
        progress: {
          pickCompleted: true,
          statusHint: "meal",
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
            deliveryId: payload.deliveryId,
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

function normalizePlatformKey(name: string) {
  const text = String(name || "").trim().toLowerCase();
  if (["其他", "其它", "other", "线下", "offline", "线下交易"].includes(text) || text.includes("线下")) {
    return "线下交易";
  }
  if (text.includes("美团") || text.includes("meituan") || text.includes("shangou")) return "美团";
  if (text.includes("京东") || text.includes("jd") || text.includes("daojia")) return "京东";
  if (text.includes("淘宝") || text.includes("taobao") || text.includes("ebai")) return "淘宝";
  if (text.includes("饿了么") || text.includes("eleme")) return "饿了么";
  return name.trim();
}

function isPlatformMatched(candidatePlatform: string, platformLabel: string) {
  const normCandidate = normalizePlatformKey(candidatePlatform);
  const normLabel = normalizePlatformKey(platformLabel);
  if (normCandidate === normLabel) return true;
  if (normCandidate && normLabel && (normCandidate.includes(normLabel) || normLabel.includes(normCandidate))) return true;
  return false;
}

function isOfflineLikePlatform(platform?: string) {
  return normalizePlatformKey(String(platform || "")) === "线下交易";
}

function matchOrderIdentity(
  identity: { orderNo?: string; dailyPlatformSequence?: number },
  orderLabel: string
) {
  const label = String(orderLabel || "").trim();
  if (!label) return false;

  // 1. 匹配序号 / 流水号 (例如 "1号" 对应 dailyPlatformSequence = 1)
  if (identity.dailyPlatformSequence != null && String(identity.dailyPlatformSequence) === label) {
    return true;
  }

  const orderNo = String(identity.orderNo || "").trim();
  if (!orderNo) return false;

  // 2. 匹配以序号结尾 (例如 "#1", "20261003-1")
  if (orderNo.endsWith(label)) {
    return true;
  }

  // 3. 匹配去除非数字后的序号或完全相等
  const pureDigits = orderNo.replace(/\D/g, "");
  if (pureDigits === label || pureDigits.endsWith(label)) {
    return true;
  }

  if (orderNo === `#${label}` || orderNo.includes(`${label}号`)) {
    return true;
  }

  return false;
}


function isAlreadyPickedLikeStatus(status?: string) {
  const text = String(status || "").trim();
  return /已拣货|拣货中|已完成|取消|删除|配送中/.test(text);
}
