import { AppConfig, DeliveryEvent } from "./types.js";

export class MainSystemClient {
  constructor(private readonly config: AppConfig) {}

  async deliver(event: DeliveryEvent) {
    if (event.kind === "upsert") {
      return this.post("/api/v1/api-key/listened-orders", event.apiKey, event.payload);
    }
    if (event.kind === "progress") {
      return this.post("/api/v1/api-key/listened-orders/progress", event.apiKey, {
        platform: event.platform,
        orderNo: event.orderNo,
        ...event.progress,
      });
    }
    return this.request("DELETE", "/api/v1/api-key/listened-orders", event.apiKey, {
      platform: event.platform,
      orderNo: event.orderNo,
    });
  }

  private async post(path: string, apiKey: string, body: unknown) {
    return this.request("POST", path, apiKey, body);
  }

  private async request(method: "POST" | "DELETE", path: string, apiKey: string, body: unknown) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.httpTimeoutMs);

    try {
      const response = await fetch(`${this.config.pushBaseUrl}${path}`, {
        method,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-API-Key": apiKey,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`${method} ${path} failed with ${response.status}: ${text.slice(0, 500)}`);
      }

      return await response.json().catch(() => ({}));
    } finally {
      clearTimeout(timeout);
    }
  }
}
