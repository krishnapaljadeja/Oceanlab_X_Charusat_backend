import nodemailer from "nodemailer";

function getMailer() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || "587");
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: {
      user,
      pass,
    },
  });
}

export async function sendSignupEmail(
  email: string,
  links: {
    confirmationLink: string;
    redirectLink: string;
  },
): Promise<void> {
  const mailer = getMailer();
  if (!mailer) {
    console.warn("[Mail] SMTP not configured. Skipping signup email.");
    return;
  }

  const from = process.env.SMTP_FROM || process.env.SMTP_USER || "";
  const appName = process.env.APP_NAME || "GitHistory_Teller";

  await mailer.sendMail({
    from,
    to: email,
    subject: `Confirm your email for ${appName}`,
    text:
      `Hi,\n\nPlease confirm your email by opening this link:\n${links.confirmationLink}` +
      `\n\nAfter verification, you will be redirected with an access token using this URL:\n${links.redirectLink}` +
      `\n\nThanks,\n${appName}`,
  });
}
