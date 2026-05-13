export type UserConfig = {
  id: number;
  label: string;
  enabled: boolean;
  platform: string;
  cookie?: string;
  apiKey: string;
  createdAt?: string;
  updatedAt?: string;
  lastUsedAt?: string;
};

export type AppConfig = {
  host: string;
  port: number;
  pushBaseUrl: string;
  publicBaseUrl?: string;
  dataDir: string;
  dbPath: string;
  smtpHost?: string;
  smtpPort: number;
  smtpUser?: string;
  smtpPass?: string;
  smtpFrom?: string;
  smtpSecure: boolean;
  pollIntervalMs: number;
  httpTimeoutMs: number;
  maxListPages: number;
  pageSize: number;
  failedRetryIntervalMs: number;
  dedupeTtlMs: number;
  statuses: string[];
  wsHeartbeatIntervalMs: number;
  wsReconnectBaseMs: number;
  wsReconnectMaxMs: number;
  mealCompleteCooldownMs: number;
};

export type RuntimeSettings = {
  pushBaseUrl: string;
  publicBaseUrl: string;
  pollIntervalMs: number;
  httpTimeoutMs: number;
  maxListPages: number;
  pageSize: number;
  failedRetryIntervalMs: number;
  dedupeTtlMs: number;
  wsHeartbeatIntervalMs: number;
  wsReconnectBaseMs: number;
  wsReconnectMaxMs: number;
  mealCompleteCooldownMs: number;
  statuses: string[];
};

export type DeliveryEvent =
  | {
      kind: "upsert";
      sourceLabel: string;
      apiKey: string;
      eventId: string;
      platform: string;
      orderNo: string;
      payload: MainSystemOrderPayload;
      rawPayload: unknown;
    }
  | {
      kind: "delete";
      sourceLabel: string;
      apiKey: string;
      eventId: string;
      platform: string;
      orderNo: string;
      sourceId?: string;
      dailyPlatformSequence?: number;
      logisticId?: string;
      rawPayload: unknown;
    }
  | {
      kind: "progress";
      sourceLabel: string;
      apiKey: string;
      eventId: string;
      platform: string;
      orderNo: string;
      progress: {
        pickCompleted?: boolean;
        pickRemainingSeconds?: number;
        statusHint?: string;
      };
      rawPayload: unknown;
    };

export type MainSystemOrderPayload = {
  id: string;
  sourceId?: string;
  shopId?: string;
  logisticId?: string;
  city?: number;
  channelTag?: string;
  platform: string;
  dailyPlatformSequence?: number;
  orderNo: string;
  orderTime: string;
  userAddress: string;
  rawShopName?: string;
  shopAddress?: string;
  rawShopAddress?: string;
  isSubscribe?: boolean;
  completedAt?: string;
  longitude?: number;
  latitude?: number;
  status?: string;
  deliveryDeadline?: string;
  deliveryTimeRange?: string;
  distanceKm?: number;
  distanceIsLinear?: boolean;
  actualPaid?: number;
  expectedIncome?: number;
  platformCommission?: number;
  delivery?: {
    logisticName?: string;
    sendFee?: number;
    pickupTime?: string;
    track?: string;
    riderName?: string;
  };
  items: Array<{
    productName: string;
    productNo?: string;
    quantity: number;
    thumb?: string;
  }>;
};

export type MaiyatianOrderSummary = {
  id: string;
  source_id?: string;
  source_sn?: string;
  channel_tag_name?: string;
  channel_tag?: string;
  order_time?: string | number;
  map_address?: string;
  address?: string;
  shop_name?: string;
  status?: string;
  tips?: string;
  is_subscribe?: boolean | number | string;
  delivery_id?: string | number;
  delivery_distance?: string | number;
  total_price?: string | number;
  balance_price?: string | number;
  fee?: {
    user_fee?: string | number;
    shop_fee?: string | number;
    commission?: string | number;
  };
  extend?: Record<string, unknown>;
  [key: string]: unknown;
};

