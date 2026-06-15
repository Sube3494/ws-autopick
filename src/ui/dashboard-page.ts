import { AuthUser, DashboardData } from "../types.js";
import { escapeHtml, formatAdminDateTimeInline } from "./shared.js";
import { INTER_FONT_LINK, renderSharedPageTheme, THEME_BOOTSTRAP_SCRIPT } from "./theme.js";

type DashboardStats = {
  onlineCount: number;
  enabledCount: number;
  cookieReadyCount: number;
  failedPeakAttempts: number;
};

function buildDashboardStats(data: DashboardData): DashboardStats {
  return {
    onlineCount: data.users.filter((user) => user.wsConnected).length,
    enabledCount: data.users.filter((user) => user.enabled).length,
    cookieReadyCount: data.users.filter((user) => user.hasCookie).length,
    failedPeakAttempts: data.failedEvents.reduce((max, item) => Math.max(max, item.attempts), 0),
  };
}

function renderConnectionRow(user: DashboardData["users"][number], index: number) {
  const seq = String(index + 1).padStart(2, "0");
  const wsBadge = user.wsConnected ? "在线" : "离线";
  const wsColor = user.wsConnected ? "#10b981" : "#ef4444";
  const wsBg = user.wsConnected ? "rgba(16,185,129,0.15)" : "rgba(239,68,68,0.15)";
  const keyPreview = user.apiKey.length > 22
    ? `${user.apiKey.slice(0, 10)}...${user.apiKey.slice(-8)}`
    : user.apiKey;

  return `<div class="connection-row">
      <div class="connection-row-head">
        <div class="cell" data-title="序号" style="color: var(--text-muted); font-family: Consolas, monospace; font-size: 14px; font-weight: 600;">
          ${seq}
        </div>
        <div class="cell" data-title="连接">
          <div class="cell-stack">
            <strong>${escapeHtml(user.label)}</strong>
          </div>
        </div>
        <div class="cell flex-center" data-title="Key" style="justify-content: flex-start;">
          <code>${escapeHtml(keyPreview)}</code>
          <button type="button" class="action-btn" data-copy="${escapeHtml(user.apiKey)}">复制</button>
        </div>
        <div class="cell" data-title="同步信息">
          <div class="cell-stack">
            <strong class="${user.hasCookie ? "text-blue" : "text-muted"}" style="font-weight:500;">
              ${user.hasCookie ? "Cookie 已同步" : "无 Cookie"}
            </strong>
            <span class="cell-subtle">${user.lastWsMessageAt ? `最近心跳 ${escapeHtml(formatAdminDateTimeInline(user.lastWsMessageAt))}` : "尚未收到 WS 消息"}</span>
            <span class="cell-subtle">${user.lastSuccessPushAt ? `最近推送 ${escapeHtml(formatAdminDateTimeInline(user.lastSuccessPushAt))}` : "尚未成功推送"}</span>
          </div>
        </div>
        <div class="cell" data-title="连接状态" style="text-align:right;">
          <span class="badge" style="color:${wsColor};background:${wsBg};box-shadow:inset 0 0 0 1px ${wsColor}40">${wsBadge}</span>
        </div>
        <div class="cell flex-center" data-title="操作" style="justify-content: flex-end; gap: 16px;">
          <div style="margin:0; display:flex; align-items:center;">
            <label class="switchline" title="开启或暂停此节点">
              <input type="checkbox" data-toggle-id="${user.id}" ${user.enabled ? "checked" : ""} onchange="toggleConnection(this)" />
              <span class="toggle"></span>
              <span class="toggle-text">${user.enabled ? "启用" : "暂停"}</span>
            </label>
          </div>
          <form method="post" action="/admin/actions" onsubmit="return confirm('删除后该节点将无法再连接。确认删除？');" style="margin:0;">
            <input type="hidden" name="action" value="delete" />
            <input type="hidden" name="id" value="${user.id}" />
            <button type="submit" class="danger-btn" style="height: 32px; padding: 0 12px; font-size: 12px; line-height: 30px;">删除</button>
          </form>
        </div>
      </div>
    </div>`;
}

