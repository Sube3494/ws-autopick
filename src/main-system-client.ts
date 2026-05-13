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
      sourceId: "sourceId" in event ? event.sourceId : undefined,
      dailyPlatformSequence: "dailyPlatformSequence" in event ? event.dailyPlatformSequence : undefined,
      deliveryId: "deliveryId" in event ? event.deliveryId : undefined,
    });
  }

  private async post(path: string, apiKey: string, body: unknown) {
    return this.request("POST", path, apiKey, body);
  }

  private async request(method: "POST" | "DELETE", path: string, apiKey: string, body: unknown) {
    const url = `${this.config.pushBaseUrl}${path}`;
    let lastError: unknown;

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.httpTimeoutMs);

      try {
        const response = await fetch(url, {
          method,
          headers: {
            Accept: "application/json",
            Connection: "close",
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
      } catch (error) {
        lastError = error;
        if (!isTransientSocketError(error) || attempt >= 2) {
          throw enrichRequestError(error, method, path, url, attempt);
        }
      } finally {
        clearTimeout(timeout);
      }
    }

    throw enrichRequestError(lastError, method, path, url, 2);
  }
}

function isTransientSocketError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof DOMException && error.name === "AbortError") {
    return true;
  }
  return message.includes("socket connection was closed unexpectedly")
    || message.includes("The operation was aborted")
    || message.includes("AbortError")
    || message.includes("ECONNRESET")
    || message.includes("UND_ERR_SOCKET")
    || message.includes("other side closed")
    || message.includes("terminated");
}

function enrichRequestError(
  error: unknown,
  method: "POST" | "DELETE",
  path: string,
  url: string,
  attempt: number,
) {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(`${method} ${path} request failed after ${attempt} attempt(s) to ${url}: ${message}`);
}
