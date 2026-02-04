import type { QueryClient } from '@tanstack/react-query';
import { Outlet, redirect } from 'react-router';
import { AccountsCache } from '~/features/accounts/account-hooks';
import { AccountRepository } from '~/features/accounts/account-repository';
import { agicashDbClient } from '~/features/agicash-db/database.client';
import { supabaseSessionTokenQuery } from '~/features/agicash-db/supabase-session';
import { LoadingScreen } from '~/features/loading/LoadingScreen';
import {
  BASE_CASHU_LOCKING_DERIVATION_PATH,
  seedQueryOptions as cashuSeedQueryOptions,
  xpubQueryOptions,
} from '~/features/shared/cashu';
import {
  encryptionPrivateKeyQueryOptions,
  encryptionPublicKeyQueryOptions,
  getEncryption,
} from '~/features/shared/encryption';
import {
  sparkIdentityPublicKeyQueryOptions,
  sparkMnemonicQueryOptions,
} from '~/features/shared/spark';
import {
  type AuthUser,
  authQueryOptions,
  useAuthState,
} from '~/features/user/auth';
import { pendingTermsStorage } from '~/features/user/pending-terms-storage';
import { type User, shouldAcceptTerms } from '~/features/user/user';
import {
  defaultAccounts,
  getUserFromCache,
  userQueryOptions,
} from '~/features/user/user-hooks';
import {
  ReadUserRepository,
  WriteUserRepository,
} from '~/features/user/user-repository';
import { Wallet } from '~/features/wallet/wallet';
import { getQueryClient } from '~/query-client';
import type { Route } from './+types/_protected';

const shouldUserVerifyEmail = (user: AuthUser) => {
  const isGuest = !user.email;
  return !isGuest && !user.email_verified;
};

const buildRedirectWithReturnUrl = (
  destinationRoute: string,
  location: URL,
  hash: string,
) => {
  const searchParams = new URLSearchParams(location.search);
  if (location.pathname !== '/') {
    searchParams.set('redirectTo', location.pathname);
  }
  const search = `?${searchParams.toString()}`;
  return redirect(`${destinationRoute}${search}${hash}`);
};

const hasUserChanged = (user: User, authUser: AuthUser) => {
  const currentAuthUserEmail = authUser.email ?? null;
  const currentUserEmail = user.isGuest ? null : user.email;

  return (
    currentUserEmail !== currentAuthUserEmail ||
    user.emailVerified !== authUser.email_verified
  );
};

const ensureUserData = async (
  queryClient: QueryClient,
  authUser: AuthUser,
  termsAcceptedAt?: string,
): Promise<User> => {
  let user = getUserFromCache(queryClient);

  if (!user) {
    queryClient.prefetchQuery(supabaseSessionTokenQuery());
  }

  if (!user || hasUserChanged(user, authUser)) {
    const [
      encryptionPrivateKey,
      encryptionPublicKey,
      cashuLockingXpub,
      sparkIdentityPublicKey,
    ] = await Promise.all([
      queryClient.ensureQueryData(encryptionPrivateKeyQueryOptions()),
      queryClient.ensureQueryData(encryptionPublicKeyQueryOptions()),
      queryClient.ensureQueryData(
        xpubQueryOptions({
          queryClient,
          derivationPath: BASE_CASHU_LOCKING_DERIVATION_PATH,
        }),
      ),
      // TODO: how to handle this network? We specify the network on the account creation.
      queryClient.ensureQueryData(
        sparkIdentityPublicKeyQueryOptions({ queryClient, network: 'MAINNET' }),
      ),
      queryClient.ensureQueryData(sparkMnemonicQueryOptions()),
      queryClient.ensureQueryData(cashuSeedQueryOptions()),
    ]);
    const encryption = getEncryption(encryptionPrivateKey, encryptionPublicKey);
    const getCashuWalletSeed = () =>
      queryClient.fetchQuery(cashuSeedQueryOptions());
    const getSparkWalletMnemonic = () =>
      queryClient.fetchQuery(sparkMnemonicQueryOptions());
    const accountRepository = new AccountRepository(
      agicashDbClient,
      encryption,
      queryClient,
      getCashuWalletSeed,
      getSparkWalletMnemonic,
    );
    const writeUserRepository = new WriteUserRepository(
      agicashDbClient,
      accountRepository,
    );

    const { user: upsertedUser, accounts } = await writeUserRepository.upsert({
      id: authUser.id,
      email: authUser.email,
      emailVerified: authUser.email_verified,
      accounts: [...defaultAccounts],
      cashuLockingXpub,
      encryptionPublicKey,
      sparkIdentityPublicKey,
      termsAcceptedAt,
    });
    user = upsertedUser;
    const readUserRepository = new ReadUserRepository(agicashDbClient);
    const { queryKey: userQueryKey } = userQueryOptions({
      userId: authUser.id,
      userRepository: readUserRepository,
    });
    queryClient.setQueryData(userQueryKey, user);
    queryClient.setQueryData([AccountsCache.Key], accounts);
  }

  return user;
};

