import { AppConfig, CompleteDeliveryCommand, DeliveryEvent, MainSystemOrderPayload, MaiyatianOrderDetail, MaiyatianOrderSummary, MaiyatianSessionIdentity, MealCompleteCommand, PickupCompleteCommand, SelfDeliveryCommand, UserConfig } from "./types.js";

const BASE_URL = "https://saas.maiyatian.com";
const WS_URL = "wss://msg.maiyatian.com/acc";
const SELF_DELIVERY_SUBMIT_URL = "/delivery/submit/?f=json";
const COMPLETE_DELIVERY_TRACK_URL = "/delivery/track/?f=json&token=";
const MEAL_COMPLETE_URL = "/order/mealComplete/?f=json";

type MaiyatianQueryListResponse = {
  data?: MaiyatianOrderDetail[];
};

type MaiyatianShopRecord = {
  id: string;
  name: string;
  address: string;
  cityCode?: string;
  cityName?: string;
};

export class MaiyatianClient {
  private identityPromise?: Promise<MaiyatianSessionIdentity>;
  private shopMapPromise?: Promise<Map<string, MaiyatianShopRecord>>;

  constructor(private readonly config: AppConfig, private readonly user: UserConfig) {}

  getWsUrl() {
    return WS_URL;
  }

  async fetchStatusOrders(status: string) {
    const token = this.requireToken();
    const records: MaiyatianOrderSummary[] = [];

    for (let page = 1; page <= this.config.maxListPages; page += 1) {
      const url = new URL("/order/list/?", BASE_URL);
      url.searchParams.set("f", "json");
      url.searchParams.set("status", status);
      url.searchParams.set("page", String(page));
      url.searchParams.set("page_size", String(this.config.pageSize));
      url.searchParams.set("sort", "1");
      url.searchParams.set("is_sort", "0");
      url.searchParams.set("delivery_type", "0");
      url.searchParams.set("dispatch_status", "0");
      url.searchParams.set("meal_status", "0");
      url.searchParams.set("token", token);

      const response = await this.get<{ data?: MaiyatianOrderSummary[] }>(url);
      const pageData = Array.isArray(response.data) ? response.data : [];
      records.push(...pageData);

      if (pageData.length < this.config.pageSize) {
        break;
      }
    }

    return records;
  }

  async fetchOrdersByStatus(status: string) {
    const orders = await this.fetchStatusOrders(status);
    const results: MainSystemOrderPayload[] = [];

    for (const summary of orders) {
      const orderId = String(summary.id || "").trim();
      if (!orderId) continue;
      const detail = await this.fetchOrderDetailWithShopAddress(orderId);
      const platform = inferPlatform(detail, inferPlatform(summary, this.user.platform));
      results.push(toMainSystemPayload(detail, platform));
    }

    return results;
  }

  async fetchOrdersByDate(date: string) {
    const token = this.requireToken();
    const results: MainSystemOrderPayload[] = [];

    for (let page = 1; page < 100; page += 1) {
      const url = new URL("/query/list/?", BASE_URL);
      url.searchParams.set("page", String(page));
      url.searchParams.set("page_size", "20");
      url.searchParams.set("filter_type", "all");
      url.searchParams.set("filter_goods_num", "goods_number");
      url.searchParams.set("filter_gird", "all");
      url.searchParams.set("filter_label", "all");
      url.searchParams.set("filter_time", "0");
      url.searchParams.set("filter_stime", "60");
      url.searchParams.set("filter_date", date);
      url.searchParams.set("date_type", "order_date");
      url.searchParams.set("shop_id", "0");
      url.searchParams.set("mode", "list");
      url.searchParams.set("sort_map", "[object Object]");
      url.searchParams.set("source", "all");
      url.searchParams.set("source_tag", "all");
      url.searchParams.set("platform_source", "all");
      url.searchParams.set("mode_type", "0");
      url.searchParams.set("tab", "0");
      url.searchParams.set("token", token);
      url.searchParams.set("controller", "open");
      url.searchParams.set("sort", "1");
      url.searchParams.set("goods_number", "0");
      url.searchParams.set("f", "json");

      const response = await this.get<MaiyatianQueryListResponse>(url);
      const rows = Array.isArray(response.data) ? response.data : [];
      if (rows.length === 0) {
        break;
      }

      for (const row of rows) {
        const orderId = String(row.id || "").trim();
        if (!orderId) continue;
        const detail = await this.fetchOrderDetailWithShopAddress(orderId);
        const platform = inferPlatform(detail, inferPlatform(row, this.user.platform));
        results.push(toMainSystemPayload(detail, platform));
      }

      if (rows.length < 20) {
        break;
      }
    }

    return results;
  }

