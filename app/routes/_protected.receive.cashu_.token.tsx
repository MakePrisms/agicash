import type { Token } from '@cashu/cashu-ts';
import { Suspense } from 'react';
import { redirect } from 'react-router';
import { Page } from '~/components/page';
import {
  AccountsCache,
  accountsQueryKey,
  accountsQueryOptions,
} from '~/features/accounts/account-hooks';
import { AccountRepository } from '~/features/accounts/account-repository';
import { AccountService } from '~/features/accounts/account-service';
import { CashuAccountService } from '~/features/accounts/cashu-account-service';
import { agicashDb } from '~/features/agicash-db/database';
import { LoadingScreen } from '~/features/loading/LoadingScreen';
import { ReceiveCashuToken } from '~/features/receive';
import { CashuReceiveQuoteRepository } from '~/features/receive/cashu-receive-quote-repository';
import { CashuReceiveQuoteService } from '~/features/receive/cashu-receive-quote-service';
import { CashuTokenSwapRepository } from '~/features/receive/cashu-token-swap-repository';
import { CashuTokenSwapService } from '~/features/receive/cashu-token-swap-service';
import {
  type CashuAccountWithFlags,
  getDefaultReceiveAccount,
  getPossibleDestinationAccounts,
} from '~/features/receive/receive-cashu-token-hooks';
import { ReceiveCashuTokenService } from '~/features/receive/receive-cashu-token-service';
import { getCashuCryptography, seedQuery } from '~/features/shared/cashu';
import {
  encryptionPrivateKeyQuery,
  encryptionPublicKeyQuery,
  getEncryption,
} from '~/features/shared/encryption';
import type { User } from '~/features/user/user';
import {
  getUserFromCacheOrThrow,
  userQueryKey,
} from '~/features/user/user-hooks';
import { UserRepository } from '~/features/user/user-repository';
import { areMintUrlsEqual, extractCashuToken } from '~/lib/cashu';
import { getQueryClient } from '~/query-client';
import type { Route } from './+types/_protected.receive.cashu_.token';
import { ReceiveCashuTokenSkeleton } from './receive-cashu-token-skeleton';

const claimToken = async (
  user: User,
  token: Token,
  preferredReceiveAccountId?: string,
) => {
  const queryClient = getQueryClient();
  const [encryptionPrivateKey, encryptionPublicKey] = await Promise.all([
    queryClient.ensureQueryData(encryptionPrivateKeyQuery()),
    queryClient.ensureQueryData(encryptionPublicKeyQuery()),
  ]);
  const getCashuWalletSeed = () => queryClient.fetchQuery(seedQuery());
  const encryption = getEncryption(encryptionPrivateKey, encryptionPublicKey);
  const accountRepository = new AccountRepository(
    agicashDb,
    encryption,
    queryClient,
    getCashuWalletSeed,
  );
  const accountService = new AccountService(accountRepository);
  const cashuAccountService = new CashuAccountService(queryClient);
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
  const receiveCashuTokenService = new ReceiveCashuTokenService(
    cashuReceiveQuoteService,
  );
  const userRepository = new UserRepository(
    agicashDb,
    encryption,
    accountRepository,
  );
  const accountsCache = new AccountsCache(queryClient);

  const accounts = await queryClient.fetchQuery(
    accountsQueryOptions({ user, accountService }),
  );
  const cashuAccounts = accounts.filter((account) => account.type === 'cashu');

  let {
    isNew,
    data: sourceAccount,
    isValid,
  } = await cashuAccountService.getSourceAccount(token, cashuAccounts);

  if (!isValid) {
    // TODO: see what to do here. Probably receive to default account
    throw new Error('Invalid token');
  }

  if (isNew) {
    const addedAccount = await accountService.addAccount({
      ...sourceAccount,
      userId: user.id,
    });
    accountsCache.upsert(addedAccount);

    const updates =
      addedAccount.currency === 'BTC'
        ? {
            defaultCurrency: addedAccount.currency,
            defaultBtcAccountId: addedAccount.id,
          }
        : {
            defaultCurrency: addedAccount.currency,
            defaultUsdAccountId: addedAccount.id,
          };

    const updatedUser = await userRepository.update(user.id, updates);
    queryClient.setQueryData([userQueryKey], updatedUser);
    sourceAccount = { ...addedAccount, isDefault: true };
  }

  const sourceAccountWithFlags: CashuAccountWithFlags = {
    ...sourceAccount,
    isSource: true,
    isUnknown: false,
    isSelectable: true,
  };
  const otherAccounts = cashuAccounts
    .filter((account) => account.id !== sourceAccount.id)
    .map((account) => ({
      ...account,
      isSource: false,
      isUnknown: false,
      isSelectable: true,
    }));

  const possibleDestinationAccounts = getPossibleDestinationAccounts(
    sourceAccountWithFlags,
    otherAccounts,
  );
  const receiveAccount = getDefaultReceiveAccount(
    sourceAccountWithFlags,
    possibleDestinationAccounts,
    preferredReceiveAccountId,
  );

  const isSameAccountClaim =
    receiveAccount.currency === sourceAccount.currency &&
    areMintUrlsEqual(receiveAccount.mintUrl, sourceAccount.mintUrl);

  let transactionId = '';

  if (isSameAccountClaim) {
    // create a cashu token swap
    const { tokenSwap, account } = await tokenSwapService.create({
      userId: user.id,
      token,
      account: receiveAccount,
    });
    accountsCache.upsert(account);
    transactionId = tokenSwap.transactionId;

    await tokenSwapService.completeSwap(account, tokenSwap);
    await queryClient.invalidateQueries({
      queryKey: [accountsQueryKey],
      refetchType: 'all',
    });
  } else {
    // create a cross account receive quote and melt the proofs
    const { cashuMeltQuote, cashuReceiveQuote } =
      await receiveCashuTokenService.createCrossAccountReceiveQuotes({
        userId: user.id,
        token,
        sourceAccount,
        destinationAccount: receiveAccount,
        exchangeRate: '1',
      });
    transactionId = cashuReceiveQuote.transactionId;

    await sourceAccount.wallet.meltProofs(cashuMeltQuote, token.proofs);
  }

  console.log('transactionId', transactionId);

  // await new Promise<void>((resolve) => {
  //   const channel = agicashDb.channel('transactions').on(
  //     'postgres_changes',
  //     {
  //       event: '*',
  //       schema: 'wallet',
  //       table: 'transactions',
  //       filter: `id=eq.${transactionId}`,
  //     },
  //     (payload: RealtimePostgresChangesPayload<AgicashDbTransaction>) => {
  //       if (
  //         payload.eventType !== 'DELETE' &&
  //         payload.new.state === 'COMPLETED'
  //       ) {
  //         channel.unsubscribe();
  //         resolve();
  //       }
  //     },
  //   );

  //   setTimeout(() => {
  //     channel.unsubscribe();
  //     resolve();
  //   }, 5000);
  // });
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
    await claimToken(user, token);
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
