import { AuthUser, FailedEventFilters, FailedEventSummary } from "../types.js";
import { buildFailedEventsReturnPath, escapeHtml, renderFailedEventRows } from "./shared.js";
import { INTER_FONT_LINK, renderSharedPageTheme, THEME_BOOTSTRAP_SCRIPT } from "./theme.js";

type FailedEventPageStats = {
  maxAttempts: number;
  highRiskCount: number;
  activeRetryCount: number;
};

function buildFailedEventPageStats(items: FailedEventSummary[]): FailedEventPageStats {
  return {
    maxAttempts: items.reduce((max, item) => Math.max(max, item.attempts), 0),
    highRiskCount: items.filter((item) => item.attempts >= 30).length,
    activeRetryCount: items.filter((item) => item.attempts < 50).length,
  };
}

function renderFailedEventStats(total: number, currentCount: number, stats: FailedEventPageStats) {
  return `<section class="stats">
      <div class="panel stat"><div class="stat-label">失败总数</div><div class="stat-value">${total}</div></div>
      <div class="panel stat"><div class="stat-label">当前结果</div><div class="stat-value">${currentCount}</div></div>
      <div class="panel stat"><div class="stat-label">最高重试</div><div class="stat-value">${stats.maxAttempts}</div></div>
      <div class="panel stat"><div class="stat-label">高风险记录</div><div class="stat-value">${stats.highRiskCount}</div></div>
    </section>`;
}

function renderFailedEventFilters(filters: FailedEventFilters, limit: number) {
  return `<section class="panel">
      <form method="get" action="/admin/failed-events" class="filters">
        <div class="filter-grid">
          <div class="field span-4">
            <label for="name">连接名称</label>
            <input id="name" name="name" value="${escapeHtml(filters.label || "")}" placeholder="输入连接名称" />
          </div>
          <div class="field span-4">
            <label for="platform">平台</label>
            <input id="platform" name="platform" value="${escapeHtml(filters.platform || "")}" placeholder="输入平台名称" />
          </div>
          <div class="field span-4">
            <label for="orderNo">单号</label>
            <input id="orderNo" name="orderNo" value="${escapeHtml(filters.orderNo || "")}" placeholder="输入订单号" />
          </div>
          <div class="field span-3">
            <label>类型</label>
            <div class="custom-select" id="kind-select">
              <div class="custom-select-trigger">
                <span>${filters.kind === "upsert" ? "upsert" : filters.kind === "progress" ? "progress" : filters.kind === "delete" ? "delete" : "全部"}</span>
                <span class="chevron"></span>
              </div>
              <div class="custom-select-options">
                <div class="custom-select-option ${!filters.kind ? "active" : ""}" data-value="">全部</div>
                <div class="custom-select-option ${filters.kind === "upsert" ? "active" : ""}" data-value="upsert">upsert</div>
                <div class="custom-select-option ${filters.kind === "progress" ? "active" : ""}" data-value="progress">progress</div>
                <div class="custom-select-option ${filters.kind === "delete" ? "active" : ""}" data-value="delete">delete</div>
              </div>
              <input type="hidden" name="kind" value="${escapeHtml(filters.kind || "")}" />
            </div>
          </div>
          <div class="field span-3">
            <label for="error-keyword">错误关键字</label>
            <input
              id="error-keyword"
              name="error"
              value="${escapeHtml(filters.error || "")}"
              placeholder="输入错误信息关键字"
            />
          </div>
          <div class="field span-3">
            <label>查询数量</label>
            <div class="custom-select" id="limit-select">
              <div class="custom-select-trigger">
                <span>${limit}</span>
                <span class="chevron"></span>
              </div>
              <div class="custom-select-options">
                <div class="custom-select-option ${limit === 50 ? "active" : ""}" data-value="50">50</div>
                <div class="custom-select-option ${limit === 100 ? "active" : ""}" data-value="100">100</div>
                <div class="custom-select-option ${limit === 200 ? "active" : ""}" data-value="200">200</div>
                <div class="custom-select-option ${limit === 500 ? "active" : ""}" data-value="500">500</div>
              </div>
              <input type="hidden" name="limit" value="${limit}" />
            </div>
          </div>
          <div class="field span-3 actions">
            <div class="filter-actions">
              <button type="submit" class="primary">筛选</button>
              <a href="/admin/failed-events" class="ghost">重置</a>
            </div>
          </div>
        </div>
      </form>
    </section>`;
}