  async fetchOrderDetail(orderId: string) {
    const token = this.requireToken();
    const url = new URL("/order/detail/?", BASE_URL);
    url.searchParams.set("detail", "1");
    url.searchParams.set("f", "json");
    url.searchParams.set("token", token);
    url.searchParams.set("id", orderId);

    const response = await this.get<{ data?: MaiyatianOrderDetail }>(url);
    if (!response.data || typeof response.data !== "object") {
      throw new Error(`order detail missing for ${orderId}`);
    }
    return response.data;
  }

  async fetchOrderDetailWithShopAddress(orderId: string) {
    const detail = await this.fetchOrderDetail(orderId);
    return await this.fillShopAddress(detail);
  }

  async fetchSessionIdentity() {
    if (!this.identityPromise) {
      this.identityPromise = this.loadSessionIdentity();
    }
    return this.identityPromise;
  }

  async buildEventFromOrderId(orderId: string, statusHint = "") {
    const detail = await this.fetchOrderDetailWithShopAddress(orderId);
    return this.toEvent(detail, statusHint);
  }

  async submitSelfDelivery(command: SelfDeliveryCommand) {
    const detailId = String(command.sourceId || "").trim();
    if (!detailId) {
      throw new Error("sourceId is required");
    }

    const body = new URLSearchParams({
      id: detailId,
      dispatcherId: "0",
      logisticTag: "oneself",
      tip: "0",
      weight: "0",
      remark: "",
      amount: "0",
      deliveryTime: "0",
      direct: "0",
      insure: "0",
      special: "0",
      priority: "0",
      car: "0",
      traffic: "0",
      trafficWay: "",
      cake: "0",
      mealType: "0",
      fromDoor: "0",
      toDoor: "0",
      doorService: "0",
    }).toString();

    const response = await this.postForm(SELF_DELIVERY_SUBMIT_URL, body);
    const text = await response.text();
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      parsed = null;
    }

