import * as Sentry from "https://deno.land/x/sentry@9.6.0/index.mjs";
import ky from "npm:ky@1.7.5";
import { z } from "npm:zod@3.24.3";

Sentry.init({
  dsn: Deno.env.get("SENTRY_DSN") ?? "",
  defaultIntegrations: false,
  tracesSampleRate: 1.0,
  environment: Deno.env.get("SENTRY_ENVIRONMENT") ?? "production",
});

Sentry.setTag("region", Deno.env.get("SB_REGION") ?? "unknown");
Sentry.setTag("execution_id", Deno.env.get("SB_EXECUTION_ID") ?? "unknown");

const RESEND_BASE_URL = "https://api.resend.com";
const FROM_ADDRESS = "Agicash <noreply@emails.agi.cash>";

const payloadSchema = z.object({
  id: z.string().optional(),
  email: z.string().email(),
  firstName: z.string().optional(),
});

function getRequiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function getResendClient(apiKey: string) {
  return ky.create({
    prefixUrl: RESEND_BASE_URL,
    timeout: 10_000,
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    retry: {
      // 2 retries after initial attempt = 3 total attempts
      limit: 2,
      methods: ["post"],
      statusCodes: [408, 429, 500, 502, 503, 504],
      backoffLimit: 3000,
    },
  });
}

async function sendWelcomeEmail(
  resend: typeof ky,
  templateId: string,
  email: string,
  firstName: string | undefined,
): Promise<void> {
  await resend.post("emails", {
    json: {
      from: FROM_ADDRESS,
      to: [email],
      subject: "Welcome to Agicash",
      template: {
        id: templateId,
        variables: {
          firstName: firstName ?? "there",
          email,
        },
      },
    },
  });
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
    const body = await req.json();
    const result = payloadSchema.safeParse(body);

    if (!result.success) {
      return new Response(
        JSON.stringify({ error: "Invalid payload", details: result.error.flatten() }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const { id, email, firstName } = result.data;

    const apiKey = getRequiredEnv("RESEND_API_KEY");
    const templateId = getRequiredEnv("RESEND_WELCOME_TEMPLATE_ID");
    const resend = getResendClient(apiKey);

    await sendWelcomeEmail(resend, templateId, email, firstName);

    console.log("Welcome email sent", { id, email });

    return new Response(
      JSON.stringify({ success: true, id, email }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    Sentry.captureException(error);
    await Sentry.flush(2000);
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
