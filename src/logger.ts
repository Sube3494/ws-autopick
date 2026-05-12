type LogLevel = "debug" | "info" | "warn" | "error";

function write(level: LogLevel, message: string, data?: Record<string, unknown>) {
  const line = JSON.stringify({
    time: new Date().toISOString(),
    level,
    message,
    ...data,
  });
  const sink = level === "error" ? console.error : console.log;
  sink(line);
}

export const logger = {
  debug(message: string, data?: Record<string, unknown>) {
    write("debug", message, data);
  },
  info(message: string, data?: Record<string, unknown>) {
    write("info", message, data);
  },
  warn(message: string, data?: Record<string, unknown>) {
    write("warn", message, data);
  },
  error(message: string, data?: Record<string, unknown>) {
    write("error", message, data);
  },
};
