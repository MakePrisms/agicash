import { z } from 'zod';
import { agicashDbServer } from '~/features/agicash-db/database.server';
import { PENDING_CASHAPP_BUY_COOKIE_NAME } from '~/features/buy/pending-cashapp-buy';
import { getLightningQuote } from '~/features/receive/cashu-receive-quote-core';
import { CashuReceiveQuoteRepositoryServer } from '~/features/receive/cashu-receive-quote-repository.server';
import { CashuReceiveQuoteServiceServer } from '~/features/receive/cashu-receive-quote-service.server';
import { SparkReceiveQuoteRepositoryServer } from '~/features/receive/spark-receive-quote-repository.server';
import { SparkReceiveQuoteServiceServer } from '~/features/receive/spark-receive-quote-service.server';
import { getQueryClient } from '~/features/shared/query-client';
import {
  ReadUserDefaultAccountRepository,
  ReadUserRepository,
} from '~/features/user/user-repository';
import { Money } from '~/lib/money';
import type { Route } from './+types/api.buy.cashapp-redirect.$userId';

const sparkMnemonic = process.env.LNURL_SERVER_SPARK_MNEMONIC || '';
const getSparkWalletMnemonic = (): Promise<string> =>
  Promise.resolve(sparkMnemonic);

const QueryParamsSchema = z.object({
  accountId: z.string().min(1),
  amount: z.string().regex(/^\d+$/),
  currency: z.enum(['BTC', 'USD']),
  unit: z.enum(['sat', 'msat', 'btc', 'cent', 'usd']),
});

function serializeMoney(money: Money) {
  const unit = money.getBaseUnit();
  return {
    amount: money.toString(unit),
    currency: money.currency,
    unit,
  };
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const userId = params.userId;
  const url = new URL(request.url);

  const queryParams = QueryParamsSchema.safeParse({
    accountId: url.searchParams.get('accountId'),
    amount: url.searchParams.get('amount'),
    currency: url.searchParams.get('currency'),
    unit: url.searchParams.get('unit'),
  });

  if (!queryParams.success) {
    return redirectToError(url);
  }

  const { accountId, amount: amountStr, currency, unit } = queryParams.data;

  try {
    const amount = new Money({ amount: amountStr, currency, unit });

    const userRepository = new ReadUserRepository(agicashDbServer);
    const user = await userRepository.get(userId);

    const queryClient = getQueryClient();
    const accountRepository = new ReadUserDefaultAccountRepository(
      agicashDbServer,
      queryClient,
      getSparkWalletMnemonic,
    );
    const account = await accountRepository.getAccountByIdWithWallet(
      userId,
      accountId,
    );

    let paymentRequest: string;
    let quoteId: string;
    let transactionId: string;
    let mintingFee: Money | undefined;

    if (account.type === 'cashu') {
      const lightningQuote = await getLightningQuote({
        wallet: account.wallet,
        amount,
        xPub: user.cashuLockingXpub,
      });

      const cashuService = new CashuReceiveQuoteServiceServer(
        new CashuReceiveQuoteRepositoryServer(agicashDbServer),
      );

      const created = await cashuService.createReceiveQuote({
        userId,
        userEncryptionPublicKey: user.encryptionPublicKey,
        account,
        receiveType: 'LIGHTNING',
        lightningQuote,
      });

      paymentRequest = created.paymentRequest;
      quoteId = created.id;
      transactionId = created.transactionId;
      mintingFee = created.mintingFee;
    } else {
      const sparkService = new SparkReceiveQuoteServiceServer(
        new SparkReceiveQuoteRepositoryServer(agicashDbServer),
      );

      const lightningQuote = await sparkService.getLightningQuote({
        wallet: account.wallet,
        amount,
        receiverIdentityPubkey: user.sparkIdentityPublicKey,
      });

      const created = await sparkService.createReceiveQuote({
        userId,
        userEncryptionPublicKey: user.encryptionPublicKey,
        account,
        lightningQuote,
        receiveType: 'LIGHTNING',
      });

      paymentRequest = created.paymentRequest;
      quoteId = created.id;
      transactionId = created.transactionId;
    }

    const cookieData = JSON.stringify({
      quoteId,
      transactionId,
      accountId,
      accountType: account.type,
      paymentRequest,
      amount: serializeMoney(amount),
      ...(mintingFee ? { mintingFee: serializeMoney(mintingFee) } : {}),
    });

    const cookieValue = encodeURIComponent(cookieData);
    const deepLink = `https://cash.app/launch/lightning/${paymentRequest}`;

    return new Response(null, {
      status: 302,
      headers: {
        Location: deepLink,
        'Set-Cookie': `${PENDING_CASHAPP_BUY_COOKIE_NAME}=${cookieValue}; Path=/; Max-Age=600; SameSite=Lax`,
      },
    });
  } catch (error) {
    console.error('Failed to create buy quote for Cash App redirect', {
      cause: error,
    });
    return redirectToError(url);
  }
}

function redirectToError(url: URL) {
  const origin = url.origin;
  return new Response(null, {
    status: 302,
    headers: {
      Location: `${origin}/buy?error=quote_failed`,
    },
  });
}
