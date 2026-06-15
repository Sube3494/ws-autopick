export const INTER_FONT_LINK = '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">';

export const THEME_BOOTSTRAP_SCRIPT = `<script>
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light' || (!savedTheme && window.matchMedia('(prefers-color-scheme: light)').matches)) {
      document.documentElement.classList.add('light');
    }
  </script>`;

export function renderSharedPageTheme(options: {
  wrapMaxWidth: string;
  wrapPadding: string;
}) {
  return `
    :root {
      color-scheme: dark;
      --bg-body: #07111f;
      --text-main: #f6fbff;
      --text-muted: #8da3ba;
      --panel-bg: linear-gradient(180deg, rgba(14, 25, 46, 0.86), rgba(10, 18, 34, 0.78));
      --panel-border: rgba(148, 194, 255, 0.14);
      --input-bg: rgba(10, 18, 34, 0.78);
      --input-border: rgba(148, 194, 255, 0.16);
      --btn-sec-bg: rgba(122, 162, 255, 0.12);
      --btn-sec-hover: rgba(122, 162, 255, 0.18);
      --divider: rgba(148, 194, 255, 0.12);
      --shadow-panel: 0 24px 80px rgba(1, 8, 20, 0.46);
      --grad-1: rgba(34, 197, 94, 0.08);
      --grad-2: rgba(56, 189, 248, 0.14);
      --grad-3: rgba(59, 130, 246, 0.18);
      --surface-glow: rgba(125, 211, 252, 0.12);
    }
    :root.light {
      color-scheme: light;
      --bg-body: #f4efe7;
      --text-main: #1d2736;
      --text-muted: #6c7a8d;
      --panel-bg: linear-gradient(180deg, rgba(255, 255, 255, 0.94), rgba(248, 244, 238, 0.92));
      --panel-border: rgba(34, 53, 87, 0.08);
      --input-bg: rgba(255,255,255,0.95);
      --input-border: rgba(34, 53, 87, 0.14);
      --btn-sec-bg: rgba(34, 53, 87, 0.05);
      --btn-sec-hover: rgba(34, 53, 87, 0.1);
      --divider: rgba(34, 53, 87, 0.08);
      --shadow-panel: 0 18px 40px rgba(84, 97, 120, 0.12);
      --grad-1: rgba(249, 115, 22, 0.08);
      --grad-2: rgba(56, 189, 248, 0.12);
      --grad-3: rgba(250, 204, 21, 0.14);
      --surface-glow: rgba(14, 165, 233, 0.08);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background: var(--bg-body);
      background-image:
        radial-gradient(circle at 0% 0%, var(--grad-1), transparent 34%),
        radial-gradient(circle at 100% 0%, var(--grad-2), transparent 38%),
        radial-gradient(circle at 50% 100%, var(--grad-3), transparent 44%);
      color: var(--text-main);
      font-family: "Inter", "Segoe UI", sans-serif;
      transition: background 0.3s ease, color 0.3s ease;
    }
    .wrap {
      max-width: ${options.wrapMaxWidth};
      margin: 0 auto;
      padding: ${options.wrapPadding};
    }
    .hero, .panel {
      background: var(--panel-bg);
      backdrop-filter: blur(40px);
      -webkit-backdrop-filter: blur(40px);
      border: 1px solid var(--panel-border);
      box-shadow: var(--shadow-panel);
    }
    .hero {
      display: flex;
      justify-content: space-between;
      gap: 24px;
      align-items: flex-start;
      border-radius: 32px;
      position: relative;
      overflow: hidden;
    }
    .hero::after {
      content: "";
      position: absolute;
      inset: auto -8% -40% auto;
      width: 280px;
      height: 280px;
      border-radius: 999px;
      background: radial-gradient(circle, var(--surface-glow), transparent 68%);
      pointer-events: none;
    }
    .hero h1 {
      margin: 0;
      letter-spacing: -0.03em;
    }
    .hero p {
      margin: 12px 0 0;
      color: var(--text-muted);
      line-height: 1.7;
    }
    .panel {
      border-radius: 32px;
      position: relative;
      overflow: hidden;
    }
    .toolbar {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      align-items: center;
    }
    .toolbar form { margin: 0; display: flex; }
    a, button {
      border: 0;
      border-radius: 12px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      text-decoration: none;
      transition: all 0.2s ease;
    }
    .ghost {
      background: var(--btn-sec-bg);
      color: var(--text-main);
      box-shadow: inset 0 0 0 1px var(--panel-border);
    }
    .ghost:hover {
      background: var(--btn-sec-hover);
      transform: translateY(-1px);
    }
    .primary {
      background: linear-gradient(135deg, #0ea5e9, #2563eb 58%, #1d4ed8);
      color: #fff;
      box-shadow: 0 12px 28px rgba(37, 99, 235, 0.28);
    }
    @media (max-width: 768px) {
      .hero { flex-direction: column; }
      .toolbar { width: 100%; }
      .toolbar > * { flex: 1 1 100%; text-align: center; justify-content: center; }
    }
  `;
}
