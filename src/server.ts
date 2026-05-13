import http from "node:http";
import { PluginRuntime } from "./plugin.js";
import { AuthUser, DashboardData, FailedEventFilters, FailedEventSummary, RuntimeSettings } from "./types.js";

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

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderAuthPage(options: {
  error?: string;
  info?: string;
  email?: string;
  smtpReady: boolean;
}) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>ws-autopick 登录</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <script>
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light' || (!savedTheme && window.matchMedia('(prefers-color-scheme: light)').matches)) {
      document.documentElement.classList.add('light');
    }
  </script>
  <style>
    :root {
      color-scheme: dark;
      --bg-body: #111827; --text-main: #f9fafb; --text-muted: #9ca3af;
      --panel-bg: rgba(31, 41, 55, 0.7); --panel-border: rgba(255,255,255,0.08);
      --input-bg: rgba(17, 24, 39, 0.6); --input-border: rgba(255,255,255,0.12);
      --btn-sec-bg: rgba(255,255,255,0.05); --btn-sec-hover: rgba(255,255,255,0.1); --btn-sec-text: #f9fafb;
      --shadow-panel: 0 30px 90px rgba(0,0,0,0.4);
      --grad-1: rgba(14, 165, 233, 0.1); --grad-2: rgba(59, 130, 246, 0.1);
    }
    :root.light {
      color-scheme: light;
      --bg-body: #f3f4f6; --text-main: #111827; --text-muted: #6b7280;
      --panel-bg: rgba(255, 255, 255, 0.85); --panel-border: rgba(0,0,0,0.06);
      --input-bg: rgba(255,255,255,0.9); --input-border: rgba(0,0,0,0.15);
      --btn-sec-bg: rgba(0,0,0,0.05); --btn-sec-hover: rgba(0,0,0,0.08); --btn-sec-text: #111827;
      --shadow-panel: 0 20px 40px rgba(0,0,0,0.05);
      --grad-1: rgba(14, 165, 233, 0.15); --grad-2: rgba(59, 130, 246, 0.15);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0; min-height: 100vh;
      display: grid; place-items: center;
      background: var(--bg-body);
      background-image:
        radial-gradient(circle at 15% 50%, var(--grad-1), transparent 25%),
        radial-gradient(circle at 85% 30%, var(--grad-2), transparent 25%);
      font-family: "Inter", "Segoe UI", sans-serif;
      color: var(--text-main);
      padding: 18px; transition: background 0.3s ease;
    }
    .card {
      width: min(100%, 420px);
      padding: 40px;
      border-radius: 32px;
      background: var(--panel-bg);
      backdrop-filter: blur(40px); -webkit-backdrop-filter: blur(40px);
      box-shadow: 0 0 0 1px var(--panel-border), var(--shadow-panel);
      position: relative;
    }
    h1 { margin: 0 0 8px; font-size: 28px; letter-spacing: -0.02em; }
    .muted { margin: 0 0 28px; color: var(--text-muted); font-size: 14px; line-height: 1.6; }
    .stack { display: grid; gap: 10px; margin-bottom: 20px; }
    .message { padding: 12px 14px; border-radius: 12px; font-size: 13px; line-height: 1.5; }
    .message.error { background: rgba(239,68,68,0.1); color: #ef4444; border: 1px solid rgba(239,68,68,0.2); }
    .message.info { background: rgba(14,165,233,0.1); color: #0ea5e9; border: 1px solid rgba(14,165,233,0.2); }
    .message.warn { background: rgba(245,158,11,0.1); color: #f59e0b; border: 1px solid rgba(245,158,11,0.2); }
    .fields { display: grid; gap: 16px; }
    label { display: block; margin-bottom: 6px; font-size: 13px; font-weight: 600; color: var(--text-muted); }
    input {
      width: 100%; height: 48px;
      border: 1px solid var(--input-border); border-radius: 12px;
      padding: 0 14px; font: inherit; color: var(--text-main);
      background: var(--input-bg); transition: all 0.2s ease; font-size: 14px;
    }
    input:focus { outline: none; border-color: #38bdf8; box-shadow: 0 0 0 3px rgba(56,189,248,0.2); }
    .email-row { display: grid; grid-template-columns: 1fr auto; gap: 10px; align-items: end; }
    button {
      height: 48px; border: 0; border-radius: 12px; font-size: 14px; font-weight: 600; cursor: pointer;
      transition: all 0.2s ease; padding: 0 20px;
    }
    .secondary { background: var(--btn-sec-bg); color: var(--btn-sec-text); box-shadow: inset 0 0 0 1px var(--panel-border); white-space: nowrap; }
    .secondary:hover { background: var(--btn-sec-hover); }
    .primary {
      background: linear-gradient(135deg, #0ea5e9, #3b82f6); color: #fff;
      box-shadow: 0 8px 24px rgba(14,165,233,0.3); width: 100%; margin-top: 8px;
    }
    .primary:hover { filter: brightness(1.1); transform: translateY(-1px); }
    .theme-toggle {
      position: absolute; top: 16px; right: 16px;
      height: 32px; padding: 0 10px; border-radius: 8px;
      background: transparent; color: var(--text-muted);
      border: 1px solid var(--panel-border); font-size: 12px; cursor: pointer;
    }
    .theme-toggle:hover { background: var(--btn-sec-bg); color: var(--text-main); }
  </style>
</head>
<body>
  <div class="card">
    <button class="theme-toggle" id="theme-btn">切换浅色</button>
    <h1>登录管理台</h1>
    <p class="muted">邮箱验证码登录，首次注册自动绑定为管理员。</p>
    <div class="stack">
      ${options.error ? `<div class="message error">${escapeHtml(options.error)}</div>` : ""}
      ${options.info ? `<div class="message info">${escapeHtml(options.info)}</div>` : ""}
      ${options.smtpReady ? "" : `<div class="message warn">邮件服务尚未配置，暂时无法发送验证码。</div>`}
    </div>
    <div class="fields">
      <div>
        <label for="email">邮箱</label>
        <div class="email-row">
          <input id="email" type="email" value="${escapeHtml(options.email || "")}" placeholder="name@example.com" autocomplete="username" required />
          <form method="post" action="/auth/send-code" style="margin:0;">
            <input id="send-email" type="hidden" name="email" value="${escapeHtml(options.email || "")}" />
            <button class="secondary" id="send-code-button" type="submit">发送验证码</button>
          </form>
        </div>
      </div>
      <form method="post" action="/auth/verify" style="margin:0;">
        <input id="verify-email" type="hidden" name="email" value="${escapeHtml(options.email || "")}" />
        <label for="code">验证码</label>
        <input id="code" name="code" inputmode="numeric" pattern="\\d{6}" maxlength="6" placeholder="6 位数字" autocomplete="one-time-code" required />
        <button class="primary" type="submit">登录</button>
      </form>
    </div>
  </div>
  <script>
    const emailInput = document.getElementById('email');
    const sendEmailInput = document.getElementById('send-email');
    const verifyEmailInput = document.getElementById('verify-email');
    const sendButton = document.getElementById('send-code-button');

    function syncEmailTargets() {
      const value = emailInput ? emailInput.value : '';
      if (sendEmailInput) sendEmailInput.value = value;
      if (verifyEmailInput) verifyEmailInput.value = value;
    }

    if (emailInput) {
      emailInput.addEventListener('input', syncEmailTargets);
      syncEmailTargets();
    }

    if (sendButton) {
      sendButton.addEventListener('click', () => {
        sendButton.textContent = '发送中...';
      });
    }

    const themeBtn = document.getElementById('theme-btn');
    const html = document.documentElement;
    function updateThemeBtn() {
      themeBtn.textContent = html.classList.contains('light') ? '切换深色' : '切换浅色';
    }
    updateThemeBtn();
    themeBtn.addEventListener('click', () => {
      html.classList.toggle('light');
      localStorage.setItem('theme', html.classList.contains('light') ? 'light' : 'dark');
      updateThemeBtn();
    });
  </script>
</body>
</html>`;
}

function renderForbiddenPage(user: AuthUser) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>无权限</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;800&display=swap" rel="stylesheet">
  <style>
    body { margin:0; min-height:100vh; display:grid; place-items:center; background:#111827; font-family:"Inter",sans-serif; color:#f9fafb; }
    .card { width:min(92vw, 460px); padding:48px; border-radius:32px; background:rgba(31,41,55,0.7); backdrop-filter:blur(40px); border:1px solid rgba(255,255,255,0.08); text-align:center; box-shadow:0 30px 90px rgba(0,0,0,0.4); }
    h1 { margin:0 0 16px; font-size:32px; letter-spacing:-0.02em; }
    p { margin:0 0 32px; color:#9ca3af; line-height:1.7; font-size:16px; }
    button { height:52px; border:0; border-radius:16px; background:linear-gradient(135deg, #0ea5e9, #3b82f6); color:#fff; font-weight:600; padding:0 24px; cursor:pointer; font-size:14px; box-shadow:0 8px 24px rgba(14,165,233,0.3); transition:transform 0.2s; }
    button:hover { transform:translateY(-2px); }
  </style>
</head>
<body>
  <div class="card">
    <h1>当前账号没有权限</h1>
    <p>${escapeHtml(user.email)} 已登录，但这个插件只允许唯一管理员账号进入后台。</p>
    <form method="post" action="/logout"><button type="submit">退出登录</button></form>
  </div>
</body>
</html>`;
}

function normalizeFailedEventFilters(searchParams: URLSearchParams): FailedEventFilters {
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

function renderFailedEventRows(items: FailedEventSummary[]) {
  return items.map((item) => `
    <tr>
      <td data-label="连接">${escapeHtml(item.sourceLabel)}</td>
      <td data-label="平台">${escapeHtml(item.platform)}</td>
      <td data-label="单号"><code>${escapeHtml(item.orderNo)}</code></td>
      <td data-label="类型">${escapeHtml(item.kind)}</td>
      <td data-label="重试次数">${item.attempts}</td>
      <td data-label="下次重试">${escapeHtml(item.nextRetryAt)}</td>
      <td data-label="最近错误">${escapeHtml(item.lastError || "-")}</td>
    </tr>
  `).join("");
}

function renderDashboardPage(data: DashboardData, currentUser: AuthUser, message?: string, autoCopyKey?: string) {
  const cards = data.users.map((user, index) => {
    const seq = String(index + 1).padStart(2, '0');
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
        <div class="cell flex-center" data-title="Key" style="justify-content: flex-start;">
          <code>${escapeHtml(keyPreview)}</code>
          <button type="button" class="action-btn" data-copy="${escapeHtml(user.apiKey)}">复制</button>
        </div>
        <div class="cell" data-title="连接名称" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
          <strong>${escapeHtml(user.label)}</strong>
        </div>
        <div class="cell" data-title="Cookie" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
          <strong class="${user.hasCookie ? 'text-blue' : 'text-muted' }" style="font-weight:500;">
            ${user.hasCookie ? "Cookie 已同步" : "无 Cookie"}
          </strong>
        </div>
        <div class="cell" data-title="连接状态" style="text-align:right;">
          <span class="badge" style="color:${wsColor};background:${wsBg};box-shadow:inset 0 0 0 1px ${wsColor}40">${wsBadge}</span>
        </div>
        <div class="cell flex-center" data-title="操作" style="justify-content: flex-end; gap: 16px;">
          <div style="margin:0; display:flex; align-items:center;">
            <label class="switchline" title="开启或暂停此节点">
              <input type="checkbox" data-toggle-id="${user.id}" ${user.enabled ? "checked" : ""} onchange="toggleConnection(this)" />
              <span class="toggle"></span>
              <span class="toggle-text">${user.enabled ? '启用' : '暂停'}</span>
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
  }).join("");

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>ws-autopick 管理页</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <script>
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light' || (!savedTheme && window.matchMedia('(prefers-color-scheme: light)').matches)) {
      document.documentElement.classList.add('light');
    }
  </script>
  <style>
    :root {
      color-scheme: dark;
      --bg-body: #111827; --text-main: #f9fafb; --text-muted: #9ca3af;
      --panel-bg: rgba(31, 41, 55, 0.7); --panel-border: rgba(255,255,255,0.08);
      --input-bg: rgba(17, 24, 39, 0.6); --input-border: rgba(255,255,255,0.12);
      --row-bg: rgba(31, 41, 55, 0.5); --row-hover: rgba(55, 65, 81, 0.7); --row-open: rgba(55, 65, 81, 0.9);
      --btn-sec-bg: rgba(255,255,255,0.08); --btn-sec-hover: rgba(255,255,255,0.12); --btn-sec-text: #e5e7eb;
      --code-bg: rgba(255,255,255,0.06); --code-text: #d1d5db;
      --divider: rgba(255,255,255,0.1);
      --shadow-panel: 0 20px 60px rgba(0,0,0,0.3);
      --danger-bg: rgba(239,68,68,0.15); --danger-border: rgba(239,68,68,0.3);
      --grad-1: rgba(14, 165, 233, 0.1); --grad-2: rgba(59, 130, 246, 0.1);
      --toast-bg: #fff; --toast-text: #09090b;
      --modal-bg: rgba(31,41,55,0.9);
    }
    :root.light {
      color-scheme: light;
      --bg-body: #f3f4f6; --text-main: #111827; --text-muted: #6b7280;
      --panel-bg: rgba(255, 255, 255, 0.85); --panel-border: rgba(0,0,0,0.06);
      --input-bg: rgba(255,255,255,0.9); --input-border: rgba(0,0,0,0.15);
      --row-bg: rgba(255, 255, 255, 0.6); --row-hover: rgba(255, 255, 255, 1); --row-open: rgba(255, 255, 255, 1);
      --btn-sec-bg: rgba(0,0,0,0.05); --btn-sec-hover: rgba(0,0,0,0.1); --btn-sec-text: #374151;
      --code-bg: rgba(0,0,0,0.05); --code-text: #374151;
      --divider: rgba(0,0,0,0.08);
      --shadow-panel: 0 10px 30px rgba(0,0,0,0.05);
      --danger-bg: rgba(239,68,68,0.1); --danger-border: rgba(239,68,68,0.2);
      --grad-1: rgba(14, 165, 233, 0.15); --grad-2: rgba(59, 130, 246, 0.15);
      --toast-bg: #111827; --toast-text: #f9fafb;
      --modal-bg: rgba(255,255,255,0.9);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0; background: var(--bg-body);
      background-image: 
        radial-gradient(circle at 0% 0%, var(--grad-1), transparent 40%),
        radial-gradient(circle at 100% 100%, var(--grad-2), transparent 40%);
      color: var(--text-main);
      font-family: "Inter", "Segoe UI", sans-serif;
      min-height: 100vh; transition: background 0.3s ease, color 0.3s ease;
    }
    .wrap { max-width: 1200px; margin: 0 auto; padding: 48px 24px; }
    .hero { display: flex; justify-content: space-between; gap: 24px; align-items: flex-start; margin-bottom: 40px; }
    .hero h1 { margin: 0; font-size: 38px; line-height: 1.1; letter-spacing: -0.03em; background: linear-gradient(to right, var(--text-main), #60a5fa); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .hero p { margin: 12px 0 0; color: var(--text-muted); line-height: 1.7; font-size: 16px; max-width: 600px; }
    .toolbar { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; }
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
    .danger { background: var(--danger-bg); color: #ef4444; box-shadow: inset 0 0 0 1px var(--danger-border); }
    .danger:hover { background: var(--danger-border); }
    .panel {
      background: var(--panel-bg);
      backdrop-filter: blur(40px); -webkit-backdrop-filter: blur(40px);
      border: 1px solid var(--panel-border);
      border-radius: 32px; box-shadow: var(--shadow-panel);
      transition: all 0.3s ease;
    }
    .summary { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 16px; margin-bottom: 24px; }
    .summary .item { padding: 28px; display: flex; flex-direction: column; justify-content: space-between; position: relative; overflow: hidden; }
    .summary .label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-muted); font-weight: 700; margin-bottom: 12px; }
    .summary .value { font-size: 20px; font-weight: 600; word-break: break-word; color: var(--text-main); }
    .summary .number { font-size: 48px; line-height: 1; letter-spacing: -0.02em; }
    .summary .item-head { display: grid; gap: 10px; }
    .summary .item-foot { margin-top: 20px; display: flex; align-items: center; }
    .summary-link {
      display: inline-flex; align-items: center; justify-content: center;
      min-height: 40px; padding: 0 14px;
      border-radius: 12px;
      background: var(--btn-sec-bg);
      color: var(--text-main);
      text-decoration: none;
      font-size: 13px; font-weight: 700;
      box-shadow: inset 0 0 0 1px var(--panel-border);
      transition: all 0.2s ease;
    }
    .summary-link:hover {
      background: var(--btn-sec-hover);
      transform: translateY(-1px);
    }
    .text-blue { color: #0ea5e9 !important; }
    .text-muted { color: var(--text-muted) !important; }
    .text-red { color: #ef4444 !important; }
    .layout { display: grid; grid-template-columns: 1fr; gap: 24px; margin-bottom: 24px; }
    .panel-head { display: flex; justify-content: space-between; gap: 16px; align-items: flex-end; margin-bottom: 24px; }
    .panel-head h3 { margin: 0; font-size: 24px; letter-spacing: -0.02em; }
    .panel-head p { margin: 8px 0 0; color: var(--text-muted); line-height: 1.6; font-size: 14px; }
    .create.panel { padding: 36px; }
    .settings.panel { padding: 0; }
    .settings.panel[open] .chevron { transform: rotate(225deg) translateY(-2px) translateX(-2px) !important; }
    .create form { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 16px; align-items: end; }
    .settings form { display: grid; gap: 24px; grid-template-columns: repeat(3, minmax(0,1fr)); }
    .full { grid-column: 1 / -1; }
    label { display: block; margin-bottom: 8px; font-size: 13px; font-weight: 600; color: var(--text-muted); }
    input, textarea {
      width: 100%; border: 1px solid var(--input-border); border-radius: 12px;
      padding: 14px 16px; font: inherit; color: var(--text-main); background: var(--input-bg);
      transition: all 0.2s ease;
    }
    input:focus, textarea:focus { outline: none; border-color: #38bdf8; box-shadow: 0 0 0 3px rgba(56,189,248,0.2); }
    .list { display: grid; gap: 12px; }
    
    .connections-panel { padding: 0; background: transparent; border: none; box-shadow: none; backdrop-filter: none; margin-top: 32px; }
    .connections-panel .panel-head { margin-bottom: 16px; padding: 0; }
    
    .connection-row {
      background: var(--row-bg); border: 1px solid var(--panel-border);
      border-radius: 20px; transition: all 0.2s ease; backdrop-filter: blur(10px);
    }
    .connection-row:hover { border-color: var(--divider); background: var(--row-hover); }
    .connection-row-head {
      display: grid;
      grid-template-columns: 24px 240px minmax(100px, 1fr) 100px 70px 160px;
      gap: 20px; align-items: center; padding: 16px 24px; position: relative;
    }
    .cell { display: block; }
    .cell.flex-center { display: flex; align-items: center; gap: 8px; justify-content: flex-start; }
    .cell strong { font-size: 15px; color: var(--text-main); font-weight: 600; line-height: 1; }
    .cell code { font-family: Consolas, monospace; font-size: 13px; color: var(--code-text); background: var(--code-bg); padding: 4px 8px; border-radius: 6px; }
    .action-btn {
      background: var(--btn-sec-bg); color: var(--text-muted); border: 1px solid var(--panel-border);
      padding: 4px 12px; border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer; transition: 0.2s; height: auto;
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
    .badge { border-radius: 8px; padding: 4px 10px; font-size: 12px; font-weight: 700; white-space: nowrap; letter-spacing: 0.05em; display: inline-flex; align-items: center; justify-content: center; }
    .message { margin: 0 0 24px; padding: 16px; border-radius: 16px; background: rgba(16,185,129,0.1); color: #10b981; border: 1px solid rgba(16,185,129,0.2); font-weight: 500; transition: opacity 0.3s ease; }
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
    @media (max-width: 1024px) { .settings form { grid-template-columns: 1fr 1fr; } .summary { grid-template-columns: 1fr 1fr; } }
    @media (max-width: 768px) {
      .wrap { padding: 24px 16px 40px; }
      .hero { flex-direction: column; margin-bottom: 24px; }
      .hero h1 { font-size: 30px; }
      .hero p { font-size: 14px; max-width: none; }
      .toolbar { width: 100%; }
      .toolbar > * { flex: 1 1 100%; text-align: center; justify-content: center; }
      .summary, .settings form { grid-template-columns: 1fr; }
      .summary .item { padding: 22px; }
      .summary .number { font-size: 40px; }
      .summary-link { width: 100%; }
      .create form { grid-template-columns: 1fr; }
      .create.panel, .panel, .modal { border-radius: 24px; }
      .panel-head { flex-direction: column; align-items: flex-start; margin-bottom: 18px; }
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
  <div class="wrap">
    <section class="hero">
      <div>
        <h1>插件 Key 与监听管理</h1>
        <p>当前登录：${escapeHtml(currentUser.email)}。这里主要负责生成和管理每条连接的密钥，主系统那边的脚本地址保持预设即可。</p>
      </div>
      <div class="toolbar">
        <button type="button" class="ghost" id="theme-btn">切换浅色</button>
        <button type="button" class="ghost" id="open-health-check">健康检查</button>
        <form method="post" action="/logout" style="margin:0;"><button type="submit" class="ghost">退出登录</button></form>
      </div>
    </section>
    <section class="summary">
      <div class="item panel"><div class="item-head"><div class="label">主系统地址</div><div class="value">${escapeHtml(data.pushBaseUrl)}</div></div></div>
      <div class="item panel"><div class="item-head"><div class="label">连接数量</div><div class="value number">${data.users.length}</div></div></div>
      <div class="item panel">
        <div class="item-head">
          <div class="label">失败积压</div>
          <div class="value number">${data.failedEventCount}</div>
        </div>
        <div class="item-foot">
          <a href="/admin/failed-events" class="summary-link">查看详情</a>
        </div>
      </div>
      <div class="item panel"><div class="item-head"><div class="label">插件状态</div><div class="value text-blue" style="font-size:24px;">运行中</div></div></div>
    </section>
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
          <div><label>主系统地址</label><input name="pushBaseUrl" value="${escapeHtml(data.settings.pushBaseUrl)}" /></div>
          <div><label>插件公开地址</label><input name="publicBaseUrl" value="${escapeHtml(data.settings.publicBaseUrl)}" /></div>
          <div><label>轮询间隔 (ms)</label><input name="pollIntervalMs" value="${data.settings.pollIntervalMs}" /></div>
          <div><label>HTTP 超时 (ms)</label><input name="httpTimeoutMs" value="${data.settings.httpTimeoutMs}" /></div>
          <div><label>最大页数</label><input name="maxListPages" value="${data.settings.maxListPages}" /></div>
          <div><label>每页数量</label><input name="pageSize" value="${data.settings.pageSize}" /></div>
          <div><label>失败重试间隔 (ms)</label><input name="failedRetryIntervalMs" value="${data.settings.failedRetryIntervalMs}" /></div>
          <div><label>去重 TTL (ms)</label><input name="dedupeTtlMs" value="${data.settings.dedupeTtlMs}" /></div>
          <div><label>WS 心跳 (ms)</label><input name="wsHeartbeatIntervalMs" value="${data.settings.wsHeartbeatIntervalMs}" /></div>
          <div><label>WS 重连基准 (ms)</label><input name="wsReconnectBaseMs" value="${data.settings.wsReconnectBaseMs}" /></div>
          <div><label>WS 重连上限 (ms)</label><input name="wsReconnectMaxMs" value="${data.settings.wsReconnectMaxMs}" /></div>
          <div class="full"><label>轮询状态列表</label><input name="statuses" value="${escapeHtml(data.settings.statuses.join(","))}" /></div>
          <div class="full" style="display: flex; justify-content: flex-end; margin-top: 16px;">
            <button type="submit" class="primary" style="width: auto;">保存运行设置</button>
          </div>
        </form>
      </div>
    </details>
    <section class="connections-panel">
      <div class="panel-head" style="margin-bottom:20px;">
        <div>
          <h3>连接列表</h3>
          <p>点击行可展开配置和详细状态。</p>
        </div>
      </div>
      <section class="list">${cards || `<div style="padding:40px;text-align:center;color:var(--text-muted);background:var(--row-bg);border-radius:24px;border:1px solid var(--panel-border);">还没有连接，请先在上方生成新 Key。</div>`}</section>
    </section>
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
    function updateThemeBtn() {
      if(themeBtn) themeBtn.textContent = html.classList.contains('light') ? '切换深色' : '切换浅色';
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

function renderFailedEventsPage(options: {
  currentUser: AuthUser;
  filters: FailedEventFilters;
  items: FailedEventSummary[];
  total: number;
}) {
  const rows = renderFailedEventRows(options.items);
  const limit = options.filters.limit || 100;

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>失败积压详情</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <script>
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light' || (!savedTheme && window.matchMedia('(prefers-color-scheme: light)').matches)) {
      document.documentElement.classList.add('light');
    }
  </script>
  <style>
    :root {
      color-scheme: dark;
      --bg-body: #111827; --text-main: #f9fafb; --text-muted: #9ca3af;
      --panel-bg: rgba(31, 41, 55, 0.7); --panel-border: rgba(255,255,255,0.08);
      --input-bg: rgba(17, 24, 39, 0.6); --input-border: rgba(255,255,255,0.12);
      --row-bg: rgba(31, 41, 55, 0.5); --btn-sec-bg: rgba(255,255,255,0.08); --btn-sec-hover: rgba(255,255,255,0.12);
      --divider: rgba(255,255,255,0.1); --shadow-panel: 0 20px 60px rgba(0,0,0,0.3);
      --grad-1: rgba(14, 165, 233, 0.1); --grad-2: rgba(59, 130, 246, 0.1);
    }
    :root.light {
      color-scheme: light;
      --bg-body: #f3f4f6; --text-main: #111827; --text-muted: #6b7280;
      --panel-bg: rgba(255, 255, 255, 0.85); --panel-border: rgba(0,0,0,0.06);
      --input-bg: rgba(255,255,255,0.9); --input-border: rgba(0,0,0,0.15);
      --row-bg: rgba(255,255,255,0.75); --btn-sec-bg: rgba(0,0,0,0.05); --btn-sec-hover: rgba(0,0,0,0.1);
      --divider: rgba(0,0,0,0.08); --shadow-panel: 0 10px 30px rgba(0,0,0,0.05);
      --grad-1: rgba(14, 165, 233, 0.15); --grad-2: rgba(59, 130, 246, 0.15);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0; min-height: 100vh; background: var(--bg-body); color: var(--text-main);
      background-image:
        radial-gradient(circle at 0% 0%, var(--grad-1), transparent 40%),
        radial-gradient(circle at 100% 100%, var(--grad-2), transparent 40%);
      font-family: "Inter", "Segoe UI", sans-serif;
    }
    .wrap { max-width: 1320px; margin: 0 auto; padding: 40px 24px 56px; }
    .hero, .panel { background: var(--panel-bg); backdrop-filter: blur(40px); -webkit-backdrop-filter: blur(40px); border: 1px solid var(--panel-border); border-radius: 32px; box-shadow: var(--shadow-panel); }
    .hero { display: flex; justify-content: space-between; gap: 20px; align-items: flex-start; padding: 28px 32px; margin-bottom: 20px; }
    .hero h1 { margin: 0; font-size: 34px; letter-spacing: -0.03em; }
    .hero p { margin: 10px 0 0; color: var(--text-muted); line-height: 1.7; max-width: 760px; }
    .toolbar { display: flex; gap: 12px; flex-wrap: wrap; }
    a, button { border: 0; border-radius: 12px; padding: 12px 18px; font-size: 14px; font-weight: 600; cursor: pointer; text-decoration: none; transition: 0.2s ease; }
    .ghost { background: var(--btn-sec-bg); color: var(--text-main); box-shadow: inset 0 0 0 1px var(--panel-border); }
    .ghost:hover { background: var(--btn-sec-hover); }
    .primary { background: linear-gradient(135deg, #0ea5e9, #3b82f6); color: #fff; box-shadow: 0 8px 20px rgba(14,165,233,0.3); }
    .panel { padding: 28px; }
    .stats { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 16px; margin-bottom: 20px; }
    .stat { padding: 24px; }
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
        linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01)),
        rgba(255,255,255,0.015);
      border: 1px solid rgba(255,255,255,0.04);
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.04);
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
    .warning { margin-bottom: 18px; padding: 14px 16px; border-radius: 16px; background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.2); color: #ef4444; font-weight: 500; }
    .table-wrap { overflow: auto; border: 1px solid var(--panel-border); border-radius: 24px; background: var(--row-bg); }
    table { width: 100%; min-width: 980px; border-collapse: collapse; }
    th, td { text-align: left; padding: 14px 16px; border-bottom: 1px solid var(--divider); font-size: 13px; vertical-align: top; }
    th { color: var(--text-muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; font-weight: 700; background: rgba(255,255,255,0.02); }
    td code { font-family: Consolas, monospace; font-size: 12px; }
    .empty { padding: 28px; color: var(--text-muted); text-align: center; }
    .theme-toggle { white-space: nowrap; }
    @media (max-width: 1100px) {
      .filter-grid { grid-template-columns: repeat(6, minmax(0,1fr)); }
      .field.span-3 { grid-column: span 3; }
      .field.span-4 { grid-column: span 2; }
      .field.span-6 { grid-column: span 6; }
      .stats { grid-template-columns: 1fr; }
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

    <section class="stats">
      <div class="panel stat"><div class="stat-label">失败总数</div><div class="stat-value">${options.total}</div></div>
      <div class="panel stat"><div class="stat-label">当前结果</div><div class="stat-value">${options.items.length}</div></div>
      <div class="panel stat"><div class="stat-label">查询上限</div><div class="stat-value">${limit}</div></div>
    </section>

    <section class="panel">
      <form method="get" action="/admin/failed-events" class="filters">
        <div class="filter-grid">
          <div class="field span-4">
            <label for="name">连接名称</label>
            <input id="name" name="name" value="${escapeHtml(options.filters.label || "")}" placeholder="输入连接名称" />
          </div>
          <div class="field span-4">
            <label for="platform">平台</label>
            <input id="platform" name="platform" value="${escapeHtml(options.filters.platform || "")}" placeholder="输入平台名称" />
          </div>
          <div class="field span-4">
            <label for="orderNo">单号</label>
            <input id="orderNo" name="orderNo" value="${escapeHtml(options.filters.orderNo || "")}" placeholder="输入订单号" />
          </div>
          <div class="field span-3">
            <label>类型</label>
            <div class="custom-select" id="kind-select">
              <div class="custom-select-trigger">
                <span>${options.filters.kind === "upsert" ? "upsert" : options.filters.kind === "progress" ? "progress" : options.filters.kind === "delete" ? "delete" : "全部"}</span>
                <span class="chevron"></span>
              </div>
              <div class="custom-select-options">
                <div class="custom-select-option ${!options.filters.kind ? "active" : ""}" data-value="">全部</div>
                <div class="custom-select-option ${options.filters.kind === "upsert" ? "active" : ""}" data-value="upsert">upsert</div>
                <div class="custom-select-option ${options.filters.kind === "progress" ? "active" : ""}" data-value="progress">progress</div>
                <div class="custom-select-option ${options.filters.kind === "delete" ? "active" : ""}" data-value="delete">delete</div>
              </div>
              <input type="hidden" name="kind" value="${escapeHtml(options.filters.kind || "")}" />
            </div>
          </div>
          <div class="field span-3">
            <label for="error-keyword">错误关键字</label>
            <input
              id="error-keyword"
              name="error"
              value="${escapeHtml(options.filters.error || "")}"
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
    </section>

    <section class="panel" style="margin-top:20px;">
      ${options.total > 0 ? `<div class="warning">这些事件还没有成功推回主系统，插件会继续自动重试。</div>` : ""}
      <div class="note" style="margin-bottom:16px;">展示最近符合条件的 ${options.items.length} 条记录，默认按下次重试时间升序排列。</div>
      ${options.items.length > 0 ? `
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>连接</th>
                <th>平台</th>
                <th>单号</th>
                <th>类型</th>
                <th>重试次数</th>
                <th>下次重试</th>
                <th>最近错误</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      ` : `<div class="empty">没有符合筛选条件的失败积压。</div>`}
    </section>
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

function renderHealthViewerPage(payload: unknown) {
  const pretty = JSON.stringify(payload, null, 2);
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>健康检查</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;800&display=swap" rel="stylesheet">
  <script>
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light' || (!savedTheme && window.matchMedia('(prefers-color-scheme: light)').matches)) {
      document.documentElement.classList.add('light');
    }
  </script>
  <style>
    :root {
      --bg-body: #111827; --text-main: #f9fafb; --panel-bg: rgba(31,41,55,0.7); --panel-border: rgba(255,255,255,0.08);
    }
    :root.light {
      --bg-body: #f3f4f6; --text-main: #111827; --panel-bg: rgba(255,255,255,0.85); --panel-border: rgba(0,0,0,0.06);
    }
    body { margin:0; min-height:100vh; background:var(--bg-body); color:var(--text-main); font-family:"Inter", sans-serif; transition: background 0.3s; }
    .wrap { max-width:980px; margin:0 auto; padding:40px 24px; }
    h1 { margin:0 0 24px; font-size: 32px; letter-spacing: -0.02em; background: linear-gradient(to right, #38bdf8, #818cf8); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    pre { margin:0; white-space:pre-wrap; word-break:break-word; padding:24px; border-radius:24px; background:var(--panel-bg); backdrop-filter:blur(20px); border:1px solid var(--panel-border); font-family:Consolas, monospace; line-height:1.6; font-size:14px; box-shadow:0 20px 60px rgba(0,0,0,0.2); }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>System Health Check</h1>
    <pre>${escapeHtml(pretty)}</pre>
  </div>
</body>
</html>`;
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
    mealCompleteCooldownMs: Number(body.mealCompleteCooldownMs || current.mealCompleteCooldownMs),
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
        const logisticId = String(body.logisticId || "").trim();
        const orderNo = String(body.orderNo || "").trim();
        const platform = String(body.platform || "").trim();
        const dailyPlatformSequence = Number(body.dailyPlatformSequence || 0);

        if (!sourceId || !logisticId || !orderNo || !platform || !Number.isFinite(dailyPlatformSequence) || dailyPlatformSequence <= 0) {
          response.writeHead(400, { "Content-Type": "application/json" });
          response.end(JSON.stringify({
            ok: false,
            error: "platform, dailyPlatformSequence, orderNo, sourceId and logisticId are required",
          }));
          return;
        }

        const payload = await runtime.selfDelivery(apiKey || "", {
          platform,
          dailyPlatformSequence,
          orderNo,
          sourceId,
          logisticId,
        });
        response.writeHead(payload.ok ? 200 : 409, { "Content-Type": "application/json" });
        response.end(JSON.stringify(payload));
        return;
      }

      if ((url.pathname === "/pickup-complete" || url.pathname === "/meal-complete") && method === "POST") {
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

        const payload = url.pathname === "/pickup-complete"
          ? await runtime.pickupComplete(apiKey || "", {
              platform,
              dailyPlatformSequence,
              orderNo,
              sourceId,
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
