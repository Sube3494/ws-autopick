import { escapeHtml } from "./shared.js";
import { INTER_FONT_LINK, renderSharedPageTheme, THEME_BOOTSTRAP_SCRIPT } from "./theme.js";

export function renderHealthViewerPage(payload: unknown) {
  const pretty = JSON.stringify(payload, null, 2);
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>健康检查</title>
  ${INTER_FONT_LINK}
  ${THEME_BOOTSTRAP_SCRIPT}
  <style>
    ${renderSharedPageTheme({ wrapMaxWidth: "980px", wrapPadding: "40px 24px" })}
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
