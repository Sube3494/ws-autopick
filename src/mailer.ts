import nodemailer from "nodemailer";
import { AppConfig } from "./types.js";

export async function sendVerificationCode(config: AppConfig, email: string, code: string) {
  if (!config.smtpHost || !config.smtpUser || !config.smtpPass || !config.smtpFrom) {
    throw new Error("SMTP is not configured");
  }

  const transporter = nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpSecure,
    auth: {
      user: config.smtpUser,
      pass: config.smtpPass,
    },
  });

  await transporter.sendMail({
    from: config.smtpFrom,
    to: email,
    subject: "ws-autopick 登录验证码",
    text: `你的验证码是：${code}，5 分钟内有效。`,
    html: `<div style="font-family:Segoe UI,PingFang SC,Microsoft YaHei,sans-serif">
      <h2>ws-autopick 登录验证码</h2>
      <p>你的验证码是：</p>
      <div style="font-size:32px;font-weight:700;letter-spacing:6px">${code}</div>
      <p>5 分钟内有效。</p>
    </div>`,
  });
}