    return {
      ok: response.ok && Number(parsed?.errno || 0) === 1,
      status: response.status,
      parsed,
      text,
      submitParams: {
        id: detailId,
        logisticTag: "oneself",
      },
    };
  }

  async submitPickupComplete(command: PickupCompleteCommand) {
    const detailId = String(command.sourceId || "").trim();
    if (!detailId) {
      throw new Error("sourceId is required");
    }

    const body = new URLSearchParams({
      id: detailId,
      logisticTag: "picker",
    }).toString();

    const response = await this.postForm(SELF_DELIVERY_SUBMIT_URL, body);
    const text = await response.text();
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      parsed = null;
    }

    return {
      ok: response.ok && Number(parsed?.errno || 0) === 1,
      status: response.status,
      parsed,
      text,
      submitParams: {
        id: detailId,
        logisticTag: "picker",
      },
    };
  }

  async submitCompleteDelivery(command: CompleteDeliveryCommand) {
    const detailId = String(command.sourceId || "").trim();
    const deliveryId = String(command.deliveryId || "").trim();
    const token = this.requireToken();
    if (!detailId || !deliveryId) {
      throw new Error("sourceId and deliveryId are required");
    }

    const body = new URLSearchParams({
      id: detailId,
      delivery_id: deliveryId,
      status: "50",
      delivery_name: "",
      delivery_phone: "",
      tag: "oneself",
    }).toString();

    const response = await this.postForm(`${COMPLETE_DELIVERY_TRACK_URL}${encodeURIComponent(token)}`, body);
    const text = await response.text();
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      parsed = null;
    }

    return {
      ok: response.ok && Number(parsed?.errno || 0) === 1,
      status: response.status,
      parsed,
      text,
      submitParams: {
        id: detailId,
        delivery_id: deliveryId,
        status: "50",
        tag: "oneself",
      },
    };
  }

  async submitMealComplete(command: MealCompleteCommand) {
    const detailId = String(command.sourceId || "").trim();
    if (!detailId) {
      throw new Error("sourceId is required");
    }

    const body = new URLSearchParams({
      id: detailId,
    }).toString();

    const response = await this.postForm(MEAL_COMPLETE_URL, body);
    const text = await response.text();
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      parsed = null;
    }

    const errno = Number(parsed?.errno || 0);
    const message = String(parsed?.message || "").trim();
    const alreadyCompleted = errno === 5011 || /已完成备货|不能重复备货/.test(message);

    return {
      ok: response.ok && (errno === 1 || alreadyCompleted),
      status: response.status,
      parsed,
      text,
      submitParams: {
        id: detailId,
      },
    };
  }

  async collectEvents() {
    const events: DeliveryEvent[] = [];

    for (const status of this.config.statuses) {
      const orders = await this.fetchStatusOrders(status);
      for (const summary of orders) {
        const orderId = String(summary.id || "").trim();
        if (!orderId) continue;
        const detail = await this.fetchOrderDetailWithShopAddress(orderId);
        events.push(this.toEvent(detail, status));
      }
    }

    return events;
  }

  private toEvent(detail: MaiyatianOrderDetail, statusHint: string): DeliveryEvent {
    const platform = inferPlatform(detail, this.user.platform);
    const orderNo = String(detail.source_id || detail.source_sn || detail.id || "").trim();
    const status = resolveStatus(detail, statusHint);
    const eventId = [
      this.user.label,
      String(detail.id || detail.source_id || ""),
      status.kind,
      status.value,
    ].join(":");

    if (status.kind === "delete") {
      return {
        kind: "delete",
        sourceLabel: this.user.label,
        apiKey: this.user.apiKey,
        eventId,
        platform,
        orderNo,
        rawPayload: detail,
      };
    }

    const payload = toMainSystemPayload(detail, platform);
    if (status.value === "cancel") {
      payload.status = "已取消";
    }

    return {
      kind: "upsert",
      sourceLabel: this.user.label,
      apiKey: this.user.apiKey,
      eventId,
      platform,
      orderNo,
      payload,
      rawPayload: detail,
    };
  }

  private async loadSessionIdentity(): Promise<MaiyatianSessionIdentity> {
    const html = await this.fetchHtml("/order/");
    const accountId =
      matchFirst(html, /var\s+gAccountId\s*=\s*'(\d+)'/) ||
      matchFirst(html, /uid'\s*,\s*'(\d+)'/) ||
      matchFirst(html, /访问accountId.*?(\d+)/);
    const merchantId =
      matchFirst(html, /var\s+gMerchantId\s*=\s*'(\d+)'/) ||
      matchFirst(html, /user_id=(\d+)/) ||
      matchFirst(html, /privacyAuth\/getUrl\/\?source=1&page=1&user_id=(\d+)/);

    if (!accountId || !merchantId) {
      throw new Error(`failed to parse merchant/account id for label ${this.user.label}`);
    }

    return {
      merchantId,
      accountId,
    };
  }

  private requireToken() {
    const cookie = String(this.user.cookie || "").trim();
    const token = readCookieValue(cookie, "token");
    if (!cookie) {
      throw new Error(`label ${this.user.label} missing cookie`);
    }
    if (!token) {
      throw new Error(`label ${this.user.label} cookie missing token`);
    }
    return token;
  }

  private async fillShopAddress(detail: MaiyatianOrderDetail) {
    const existing = readPreferredShopAddress(detail);
    if (existing) {
      return detail;
    }

    const delivery = detail.delivery && typeof detail.delivery === "object" ? detail.delivery : null;
    const shopId = String(detail.shop_id || delivery?.shop_id || detail.merchant_id || "").trim();
    if (!shopId) {
      return detail;
    }

    const shopMap = await this.fetchShopMap();
    const matched = shopMap.get(shopId);
    if (!matched?.address) {
      return detail;
    }

    return {
      ...detail,
      shop_address: String(detail.shop_address || "").trim() || matched.address,
      shopAddress: String(detail.shopAddress || "").trim() || matched.address,
      store_address: String(detail.store_address || "").trim() || matched.address,
      storeAddress: String(detail.storeAddress || "").trim() || matched.address,
      merchant_address: String(detail.merchant_address || "").trim() || matched.address,
      merchantAddress: String(detail.merchantAddress || "").trim() || matched.address,
      channel_address: String(detail.channel_address || "").trim() || matched.address,
      channelAddress: String(detail.channelAddress || "").trim() || matched.address,
      extend: {
        ...(detail.extend && typeof detail.extend === "object" ? detail.extend : {}),
        storeAddress: readNestedString(detail.extend, "storeAddress") || matched.address,
        store_address: readNestedString(detail.extend, "store_address") || matched.address,
        merchantAddress: readNestedString(detail.extend, "merchantAddress") || matched.address,
        merchant_address: readNestedString(detail.extend, "merchant_address") || matched.address,
        channelAddress: readNestedString(detail.extend, "channelAddress") || matched.address,
        channel_address: readNestedString(detail.extend, "channel_address") || matched.address,
      },
    };
  }

  private async fetchShopMap() {
    if (!this.shopMapPromise) {
      this.shopMapPromise = this.loadShopMap();
    }
    return this.shopMapPromise;
  }

  private async loadShopMap() {
    const entryHtml = await this.fetchHtml("/shop/");
    const cityTabs = parseMaiyatianCityTabs(entryHtml);
    const deduped = new Map<string, MaiyatianShopRecord>();

    for (const shop of parseMaiyatianShopRows(entryHtml)) {
      deduped.set(shop.id, shop);
    }

    for (const city of cityTabs) {
      const cityHtml = await this.fetchHtml(`/shop/?city=${encodeURIComponent(city.cityCode)}`);
      for (const shop of parseMaiyatianShopRows(cityHtml, city.cityCode, city.cityName)) {
        deduped.set(shop.id, shop);
      }
    }

    return deduped;
  }

  private async get<T>(url: URL) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.httpTimeoutMs);
    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          Cookie: String(this.user.cookie || ""),
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Maiyatian request failed with ${response.status} for ${url.pathname}`);
      }

      return await response.json() as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async fetchHtml(pathname: string) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.httpTimeoutMs);
    try {
      const response = await fetch(new URL(pathname, BASE_URL), {
        headers: {
          Accept: "text/html,application/xhtml+xml",
          Cookie: String(this.user.cookie || ""),
        },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Maiyatian html request failed with ${response.status} for ${pathname}`);
      }
      return await response.text();
    } finally {
      clearTimeout(timeout);
    }
  }

  private async postForm(pathname: string, body: string) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.httpTimeoutMs);
    try {
      const response = await fetch(new URL(pathname, BASE_URL), {
        method: "POST",
        headers: {
          Accept: "application/json, text/javascript, */*; q=0.01",
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "X-Requested-With": "XMLHttpRequest",
          Cookie: String(this.user.cookie || ""),
        },
        body,
        signal: controller.signal,
      });

      return response;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function matchFirst(input: string, pattern: RegExp) {
  const match = input.match(pattern);
  return match?.[1]?.trim() || "";
}

function stripHtmlTags(input: string) {
  return String(input || "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseMaiyatianCityTabs(html: string) {
  const result: Array<{ cityCode: string; cityName: string }> = [];
  const cityPattern = /<a[^>]+href="\/shop\/\?city=([^"]+)"[^>]*>\s*<span>([^<]+)<\/span>\s*<\/a>/gi;
  let match: RegExpExecArray | null = null;

  while ((match = cityPattern.exec(html))) {
    const cityCode = String(match[1] || "").trim();
    const cityName = stripHtmlTags(match[2] || "");
    if (!cityCode || cityCode === "all" || !cityName) {
      continue;
    }
    result.push({ cityCode, cityName });
  }

  return result;
}

