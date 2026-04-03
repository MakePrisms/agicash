const RESEND_BASE_URL = "https://api.resend.com";
const FROM_ADDRESS = "Agicash <noreply@emails.agi.cash>";
const MAX_RETRIES = 2;

type WebhookPayload = {
  type: "INSERT";
  table: string;
  schema: string;
  record: {
    id: string;
    email: string | null;
    username?: string;
  };
};

type ManualPayload = {
  email: string;
  firstName?: string;
};

type Payload = WebhookPayload | ManualPayload;

function isWebhookPayload(payload: Payload): payload is WebhookPayload {
  return "type" in payload && "record" in payload;
}

function extractEmailAndName(payload: Payload): {
  email: string | null;
  firstName: string | undefined;
} {
  if (isWebhookPayload(payload)) {
    return {
      email: payload.record.email,
      firstName: payload.record.username,
    };
  }
  return {
    email: payload.email,
    firstName: payload.firstName,
  };
}

async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < MAX_RETRIES) {
        const delayMs = 1000 * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  console.error(
    `${label} failed after ${MAX_RETRIES + 1} attempts:`,
    lastError,
  );
  throw lastError;
}

async function createResendContact(
  apiKey: string,
  audienceId: string,
  email: string,
  firstName: string | undefined,
): Promise<void> {
  const response = await fetch(
    `${RESEND_BASE_URL}/audiences/${audienceId}/contacts`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        ...(firstName ? { first_name: firstName } : {}),
      }),
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Resend create contact failed (${response.status}): ${body}`,
    );
  }
}

async function sendWelcomeEmail(
  apiKey: string,
  templateId: string,
  email: string,
  firstName: string | undefined,
): Promise<void> {
  const displayName = firstName ?? "there";
  const unsubscribeUrl = `https://agi.cash/api/unsubscribe?email=${btoa(email)}`;

  const response = await fetch(`${RESEND_BASE_URL}/emails`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM_ADDRESS,
      to: [email],
      subject: "Welcome to Agicash",
      template: {
        id: templateId,
        variables: {
          firstName: displayName,
          email,
          unsubscribeUrl,
        },
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Resend send email failed (${response.status}): ${body}`,
    );
  }
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const payload: Payload = await req.json();
    const { email, firstName } = extractEmailAndName(payload);

    if (!email) {
      return new Response(
        JSON.stringify({ skipped: true, reason: "no email (guest user)" }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const apiKey = Deno.env.get("RESEND_API_KEY");
    const audienceId = Deno.env.get("RESEND_AUDIENCE_ID");
    const templateId = Deno.env.get("RESEND_WELCOME_TEMPLATE_ID");

    if (!apiKey || !audienceId || !templateId) {
      console.error("Missing required Resend env vars:", {
        hasApiKey: !!apiKey,
        hasAudienceId: !!audienceId,
        hasTemplateId: !!templateId,
      });
      return new Response(
        JSON.stringify({ error: "Missing Resend configuration" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Best-effort: contact creation failure should not block the welcome email
    try {
      await withRetry(
        () => createResendContact(apiKey, audienceId, email, firstName),
        "Create Resend contact",
      );
    } catch {
      // logged inside withRetry, continue to send email
    }

    await withRetry(
      () => sendWelcomeEmail(apiKey, templateId, email, firstName),
      "Send welcome email",
    );

    return new Response(
      JSON.stringify({ success: true, email }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    console.error("Welcome email function error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
