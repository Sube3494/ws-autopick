import http from "node:http";
import { PluginRuntime } from "./plugin.js";
import { FailedEventFilters, RuntimeSettings } from "./types.js";
import {
  normalizeFailedEventFilters,
  renderAuthPage,
  renderDashboardPage,
  renderFailedEventsPage,
  renderForbiddenPage,
  renderHealthViewerPage,
} from "./ui-pages.js";

const SESSION_COOKIE = "ws_autopick_session";

function readApiKey(headers: http.IncomingHttpHeaders) {
  const xApiKey = Array.isArray(headers["x-api-key"]) ? headers["x-api-key"][0] : headers["x-api-key"];
  if (xApiKey) return xApiKey;

  const authorization = Array.isArray(headers.authorization) ? headers.authorization[0] : headers.authorization;
  if (authorization?.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length).trim();
  }

  return null;
}

function readCookies(headers: http.IncomingHttpHeaders) {
  const raw = Array.isArray(headers.cookie) ? headers.cookie[0] : headers.cookie;
  const result: Record<string, string> = {};
  for (const part of String(raw || "").split(";").map((item) => item.trim()).filter(Boolean)) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    result[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return result;
}

async function readRequestBody(request: http.IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseFormBody(body: string) {
  const params = new URLSearchParams(body);
  return Object.fromEntries(params.entries());
}

function redirect(response: http.ServerResponse, location: string) {
  response.writeHead(302, { Location: location });
  response.end();
}

function writeSessionCookie(response: http.ServerResponse, token: string) {
  response.setHeader("Set-Cookie", `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=604800; SameSite=Lax`);
}

function clearSessionCookie(response: http.ServerResponse) {
  response.setHeader("Set-Cookie", `${SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);
}

function getSessionUser(runtime: PluginRuntime, request: http.IncomingMessage) {
  const token = readCookies(request.headers)[SESSION_COOKIE] || null;
  const user = runtime.getSessionUser(token);
  return { token, user };
}

function parseSettings(body: Record<string, string>, current: RuntimeSettings): RuntimeSettings {
  return {
    pushBaseUrl: String(body.pushBaseUrl || current.pushBaseUrl).trim(),
    publicBaseUrl: String(body.publicBaseUrl || current.publicBaseUrl).trim(),
    pollIntervalMs: Number(body.pollIntervalMs || current.pollIntervalMs),
    httpTimeoutMs: Number(body.httpTimeoutMs || current.httpTimeoutMs),
    maxListPages: Number(body.maxListPages || current.maxListPages),
    pageSize: Number(body.pageSize || current.pageSize),
    failedRetryIntervalMs: Number(body.failedRetryIntervalMs || current.failedRetryIntervalMs),
    dedupeTtlMs: Number(body.dedupeTtlMs || current.dedupeTtlMs),
    wsHeartbeatIntervalMs: Number(body.wsHeartbeatIntervalMs || current.wsHeartbeatIntervalMs),
    wsReconnectBaseMs: Number(body.wsReconnectBaseMs || current.wsReconnectBaseMs),
    wsReconnectMaxMs: Number(body.wsReconnectMaxMs || current.wsReconnectMaxMs),
    pickingWaitTimeoutMs: Number(body.pickingWaitTimeoutSeconds || Math.round(current.pickingWaitTimeoutMs / 1000)) * 1000,
    mealCompleteCooldownMs: Number(body.mealCompleteCooldownSeconds || Math.round(current.mealCompleteCooldownMs / 1000)) * 1000,
    statuses: String(body.statuses || current.statuses.join(",")).split(",").map((item) => item.trim()).filter(Boolean),
  };
}

function requireAdmin(runtime: PluginRuntime, request: http.IncomingMessage, response: http.ServerResponse) {
  const { token, user } = getSessionUser(runtime, request);
  if (!user) {
    redirect(response, "/auth");
    return null;
  }
  if (!user.isAdmin) {
    redirect(response, "/forbidden");
    return null;
  }
  return { token, user };
}

export function createServer(runtime: PluginRuntime) {
  return http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", "http://127.0.0.1");
      const method = request.method || "GET";

      if (url.pathname === "/" && method === "GET") {
        redirect(response, "/admin");
        return;
      }

      if (url.pathname === "/auth" && method === "GET") {
        const { user } = getSessionUser(runtime, request);
        if (user?.isAdmin) {
          redirect(response, "/admin");
          return;
        }
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(renderAuthPage({ smtpReady: runtime.isSmtpReady() }));
        return;
      }

      if (url.pathname === "/auth/send-code" && method === "POST") {
        const body = parseFormBody(await readRequestBody(request));
        try {
          await runtime.sendLoginCode(String(body.email || ""));
          response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          response.end(renderAuthPage({
            smtpReady: runtime.isSmtpReady(),
            email: String(body.email || ""),
            info: "验证码已发送，请查看邮箱。",
          }));
        } catch (error) {
          response.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          response.end(renderAuthPage({
            smtpReady: runtime.isSmtpReady(),
            email: String(body.email || ""),
            error: error instanceof Error ? error.message : "发送验证码失败",
          }));
        }
        return;
      }

      if (url.pathname === "/auth/verify" && method === "POST") {
        const body = parseFormBody(await readRequestBody(request));
        try {
          const { token, user } = await runtime.verifyLoginCode(String(body.email || ""), String(body.code || ""));
          writeSessionCookie(response, token);
          response.writeHead(302, { Location: user.isAdmin ? "/admin" : "/forbidden" });
          response.end();
        } catch (error) {
          response.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          response.end(renderAuthPage({
            smtpReady: runtime.isSmtpReady(),
            email: String(body.email || ""),
            error: error instanceof Error ? error.message : "登录失败",
          }));
        }
        return;
      }

      if (url.pathname === "/logout" && method === "POST") {
        const { token } = getSessionUser(runtime, request);
        runtime.deleteSession(token);
        clearSessionCookie(response);
        redirect(response, "/auth");
        return;
      }

      if (url.pathname === "/forbidden" && method === "GET") {
        const { user } = getSessionUser(runtime, request);
        if (!user) {
          redirect(response, "/auth");
          return;
        }
        response.writeHead(403, { "Content-Type": "text/html; charset=utf-8" });
        response.end(renderForbiddenPage(user));
        return;
      }

      if (url.pathname === "/admin/health-check" && method === "GET") {
        const session = requireAdmin(runtime, request, response);
        if (!session) return;

        const apiKey = String(url.searchParams.get("apiKey") || "").trim();
        if (!runtime.isAuthorized(apiKey)) {
          response.writeHead(401, { "Content-Type": "text/html; charset=utf-8" });
          response.end(renderHealthViewerPage({ ok: false, error: "Unauthorized" }));
          return;
        }

        const payload = await runtime.health();
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(renderHealthViewerPage(payload));
        return;
      }

      if (url.pathname === "/admin/failed-events" && method === "GET") {
        const session = requireAdmin(runtime, request, response);
        if (!session) return;

        const filters = normalizeFailedEventFilters(url.searchParams);
        const [items, data] = await Promise.all([
          runtime.listFailedEvents(filters),
          runtime.dashboardData(),
        ]);

        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(renderFailedEventsPage({
          currentUser: session.user,
          filters,
          items,
          total: data.failedEventCount,
        }));
        return;
      }

      if (url.pathname === "/admin/actions" && method === "POST") {
        const session = requireAdmin(runtime, request, response);
        if (!session) return;

        const body = parseFormBody(await readRequestBody(request));
        const action = String(body.action || "").trim();

        if (action === "create") {
          const created = await runtime.createConnection(String(body.name || body.label || ""), String(body.platform || "美团"));
          const data = await runtime.dashboardData();
          response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          response.end(renderDashboardPage(data, session.user, "新 key 已生成，正在尝试自动复制。", created?.apiKey || ""));
          return;
        }

        if (action === "update") {
          await runtime.updateConnection({
            id: Number(body.id),
            label: String(body.name || body.label || ""),
            platform: String(body.platform || "美团"),
            enabled: body.enabled === "1",
          });
          redirect(response, "/admin?message=connection-saved");
          return;
        }

        if (action === "toggle") {
          const enabled = body.enabled === "1";
          await runtime.toggleConnection(Number(body.id), enabled);
          redirect(response, `/admin?message=${enabled ? "connection-enabled" : "connection-disabled"}`);
          return;
        }

        if (action === "regenerate") {
          await runtime.regenerateApiKey(Number(body.id));
          redirect(response, "/admin?message=key-regenerated");
          return;
        }

        if (action === "delete") {
          await runtime.deleteConnection(Number(body.id));
          redirect(response, "/admin?message=connection-deleted");
          return;
        }

        if (action === "delete-failed-event") {
          await runtime.deleteFailedEvent(String(body.id || ""));
          const returnTo = String(body.returnTo || "/admin/failed-events").trim() || "/admin/failed-events";
          redirect(response, returnTo);
          return;
        }

        if (action === "settings") {
          const current = runtime.getRuntimeSettings();
          await runtime.updateRuntimeSettings(parseSettings(body, current));
          redirect(response, "/admin?message=settings-saved");
          return;
        }

        response.writeHead(400, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ ok: false, error: "Unknown action" }));
        return;
      }

      if (url.pathname === "/admin" && method === "GET") {
        const session = requireAdmin(runtime, request, response);
        if (!session) return;

        const data = await runtime.dashboardData();
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(renderDashboardPage(data, session.user, mapMessage(url.searchParams.get("message"))));
        return;
      }

      if (url.pathname === "/health" && method === "GET") {
        const apiKey = readApiKey(request.headers);
        if (!runtime.isAuthorized(apiKey)) {
          response.writeHead(401, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ ok: false, error: "Unauthorized" }));
          return;
        }

        const payload = await runtime.health();
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify(payload));
        return;
      }

      if (url.pathname.startsWith("/list-orders/") && method === "GET") {
        const apiKey = readApiKey(request.headers);
        if (!runtime.isAuthorized(apiKey)) {
          response.writeHead(401, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ ok: false, error: "Unauthorized" }));
          return;
        }

        const status = decodeURIComponent(url.pathname.slice("/list-orders/".length)).trim();
        if (!status) {
          response.writeHead(400, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ ok: false, error: "status is required" }));
          return;
        }

        const payload = await runtime.listOrdersByStatus(apiKey || "", status);
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify(payload));
        return;
      }

      if (url.pathname.startsWith("/all-orders/") && method === "GET") {
        const apiKey = readApiKey(request.headers);
        if (!runtime.isAuthorized(apiKey)) {
          response.writeHead(401, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ ok: false, error: "Unauthorized" }));
          return;
        }

        const date = decodeURIComponent(url.pathname.slice("/all-orders/".length)).trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          response.writeHead(400, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ ok: false, error: "date must be YYYY-MM-DD" }));
          return;
        }

        const payload = await runtime.listOrdersByDate(apiKey || "", date);
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify(payload));
        return;
      }

      if (url.pathname === "/api/connections/cookie" && method === "POST") {
        const apiKey = readApiKey(request.headers);
        if (!runtime.isAuthorized(apiKey)) {
          response.writeHead(401, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ ok: false, error: "Unauthorized" }));
          return;
        }

        const rawBody = await readRequestBody(request);
        let body: Record<string, unknown>;
        try {
          body = rawBody ? JSON.parse(rawBody) as Record<string, unknown> : {};
        } catch {
          response.writeHead(400, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ ok: false, error: "Invalid JSON body" }));
          return;
        }

        const cookie = typeof body.cookie === "string" ? body.cookie : "";
        const enabled = typeof body.enabled === "boolean" ? body.enabled : true;
        const updated = await runtime.syncConnectionCookie(apiKey || "", cookie, enabled);

        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({
          ok: true,
          connection: {
            id: updated.id,
            label: updated.label,
            enabled: updated.enabled,
            hasCookie: Boolean(String(updated.cookie || "").trim()),
            updatedAt: updated.updatedAt,
          },
        }));
        return;
      }

      if (url.pathname === "/self-delivery" && method === "POST") {
        const apiKey = readApiKey(request.headers);
        if (!runtime.isAuthorized(apiKey)) {
          response.writeHead(401, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ ok: false, error: "Unauthorized" }));
          return;
        }

        const rawBody = await readRequestBody(request);
        let body: Record<string, unknown>;
        try {
          body = rawBody ? JSON.parse(rawBody) as Record<string, unknown> : {};
        } catch {
          response.writeHead(400, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ ok: false, error: "Invalid JSON body" }));
          return;
        }

        const sourceId = String(body.sourceId || "").trim();
        const orderNo = String(body.orderNo || "").trim();
        const platform = String(body.platform || "").trim();
        const dailyPlatformSequence = Number(body.dailyPlatformSequence || 0);

        if (!sourceId || !orderNo || !platform || !Number.isFinite(dailyPlatformSequence) || dailyPlatformSequence <= 0) {
          response.writeHead(400, { "Content-Type": "application/json" });
          response.end(JSON.stringify({
            ok: false,
            error: "platform, dailyPlatformSequence, orderNo and sourceId are required",
          }));
          return;
        }

        const payload = await runtime.selfDelivery(apiKey || "", {
          platform,
          dailyPlatformSequence,
          orderNo,
          sourceId,
        });
        response.writeHead(payload.ok ? 200 : 409, { "Content-Type": "application/json" });
        response.end(JSON.stringify(payload));
        return;
      }

      if ((url.pathname === "/pickup-complete" || url.pathname === "/meal-complete" || url.pathname === "/complete-delivery") && method === "POST") {
        const apiKey = readApiKey(request.headers);
        if (!runtime.isAuthorized(apiKey)) {
          response.writeHead(401, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ ok: false, error: "Unauthorized" }));
          return;
        }

        const rawBody = await readRequestBody(request);
        let body: Record<string, unknown>;
        try {
          body = rawBody ? JSON.parse(rawBody) as Record<string, unknown> : {};
        } catch {
          response.writeHead(400, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ ok: false, error: "Invalid JSON body" }));
          return;
        }

        const sourceId = String(body.sourceId || "").trim();
        const deliveryId = String(body.deliveryId || "").trim();
        const orderNo = String(body.orderNo || "").trim();
        const platform = String(body.platform || "").trim();
        const dailyPlatformSequence = Number(body.dailyPlatformSequence || 0);

        const requiresDeliveryId = url.pathname === "/complete-delivery";
        if (
          !sourceId
          || !orderNo
          || !platform
          || !Number.isFinite(dailyPlatformSequence)
          || dailyPlatformSequence <= 0
          || (requiresDeliveryId && !deliveryId)
        ) {
          response.writeHead(400, { "Content-Type": "application/json" });
          response.end(JSON.stringify({
            ok: false,
            error: requiresDeliveryId
              ? "platform, dailyPlatformSequence, orderNo, sourceId and deliveryId are required"
              : "platform, dailyPlatformSequence, orderNo and sourceId are required",
          }));
          return;
        }

        const payload = url.pathname === "/pickup-complete"
          ? await runtime.pickupComplete(apiKey || "", {
              platform,
              dailyPlatformSequence,
              orderNo,
              sourceId,
            })
          : url.pathname === "/complete-delivery"
            ? await runtime.completeDelivery(apiKey || "", {
                platform,
                dailyPlatformSequence,
                orderNo,
                sourceId,
                deliveryId,
              })
            : await runtime.mealComplete(apiKey || "", {
                platform,
                dailyPlatformSequence,
                orderNo,
                sourceId,
              });
        response.writeHead(payload.ok ? 200 : 409, { "Content-Type": "application/json" });
        response.end(JSON.stringify(payload));
        return;
      }

      response.writeHead(404, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: false, error: "Not found" }));
    } catch (error) {
      response.writeHead(500, { "Content-Type": "application/json" });
      response.end(JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : "Unknown server error",
      }));
    }
  });
}

function mapMessage(value: string | null) {
  if (value === "key-created") return "新 key 已生成。";
  if (value === "connection-saved") return "连接配置已保存。";
  if (value === "connection-enabled") return "连接已启用。";
  if (value === "connection-disabled") return "连接已暂停。";
  if (value === "key-regenerated") return "key 已重置。";
  if (value === "connection-deleted") return "连接已删除。";
  if (value === "settings-saved") return "运行设置已保存并立即生效。";
  return "";
}