function parseMaiyatianShopRows(html: string, cityCode?: string, cityName?: string) {
  const shops: MaiyatianShopRecord[] = [];
  const rowPattern = /<tr>\s*<td class="multi">([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>[\s\S]*?\/shop\/edit\/\?id=(\d+)/gi;
  let match: RegExpExecArray | null = null;

  while ((match = rowPattern.exec(html))) {
    const multiCell = String(match[1] || "");
    const id = String(match[3] || "").trim();
    const labelMatch = multiCell.match(/<label>([\s\S]*?)<\/label>/i);
    const address = stripHtmlTags(labelMatch?.[1] || "");
    const name = stripHtmlTags(multiCell.replace(/<label>[\s\S]*?<\/label>/i, ""));

    if (!id || !name || !address) {
      continue;
    }

    shops.push({
      id,
      name,
      address,
      cityCode: cityCode || undefined,
      cityName: cityName || undefined,
    });
  }

  return shops;
}

function readNestedString(value: unknown, key: string) {
  if (!value || typeof value !== "object") {
    return "";
  }
  return String((value as Record<string, unknown>)[key] || "").trim();
}

function readPreferredShopAddress(detail: MaiyatianOrderDetail) {
  return String(
    detail.shop_address
    || detail.shopAddress
    || detail.store_address
    || detail.storeAddress
    || detail.merchant_address
    || detail.merchantAddress
    || detail.channel_address
    || detail.channelAddress
    || readNestedString(detail.extend, "storeAddress")
    || readNestedString(detail.extend, "store_address")
    || readNestedString(detail.extend, "merchantAddress")
    || readNestedString(detail.extend, "merchant_address")
    || readNestedString(detail.extend, "channelAddress")
    || readNestedString(detail.extend, "channel_address")
    || ""
  ).trim();
}

function normalizeDeliveryId(value: unknown) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized === "0") {
    return undefined;
  }
  return normalized;
}

