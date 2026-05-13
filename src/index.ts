import { promises as fs } from "node:fs";
import { loadConfig } from "./config.js";
import { AppDatabase } from "./db.js";
import { logger } from "./logger.js";
import { PluginRuntime } from "./plugin.js";
import { createServer } from "./server.js";

async function main() {
  const cwd = process.cwd();
  const config = loadConfig(cwd);
  await fs.mkdir(config.dataDir, { recursive: true });
  const database = new AppDatabase(config);
  const runtime = new PluginRuntime(config, database);
  await runtime.start();

  const missingMailConfig = [
    ["SMTP_HOST", config.smtpHost],
    ["SMTP_USER", config.smtpUser],
    ["SMTP_PASS", config.smtpPass],
    ["SMTP_FROM", config.smtpFrom],
  ].filter(([, value]) => !value).map(([key]) => key);

  if (missingMailConfig.length > 0) {
    logger.warn("mail login setup is incomplete", {
      missing: missingMailConfig.join(","),
      hint: "Configure the missing env vars and restart the service before using email login",
    });
  }

  const server = createServer(runtime);
  server.listen(config.port, config.host, () => {
    const connectionCount = database.listConnections().length;
    logger.info("ws-autopick started", {
      host: config.host,
      port: config.port,
      connectionCount,
      pushBaseUrl: config.pushBaseUrl,
      dbPath: config.dbPath,
    });
  });

  const shutdown = async (signal: string) => {
    logger.info("shutdown requested", { signal });
    server.close();
    await runtime.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("unhandledRejection", (error) => {
    logger.error("unhandled rejection", {
      error: error instanceof Error ? error.stack || error.message : String(error),
    });
  });
  process.on("uncaughtException", (error) => {
    logger.error("uncaught exception", {
      error: error instanceof Error ? error.stack || error.message : String(error),
    });
  });
}

void main().catch((error) => {
  logger.error("ws-autopick failed to start", {
    error: error instanceof Error ? error.stack || error.message : String(error),
  });
  process.exit(1);
});
