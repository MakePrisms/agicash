import { Suspense } from 'react';
import { redirect } from 'react-router';
import { Page } from '~/components/page';
import { AccountRepository } from '~/features/accounts/account-repository';
import { AccountService } from '~/features/accounts/account-service';
import { agicashDbClient } from '~/features/agicash-db/database.client';
import { LoadingScreen } from '~/features/loading/LoadingScreen';
import { ReceiveCashuToken } from '~/features/receive';
import { CashuReceiveQuoteRepository } from '~/features/receive/cashu-receive-quote-repository';
import { CashuReceiveQuoteService } from '~/features/receive/cashu-receive-quote-service';
import { CashuReceiveSwapRepository } from '~/features/receive/cashu-receive-swap-repository';
import { CashuReceiveSwapService } from '~/features/receive/cashu-receive-swap-service';
import { ClaimCashuTokenService } from '~/features/receive/claim-cashu-token-service';
import { InvalidCashuTokenPage } from '~/features/receive/invalid-cashu-token-page';
import { ReceiveCashuTokenQuoteService } from '~/features/receive/receive-cashu-token-quote-service';
import { ReceiveCashuTokenService } from '~/features/receive/receive-cashu-token-service';
import { SparkReceiveQuoteRepository } from '~/features/receive/spark-receive-quote-repository';
import { SparkReceiveQuoteService } from '~/features/receive/spark-receive-quote-service';
import {
  decodeCashuToken,
  getCashuCryptography,
  seedQueryOptions,
} from '~/features/shared/cashu';
import {
  encryptionPrivateKeyQueryOptions,
  encryptionPublicKeyQueryOptions,
  getEncryption,
} from '~/features/shared/encryption';
import { getQueryClient } from '~/features/shared/query-client';
import { sparkMnemonicQueryOptions } from '~/features/shared/spark';
import { getUserFromCacheOrThrow } from '~/features/user/user-hooks';
import { WriteUserRepository } from '~/features/user/user-repository';
import { UserService } from '~/features/user/user-service';
import { toast } from '~/hooks/use-toast';
import { isSupportedCashuUnit, sumProofs } from '~/lib/cashu';
import { CASHU_PROTOCOL_UNITS } from '~/lib/cashu/types';
import type { Route } from './+types/_protected.receive.cashu_.token';
import { ReceiveCashuTokenSkeleton } from './receive-cashu-token-skeleton';

const getClaimCashuTokenService = async () => {
  const queryClient = getQueryClient();
  const [encryptionPrivateKey, encryptionPublicKey] = await Promise.all([
    queryClient.ensureQueryData(encryptionPrivateKeyQueryOptions()),
    queryClient.ensureQueryData(encryptionPublicKeyQueryOptions()),
  ]);
  const getCashuWalletSeed = () => queryClient.fetchQuery(seedQueryOptions());
  const getSparkWalletMnemonic = () =>
    queryClient.fetchQuery(sparkMnemonicQueryOptions());
  const encryption = getEncryption(encryptionPrivateKey, encryptionPublicKey);
  const accountRepository = new AccountRepository(
    agicashDbClient,
    encryption,
    queryClient,
    getCashuWalletSeed,
    getSparkWalletMnemonic,
    './.spark-data',
  );
  const accountService = new AccountService(accountRepository, queryClient);
  const receiveSwapRepository = new CashuReceiveSwapRepository(
    agicashDbClient,
    encryption,
    accountRepository,
  );
  const receiveSwapService = new CashuReceiveSwapService(receiveSwapRepository);
  const cashuReceiveQuoteRepository = new CashuReceiveQuoteRepository(
    agicashDbClient,
    encryption,
    accountRepository,
  );
  const cashuCryptography = getCashuCryptography(queryClient);
  const cashuReceiveQuoteService = new CashuReceiveQuoteService(
    cashuCryptography,
    cashuReceiveQuoteRepository,
  );
  const sparkReceiveQuoteService = new SparkReceiveQuoteService(
    new SparkReceiveQuoteRepository(agicashDbClient, encryption),
  );
  const receiveCashuTokenService = new ReceiveCashuTokenService(queryClient);
  const receiveCashuTokenQuoteService = new ReceiveCashuTokenQuoteService(
    cashuReceiveQuoteService,
    sparkReceiveQuoteService,
  );
  const userRepository = new WriteUserRepository(
    agicashDbClient,
    accountRepository,
  );
  const userService = new UserService(userRepository);

  return new ClaimCashuTokenService(
    queryClient,
    accountRepository,
    accountService,
    receiveSwapService,
    cashuReceiveQuoteService,
    sparkReceiveQuoteService,
    receiveCashuTokenService,
    receiveCashuTokenQuoteService,
    userService,
  );
};

const getClaimTo = (
  searchParams: URLSearchParams,
): 'cashu' | 'spark' | null => {
  const claimTo = searchParams.get('claimTo');
  if (claimTo === 'cashu' || claimTo === 'spark') {
    return claimTo;
  }
  return null;
};

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  // Request url doesn't include hash so we need to read it from the window location instead
  const token = await decodeCashuToken(window.location.hash);

  if (!token) {
    throw redirect('/receive');
  }

  if (!isSupportedCashuUnit(token.unit)) {
    return {
      token,
      isSupported: false as const,
      selectedAccountId: undefined,
    };
  }

  const location = new URL(request.url);
  const selectedAccountId =
    location.searchParams.get('selectedAccountId') ?? undefined;
  const claimTo = getClaimTo(location.searchParams);

  if (claimTo) {
    const user = getUserFromCacheOrThrow();
    const claimCashuTokenService = await getClaimCashuTokenService();

    const result = await claimCashuTokenService.claimToken(
      user,
      token,
      claimTo,
    );
    if (!result.success) {
      toast({
        title: 'Failed to claim the token',
        description: result.message,
        variant: 'destructive',
        duration: 8000,
      });
    }

    const explicitRedirectTo = location.searchParams.get('redirectTo');
    let redirectTo = explicitRedirectTo ?? '/';

    if (
      !explicitRedirectTo &&
      result.success &&
      result.destinationAccount.purpose === 'gift-card'
    ) {
      redirectTo = `/gift-cards/${result.destinationAccount.id}`;
    }

    throw redirect(redirectTo);
  }

  return { token, isSupported: true as const, selectedAccountId };
}

clientLoader.hydrate = true as const;

export function HydrateFallback() {
  return <LoadingScreen />;
}

export default function ProtectedReceiveCashuToken({
  loaderData,
}: Route.ComponentProps) {
  const { token, isSupported, selectedAccountId } = loaderData;

  if (!isSupported) {
    const unit = token.unit ?? 'unknown';
    return (
      <InvalidCashuTokenPage
        message={`This token's unit isn't supported. Supported units: ${CASHU_PROTOCOL_UNITS.join(', ')}.`}
        display={{ amount: sumProofs(token.proofs), unit }}
      />
    );
  }

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
