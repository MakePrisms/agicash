import ky from 'ky';

const RESEND_API_BASE = 'https://api.resend.com';
const FROM_ADDRESS = 'Agicash <noreply@emails.agi.cash>';

const resendApiKey = process.env.RESEND_API_KEY ?? '';
if (!resendApiKey) {
  throw new Error('RESEND_API_KEY is not set');
}

const resendWelcomeTemplateId = process.env.RESEND_WELCOME_TEMPLATE_ID ?? '';
if (!resendWelcomeTemplateId) {
  throw new Error('RESEND_WELCOME_TEMPLATE_ID is not set');
}

const resendAudienceId = process.env.RESEND_AUDIENCE_ID ?? '';
if (!resendAudienceId) {
  throw new Error('RESEND_AUDIENCE_ID is not set');
}

const resend = ky.create({
  prefixUrl: RESEND_API_BASE,
  headers: {
    Authorization: `Bearer ${resendApiKey}`,
  },
});

type SignupMethod = 'email' | 'google' | 'guest';

type NewSignupParams = {
  email: string;
  firstName?: string;
  signupMethod: SignupMethod;
};

async function createContact(email: string, firstName?: string) {
  const body: Record<string, string> = { email };
  if (firstName) {
    body.first_name = firstName;
  }

  await resend.post(`audiences/${resendAudienceId}/contacts`, { json: body });
}

async function sendWelcomeEmail(email: string, firstName?: string) {
  await resend.post('emails', {
    json: {
      from: FROM_ADDRESS,
      to: [email],
      subject: 'Welcome to Agicash',
      template: {
        id: resendWelcomeTemplateId,
        variables: {
          firstName: firstName ?? 'there',
          email,
        },
      },
    },
  });
}

export async function handleNewSignup(params: NewSignupParams): Promise<void> {
  if (params.signupMethod === 'guest') {
    return;
  }

  try {
    await createContact(params.email, params.firstName);
  } catch (error) {
    console.error('Failed to create Resend contact', { cause: error });
  }

  try {
    await sendWelcomeEmail(params.email, params.firstName);
  } catch (error) {
    console.error('Failed to send welcome email', { cause: error });
  }
}
