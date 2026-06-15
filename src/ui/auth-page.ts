import { AuthUser } from "../types.js";
import { escapeHtml } from "./shared.js";
import { INTER_FONT_LINK, renderSharedPageTheme, THEME_BOOTSTRAP_SCRIPT } from "./theme.js";

export function renderAuthPage(options: {
  error?: string;
  info?: string;
  email?: string;
  smtpReady: boolean;
}) {
  const escapedEmail = escapeHtml(options.email || "");
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>ws-autopick 登录</title>
  ${INTER_FONT_LINK}
  ${THEME_BOOTSTRAP_SCRIPT}
  <style>
    ${renderSharedPageTheme({ wrapMaxWidth: "720px", wrapPadding: "40px 24px" })}
    body {
      display: grid;
      align-items: center;
      position: relative;
    }
    .page-theme-toggle {
      position: fixed;
      top: 22px;
      right: 22px;
      z-index: 10;
    }
    .auth-shell {
      position: relative;
      overflow: hidden;
      width: min(100%, 560px);
      margin: 0 auto;
      border-radius: 36px;
      padding: 34px 34px 30px;
    }
    .auth-shell::before {
      content: "";
      position: absolute;
      inset: 0;
      background:
        linear-gradient(135deg, rgba(125, 211, 252, 0.1), transparent 44%),
        radial-gradient(circle at top right, rgba(34, 197, 94, 0.12), transparent 36%);
      pointer-events: none;
    }
    .auth-topbar {
      position: relative;
      display: flex;
      justify-content: flex-start;
      align-items: flex-start;
      z-index: 1;
      margin-bottom: 18px;
    }
    .brand-mark {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      padding: 0;
      border-radius: 0;
      background: transparent;
      border: 0;
      color: var(--text-main);
      font-size: 14px;
      font-weight: 800;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .brand-dot {
      width: 9px;
      height: 9px;
      border-radius: 999px;
      background: linear-gradient(135deg, #38bdf8, #22c55e);
      box-shadow: 0 0 18px rgba(56, 189, 248, 0.45);
    }
    .theme-toggle {
      width: 42px;
      height: 42px;
      padding: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: rgba(255, 255, 255, 0.02);
      color: var(--text-main);
      border: 1px solid var(--panel-border);
      border-radius: 999px;
    }
    .theme-toggle:hover {
      background: var(--btn-sec-hover);
      transform: translateY(-1px);
    }
    .theme-toggle svg {
      width: 18px;
      height: 18px;
      display: block;
      fill: currentColor;
    }
    .auth-card-inner {
      position: relative;
      z-index: 1;
    }
    .auth-card-inner {
      display: grid;
      gap: 24px;
    }
    .card-header h2 {
      margin: 0 0 10px;
      font-size: 44px;
      line-height: 1.02;
      letter-spacing: -0.05em;
    }
    .card-header p {
      margin: 0;
      color: var(--text-muted);
      font-size: 16px;
      line-height: 1.6;
    }
    .stack {
      display: grid;
      gap: 10px;
    }
    .message {
      padding: 14px 16px;
      border-radius: 16px;
      font-size: 13px;
      line-height: 1.6;
      border: 1px solid transparent;
      backdrop-filter: blur(18px);
    }
    .message.error {
      background: rgba(239, 68, 68, 0.12);
      color: #fecaca;
      border-color: rgba(248, 113, 113, 0.22);
    }
    .message.info {
      background: rgba(56, 189, 248, 0.12);
      color: #bae6fd;
      border-color: rgba(56, 189, 248, 0.2);
    }
    .message.warn {
      background: rgba(245, 158, 11, 0.12);
      color: #fde68a;
      border-color: rgba(245, 158, 11, 0.2);
    }
    :root.light .message.error { color: #b91c1c; }
    :root.light .message.info { color: #075985; }
    :root.light .message.warn { color: #92400e; }
    .login-form {
      display: grid;
      gap: 18px;
    }
    .field {
      display: grid;
      gap: 10px;
    }
    label {
      font-size: 14px;
      font-weight: 700;
      letter-spacing: 0.01em;
      color: var(--text-muted);
    }
    input {
      width: 100%;
      min-height: 60px;
      border: 1px solid var(--input-border);
      border-radius: 18px;
      padding: 0 18px;
      font: inherit;
      color: var(--text-main);
      background: rgba(9, 18, 34, 0.45);
      transition: border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease;
      font-size: 16px;
    }
    :root.light input {
      background: rgba(255, 255, 255, 0.88);
    }
    input:focus {
      outline: none;
      border-color: rgba(56, 189, 248, 0.8);
      box-shadow: 0 0 0 4px rgba(56, 189, 248, 0.16);
      transform: translateY(-1px);
    }
    .email-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 12px;
      align-items: end;
    }
    .secondary {
      min-height: 60px;
      padding: 0 22px;
      white-space: nowrap;
      border-radius: 18px;
      font-size: 15px;
    }
    .primary {
      width: 100%;
      min-height: 62px;
      margin-top: 8px;
      border-radius: 18px;
      font-size: 17px;
      letter-spacing: 0.01em;
    }
    .auth-footnote {
      display: grid;
      grid-template-columns: 1fr;
      gap: 10px;
      color: var(--text-muted);
      font-size: 13px;
      line-height: 1.65;
    }
    .auth-footnote strong {
      color: var(--text-main);
      font-weight: 700;
    }
    @media (max-width: 640px) {
      .wrap {
        padding: 18px;
      }
      .auth-shell {
        width: min(100%, 100%);
        padding: 24px 22px 22px;
        border-radius: 28px;
      }
      .page-theme-toggle {
        top: 16px;
        right: 16px;
      }
      .card-header h2 {
        font-size: 36px;
      }
      .card-header p {
        font-size: 15px;
      }
      .email-row {
        grid-template-columns: 1fr;
      }
      input,
      .secondary,
      .primary {
        min-height: 56px;
      }
    }
  </style>
</head>
<body>
  <button class="theme-toggle ghost page-theme-toggle" id="theme-btn" type="button" aria-label="切换主题" title="切换主题">
    <svg id="theme-icon-dark" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M21 12.79A9 9 0 0 1 11.21 3a1 1 0 0 0-1.24 1.25A7 7 0 1 0 19.75 14a1 1 0 0 0 1.25-1.21Z"></path>
    </svg>
    <svg id="theme-icon-light" viewBox="0 0 24 24" aria-hidden="true" style="display:none;">
      <path d="M12 18a6 6 0 1 1 0-12 6 6 0 0 1 0 12Zm0-16a1 1 0 0 1 1 1v1a1 1 0 1 1-2 0V3a1 1 0 0 1 1-1Zm0 18a1 1 0 0 1 1 1v1a1 1 0 1 1-2 0v-1a1 1 0 0 1 1-1Zm10-9a1 1 0 1 1 0 2h-1a1 1 0 1 1 0-2h1ZM4 12a1 1 0 1 1 0 2H3a1 1 0 1 1 0-2h1Zm14.36-6.95a1 1 0 0 1 1.41 1.41l-.7.71a1 1 0 0 1-1.42-1.41l.71-.71ZM6.35 17.65a1 1 0 0 1 1.41 1.41l-.7.71a1 1 0 0 1-1.42-1.41l.71-.71Zm12.72 2.12a1 1 0 0 1-1.41 0l-.71-.71a1 1 0 0 1 1.41-1.41l.71.7a1 1 0 0 1 0 1.42ZM7.06 7.06a1 1 0 0 1-1.41 0l-.71-.71a1 1 0 0 1 1.41-1.41l.71.7a1 1 0 0 1 0 1.42Z"></path>
    </svg>
  </button>
  <div class="wrap">
    <section class="panel auth-shell">
      <div class="auth-topbar">
        <div class="brand-mark"><span class="brand-dot"></span>ws-autopick</div>
      </div>
      <div class="auth-card-inner">
        <div class="card-header">
          <h2>登录管理台</h2>
          <p>邮箱验证码登录</p>
        </div>
        <div class="stack">
          ${options.error ? `<div class="message error">${escapeHtml(options.error)}</div>` : ""}
          ${options.info ? `<div class="message info">${escapeHtml(options.info)}</div>` : ""}
          ${options.smtpReady ? "" : `<div class="message warn">邮件服务尚未配置，暂时无法发送验证码。</div>`}
        </div>
        <div class="login-form">
          <div class="field">
            <label for="email">邮箱</label>
            <div class="email-row">
              <input id="email" type="email" value="${escapedEmail}" placeholder="name@example.com" autocomplete="username" required />
              <form method="post" action="/auth/send-code" style="margin:0;">
                <input id="send-email" type="hidden" name="email" value="${escapedEmail}" />
                <button class="secondary ghost" id="send-code-button" type="submit">发送验证码</button>
              </form>
            </div>
          </div>
          <form method="post" action="/auth/verify" style="margin:0; display:grid; gap:16px;">
            <input id="verify-email" type="hidden" name="email" value="${escapedEmail}" />
            <div class="field">
              <label for="code">验证码</label>
              <input id="code" name="code" inputmode="numeric" pattern="\\d{6}" maxlength="6" placeholder="6 位数字" autocomplete="one-time-code" required />
            </div>
            <button class="primary" type="submit">登录</button>
          </form>
        </div>
        <div class="auth-footnote">
          <span><strong>提示</strong> 如果没有收到邮件，先确认 SMTP 配置是否已启用。</span>
          <span>验证码有效期较短，请尽快完成登录。</span>
        </div>
      </div>
    </section>
  </div>
  <script>
    const emailInput = document.getElementById('email');
    const sendEmailInput = document.getElementById('send-email');
    const verifyEmailInput = document.getElementById('verify-email');
    const sendButton = document.getElementById('send-code-button');
    const darkIcon = document.getElementById('theme-icon-dark');
    const lightIcon = document.getElementById('theme-icon-light');

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
      const isLight = html.classList.contains('light');
      if (darkIcon) darkIcon.style.display = isLight ? 'none' : 'block';
      if (lightIcon) lightIcon.style.display = isLight ? 'block' : 'none';
      if (themeBtn) {
        themeBtn.setAttribute('aria-label', isLight ? '切换深色' : '切换浅色');
        themeBtn.setAttribute('title', isLight ? '切换深色' : '切换浅色');
      }
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

export function renderForbiddenPage(user: AuthUser) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>无权限</title>
  ${INTER_FONT_LINK}
  ${THEME_BOOTSTRAP_SCRIPT}
  <style>
    ${renderSharedPageTheme({ wrapMaxWidth: "760px", wrapPadding: "28px 18px" })}
    body { display: grid; place-items: center; }
    .forbidden-card {
      padding: 34px;
      border-radius: 34px;
      text-align: center;
    }
    .status-chip {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 20px;
      padding: 9px 14px;
      border-radius: 999px;
      background: rgba(248, 113, 113, 0.12);
      border: 1px solid rgba(248, 113, 113, 0.18);
      color: #fca5a5;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }
    :root.light .status-chip { color: #b91c1c; }
    h1 {
      margin: 0 0 14px;
      font-size: clamp(32px, 6vw, 48px);
      letter-spacing: -0.05em;
    }
    p {
      margin: 0 auto 30px;
      max-width: 520px;
      color: var(--text-muted);
      line-height: 1.8;
      font-size: 15px;
    }
    code {
      padding: 2px 8px;
      border-radius: 999px;
      background: rgba(125, 211, 252, 0.12);
      color: var(--text-main);
      font-family: inherit;
      font-weight: 700;
    }
    .logout-btn {
      min-height: 54px;
      padding: 0 24px;
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="panel forbidden-card">
      <div class="status-chip">访问受限</div>
      <h1>当前账号没有权限</h1>
      <p><code>${escapeHtml(user.email)}</code> 已登录，但这个插件只允许唯一管理员账号进入后台。如果这是错误账号，可以先退出再重新登录。</p>
      <form method="post" action="/logout"><button type="submit" class="primary logout-btn">退出登录</button></form>
    </div>
  </div>
</body>
</html>`;
}