function toMainSystemPayload(detail: MaiyatianOrderDetail, platform: string): MainSystemOrderPayload {
  const mapAddress = String(detail.map_address || detail.address || "").trim();
  const shopName = String(
    detail.shop_name
    || detail.channel_name
    || detail.channelName
    || detail.storeName
    || detail.merchantName
    || detail.merchant_name
    || detail.extend?.channel_name
    || ""
  ).trim();
  const shopAddress = String(
    detail.shop_address
    || detail.shopAddress
    || detail.store_address
    || detail.storeAddress
    || detail.merchant_address
    || detail.merchantAddress
    || detail.channel_address
    || detail.channelAddress
    || detail.extend?.storeAddress
    || detail.extend?.store_address
    || detail.extend?.merchantAddress
    || detail.extend?.merchant_address
    || detail.extend?.channelAddress
    || detail.extend?.channel_address
    || detail.shop_name
    || ""
  ).trim();
  const fallbackUserAddress = mapAddress || shopAddress || String(detail.delivery_time_format || "").trim() || "到店自提";
  const delivery = detail.delivery && typeof detail.delivery === "object" ? detail.delivery : null;
  const fee = detail.fee && typeof detail.fee === "object" ? detail.fee : null;

  return {
    id: String(detail.id || "").trim(),
    sourceId: String(detail.id || "").trim() || undefined,
    shopId: String(detail.shop_id || detail.merchant_id || "").trim() || undefined,
    deliveryId: normalizeDeliveryId(delivery?.id || delivery?.logistic_id),
    city: toNumber(detail.city),
    channelTag: String(detail.channel_tag || "").trim() || undefined,
    platform,
    dailyPlatformSequence: Math.max(0, Number(detail.source_sn || 0) || 0),
    orderNo: String(detail.source_id || detail.source_sn || detail.id || "").trim(),
    orderTime: normalizeOrderTime(detail.order_time),
    userAddress: fallbackUserAddress,
    rawShopName: shopName || undefined,
    shopAddress: shopAddress || undefined,
    rawShopAddress: shopAddress || undefined,
    isSubscribe: isTruthy(detail.is_subscribe),
    completedAt: normalizeTime(detail.finished_time || detail.finishedTime),
    longitude: toNumber(detail.longitude),
    latitude: toNumber(detail.latitude),
    status: describeStatus(detail),
    deliveryDeadline: normalizeDeliveryDeadline(detail.delivery_time),
    deliveryTimeRange: String(detail.delivery_time_format || "").trim() || undefined,
    distanceKm: toKilometers(detail.delivery_distance),
    distanceIsLinear: false,
    actualPaid: toFen(fee?.user_fee || detail.total_price),
    expectedIncome: toFen(fee?.shop_fee || detail.balance_price),
    platformCommission: toFen(fee?.commission),
    delivery: delivery ? {
      logisticName: String(delivery.logistic_name || delivery.delivery_name || "").trim() || undefined,
      sendFee: toFen(delivery.send_fee),
      pickupTime: normalizeTime(delivery.pickup_time),
      track: String(delivery.track || "").trim() || undefined,
      riderName: String(delivery.delivery_name || "").trim() || undefined,
      riderPhone: String(delivery.delivery_phone || "").trim() || undefined,
    } : undefined,
    items: Array.isArray(detail.goods)
      ? detail.goods.map((item) => ({
          productName: String(item.goods_name || "").trim(),
          productNo: String(item.sku_code || "").trim() || undefined,
          quantity: Math.max(1, Number(item.number || 1)),
          thumb: String(item.thumb || "").trim() || undefined,
        })).filter((item) => item.productName)
      : [],
    customerRemark: String(detail.user_remark || detail.remark || "").trim() || undefined,
    unencryptedPhone: String(detail.unencrypted_phone || "").trim() || undefined,
    unencryptedAddress: String(detail.unencrypted_address || "").trim() || undefined,
    unencryptedMapAddress: String(detail.unencrypted_map_address || "").trim() || undefined,
    customerName: String(detail.real_name || detail.realName || detail.nick_name || detail.nickName || "").trim() || undefined,
    customerPhone: String(detail.unencrypted_phone || detail.phone || "").trim() || undefined,
    customerMaskedPhone: String(detail.secret_phone || "").trim() || undefined,
    customerPhoneExtension: String(detail.phone_extend || "").trim() || undefined,
  };
}