function renderSummarySection(data: DashboardData, stats: DashboardStats) {
  return `<section class="summary">
      <div class="item panel summary-address">
        <div class="item-head stack-tight">
          <div class="label">主系统地址</div>
          <div class="value address-main">${escapeHtml(data.pushBaseUrl)}</div>
          <div class="meta-line">公开地址：${escapeHtml(data.publicBaseUrl)}</div>
        </div>
      </div>
      <div class="item panel summary-connections">
        <div class="item-head">
          <div class="label">连接数量</div>
          <div class="number-row">
            <div class="value number">${data.users.length}</div>
          </div>
          <div class="status-row"><span class="badge" style="color:#10b981;background:rgba(16,185,129,0.15);box-shadow:inset 0 0 0 1px rgba(16,185,129,0.24)">在线 ${stats.onlineCount}</span><span class="badge" style="color:var(--text-muted);background:var(--btn-sec-bg);box-shadow:inset 0 0 0 1px var(--panel-border)">启用 ${stats.enabledCount}</span><span class="badge" style="color:#0ea5e9;background:rgba(14,165,233,0.14);box-shadow:inset 0 0 0 1px rgba(14,165,233,0.2)">Cookie ${stats.cookieReadyCount}</span></div>
        </div>
      </div>
      <div class="item panel summary-failed">
        <div class="item-head">
          <div class="label">失败积压</div>
          <div class="value number">${data.failedEventCount}</div>
          <div class="meta-line">${stats.failedPeakAttempts > 0 ? `最高重试 ${stats.failedPeakAttempts} 次` : "当前没有积压重试"}</div>
        </div>
        <div class="item-foot">
          <a href="/admin/failed-events" class="summary-link">查看详情</a>
        </div>
      </div>
      <div class="item panel summary-runtime"><div class="item-head"><div class="label">插件状态</div><div class="value text-blue" style="font-size:24px;">运行中</div><div class="meta-line">后台服务已启动，失败回推会按设定自动重试。</div></div></div>
    </section>`;
}

function renderConnectionsSection(cards: string) {
  return `<section class="connections-panel">
      <div class="panel-head" style="margin-bottom:20px;">
        <div>
          <h3>连接列表</h3>
          <p>桌面端按表格查看，移动端会自动切成卡片。重点看连接状态、Cookie 同步和最近心跳。</p>
        </div>
      </div>
      <div class="connections-table-head" aria-hidden="true">
        <span>序号</span>
        <span>连接</span>
        <span>API Key</span>
        <span>同步信息</span>
        <span>状态</span>
        <span>操作</span>
      </div>
      <section class="list">${cards || `<div style="padding:40px;text-align:center;color:var(--text-muted);background:var(--row-bg);border-radius:24px;border:1px solid var(--panel-border);">还没有连接，请先在上方生成新 Key。</div>`}</section>
    </section>`;
}

