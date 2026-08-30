import "server-only";

import nodemailer from "nodemailer";

type SendInviteEmailInput = {
  recipientEmail: string;
};

type GmailSmtpConfiguration = {
  appBaseUrl: string;
  from: string;
  password: string;
  user: string;
};

function requiredEnvironmentValue(name: string): string {
  const value = process.env[name]?.trim() ?? "";
  if (!value) {
    throw new Error(`Missing server email configuration: ${name}`);
  }
  return value;
}

function normalizedAppBaseUrl(): string {
  const rawValue = requiredEnvironmentValue("APP_BASE_URL");
  const url = new URL(rawValue);
  const localDevelopmentHost =
    url.hostname === "localhost" || url.hostname === "127.0.0.1";

  if (
    (url.protocol !== "https:" &&
      !(localDevelopmentHost && url.protocol === "http:")) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw new Error("APP_BASE_URL must be a secure application origin.");
  }

  return url.origin;
}

function gmailSmtpConfiguration(): GmailSmtpConfiguration {
  const user = requiredEnvironmentValue("GMAIL_SMTP_USER");
  const password = requiredEnvironmentValue(
    "GMAIL_SMTP_APP_PASSWORD"
  ).replace(/\s+/g, "");
  const fromName = process.env.GMAIL_SMTP_FROM_NAME?.trim() || "투약 관리";
  const from = `${fromName} <${user}>`;

  if (!password || /[\r\n<>]/.test(user) || /[\r\n<>]/.test(fromName)) {
    throw new Error("Invalid Gmail SMTP configuration.");
  }

  return {
    appBaseUrl: normalizedAppBaseUrl(),
    from,
    password,
    user,
  };
}

export function assertInviteEmailConfiguration(): void {
  gmailSmtpConfiguration();
}

function validRecipientEmail(value: string): boolean {
  return (
    value.length >= 3 &&
    value.length <= 320 &&
    !/[\r\n]/.test(value) &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
  );
}

function htmlEscape(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const replacements: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return replacements[character];
  });
}

export async function sendInviteEmail({
  recipientEmail,
}: SendInviteEmailInput): Promise<void> {
  if (!validRecipientEmail(recipientEmail)) {
    throw new Error("Invalid invite recipient.");
  }

  const configuration = gmailSmtpConfiguration();
  const inviteUrl = new URL("/family", configuration.appBaseUrl);
  const inviteUrlString = inviteUrl.toString();
  const escapedInviteUrl = htmlEscape(inviteUrlString);
  const plainDescription =
    "초대한 사람이 내 복약 기록을 보호자로 관리하도록 요청했습니다. 수락할 때 내가 소유한 복약 공간을 직접 선택해야 하며, 보호자는 그 공간의 약·일정·투약·상태 기록을 조회하고 변경할 수 있습니다.";
  const htmlDescription = htmlEscape(plainDescription);

  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: {
      user: configuration.user,
      pass: configuration.password,
    },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    tls: {
      minVersion: "TLSv1.2",
    },
  });

  const info = await transporter.sendMail({
    from: configuration.from,
    to: recipientEmail,
    subject: "[투약 관리] 가족 복약 기록 관리 요청",
    text: [
      "가족 복약 기록 관리 요청이 도착했습니다.",
      "",
      plainDescription,
      "",
      "아래 주소에서 이 메일을 받은 Google 계정으로 로그인한 뒤 관리 요청을 수락하거나 거절해 주세요.",
      inviteUrlString,
      "",
      "본인이 예상한 관리 요청이 아니라면 이 메일을 무시해 주세요.",
    ].join("\n"),
    html: [
      '<div style="font-family:Arial,\'Noto Sans KR\',sans-serif;line-height:1.6;color:#222">',
      "<h1 style=\"font-size:22px\">가족 복약 기록 관리 요청</h1>",
      `<p>${htmlDescription}</p>`,
      "<p>아래 버튼을 누른 뒤 이 메일을 받은 Google 계정으로 로그인하여 관리 요청을 수락하거나 거절해 주세요.</p>",
      `<p><a href="${escapedInviteUrl}" style="display:inline-block;padding:12px 20px;border-radius:999px;background:#222;color:#fff;text-decoration:none;font-weight:700">관리 요청 확인하기</a></p>`,
      `<p style="font-size:13px;color:#666;word-break:break-all">버튼이 열리지 않으면 다음 주소를 입력하세요.<br>${escapedInviteUrl}</p>`,
      '<p style="font-size:13px;color:#666">본인이 예상한 관리 요청이 아니라면 이 메일을 무시해 주세요.</p>',
      "</div>",
    ].join(""),
    disableFileAccess: true,
    disableUrlAccess: true,
  });

  if (!Array.isArray(info.accepted) || info.accepted.length === 0) {
    throw new Error("Gmail SMTP did not accept the invite recipient.");
  }
}
