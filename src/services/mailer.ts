import { Resend } from "resend";

function getResendClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return null;
  }
  return new Resend(apiKey);
}

export async function sendSignupEmail(
  email: string,
  links: {
    confirmationLink: string;
    redirectLink: string;
  },
): Promise<void> {
  const resend = getResendClient();
  if (!resend) {
    console.warn(
      "[Mail] RESEND_API_KEY is not configured. Skipping signup email.",
    );
    return;
  }

  const defaultFrom = "onboarding@resend.dev";
  const from = process.env.RESEND_FROM_EMAIL || defaultFrom;
  const appName = process.env.APP_NAME || "GitHistory_Teller";

  const mailPayload = {
    to: email,
    subject: `Confirm your email for ${appName}`,
    html:
      `<p>Hi,</p>` +
      `<p>Please confirm your email by opening this link:</p>` +
      `<p><a href="${links.confirmationLink}">${links.confirmationLink}</a></p>` +
      `<p>After verification, you'll be redirected using:</p>` +
      `<p>${links.redirectLink}</p>` +
      `<p>Thanks,<br/>${appName}</p>`,
    text:
      `Hi,\n\nPlease confirm your email by opening this link:\n${links.confirmationLink}` +
      `\n\nAfter verification, you will be redirected with an access token using this URL:\n${links.redirectLink}` +
      `\n\nThanks,\n${appName}`,
  };

  let { error } = await resend.emails.send({
    from,
    ...mailPayload,
  });

  const domainNotVerified =
    !!error &&
    typeof error === "object" &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string" &&
    (error as { message: string }).message
      .toLowerCase()
      .includes("domain is not verified");

  if (domainNotVerified && from.toLowerCase() !== defaultFrom) {
    console.warn(
      `[Mail] Sender domain is not verified for ${from}. Retrying with ${defaultFrom}.`,
    );
    ({ error } = await resend.emails.send({
      from: defaultFrom,
      ...mailPayload,
    }));
  }

  if (error) {
    console.error("[Mail] Failed to send signup email via Resend.", error);
    throw new Error("AUTH_EMAIL_SEND_FAILED");
  }
}