function renderFailedEventResults(total: number, currentCount: number, stats: FailedEventPageStats, rows: string) {
  return `<section class="panel" style="margin-top:20px;">
      ${total > 0 ? `<div class="warning">当前有 ${total} 条失败积压，正在重试中的记录约 ${stats.activeRetryCount} 条；永久错误或超过阈值的记录会自动清理。</div>` : ""}
      <div class="note" style="margin-bottom:16px;">展示最近符合条件的 ${currentCount} 条记录，默认按下次重试时间升序排列。重试超过 30 次的记录建议优先排查。</div>
      ${currentCount > 0 ? `
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>连接</th>
                <th>订单</th>
                <th>类型</th>
                <th>重试</th>
                <th>时间</th>
                <th>最近错误</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      ` : `<div class="empty">没有符合筛选条件的失败积压。</div>`}
    </section>`;
}

export function renderFailedEventsPage(options: {
  currentUser: AuthUser;
  filters: FailedEventFilters;
  items: FailedEventSummary[];
  total: number;
}) {
  const returnTo = buildFailedEventsReturnPath(options.filters);
  const rows = renderFailedEventRows(options.items, returnTo);
  const limit = options.filters.limit || 100;
  const stats = buildFailedEventPageStats(options.items);

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>失败积压详情</title>
  ${INTER_FONT_LINK}
  ${THEME_BOOTSTRAP_SCRIPT}
  <style>
    ${renderSharedPageTheme({ wrapMaxWidth: "1320px", wrapPadding: "40px 24px 56px" })}
    :root {
      --row-bg: rgba(31, 41, 55, 0.5); --btn-sec-bg: rgba(255,255,255,0.08); --btn-sec-hover: rgba(255,255,255,0.12);
    }
    :root.light {
      --row-bg: rgba(255,255,255,0.75); --btn-sec-bg: rgba(0,0,0,0.05); --btn-sec-hover: rgba(0,0,0,0.1);
    }
    .hero { display: flex; justify-content: space-between; gap: 20px; align-items: flex-start; padding: 28px 32px; margin-bottom: 20px; }
    .hero h1 { margin: 0; font-size: 36px; letter-spacing: -0.04em; background: linear-gradient(120deg, var(--text-main), #fda4af 42%, #fb7185 78%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .hero p { margin: 10px 0 0; color: var(--text-muted); line-height: 1.7; max-width: 760px; }
    a, button { border: 0; border-radius: 12px; padding: 12px 18px; font-size: 14px; font-weight: 600; cursor: pointer; text-decoration: none; transition: 0.2s ease; }
    .panel { padding: 28px; }
    .stats { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 16px; margin-bottom: 20px; }
    .stat { padding: 24px; position: relative; overflow: hidden; isolation: isolate; }
    .stat::after { content: ""; position: absolute; inset: auto -10% -34% auto; width: 170px; height: 170px; border-radius: 999px; background: radial-gradient(circle, rgba(251, 113, 133, 0.16), transparent 70%); z-index: -1; }
    .stat-label { font-size: 12px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.08em; font-weight: 700; margin-bottom: 10px; }
    .stat-value { font-size: 34px; font-weight: 800; letter-spacing: -0.03em; }
    .filters { display: grid; gap: 14px; }
    .filter-grid {
      display: grid;
      grid-template-columns: repeat(12, minmax(0,1fr));
      gap: 12px;
      align-items: end;
      padding: 14px;
      border-radius: 22px;
      background:
        linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.015)),
        rgba(255,255,255,0.018);
      border: 1px solid rgba(255,255,255,0.06);
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.05), 0 12px 24px rgba(15, 23, 42, 0.08);
    }
    :root.light .filter-grid {
      background:
        linear-gradient(180deg, rgba(255,255,255,0.95), rgba(248,250,252,0.9)),
        rgba(255,255,255,0.7);
      border-color: rgba(15, 23, 42, 0.05);
      box-shadow:
        inset 0 1px 0 rgba(255,255,255,0.8),
        0 10px 30px rgba(148, 163, 184, 0.08);
    }
    .field {
      min-width: 0;
      grid-column: span 2;
      display: flex;
      flex-direction: column;
      align-self: stretch;
    }
    .field.span-3 { grid-column: span 3; }
    .field.span-4 { grid-column: span 3; }
    .field.span-6 { grid-column: span 6; }
    .field label { display: block; margin-bottom: 6px; font-size: 12px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.06em; }
    .field-control {
      width: 100%;
      min-width: 0;
    }
    .field-control.select {
      position: relative;
      display: flex;
      align-items: center;
    }
    .field-control.select > select {
      flex: 1 1 auto;
    }
    .field input, .field select {
      display: block;
      width: 100%;
      min-width: 0;
      height: 46px;
      border: 1px solid var(--input-border);
      border-radius: 14px;
      padding: 0 14px;
      background:
        linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.015)),
        var(--input-bg);
      color: var(--text-main);
      font: inherit;
      font-size: 14px;
      line-height: 46px;
      box-shadow:
        inset 0 1px 0 rgba(255,255,255,0.05),
        0 8px 18px rgba(15, 23, 42, 0.08);
      transition: border-color 0.18s ease, box-shadow 0.18s ease, transform 0.18s ease, background 0.18s ease;
    }
    .field select {
      appearance: none;
      -webkit-appearance: none;
    }
    :root.light .field input, :root.light .field select {
      background:
        linear-gradient(180deg, rgba(255,255,255,1), rgba(248,250,252,0.92)),
        var(--input-bg);
      box-shadow:
        inset 0 1px 0 rgba(255,255,255,0.95),
        0 10px 22px rgba(148, 163, 184, 0.12);
    }
    .field input::placeholder { color: color-mix(in srgb, var(--text-muted) 78%, transparent); }
    .field select {
      padding-right: 42px;
      cursor: pointer;
    }
    .field input:hover, .field select:hover {
      border-color: color-mix(in srgb, var(--input-border) 55%, #38bdf8 45%);
      box-shadow:
        inset 0 1px 0 rgba(255,255,255,0.06),
        0 12px 24px rgba(14, 165, 233, 0.08);
    }
    .field input:focus, .field select:focus {
      outline: none;
      border-color: #38bdf8;
      background:
        linear-gradient(180deg, rgba(56,189,248,0.08), rgba(255,255,255,0.02)),
        var(--input-bg);
      box-shadow:
        0 0 0 4px rgba(56,189,248,0.16),
        0 16px 32px rgba(14, 165, 233, 0.14);
      transform: translateY(-1px);
    }
    .field-control.select::after {
      content: "";
      position: absolute;
      right: 15px;
      top: 50%;
      width: 9px;
      height: 9px;
      border-right: 2px solid color-mix(in srgb, var(--text-muted) 78%, transparent);
      border-bottom: 2px solid color-mix(in srgb, var(--text-muted) 78%, transparent);
      transform: translateY(-65%) rotate(45deg);
      pointer-events: none;
      transition: transform 0.18s ease, border-color 0.18s ease;
    }
    .field-control.select:focus-within::after {
      transform: translateY(-45%) rotate(45deg);
      border-color: #38bdf8;
    }
    .filter-actions {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      align-items: flex-end;
      height: 100%;
    }
    .field.actions {
      justify-content: flex-end;
      align-self: end;
    }
    .filter-actions .primary, .filter-actions .ghost {
      min-width: 92px;
      border-radius: 14px;
      height: 46px;
      padding: 0 18px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .field.actions .filter-actions {
      min-height: 46px;
    }
    .note { color: var(--text-muted); font-size: 13px; line-height: 1.7; }
    .warning { margin-bottom: 18px; padding: 14px 16px; border-radius: 18px; background: linear-gradient(135deg, rgba(251,113,133,0.16), rgba(249,115,22,0.1)); border: 1px solid rgba(251,113,133,0.24); color: #fb7185; font-weight: 600; box-shadow: 0 10px 24px rgba(251, 113, 133, 0.08); }
    .table-wrap { overflow: auto; border: 1px solid var(--panel-border); border-radius: 24px; background: linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.012)); box-shadow: inset 0 1px 0 rgba(255,255,255,0.05); }
    table { width: 100%; min-width: 860px; border-collapse: collapse; table-layout: fixed; }
    th, td { text-align: left; padding: 14px 16px; border-bottom: 1px solid var(--divider); font-size: 13px; vertical-align: top; }
    th { color: var(--text-muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; font-weight: 700; background: rgba(255,255,255,0.02); }
    td code { font-family: Consolas, monospace; font-size: 12px; }
    th:nth-child(1), td:nth-child(1) { width: 120px; }
    th:nth-child(2), td:nth-child(2) { width: 230px; }
    th:nth-child(3), td:nth-child(3) { width: 110px; }
    th:nth-child(4), td:nth-child(4) { width: 90px; }
    th:nth-child(5), td:nth-child(5) { width: 170px; }
    .cell-stack { display: grid; gap: 6px; min-width: 0; }
    .cell-subtle {
      color: var(--text-muted);
      font-size: 12px;
      line-height: 1.4;
      word-break: break-word;
    }
    .kind-badge, .attempt-badge, .error-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 28px;
      padding: 0 10px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.02em;
    }
    .kind-badge {
      background: rgba(255,255,255,0.08);
      box-shadow: inset 0 0 0 1px var(--panel-border);
      color: var(--text-main);
    }
    .kind-progress { color: #38bdf8; background: rgba(56,189,248,0.12); box-shadow: inset 0 0 0 1px rgba(56,189,248,0.22); }
    .kind-upsert { color: #22c55e; background: rgba(34,197,94,0.12); box-shadow: inset 0 0 0 1px rgba(34,197,94,0.22); }
    .kind-delete { color: #f97316; background: rgba(249,115,22,0.12); box-shadow: inset 0 0 0 1px rgba(249,115,22,0.22); }
    .attempt-badge {
      min-width: 44px;
      background: rgba(255,255,255,0.08);
      box-shadow: inset 0 0 0 1px var(--panel-border);
    }
    .attempt-neutral { color: var(--text-main); }
    .attempt-warn { color: #fbbf24; background: rgba(251,191,36,0.12); box-shadow: inset 0 0 0 1px rgba(251,191,36,0.22); }
    .attempt-danger { color: #fb7185; background: rgba(244,63,94,0.12); box-shadow: inset 0 0 0 1px rgba(244,63,94,0.22); }
    .error-cell { display: grid; gap: 10px; }
    .inline-action { margin: 0; display: flex; justify-content: flex-start; }
    .danger-link {
      border: 0;
      background: linear-gradient(135deg, rgba(239,68,68,0.14), rgba(251,113,133,0.14));
      color: #fb7185;
      box-shadow: inset 0 0 0 1px rgba(239,68,68,0.18);
      border-radius: 999px;
      padding: 6px 12px;
      font-size: 12px;
      font-weight: 700;
    }
    .danger-link:hover { background: linear-gradient(135deg, rgba(239,68,68,0.2), rgba(251,113,133,0.2)); }
    .retry-time {
      color: var(--text-main);
      white-space: normal;
      font-variant-numeric: tabular-nums;
      font-size: 12px;
    }
    .error-stack { display: grid; gap: 8px; max-width: 100%; }
    .error-summary { font-weight: 700; line-height: 1.5; }
    .error-meta {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
    }
    .error-badge {
      color: #fda4af;
      background: rgba(244,63,94,0.12);
      box-shadow: inset 0 0 0 1px rgba(244,63,94,0.22);
    }
    .error-method {
      font-size: 12px;
      font-weight: 700;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .error-endpoint {
      display: inline-block;
      max-width: 100%;
      padding: 4px 8px;
      border-radius: 10px;
      background: rgba(255,255,255,0.06);
      box-shadow: inset 0 0 0 1px var(--panel-border);
      white-space: normal;
      word-break: break-all;
    }
    .error-raw {
      border-radius: 14px;
      background: rgba(255,255,255,0.04);
      box-shadow: inset 0 0 0 1px rgba(255,255,255,0.05);
      overflow: hidden;
    }
    .error-raw summary {
      cursor: pointer;
      padding: 10px 12px;
      color: var(--text-muted);
      font-size: 12px;
      font-weight: 700;
      list-style: none;
    }
    .error-raw summary::-webkit-details-marker { display: none; }
    .error-raw pre {
      margin: 0;
      padding: 0 12px 12px;
      white-space: pre-wrap;
      word-break: break-word;
      font-family: Consolas, monospace;
      font-size: 12px;
      line-height: 1.6;
      color: var(--text-muted);
    }
    .error-empty { color: var(--text-muted); }
    .empty { padding: 28px; color: var(--text-muted); text-align: center; }
    .theme-toggle { white-space: nowrap; }
    @media (max-width: 1100px) {
      .filter-grid { grid-template-columns: repeat(6, minmax(0,1fr)); }
      .field.span-3 { grid-column: span 3; }
      .field.span-4 { grid-column: span 2; }
      .field.span-6 { grid-column: span 6; }
      .stats { grid-template-columns: 1fr 1fr; }
    }
    @media (max-width: 768px) {
      .wrap { padding: 24px 16px 40px; }
      .hero { flex-direction: column; padding: 24px 20px; }
      .hero h1 { font-size: 28px; }
      .hero p { font-size: 14px; max-width: none; }
      .toolbar { width: 100%; }
      .toolbar > * { flex: 1 1 100%; text-align: center; justify-content: center; }
      .panel { padding: 20px; border-radius: 24px; }
      .stat { padding: 20px; }
      .stat-value { font-size: 30px; }
      .filter-grid { grid-template-columns: 1fr; }
      .field, .field.span-3, .field.span-4, .field.span-6, .field.actions { grid-column: auto; }
      .filter-grid { padding: 0; border: 0; background: transparent; box-shadow: none; }
      .field input, .field select { height: 44px; line-height: 44px; }
      .field.actions { justify-content: stretch; }
      .filter-actions { flex-direction: column; }
      .filter-actions > * { width: 100%; justify-content: center; text-align: center; }
      .table-wrap { overflow: visible; border: 0; background: transparent; }
      table { min-width: 0; }
      thead { display: none; }
      tbody { display: grid; gap: 14px; }
      tr {
        display: block;
        border: 1px solid var(--panel-border);
        border-radius: 18px;
        background: var(--row-bg);
        overflow: hidden;
      }
      td {
        display: grid;
        grid-template-columns: 88px minmax(0, 1fr);
        gap: 12px;
        padding: 12px 14px;
        font-size: 13px;
      }
      td::before {
        content: attr(data-label);
        color: var(--text-muted);
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      td code { word-break: break-all; }
      .note { font-size: 12px; }
    }
    @media (max-width: 480px) {
      a, button { padding: 12px 16px; font-size: 13px; }
      .hero h1 { font-size: 24px; }
      .stat-value { font-size: 26px; }
      .stats { grid-template-columns: 1fr; }
      td { grid-template-columns: 1fr; gap: 6px; }
    }

    /* 自定义下拉框样式 */
    .custom-select {
      position: relative;
      width: 100%;
    }
    .custom-select-trigger {
      display: flex;
      justify-content: space-between;
      align-items: center;
      width: 100%;
      height: 54px;
      border: 1px solid var(--input-border);
      border-radius: 18px;
      padding: 0 18px;
      background:
        linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.015)),
        var(--input-bg);
      color: var(--text-main);
      font-size: 15px;
      cursor: pointer;
      box-shadow:
        inset 0 1px 0 rgba(255,255,255,0.05),
        0 8px 18px rgba(15, 23, 42, 0.08);
      transition: all 0.18s ease;
    }
    :root.light .custom-select-trigger {
      background:
        linear-gradient(180deg, rgba(255,255,255,1), rgba(248,250,252,0.92)),
        var(--input-bg);
      box-shadow:
        inset 0 1px 0 rgba(255,255,255,0.95),
        0 10px 22px rgba(148, 163, 184, 0.12);
    }
    .custom-select-trigger:hover {
      border-color: color-mix(in srgb, var(--input-border) 55%, #38bdf8 45%);
      box-shadow:
        inset 0 1px 0 rgba(255,255,255,0.06),
        0 12px 24px rgba(14, 165, 233, 0.08);
    }
    .custom-select.open .custom-select-trigger {
      border-color: #38bdf8;
      background:
        linear-gradient(180deg, rgba(56,189,248,0.08), rgba(255,255,255,0.02)),
        var(--input-bg);
      box-shadow:
        0 0 0 4px rgba(56,189,248,0.16),
        0 16px 32px rgba(14, 165, 233, 0.14);
      transform: translateY(-1px);
    }
    .custom-select-trigger .chevron {
      width: 10px;
      height: 10px;
      border-right: 2px solid color-mix(in srgb, var(--text-muted) 78%, transparent);
      border-bottom: 2px solid color-mix(in srgb, var(--text-muted) 78%, transparent);
      transform: rotate(45deg) translateY(-2px);
      transition: transform 0.18s ease, border-color 0.18s ease;
      margin-left: 12px;
    }
    .custom-select.open .custom-select-trigger .chevron {
      transform: rotate(225deg) translateY(-2px) translateX(-2px);
      border-color: #38bdf8;
    }
    .custom-select-options {
      position: absolute;
      top: calc(100% + 8px);
      left: 0;
      width: 100%;
      background: var(--panel-bg);
      backdrop-filter: blur(40px);
      -webkit-backdrop-filter: blur(40px);
      border: 1px solid var(--panel-border);
      border-radius: 20px;
      padding: 8px;
      box-shadow: var(--shadow-panel);
      opacity: 0;
      transform: translateY(-10px) scale(0.98);
      pointer-events: none;
      transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      z-index: 100;
    }
    .custom-select.open .custom-select-options {
      opacity: 1;
      transform: translateY(0) scale(1);
      pointer-events: auto;
    }
    .custom-select-option {
      padding: 12px 16px;
      font-size: 14px;
      font-weight: 500;
      color: var(--text-main);
      border-radius: 12px;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .custom-select-option:hover {
      background: var(--btn-sec-hover);
    }
    .custom-select-option.active {
      background: linear-gradient(135deg, #0ea5e9, #3b82f6);
      color: #fff;
    }
  </style>
</head>
<body>
  <div class="wrap">
    <section class="hero">
      <div>
        <h1>失败积压详情</h1>
        <p>当前登录：${escapeHtml(options.currentUser.email)}。这里单独看待重试事件，可以按连接、单号、类型和报错关键字筛选。</p>
      </div>
      <div class="toolbar">
        <a href="/admin" class="ghost">返回后台</a>
        <button type="button" class="ghost theme-toggle" id="theme-btn">切换浅色</button>
      </div>
    </section>

    ${renderFailedEventStats(options.total, options.items.length, stats)}
    ${renderFailedEventFilters(options.filters, limit)}
    ${renderFailedEventResults(options.total, options.items.length, stats, rows)}
  </div>
  <script>
    const themeBtn = document.getElementById('theme-btn');
    const html = document.documentElement;
    function updateThemeBtn() {
      if (themeBtn) themeBtn.textContent = html.classList.contains('light') ? '切换深色' : '切换浅色';
    }
    updateThemeBtn();
    if (themeBtn) {
      themeBtn.addEventListener('click', () => {
        html.classList.toggle('light');
        localStorage.setItem('theme', html.classList.contains('light') ? 'light' : 'dark');
        updateThemeBtn();
      });
    }

    // 自定义下拉选择框交互逻辑
    document.querySelectorAll('.custom-select').forEach(select => {
      const trigger = select.querySelector('.custom-select-trigger');
      const triggerText = trigger.querySelector('span');
      const options = select.querySelectorAll('.custom-select-option');
      const hiddenInput = select.querySelector('input[type="hidden"]');

      trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        // 关闭其他下拉框
        document.querySelectorAll('.custom-select').forEach(other => {
          if (other !== select) other.classList.remove('open');
        });
        select.classList.toggle('open');
      });

      options.forEach(option => {
        option.addEventListener('click', (e) => {
          e.stopPropagation();
          const val = option.dataset.value;
          const text = option.textContent;

          // 切换高亮
          options.forEach(opt => opt.classList.remove('active'));
          option.classList.add('active');

          // 更新触发器文本和隐藏输入框的值
          triggerText.textContent = text;
          hiddenInput.value = val;

          // 关闭选项面板
          select.classList.remove('open');
        });
      });
    });

    // 点击外部关闭所有下拉框
    document.addEventListener('click', () => {
      document.querySelectorAll('.custom-select').forEach(select => {
        select.classList.remove('open');
      });
    });
  </script>
</body>
</html>`;
}