export type MaiyatianOrderDetail = {
  id?: string;
  source_id?: string;
  source_sn?: string;
  city?: string | number;
  shop_id?: string | number;
  channel_name?: string;
  channelName?: string;
  storeName?: string;
  merchantName?: string;
  merchant_name?: string;
  shop_address?: string;
  shopAddress?: string;
  store_address?: string;
  storeAddress?: string;
  merchant_address?: string;
  merchantAddress?: string;
  channel_address?: string;
  channelAddress?: string;
  channel_tag?: string;
  channel_tag_name?: string;
  channel_id?: string | number;
  merchant_id?: string | number;
  order_time?: string;
  map_address?: string;
  address?: string;
  shop_name?: string;
  longitude?: string | number;
  latitude?: string | number;
  status?: string;
  user_remark?: string;
  system_remark?: string;
  is_subscribe?: boolean | number | string;
  finished_time?: string | number;
  finishedTime?: string;
  delivery_distance?: string | number;
  delivery_time?: string | number;
  delivery_end?: string | number;
  delivery_time_format?: string;
  total_price?: string | number;
  balance_price?: string | number;
  fee?: {
    user_fee?: string | number;
    shop_fee?: string | number;
    commission?: string | number;
  };
  extend?: Record<string, unknown>;
  goods?: Array<{
    goods_name?: string;
    sku_code?: string;
    number?: string | number;
    thumb?: string;
  }>;
  delivery?: {
    id?: string | number;
    logistic_id?: string | number;
    logistic_name?: string;
    send_fee?: string | number;
    pickup_time?: string | number;
    track?: string;
    delivery_name?: string;
    finished_time?: string | number;
    shop_id?: string | number;
  } | false;
  is_cancel?: string | number | boolean;
  cancel_status?: string | number;
  cancel?: unknown[];
  [key: string]: unknown;
};

export type UserRuntimeSnapshot = {
  label: string;
  platform: string;
  enabled: boolean;
  running: boolean;
  wsConnected: boolean;
  queueSize: number;
  lastPollAt?: string;
  lastWsMessageAt?: string;
  lastSuccessPushAt?: string;
  lastError?: string;
  failedEventCount: number;
};

export type FailedEventRecord = {
  id: string;
  createdAt: string;
  attempts: number;
  nextRetryAt: string;
  event: DeliveryEvent;
  lastError?: string;
};

export type FailedEventSummary = {
  id: string;
  createdAt: string;
  attempts: number;
  nextRetryAt: string;
  kind: DeliveryEvent["kind"];
  sourceLabel: string;
  platform: string;
  orderNo: string;
  lastError?: string;
};

export type FailedEventFilters = {
  label?: string;
  platform?: string;
  orderNo?: string;
  kind?: DeliveryEvent["kind"] | "";
  error?: string;
  limit?: number;
};

export type MaiyatianSessionIdentity = {
  merchantId: string;
  accountId: string;
};

export type SelfDeliveryCommand = {
  platform: string;
  dailyPlatformSequence: number;
  orderNo: string;
  sourceId: string;
  logisticId: string;
};

export type PickupCompleteCommand = {
  platform: string;
  dailyPlatformSequence: number;
  orderNo: string;
  sourceId: string;
  logisticId?: string;
};

export type CompleteDeliveryCommand = {
  platform: string;
  dailyPlatformSequence: number;
  orderNo: string;
  sourceId: string;
  logisticId: string;
};

export type MealCompleteCommand = {
  platform: string;
  dailyPlatformSequence: number;
  orderNo: string;
  sourceId: string;
  logisticId?: string;
};

export type AdminUserSummary = {
  id: number;
  label: string;
  enabled: boolean;
  platform: string;
  hasCookie: boolean;
  cookie?: string;
  apiKey: string;
  wsConnected: boolean;
  lastSuccessPushAt?: string;
  lastWsMessageAt?: string;
  lastError?: string;
  createdAt?: string;
  updatedAt?: string;
  lastUsedAt?: string;
};

export type ConnectionUpdateInput = {
  id: number;
  label: string;
  platform: string;
  cookie?: string;
  enabled: boolean;
};

export type AuthUser = {
  id: number;
  email: string;
  isAdmin: boolean;
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
};

export type DashboardData = {
  publicBaseUrl: string;
  pushBaseUrl: string;
  failedEventCount: number;
  failedEvents: FailedEventSummary[];
  users: AdminUserSummary[];
  settings: RuntimeSettings;
  authUsers: AuthUser[];
};