export function renderDashboardPage(data: DashboardData, currentUser: AuthUser, message?: string, autoCopyKey?: string) {
  const stats = buildDashboardStats(data);
  const cards = data.users.map(renderConnectionRow).join("");

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>ws-autopick 管理页</title>
  ${INTER_FONT_LINK}
  ${THEME_BOOTSTRAP_SCRIPT}
  <style>
    ${renderSharedPageTheme({ wrapMaxWidth: "1200px", wrapPadding: "48px 24px" })}
    :root {
      --row-bg: rgba(31, 41, 55, 0.5); --row-hover: rgba(55, 65, 81, 0.7); --row-open: rgba(55, 65, 81, 0.9);
      --btn-sec-bg: rgba(255,255,255,0.08); --btn-sec-hover: rgba(255,255,255,0.12); --btn-sec-text: #e5e7eb;
      --code-bg: rgba(255,255,255,0.06); --code-text: #d1d5db;
      --danger-bg: rgba(239,68,68,0.15); --danger-border: rgba(239,68,68,0.3);
      --toast-bg: #fff; --toast-text: #09090b;
      --modal-bg: rgba(31,41,55,0.9);
    }
    :root.light {
      --row-bg: rgba(255, 255, 255, 0.6); --row-hover: rgba(255, 255, 255, 1); --row-open: rgba(255, 255, 255, 1);
      --btn-sec-bg: rgba(0,0,0,0.05); --btn-sec-hover: rgba(0,0,0,0.1); --btn-sec-text: #374151;
      --code-bg: rgba(0,0,0,0.05); --code-text: #374151;
      --danger-bg: rgba(239,68,68,0.1); --danger-border: rgba(239,68,68,0.2);
      --toast-bg: #111827; --toast-text: #f9fafb;
      --modal-bg: rgba(255,255,255,0.9);
    }
    .hero { display: flex; justify-content: space-between; gap: 24px; align-items: flex-start; margin-bottom: 40px; padding: 34px 36px; }
    .hero h1 { margin: 0; font-size: 40px; line-height: 1.02; letter-spacing: -0.04em; background: linear-gradient(120deg, var(--text-main), #8bd3ff 44%, #60a5fa 78%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .hero p { margin: 12px 0 0; color: var(--text-muted); line-height: 1.7; font-size: 16px; max-width: 600px; }
    button, .primary, .toolbar a {
      border: 0; border-radius: 12px;
      font-size: 14px; font-weight: 600; cursor: pointer; text-decoration: none;
      transition: all 0.2s ease; padding: 12px 20px;
    }
    button:hover { filter: brightness(1.05); transform: translateY(-1px); }
    button:active { transform: translateY(0); }
    .primary { background: linear-gradient(135deg, #0ea5e9, #3b82f6); color: #fff; box-shadow: 0 8px 20px rgba(14,165,233,0.3); }
    .ghost, .ghost-inline { background: var(--btn-sec-bg); color: var(--text-main); box-shadow: inset 0 0 0 1px var(--panel-border); }
    .ghost:hover, .ghost-inline:hover { background: var(--btn-sec-hover); box-shadow: inset 0 0 0 1px var(--panel-border); }
    .toolbar {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
    .toolbar form { margin: 0; }
    .toolbar-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      min-height: 46px;
      padding: 0 18px;
      border-radius: 999px;
      background: linear-gradient(180deg, rgba(122, 162, 255, 0.11), rgba(122, 162, 255, 0.07));
      box-shadow: inset 0 0 0 1px var(--panel-border);
    }
    .toolbar-btn svg {
      width: 16px;
      height: 16px;
      flex: 0 0 16px;
      stroke: currentColor;
    }
    .toolbar-btn-label { line-height: 1; }
    .toolbar-icon-btn {
      width: 46px;
      min-width: 46px;
      height: 46px;
      padding: 0;
      border-radius: 999px;
      gap: 0;
    }
    .toolbar-icon-btn svg {
      width: 18px;
      height: 18px;
      flex-basis: 18px;
    }
    .toolbar-action-btn {
      color: var(--text-main);
    }
    .toolbar-action-btn:hover,
    .toolbar-icon-btn:hover {
      background: linear-gradient(180deg, rgba(122, 162, 255, 0.18), rgba(122, 162, 255, 0.11));
      box-shadow: inset 0 0 0 1px rgba(148, 194, 255, 0.22);
    }
    .toolbar-exit-btn {
      background: linear-gradient(180deg, rgba(239, 68, 68, 0.12), rgba(239, 68, 68, 0.08));
      box-shadow: inset 0 0 0 1px rgba(248, 113, 113, 0.18);
    }
    .toolbar-exit-btn:hover {
      background: linear-gradient(180deg, rgba(239, 68, 68, 0.18), rgba(239, 68, 68, 0.12));
      box-shadow: inset 0 0 0 1px rgba(248, 113, 113, 0.24);
    }
    .danger { background: var(--danger-bg); color: #ef4444; box-shadow: inset 0 0 0 1px var(--danger-border); }
    .danger:hover { background: var(--danger-border); }
    .panel { transition: all 0.3s ease; }
    .summary { display: grid; grid-template-columns: repeat(12, minmax(0,1fr)); gap: 16px; margin-bottom: 24px; }
    .summary .item { padding: 28px; display: flex; flex-direction: column; justify-content: space-between; position: relative; overflow: hidden; min-height: 152px; isolation: isolate; }
    .summary .item::after { content: ""; position: absolute; inset: auto -10% -35% auto; width: 180px; height: 180px; border-radius: 999px; background: radial-gradient(circle, rgba(125, 211, 252, 0.16), transparent 72%); z-index: -1; }
    .summary .item.summary-address { grid-column: span 4; }
    .summary .item.summary-connections { grid-column: span 3; }
    .summary .item.summary-failed { grid-column: span 2; }
    .summary .item.summary-runtime { grid-column: span 3; }
    .summary .label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-muted); font-weight: 700; margin-bottom: 12px; }
    .summary .value { font-size: 20px; font-weight: 600; word-break: break-word; color: var(--text-main); }
    .summary .number { font-size: 54px; line-height: 0.94; letter-spacing: -0.04em; }
    .summary .item-head { display: grid; gap: 10px; }
    .summary .item-foot { margin-top: 20px; display: flex; align-items: center; }
    .summary .meta-line { color: var(--text-muted); font-size: 13px; line-height: 1.6; }
    .summary .status-row { display: flex; gap: 10px; flex-wrap: wrap; }
    .summary .address-main { font-size: 18px; line-height: 1.45; word-break: break-all; }
    .summary .stack-tight { display: grid; gap: 8px; }
    .summary .number-row { display: flex; align-items: flex-end; gap: 12px; flex-wrap: wrap; }
    .summary-link {
      display: inline-flex; align-items: center; justify-content: center;
      min-height: 40px; padding: 0 14px;
      border-radius: 999px;
      background: linear-gradient(135deg, rgba(14,165,233,0.16), rgba(59,130,246,0.14));
      color: var(--text-main);
      text-decoration: none;
      font-size: 13px; font-weight: 700;
      box-shadow: inset 0 0 0 1px rgba(125, 211, 252, 0.18);
      transition: all 0.2s ease;
    }
    .summary-link:hover {
      background: linear-gradient(135deg, rgba(14,165,233,0.24), rgba(59,130,246,0.2));
      transform: translateY(-1px);
    }
    .text-blue { color: #0ea5e9 !important; }
    .text-muted { color: var(--text-muted) !important; }
    .text-red { color: #ef4444 !important; }
    .admin-page {
      --connection-columns: 40px minmax(180px, 1.1fr) minmax(220px, 1.35fr) minmax(220px, 1.2fr) 92px 176px;
    }
    .layout { display: grid; grid-template-columns: 1fr; gap: 20px; margin-bottom: 28px; }
    .panel-head { display: flex; justify-content: space-between; gap: 16px; align-items: flex-end; margin-bottom: 24px; }
    .panel-head h3 { margin: 0; font-size: 24px; letter-spacing: -0.02em; }
    .panel-head p { margin: 8px 0 0; color: var(--text-muted); line-height: 1.6; font-size: 14px; }
    .create.panel { padding: 32px 36px; box-shadow: 0 20px 44px rgba(15, 23, 42, 0.2), var(--shadow-panel); }
    .settings.panel { padding: 0; }
    .settings.panel[open] .chevron { transform: rotate(225deg) translateY(-2px) translateX(-2px) !important; }
    .create form { display: grid; grid-template-columns: minmax(280px, 420px) auto; gap: 16px; align-items: end; }
    .settings form { display: grid; gap: 24px; grid-template-columns: repeat(3, minmax(0,1fr)); }
    .full { grid-column: 1 / -1; }
    .settings-groups { display: grid; gap: 20px; }
    .settings-group {
      padding: 20px;
      border-radius: 20px;
      background: linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.018));
      box-shadow: inset 0 0 0 1px var(--panel-border);
    }
    .settings-group h4 { margin: 0; font-size: 16px; }
    .settings-group p { margin: 6px 0 0; color: var(--text-muted); font-size: 13px; line-height: 1.6; }
    .settings-grid { display: grid; gap: 18px 16px; grid-template-columns: repeat(2, minmax(0,1fr)); margin-top: 18px; }
    label { display: block; margin-bottom: 8px; font-size: 13px; font-weight: 600; color: var(--text-muted); }
    input, textarea {
      width: 100%; border: 1px solid var(--input-border); border-radius: 12px;
      padding: 14px 16px; font: inherit; color: var(--text-main); background: var(--input-bg);
      transition: all 0.2s ease;
    }
    input:focus, textarea:focus { outline: none; border-color: #38bdf8; box-shadow: 0 0 0 3px rgba(56,189,248,0.2); }
    .list { display: grid; gap: 12px; }
    
    .connections-panel { padding: 0; background: transparent; border: none; box-shadow: none; backdrop-filter: none; margin-top: 8px; }
    .connections-panel .panel-head { margin-bottom: 16px; padding: 0 24px; align-items: center; }
    .connections-table-head {
      display: grid;
      grid-template-columns: var(--connection-columns);
      gap: 20px;
      padding: 0 24px 10px;
      color: var(--text-muted);
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    
    .connection-row {
      background: linear-gradient(180deg, color-mix(in srgb, var(--row-bg) 90%, rgba(255,255,255,0.03) 10%), var(--row-bg));
      border: 1px solid var(--panel-border);
      border-radius: 24px; transition: all 0.24s ease; backdrop-filter: blur(10px);
      box-shadow: 0 10px 24px rgba(2, 8, 23, 0.12);
    }
    .connection-row:hover { border-color: color-mix(in srgb, var(--divider) 65%, #7dd3fc 35%); background: var(--row-hover); transform: translateY(-2px); box-shadow: 0 18px 30px rgba(2, 8, 23, 0.18); }
    .connection-row-head {
      display: grid;
      grid-template-columns: var(--connection-columns);
      gap: 20px; align-items: center; padding: 16px 24px; position: relative;
    }
    .connection-row-head > .cell, .connections-table-head > span { min-width: 0; }
    .cell { display: block; min-width: 0; }
    .cell.flex-center { display: flex; align-items: center; gap: 8px; justify-content: flex-start; min-width: 0; }
    .cell strong { font-size: 15px; color: var(--text-main); font-weight: 700; line-height: 1; letter-spacing: -0.01em; }
    .cell code { font-family: Consolas, monospace; font-size: 13px; color: var(--code-text); background: var(--code-bg); padding: 4px 8px; border-radius: 6px; }
    .cell[data-title="Key"] code { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .connections-table-head > span:nth-child(5), .connections-table-head > span:nth-child(6) { text-align: center; }
    .cell[data-title="连接状态"] { justify-self: stretch; text-align: center !important; display: flex; justify-content: center; align-items: center; }
    .cell[data-title="操作"] { justify-self: center; width: auto; display: flex; justify-content: center; align-items: center; gap: 12px !important; }
    .cell[data-title="操作"] > * { flex: 0 0 auto; }
    .cell-stack { display: grid; gap: 6px; min-width: 0; }
    .cell-subtle { color: var(--text-muted); font-size: 12px; line-height: 1.45; word-break: break-word; }
    .action-btn {
      background: var(--btn-sec-bg); color: var(--text-muted); border: 1px solid var(--panel-border);
      padding: 4px 12px; border-radius: 999px; font-size: 12px; font-weight: 700; cursor: pointer; transition: 0.2s; height: auto;
    }
    .action-btn:hover { background: var(--btn-sec-hover); color: var(--text-main); }
    .action-bar {
      display: flex; gap: 12px; align-items: center; flex-wrap: wrap;
      background: var(--input-bg); border: 1px solid var(--panel-border);
      padding: 12px 16px; border-radius: 16px; margin-top: 16px;
    }
    .edit-bar { display: flex; gap: 16px; align-items: center; margin: 0; flex-wrap: wrap; }
    .switchline { display: flex; align-items: center; gap: 8px; margin: 0; cursor: pointer; user-select: none; }
    .switchline input { display: none; }
    .toggle {
      width: 44px; height: 24px; background: var(--divider); border-radius: 99px; position: relative; transition: 0.2s;
    }
    .toggle::after {
      content: ''; position: absolute; top: 2px; left: 2px; width: 20px; height: 20px;
      background: #fff; border-radius: 50%; transition: 0.2s;
    }
    .switchline input:checked + .toggle { background: #0ea5e9; }
    .switchline input:checked + .toggle::after { transform: translateX(20px); }
    .toggle-text { font-size: 13px; font-weight: 600; color: var(--text-muted); width: 32px; }
    .divider { width: 1px; height: 24px; background: var(--divider); }
    .input-group { display: flex; gap: 8px; }
    .input-group input { height: 36px; padding: 0 12px; border-radius: 8px; width: 200px; font-size: 13px; }
    .secondary-btn, .danger-btn { 
      height: 36px; padding: 0 16px; border-radius: 8px; font-size: 13px; font-weight: 600; border: none; cursor: pointer; transition: 0.2s;
    }
    .secondary-btn { background: var(--btn-sec-bg); color: var(--btn-sec-text); border: 1px solid var(--panel-border); }
    .secondary-btn:hover { background: var(--btn-sec-hover); }
    .danger-btn { background: var(--danger-bg); color: #ef4444; border: 1px solid var(--danger-border); }
    .danger-btn:hover { background: var(--danger-border); }
    .flex-spacer { flex: 1; }
    .badge { border-radius: 999px; padding: 4px 10px; font-size: 12px; font-weight: 700; white-space: nowrap; letter-spacing: 0.05em; display: inline-flex; align-items: center; justify-content: center; backdrop-filter: blur(10px); }
    .message { margin: 0 0 24px; padding: 16px 18px; border-radius: 18px; background: linear-gradient(135deg, rgba(16,185,129,0.12), rgba(14,165,233,0.1)); color: #34d399; border: 1px solid rgba(52,211,153,0.2); font-weight: 600; transition: opacity 0.3s ease; box-shadow: 0 10px 24px rgba(16, 185, 129, 0.08); }
    .warning-message { background: rgba(239,68,68,0.1); color: #ef4444; border-color: rgba(239,68,68,0.2); }
    .failed-panel { margin-bottom: 24px; padding: 24px 28px; }
    .failed-panel .panel-head { margin-bottom: 16px; }
    .failed-table-wrap {
      overflow: auto;
      border: 1px solid var(--panel-border);
      border-radius: 20px;
      background: var(--row-bg);
    }
    .failed-table {
      width: 100%;
      min-width: 920px;
      border-collapse: collapse;
    }
    .failed-table th, .failed-table td {
      text-align: left;
      padding: 14px 16px;
      border-bottom: 1px solid var(--divider);
      font-size: 13px;
      vertical-align: top;
    }
    .failed-table th {
      color: var(--text-muted);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-weight: 700;
      background: rgba(255,255,255,0.02);
    }
    .failed-table td code {
      font-family: Consolas, monospace;
      font-size: 12px;
    }
    .muted-note { color: var(--text-muted); font-size: 13px; line-height: 1.7; }
    .toast {
      position: fixed; right: 24px; top: 24px;
      background: var(--toast-bg); color: var(--toast-text);
      padding: 14px 24px; border-radius: 16px; font-weight: 600;
      opacity: 0; transform: translateY(-20px); transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      pointer-events: none;
      box-shadow: 0 16px 32px rgba(0,0,0,0.15), inset 0 0 0 1px var(--panel-border);
      z-index: 9999;
    }
    .toast.show { opacity: 1; transform: translateY(0); }
    .modal-backdrop { position: fixed; inset: 0; display: none; place-items: center; background: rgba(0,0,0,0.4); backdrop-filter: blur(8px); padding: 24px; z-index: 50; }
    .modal-backdrop.show { display: grid; }
    .modal { width: min(100%, 460px); padding: 32px; border-radius: 32px; background: var(--modal-bg); border: 1px solid var(--panel-border); box-shadow: var(--shadow-panel); }
    .modal h3 { margin: 0 0 12px; font-size: 24px; }
    .modal p { margin: 0 0 24px; color: var(--text-muted); line-height: 1.6; }
    .modal .row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 24px; }
    @media (max-width: 1024px) { .settings form { grid-template-columns: 1fr 1fr; } .summary { grid-template-columns: repeat(2, minmax(0,1fr)); } .summary .item.summary-address, .summary .item.summary-connections, .summary .item.summary-failed, .summary .item.summary-runtime { grid-column: span 1; } .settings-grid { grid-template-columns: 1fr 1fr; } .admin-page { --connection-columns: 40px minmax(150px, 1fr) minmax(190px, 1.2fr) minmax(190px, 1.15fr) 84px 160px; } }
    @media (max-width: 768px) {
      .wrap { padding: 24px 16px 40px; }
      .hero { flex-direction: column; margin-bottom: 24px; }
      .hero h1 { font-size: 30px; }
      .hero p { font-size: 14px; max-width: none; }
      .toolbar { width: 100%; justify-content: flex-start; }
      .toolbar > * { flex: 1 1 100%; text-align: center; justify-content: center; }
      .summary, .settings form { grid-template-columns: 1fr; }
      .settings-group { padding: 18px; }
      .settings-grid { grid-template-columns: 1fr; }
      .summary .item { padding: 22px; }
      .summary .number { font-size: 40px; }
      .summary-link { width: 100%; }
      .create form { grid-template-columns: 1fr; }
      .create.panel, .panel, .modal { border-radius: 24px; }
      .panel-head { flex-direction: column; align-items: flex-start; margin-bottom: 18px; }
      .connections-panel .panel-head { padding: 0; }
      .connections-table-head { display: none; }
      .connection-row { border-radius: 18px; }
      .connection-row-head { grid-template-columns: 1fr; gap: 14px; padding: 18px; }
      .cell { display: grid; gap: 6px; }
      .cell::before {
        content: attr(data-title);
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--text-muted);
      }
      .cell.flex-center { justify-content: flex-start; align-items: center; flex-wrap: wrap; }
      .cell[data-title="操作"] { gap: 10px; }
      .cell[data-title="操作"]::before { margin-bottom: 2px; }
      .cell[data-title="连接状态"] { text-align: left !important; }
      .cell[data-title="Key"] code { word-break: break-all; }
      .switchline { justify-content: space-between; width: 100%; }
      .danger-btn { width: 100%; height: 40px !important; }
      .input-group { flex-direction: column; }
      .input-group input { width: 100%; }
      .flex-spacer { display: none; }
      .toast { right: 16px; left: 16px; top: auto; bottom: 16px; text-align: center; }
      .modal-backdrop { padding: 16px; }
      .modal { width: 100%; padding: 24px; }
      .modal .row { grid-template-columns: 1fr; }
    }
    @media (max-width: 480px) {
      button, .primary, .toolbar a { padding: 12px 16px; font-size: 13px; }
      .hero h1 { font-size: 26px; }
      .summary .value { font-size: 18px; }
      .summary .number { font-size: 36px; }
      .action-btn { width: 100%; justify-content: center; }
    }
  </style>
</head>
<body>
  <div class="wrap admin-page">
    <section class="hero">
      <div>
        <h1>插件 Key 与监听管理</h1>
        <p>当前登录：${escapeHtml(currentUser.email)}。这里主要负责生成和管理每条连接的密钥，主系统那边的脚本地址保持预设即可。</p>
      </div>
      <div class="toolbar">
        <button type="button" class="ghost toolbar-btn toolbar-icon-btn" id="theme-btn" aria-label="切换主题" title="切换主题">
          <svg id="theme-icon-dark" viewBox="0 0 24 24" fill="none" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M20 15.5A8.5 8.5 0 0 1 8.5 4a7 7 0 1 0 11.5 11.5Z"></path>
          </svg>
          <svg id="theme-icon-light" viewBox="0 0 24 24" fill="none" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:none;">
            <path d="M12 3v2.2M12 18.8V21M5.64 5.64l1.56 1.56M16.8 16.8l1.56 1.56M3 12h2.2M18.8 12H21M5.64 18.36l1.56-1.56M16.8 7.2l1.56-1.56"></path>
            <circle cx="12" cy="12" r="4.2"></circle>
          </svg>
        </button>
        <button type="button" class="ghost toolbar-btn toolbar-action-btn" id="open-health-check">
          <svg viewBox="0 0 24 24" fill="none" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M4 12h3l2-5 4 10 2-5h5"></path>
          </svg>
          <span class="toolbar-btn-label">检查</span>
        </button>
        <form method="post" action="/logout">
          <button type="submit" class="ghost toolbar-btn toolbar-exit-btn">
            <svg viewBox="0 0 24 24" fill="none" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
              <path d="M16 17l5-5-5-5"></path>
              <path d="M21 12H9"></path>
            </svg>
            <span class="toolbar-btn-label">退出</span>
          </button>
        </form>
      </div>
    </section>
    ${renderSummarySection(data, stats)}
    <section class="layout">
      <section class="create panel">
        <div class="panel-head">
          <div>
            <h3>生成新 Key</h3>
            <p>为新的店铺或者设备生成一条用于通信的独立密钥。</p>
          </div>
        </div>
        <form method="post" action="/admin/actions">
          <input type="hidden" name="action" value="create" />
          <div>
            <label>连接名称</label>
            <input name="name" placeholder="例如：白云店-美团" required />
          </div>
          <input type="hidden" name="platform" value="美团" />
          <button type="submit" class="primary">生成新 Key</button>
        </form>
      </section>
      <details class="settings panel">
      <summary class="panel-head" style="margin:0; padding:36px; cursor:pointer; list-style:none; display:flex; justify-content:space-between; align-items:center;">
        <div>
          <h3>运行参数配置</h3>
          <p>点击展开，修改后将立即生效，用于精细化控制抓取与推送的行为。</p>
        </div>
        <div class="chevron" style="width: 8px; height: 8px; border-right: 2px solid var(--text-muted); border-bottom: 2px solid var(--text-muted); transform: rotate(45deg); transition: transform 0.2s ease;"></div>
      </summary>
      <div style="padding: 0 36px 36px; border-top: 1px solid var(--panel-border);">
        <form id="runtime-settings-form" method="post" action="/admin/actions" style="margin-top: 24px;">
          <input type="hidden" name="action" value="settings" />
          <div class="settings-groups full">
            <section class="settings-group">
              <h4>基础地址</h4>
              <p>控制主系统回推地址，以及后台展示给外部节点访问的公开地址。</p>
              <div class="settings-grid">
                <div><label>主系统地址</label><input name="pushBaseUrl" value="${escapeHtml(data.settings.pushBaseUrl)}" /></div>
                <div><label>插件公开地址</label><input name="publicBaseUrl" value="${escapeHtml(data.settings.publicBaseUrl)}" /></div>
              </div>
            </section>
            <section class="settings-group">
              <h4>轮询与抓取</h4>
              <p>影响抓单频率、分页深度，以及失败回推后的自动补偿节奏。</p>
              <div class="settings-grid">
                <div><label>轮询间隔 (ms)</label><input name="pollIntervalMs" value="${data.settings.pollIntervalMs}" /></div>
                <div><label>HTTP 超时 (ms)</label><input name="httpTimeoutMs" value="${data.settings.httpTimeoutMs}" /></div>
                <div><label>最大页数</label><input name="maxListPages" value="${data.settings.maxListPages}" /></div>
                <div><label>每页数量</label><input name="pageSize" value="${data.settings.pageSize}" /></div>
                <div><label>失败重试间隔 (ms)</label><input name="failedRetryIntervalMs" value="${data.settings.failedRetryIntervalMs}" /></div>
                <div><label>去重 TTL (ms)</label><input name="dedupeTtlMs" value="${data.settings.dedupeTtlMs}" /></div>
                <div class="full"><label>轮询状态列表</label><input name="statuses" value="${escapeHtml(data.settings.statuses.join(","))}" /></div>
              </div>
            </section>
            <section class="settings-group">
              <h4>网络与重连</h4>
              <p>节点离线时重点看这一组，控制心跳频率和断线重连节奏。</p>
              <div class="settings-grid">
                <div><label>WS 心跳 (ms)</label><input name="wsHeartbeatIntervalMs" value="${data.settings.wsHeartbeatIntervalMs}" /></div>
                <div><label>WS 重连基准 (ms)</label><input name="wsReconnectBaseMs" value="${data.settings.wsReconnectBaseMs}" /></div>
                <div><label>WS 重连上限 (ms)</label><input name="wsReconnectMaxMs" value="${data.settings.wsReconnectMaxMs}" /></div>
              </div>
            </section>
            <section class="settings-group">
              <h4>拣货自动化</h4>
              <p>网页端直接按秒调整，不用再自己换算毫秒。</p>
              <div class="settings-grid">
                <div><label>拣货等待超时 (秒)</label><input name="pickingWaitTimeoutSeconds" value="${Math.max(1, Math.round(data.settings.pickingWaitTimeoutMs / 1000))}" /></div>
                <div><label>拣货完成冷却 (秒)</label><input name="mealCompleteCooldownSeconds" value="${Math.max(1, Math.round(data.settings.mealCompleteCooldownMs / 1000))}" /></div>
              </div>
            </section>
          </div>
          <div class="full" style="display: flex; justify-content: flex-end; margin-top: 16px;">
            <button type="submit" class="primary" style="width: auto;">保存运行设置</button>
          </div>
        </form>
      </div>
      </details>
    </section>
    ${renderConnectionsSection(cards)}
  </div>
  <div id="toast" class="toast">已复制</div>
  <div id="health-modal" class="modal-backdrop" aria-hidden="true">
    <div class="modal">
      <h3>打开健康检查</h3>
      <p>请输入一条可用连接的 API Key，以进行系统完整链路的健康测试。</p>
      <input id="health-api-key" type="text" placeholder="粘贴 API Key" />
      <div class="row">
        <button type="button" class="ghost" id="close-health-modal">取消</button>
        <button type="button" class="primary" id="submit-health-modal">打开测试</button>
      </div>
    </div>
  </div>
  <script>
    const toast = document.getElementById('toast');
    function showToast(text) {
      toast.textContent = text;
      toast.classList.add('show');
      clearTimeout(toast._timer);
      toast._timer = setTimeout(() => toast.classList.remove('show'), 3000);
    }

    async function toggleConnection(checkbox) {
      const id = checkbox.getAttribute('data-toggle-id');
      const enabled = checkbox.checked;
      const textEl = checkbox.closest('.switchline').querySelector('.toggle-text');
      if (textEl) textEl.textContent = enabled ? '启用' : '暂停';
      try {
        const body = new URLSearchParams({ action: 'toggle', id, ...(enabled ? { enabled: '1' } : {}) });
        const res = await fetch('/admin/actions', { method: 'POST', body, redirect: 'manual' });
        if (res.type === 'opaqueredirect' || res.ok || res.status === 302) {
          showToast(enabled ? '连接已启用' : '连接已暂停');
        } else {
          throw new Error('请求失败');
        }
      } catch (e) {
        checkbox.checked = !enabled;
        if (textEl) textEl.textContent = !enabled ? '启用' : '暂停';
        showToast('操作失败，请重试');
      }
    }

    async function copyText(value) {
      if (!value) return false;

      if (navigator.clipboard) {
        try {
          await navigator.clipboard.writeText(value);
          return true;
        } catch {}
      }

      const textarea = document.createElement('textarea');
      textarea.value = value;
      textarea.setAttribute('aria-hidden', 'true');
      textarea.style.position = 'fixed';
      textarea.style.top = '0';
      textarea.style.left = '0';
      textarea.style.opacity = '0';
      textarea.style.pointerEvents = 'none';

      document.body.appendChild(textarea);

      const selection = document.getSelection();
      const savedRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

      textarea.focus({ preventScroll: true });
      textarea.select();
      textarea.setSelectionRange(0, textarea.value.length);

      try {
        return document.execCommand('copy');
      } catch {
        return false;
      } finally {
        if (selection) {
          selection.removeAllRanges();
          if (savedRange) selection.addRange(savedRange);
        }
        document.body.removeChild(textarea);
      }
    }

    for (const button of document.querySelectorAll('[data-copy]')) {
      button.addEventListener('click', async (e) => {
        e.preventDefault();
        const value = button.getAttribute('data-copy') || '';
        const copied = await copyText(value);
        if (!copied) {
          window.prompt('复制失败，请手动复制下面的 Key', value);
        }
        showToast(copied ? '已复制到剪贴板' : '复制失败，请手动复制');
      });
    }

    const modal = document.getElementById('health-modal');
    const openHealth = document.getElementById('open-health-check');
    const closeHealth = document.getElementById('close-health-modal');
    const submitHealth = document.getElementById('submit-health-modal');
    const healthInput = document.getElementById('health-api-key');

    function closeModal() {
      modal.classList.remove('show');
      modal.setAttribute('aria-hidden', 'true');
    }
    function openModal() {
      modal.classList.add('show');
      modal.setAttribute('aria-hidden', 'false');
      window.setTimeout(() => healthInput && healthInput.focus(), 50);
    }

    if (openHealth) openHealth.addEventListener('click', openModal);
    if (closeHealth) closeHealth.addEventListener('click', closeModal);
    if (modal) {
      modal.addEventListener('click', (event) => {
        if (event.target === modal) closeModal();
      });
    }
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && modal.classList.contains('show')) closeModal();
    });
    if (submitHealth) {
      submitHealth.addEventListener('click', () => {
        const apiKey = healthInput ? healthInput.value.trim() : '';
        if (!apiKey) {
          alert('请先输入 API Key');
          return;
        }
        const url = '/admin/health-check?apiKey=' + encodeURIComponent(apiKey);
        window.open(url, '_blank', 'noopener,noreferrer');
        closeModal();
      });
    }

    ${message ? `
    showToast(${JSON.stringify(message)});
    const url = new URL(window.location);
    if (url.searchParams.has('message')) {
      url.searchParams.delete('message');
      window.history.replaceState({}, document.title, url.pathname + url.search);
    }
    ` : ""}

    ${autoCopyKey ? `
    window.setTimeout(async () => {
      const copied = await copyText(${JSON.stringify(autoCopyKey)});
      showToast(copied ? '新 Key 已自动复制到剪贴板' : '新 Key 生成成功，但自动复制失败');
    }, 50);
    ` : ""}

    const themeBtn = document.getElementById('theme-btn');
    const html = document.documentElement;
    const darkIcon = document.getElementById('theme-icon-dark');
    const lightIcon = document.getElementById('theme-icon-light');
    function updateThemeBtn() {
      const isLight = html.classList.contains('light');
      if (darkIcon) darkIcon.style.display = isLight ? 'none' : 'block';
      if (lightIcon) lightIcon.style.display = isLight ? 'block' : 'none';
      if (themeBtn) {
        themeBtn.setAttribute('aria-label', isLight ? '切换深色' : '切换浅色');
        themeBtn.setAttribute('title', isLight ? '切换深色' : '切换浅色');
      }
    }
    updateThemeBtn();
    if(themeBtn) {
      themeBtn.addEventListener('click', () => {
        html.classList.toggle('light');
        localStorage.setItem('theme', html.classList.contains('light') ? 'light' : 'dark');
        updateThemeBtn();
      });
    }

    // 记录和恢复滚动条位置，防止刷新/提交后页面弹回顶部
    document.addEventListener('submit', () => {
      sessionStorage.setItem('scrollPosition', window.scrollY);
    });
    const savedScroll = sessionStorage.getItem('scrollPosition');
    if (savedScroll !== null) {
      window.scrollTo(0, parseInt(savedScroll, 10));
      sessionStorage.removeItem('scrollPosition');
    }
  </script>
</body>
</html>`;
}
