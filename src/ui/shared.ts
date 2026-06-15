import { FailedEventFilters, FailedEventSummary } from "../types.js";

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function normalizeFailedEventFilters(searchParams: URLSearchParams): FailedEventFilters {
  const limit = Number(searchParams.get("limit") || "100");
  const connectionName = String(searchParams.get("name") || searchParams.get("label") || "").trim();
  return {
    label: connectionName,
    platform: String(searchParams.get("platform") || "").trim(),
    orderNo: String(searchParams.get("orderNo") || "").trim(),
    kind: String(searchParams.get("kind") || "").trim() as FailedEventFilters["kind"],
    error: String(searchParams.get("error") || "").trim(),
    limit: Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 500) : 100,
  };
}

export function formatAdminDateTime(value: string | undefined) {
  const text = String(value || "").trim();
  if (!text) return { dateLabel: "-", timeLabel: "-" };

  const date = new Date(text);
  if (Number.isNaN(date.getTime())) {
    const normalized = text.replace("T", " ").replace("Z", "");
    const [datePart, timePart] = normalized.split(" ");
    return {
      dateLabel: datePart || normalized,
      timeLabel: timePart || "-",
    };
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");

  return {
    dateLabel: `${year}-${month}-${day}`,
    timeLabel: `${hours}:${minutes}:${seconds}`,
  };
}

export function formatAdminDateTimeInline(value: string | undefined) {
  const formatted = formatAdminDateTime(value);
  return [formatted.dateLabel, formatted.timeLabel].filter((item) => item && item !== "-").join(" ") || "-";
}

export function formatFailedEventType(kind: FailedEventSummary["kind"]) {
  if (kind === "progress") return "进度";
  if (kind === "upsert") return "更新";
  if (kind === "delete") return "删除";
  return kind;
}

export function getAttemptSeverityClass(attempts: number) {
  if (attempts >= 30) return "attempt-danger";
  if (attempts >= 10) return "attempt-warn";
  return "attempt-neutral";
}

export function renderFailedEventError(lastError?: string) {
  const raw = String(lastError || "").trim();
  if (!raw) {
    return `<span class="error-empty">-</span>`;
  }

  const statusMatch = raw.match(/failed with (\d{3})/i) || raw.match(/\bstatus(?:Code)?[=: ]+(\d{3})\b/i);
  const statusCode = statusMatch?.[1] || "";
  const methodMatch = raw.match(/\b(GET|POST|PUT|PATCH|DELETE)\s+([^\s]+?)(?::\s| failed|\swith|\srequest|\safter|$)/i);
  const method = methodMatch?.[1]?.toUpperCase() || "";
  const endpoint = methodMatch?.[2] || "";
  const jsonErrorMatch = raw.match(/"error"\s*:\s*"([^"]+)"/i);
  const plainErrorMatch = raw.match(/"message"\s*:\s*"([^"]+)"/i);
  const summary = jsonErrorMatch?.[1]
    || plainErrorMatch?.[1]
    || (statusCode ? `请求失败 ${statusCode}` : raw.slice(0, 120));

  return `
    <div class="error-stack">
      <div class="error-summary">${escapeHtml(summary)}</div>
      ${(statusCode || method || endpoint) ? `
        <div class="error-meta">
          ${statusCode ? `<span class="error-badge">${escapeHtml(statusCode)}</span>` : ""}
          ${method ? `<span class="error-method">${escapeHtml(method)}</span>` : ""}
          ${endpoint ? `<code class="error-endpoint">${escapeHtml(endpoint)}</code>` : ""}
        </div>
      ` : ""}
      <details class="error-raw">
        <summary>查看原始错误</summary>
        <pre>${escapeHtml(raw)}</pre>
      </details>
    </div>
  `;
}

export function buildFailedEventsReturnPath(filters: {
  label?: string;
  platform?: string;
  orderNo?: string;
  kind?: string;
  error?: string;
  limit?: number;
}) {
  const params = new URLSearchParams();
  if (filters.label) params.set("name", filters.label);
  if (filters.platform) params.set("platform", filters.platform);
  if (filters.orderNo) params.set("orderNo", filters.orderNo);
  if (filters.kind) params.set("kind", filters.kind);
  if (filters.error) params.set("error", filters.error);
  if (filters.limit) params.set("limit", String(filters.limit));
  const query = params.toString();
  return query ? `/admin/failed-events?${query}` : "/admin/failed-events";
}

export function renderFailedEventRows(items: FailedEventSummary[], returnTo: string) {
  return items.map((item) => `
    <tr>
      <td data-label="连接">
        <div class="cell-stack">
          <strong>${escapeHtml(item.sourceLabel)}</strong>
          <span class="cell-subtle">${escapeHtml(item.platform)}</span>
        </div>
      </td>
      <td data-label="订单">
        <div class="cell-stack">
          <code>${escapeHtml(item.orderNo)}</code>
          <span class="cell-subtle">${escapeHtml(item.platform)}</span>
        </div>
      </td>
      <td data-label="类型"><span class="kind-badge kind-${escapeHtml(item.kind)}">${escapeHtml(formatFailedEventType(item.kind))}</span></td>
      <td data-label="重试">
        <div class="cell-stack">
          <span class="attempt-badge ${getAttemptSeverityClass(item.attempts)}">${item.attempts}</span>
        </div>
      </td>
      <td data-label="时间"><span class="retry-time" title="${escapeHtml(String(item.nextRetryAt || ""))}">${escapeHtml(`${formatAdminDateTime(item.nextRetryAt).dateLabel} ${formatAdminDateTime(item.nextRetryAt).timeLabel}`)}</span></td>
      <td data-label="最近错误">
        <div class="error-cell">
          ${renderFailedEventError(item.lastError)}
          <form method="post" action="/admin/actions" class="inline-action" onsubmit="return confirm('忽略后这条失败记录会立即删除，确认继续？');">
            <input type="hidden" name="action" value="delete-failed-event" />
            <input type="hidden" name="id" value="${escapeHtml(item.id)}" />
            <input type="hidden" name="returnTo" value="${escapeHtml(returnTo)}" />
            <button type="submit" class="danger-link">忽略这条记录</button>
          </form>
        </div>
      </td>
    </tr>
  `).join("");
}
