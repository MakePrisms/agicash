import { Page, PageContent } from '~/components/page';
import { LoadingScreen } from '~/features/loading/LoadingScreen';
import {
  getRedirectAwayFromVerifyEmail,
  verifyEmail,
  verifyEmailContext,
  verifyEmailRouteGuard,
} from '~/features/signup/verify-email';
import { VerifyEmailForm } from '~/features/signup/verify-email-form';
import { toast } from '~/hooks/use-toast';
import type { Route } from './+types/_protected.verify-email.($code)';

export const unstable_clientMiddleware: Route.unstable_ClientMiddlewareFunction[] =
  [verifyEmailRouteGuard];

export async function clientLoader({
  request,
  context,
  params: { code },
}: Route.ClientLoaderArgs) {
  const user = context.get(verifyEmailContext);

  if (!code) {
    return { user };
  }

  const result = await verifyEmail(code);

  if (result.verified) {
    throw getRedirectAwayFromVerifyEmail(request);
  }

  toast({
    variant: 'destructive',
    title: 'Failed to verify',
    description:
      'Please try entering the code manually or request another verification email',
    duration: 8000,
  });

  return { user };
}

clientLoader.hydrate = true as const;

export function HydrateFallback() {
  return <LoadingScreen />;
}

export default function VerifyEmail({ loaderData }: Route.ComponentProps) {
  const { user } = loaderData;

  return (
    <Page>
      <PageContent className="justify-center">
        <VerifyEmailForm user={user} />
      </PageContent>
    </Page>
  );
}
