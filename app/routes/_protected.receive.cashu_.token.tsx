import { Suspense } from 'react';
import { redirect } from 'react-router';
import { Page } from '~/components/page';
import { AccountRepository } from '~/features/accounts/account-repository';
import { AccountService } from '~/features/accounts/account-service';
import { agicashDb } from '~/features/agicash-db/database';
import { LoadingScreen } from '~/features/loading/LoadingScreen';
import { ReceiveCashuToken } from '~/features/receive';
import { CashuReceiveQuoteRepository } from '~/features/receive/cashu-receive-quote-repository';
import { CashuReceiveQuoteService } from '~/features/receive/cashu-receive-quote-service';
import { CashuTokenSwapRepository } from '~/features/receive/cashu-token-swap-repository';
import { CashuTokenSwapService } from '~/features/receive/cashu-token-swap-service';
import { ClaimCashuTokenService } from '~/features/receive/claim-cashu-token-service';
import { ReceiveCashuTokenQuoteService } from '~/features/receive/receive-cashu-token-quote-service';
import { ReceiveCashuTokenService } from '~/features/receive/receive-cashu-token-service';
import {
  getCashuCryptography,
  seedQueryOptions,
} from '~/features/shared/cashu';
import {
  encryptionPrivateKeyQueryOptions,
  encryptionPublicKeyQueryOptions,
  getEncryption,
} from '~/features/shared/encryption';
import { getUserFromCacheOrThrow } from '~/features/user/user-hooks';
import { UserRepository } from '~/features/user/user-repository';
import { UserService } from '~/features/user/user-service';
import { toast } from '~/hooks/use-toast';
import { extractCashuToken } from '~/lib/cashu';
import { getQueryClient } from '~/query-client';
import type { Route } from './+types/_protected.receive.cashu_.token';
import { ReceiveCashuTokenSkeleton } from './receive-cashu-token-skeleton';

const getClaimCashuTokenService = async () => {
  const queryClient = getQueryClient();
  const [encryptionPrivateKey, encryptionPublicKey] = await Promise.all([
    queryClient.ensureQueryData(encryptionPrivateKeyQueryOptions()),
    queryClient.ensureQueryData(encryptionPublicKeyQueryOptions()),
  ]);
  const getCashuWalletSeed = () => queryClient.fetchQuery(seedQueryOptions());
  const encryption = getEncryption(encryptionPrivateKey, encryptionPublicKey);
  const accountRepository = new AccountRepository(
    agicashDb,
    encryption,
    queryClient,
    getCashuWalletSeed,
  );
  const accountService = new AccountService(accountRepository);
  const tokenSwapRepository = new CashuTokenSwapRepository(
    agicashDb,
    encryption,
    accountRepository,
  );
  const tokenSwapService = new CashuTokenSwapService(tokenSwapRepository);
  const cashuReceiveQuoteRepository = new CashuReceiveQuoteRepository(
    agicashDb,
    encryption,
    accountRepository,
  );
  const cashuCryptography = getCashuCryptography(queryClient);
  const cashuReceiveQuoteService = new CashuReceiveQuoteService(
    cashuCryptography,
    cashuReceiveQuoteRepository,
  );
  const receiveCashuTokenService = new ReceiveCashuTokenService(queryClient);
  const receiveCashuTokenQuoteService = new ReceiveCashuTokenQuoteService(
    cashuReceiveQuoteService,
  );
  const userRepository = new UserRepository(
    agicashDb,
    encryption,
    accountRepository,
  );
  const userService = new UserService(userRepository);

  return new ClaimCashuTokenService(
    queryClient,
    accountRepository,
    accountService,
    tokenSwapService,
    cashuReceiveQuoteService,
    receiveCashuTokenService,
    receiveCashuTokenQuoteService,
    userService,
  );
};

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  // Request url doesn't include hash so we need to read it from the window location instead
  const token = extractCashuToken(window.location.hash);

  if (!token) {
    throw redirect('/receive');
  }

  const location = new URL(request.url);
  const selectedAccountId =
    location.searchParams.get('selectedAccountId') ?? undefined;
  const autoClaim = location.searchParams.get('autoClaim') === 'true';

  if (autoClaim) {
    const user = getUserFromCacheOrThrow();
    const claimCashuTokenService = await getClaimCashuTokenService();
    const result = await claimCashuTokenService.claimToken(user, token);
    if (!result.success) {
      toast({
        title: 'Failed to claim the token',
        description: result.message,
        variant: 'destructive',
      });
    }
    throw redirect('/');
  }

  return { token, selectedAccountId };
}

clientLoader.hydrate = true as const;

export function HydrateFallback() {
  return <LoadingScreen />;
}

export default function ProtectedReceiveCashuToken({
  loaderData,
}: Route.ComponentProps) {
  const { token, selectedAccountId } = loaderData;

  return (
    <Page>
      <Suspense fallback={<ReceiveCashuTokenSkeleton />}>
        <ReceiveCashuToken
          token={token}
          preferredReceiveAccountId={selectedAccountId}
        />
      </Suspense>
    </Page>
  );
}
