# ws-autopick

一个独立运行的 Bun 插件，用来监听麦芽田订单变化，并把整理后的订单事件推送回主系统。

## 特性

- Bun + TypeScript
- sqlite 持久化连接、失败事件、验证码、会话、运行设置
- WebSocket 实时监听，HTTP 轮询兜底
- Web 管理台发放 `apiKey`
- 支持先建连接发 key，后续由主系统同步 `cookie`
- QQ 邮箱验证码登录
- 首个注册成功用户自动成为管理员
- 运行参数支持网页端实时修改

## 事件映射

- `notify.confirm / delivery / pickup / delivering / done`
  - 拉取订单详情
  - 推送到 `POST /api/v1/api-key/listened-orders`
- `notify.delete`
  - 推送到 `DELETE /api/v1/api-key/listened-orders`
- 空 `cmd` 且消息形如 `美团6号订单上报拣货成功`
  - 推送到 `POST /api/v1/api-key/listened-orders/progress`
- `expect`
  - 忽略

## 快速开始

安装依赖：

```bash
bun install
```

复制环境变量模板并填写 `PUSH_BASE_URL` 和 SMTP：

```bash
cp .env.example .env
```

构建并启动：

```bash
bun run build
bun run start
```

开发模式：

```bash
bun run dev
```

## 环境变量

`.env` 只保留启动必需项。业务运行参数会在首次启动时写入 sqlite，后续统一在管理台中修改。

`PUSH_BASE_URL` 为必填项，未配置时服务会直接启动失败，避免误连到默认 `3000` 端口。

```txt
HOST=127.0.0.1
PORT=22800
PUSH_BASE_URL=http://127.0.0.1:3000
DATA_DIR=./data
DB_PATH=./data/ws-autopick.sqlite
SMTP_HOST=smtp.qq.com
SMTP_PORT=465
SMTP_USER=example@qq.com
SMTP_PASS=your_smtp_key
SMTP_FROM=ws-autopick <example@qq.com>
SMTP_SECURE=true
```

## 管理台

默认地址：

```txt
http://127.0.0.1:22800/admin
```

推荐流程：

1. 先通过 QQ 邮箱验证码登录
2. 第一个注册成功用户自动成为管理员
3. 新建连接并生成 `apiKey`
4. 把 `pluginBaseUrl` 和 `inboundApiKey` 配到主系统
5. 用户侧保存好 Cookie 后，由主系统把 Cookie 同步给插件

## Cookie 同步接口

主系统拿到连接 `apiKey` 后，可以把用户侧保存好的 Cookie 回传给插件：

```http
POST /api/connections/cookie
X-API-Key: <inboundApiKey>
Content-Type: application/json

{
  "cookie": "PHPSESSID=...; token=...",
  "enabled": true
}
```

插件收到后会自动更新连接并重载监听。

## 仓库结构

```txt
src/
  index.ts              # 启动入口
  server.ts             # 管理台和鉴权
  plugin.ts             # 运行时编排
  db.ts                 # sqlite 存储
  ws.ts                 # WebSocket 客户端与消息解析
  maiyatian.ts          # 麦芽田 HTTP 与详情补拉
  main-system-client.ts # 主系统推送
  user-runner.ts        # 单连接运行器
```

## 当前边界

- 这个仓库只负责“监听平台、转换事件、推送主系统”
- 不复制主系统业务逻辑
- 不要求发 key 时先提供 cookie
- Cookie 由主系统后续同步给插件
- 主系统仍然负责订单存储、权限和后续业务处理

## 说明

- `package.json` 里的 `private: true` 仅表示不打算直接发布到 npm，不影响作为 git 仓库公开
- 当前仓库未附带 License；如果你准备公开给别人长期使用，建议单独补一个明确的许可证