function inferPlatform(
  detail: Pick<MaiyatianOrderDetail, "channel_tag_name" | "channel_tag">,
  fallback: string
) {
  const explicit = String(detail.channel_tag_name || "").trim();
  if (explicit) {
    return normalizePlatformName(explicit);
  }
  const channelTag = String(detail.channel_tag || "").trim().toLowerCase();
  if (channelTag === "shangou") return "美团";
  if (channelTag === "daojia") return "京东";
  if (channelTag === "ebai") return "淘宝";
  if (channelTag) return normalizePlatformName(channelTag);
  return fallback || "美团";
}

function normalizePlatformName(platform: string) {
  const normalized = String(platform || "").trim();
  if (!normalized) return "";
  const lower = normalized.toLowerCase();
  if (normalized === "淘宝闪购") return "淘宝";
  if (lower === "meituan") return "美团";
  if (lower === "jd") return "京东";
  if (lower === "taobao") return "淘宝";
  if (lower === "other" || normalized === "其它" || normalized === "其他" || normalized === "线下交易") return "线下交易";
  return normalized;
}

function resolveStatus(detail: MaiyatianOrderDetail, statusHint: string) {
  const rawStatus = String(detail.status || "").trim().toLowerCase();
  const deliveryTrack = String(detail.delivery && typeof detail.delivery === "object" ? detail.delivery.track || "" : "").trim();
  const isCancelled = isTruthy(detail.is_cancel) || (String(detail.cancel_status || "").trim() !== "" && String(detail.cancel_status) !== "0");
  const deletedByStatus = ["deleted", "delete"].includes(rawStatus) || /删除/.test(deliveryTrack);
  const cancelledByStatus = ["cancel", "cancelled", "canceled", "close", "closed"].includes(rawStatus) || /取消|撤销|回滚/.test(deliveryTrack);
  const normalizedHint = String(statusHint || "").trim().toLowerCase();
  const isHintCancel = normalizedHint === "cancel" || normalizedHint === "refund" || normalizedHint === "close" || normalizedHint === "closed" || normalizedHint === "rollback";

  if (deletedByStatus || normalizedHint === "delete" || normalizedHint === "deleted" || normalizedHint === "remove") {
    return { kind: "delete" as const, value: rawStatus || "delete" };
  }

  if (isCancelled || cancelledByStatus || isHintCancel) {
    return { kind: "upsert" as const, value: "cancel" };
  }

  return { kind: "upsert" as const, value: rawStatus || normalizedHint || "confirm" };
}

function describeStatus(detail: MaiyatianOrderDetail) {
  const rawStatus = String(detail.status || "").trim();
  const deliveryTrack = String(detail.delivery && typeof detail.delivery === "object" ? detail.delivery.track || "" : "").trim();
  const isCancelled = isTruthy(detail.is_cancel) || (String(detail.cancel_status || "").trim() !== "" && String(detail.cancel_status) !== "0");
  if (isCancelled) return "已取消";
  if (deliveryTrack) return deliveryTrack;
  return rawStatus || undefined;
}

function normalizeOrderTime(value: unknown) {
  const text = String(value || "").trim();
  if (text) return text;
  return normalizeTime(value) || new Date().toISOString().slice(0, 19).replace("T", " ");
}

function normalizeTime(value: unknown) {
  if (typeof value === "number" || /^\d+$/.test(String(value || "").trim())) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) {
      const date = new Date(numeric * 1000);
      return formatShanghaiDate(date);
    }
  }
  const text = String(value || "").trim();
  return text || undefined;
}

function normalizeDeliveryDeadline(value: unknown) {
  const normalized = normalizeTime(value);
  if (!normalized) return undefined;
  return normalized.slice(5, 16);
}

function toNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function toKilometers(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return undefined;
  return Number((numeric / 1000).toFixed(3));
}

function toFen(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function isTruthy(value: unknown) {
  return value === true || value === 1 || value === "1";
}

function readCookieValue(cookie: string, key: string) {
  for (const part of cookie.split(";").map((item) => item.trim()).filter(Boolean)) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    if (part.slice(0, index).trim() === key) {
      return part.slice(index + 1).trim();
    }
  }
  return "";
}

function formatShanghaiDate(date: Date) {
  const formatter = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  return formatter.format(date).replace("T", " ");
}