const routeGuardMiddleware: Route.ClientMiddlewareFunction = async (
  { request },
  next,
) => {
  const location = new URL(request.url);
  // We have to use window.location.hash because location that comes from the request does not have the hash
  const hash = window.location.hash;
  const queryClient = getQueryClient();
  const { isLoggedIn, user: authUser } = await queryClient.ensureQueryData(
    authQueryOptions(),
  );
  const shouldRedirectToSignup = !isLoggedIn;
  const shouldVerifyEmail = authUser ? shouldUserVerifyEmail(authUser) : false;
  const isVerifyEmailRoute = location.pathname.startsWith('/verify-email');
  const shouldRedirectToVerifyEmail = shouldVerifyEmail && !isVerifyEmailRoute;

  console.debug('Rendering protected layout', {
    time: new Date().toISOString(),
    location: location.pathname,
    isLoggedIn,
    shouldRedirectToSignup,
    userId: authUser?.id,
    shouldVerifyEmail,
    isVerifyEmailRoute,
    shouldRedirectToVerifyEmail,
  });

  if (shouldRedirectToSignup) {
    let search = location.search;
    if (location.pathname !== '/') {
      const searchParams = new URLSearchParams(location.search);
      searchParams.set('redirectTo', location.pathname);
      search = `?${searchParams.toString()}`;
    }

    throw redirect(`/home${search}${hash}`);
  }

  const pendingTermsAcceptedAt = pendingTermsStorage.get();
  if (pendingTermsAcceptedAt) {
    pendingTermsStorage.remove();
  }

  const user = await ensureUserData(
    queryClient,
    authUser,
    pendingTermsAcceptedAt,
  );

  if (shouldRedirectToVerifyEmail) {
    throw buildRedirectWithReturnUrl('/verify-email', location, hash);
  }

  const isAcceptTermsRoute = location.pathname.startsWith('/accept-terms');
  const shouldRedirectToAcceptTerms =
    shouldAcceptTerms(user) && !isAcceptTermsRoute;

  if (shouldRedirectToAcceptTerms) {
    throw buildRedirectWithReturnUrl('/accept-terms', location, hash);
  }

  await next();
};

export const clientMiddleware: Route.ClientMiddlewareFunction[] = [
  routeGuardMiddleware,
];

export async function clientLoader() {
  // We are keeping this clientLoader to force client rendering for all protected routes.
}

clientLoader.hydrate = true as const;

export function HydrateFallback() {
  return <LoadingScreen />;
}

export default function ProtectedRoute() {
  const { user } = useAuthState();

  if (!user) {
    console.debug('Logging out...');
    return null;
  }

  return (
    <Wallet>
      <Outlet />
    </Wallet>
  );
}
