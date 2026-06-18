import type { BreezSdk } from '@agicash/breez-sdk-spark';
import { Money } from '@agicash/money';
import type { SdkConfig } from './config';
import type { ExchangeRateDomain } from './domains';
import { getLightningQuote as getCashuLightningQuote } from './domains/cashu/cashu-receive-quote-core';
import { CashuReceiveQuoteServiceServer } from './domains/cashu/cashu-receive-quote-service.server';
import { createExchangeRateDomain } from './domains/exchange-rate/exchange-rate-domain';
import { SparkReceiveQuoteServiceServer } from './domains/spark/spark-receive-quote-service.server';
import { DomainError, NotFoundError } from './errors';
import { buildServerConnections } from './internal/connections/server-connections';
import { sha256Hex } from './internal/crypto/sha256';
import { type ExtendedCashuWallet, getCashuWallet } from './internal/lib/cashu';
import { CashuReceiveQuoteRepositoryServer } from './internal/repositories/cashu-receive-quote-repository.server';
import { ServerAccountRepository } from './internal/repositories/server-account-repository';
import { SparkReceiveQuoteRepositoryServer } from './internal/repositories/spark-receive-quote-repository.server';
import { UserRepository } from './internal/repositories/user-repository';
import type { RedactedCashuAccount, SparkAccount } from './types/account';

/** An opaque-to-the-LNURL-client reference to a created receive quote (the route encrypts it into the verify URL). */
export type LnurlVerifyRef =
  | { type: 'cashu'; quoteId: string; mintUrl: string }
  | { type: 'spark'; quoteId: string };

export type LightningAddressReceiveInfo = {
  userId: string;
  username: string;
  minSendable: Money<'BTC'>;
  maxSendable: Money<'BTC'>;
  /** LUD-06 metadata JSON string. The route returns it verbatim; the spark descriptionHash commits to it. */
  metadata: string;
};

export type LightningReceiveQuoteResult = {
  paymentRequest: string;
  verify: LnurlVerifyRef;
};

export type LightningReceiveStatusResult = {
  settled: boolean;
  preimage: string | null;
  paymentRequest: string;
};

/** The narrow server-mode surface (LNURL / lightning-address). */
export interface ServerSdkApi {
  resolveLightningAddress(
    username: string,
  ): Promise<LightningAddressReceiveInfo | null>;
  createLightningReceiveQuote(params: {
    userId: string;
    amount: Money<'BTC'>;
    bypassAmountValidation?: boolean;
  }): Promise<LightningReceiveQuoteResult>;
  getLightningReceiveStatus(
    ref: LnurlVerifyRef,
  ): Promise<LightningReceiveStatusResult>;
}

export type ServerSdkDeps = {
  lud16Domain: string;
  userRepository: Pick<UserRepository, 'get' | 'getByUsername'>;
  serverAccountRepository: Pick<ServerAccountRepository, 'getDefaultAccount'>;
  cashuReceiveQuoteService: CashuReceiveQuoteServiceServer;
  sparkReceiveQuoteService: SparkReceiveQuoteServiceServer;
  exchangeRate: Pick<ExchangeRateDomain, 'convert'>;
  /** Verify (cashu): a bare wallet for the source mint — only checkMintQuoteBolt11 is used. */
  getCashuMintWallet: (mintUrl: string) => ExtendedCashuWallet;
  /** Verify (spark): the dedicated server spark wallet (MAINNET). */
  getServerSparkWallet: () => Promise<BreezSdk>;
};

export class ServerSdk implements ServerSdkApi {
  private readonly minSendable = new Money<'BTC'>({
    amount: 1,
    currency: 'BTC',
    unit: 'sat',
  });
  private readonly maxSendable = new Money<'BTC'>({
    amount: 1_000_000,
    currency: 'BTC',
    unit: 'sat',
  });

  constructor(private readonly deps: ServerSdkDeps) {}

  async resolveLightningAddress(
    username: string,
  ): Promise<LightningAddressReceiveInfo | null> {
    const user = await this.deps.userRepository.getByUsername(username);
    if (!user) return null;
    return {
      userId: user.id,
      username: user.username,
      minSendable: this.minSendable,
      maxSendable: this.maxSendable,
      metadata: this.buildLnurlMetadata(user.username),
    };
  }

  async createLightningReceiveQuote(params: {
    userId: string;
    amount: Money<'BTC'>;
    bypassAmountValidation?: boolean;
  }): Promise<LightningReceiveQuoteResult> {
    const { userId, amount, bypassAmountValidation = false } = params;

    if (
      amount.lessThan(this.minSendable) ||
      amount.greaterThan(this.maxSendable)
    ) {
      throw new DomainError(
        `Amount out of range. Min: ${this.minSendable.toNumber('sat')} sats, Max: ${this.maxSendable.toNumber('sat')} sats.`,
        'amount_out_of_range',
      );
    }

    const user = await this.deps.userRepository.get(userId);
    if (!user) throw new NotFoundError('User not found', 'user_not_found');

    const account = await this.deps.serverAccountRepository.getDefaultAccount(
      userId,
      bypassAmountValidation ? undefined : 'BTC',
    );

    // `Money` is invariant in its currency param, so the `Money<'BTC'>` input
    // is widened to `Money` (the convert path can return any currency).
    const requested = amount as Money;
    const amountToReceive: Money =
      requested.currency === account.currency
        ? requested
        : await this.deps.exchangeRate.convert({
            amount: requested,
            to: account.currency,
          });

    if (account.type === 'cashu') {
      return this.createCashuReceiveQuote(user, account, amountToReceive);
    }
    return this.createSparkReceiveQuote(user, account, amountToReceive);
  }

  async getLightningReceiveStatus(
    ref: LnurlVerifyRef,
  ): Promise<LightningReceiveStatusResult> {
    if (ref.type === 'cashu') {
      const wallet = this.deps.getCashuMintWallet(ref.mintUrl);
      const mintQuote = await wallet.checkMintQuoteBolt11(ref.quoteId);
      const settled = ['PAID', 'ISSUED'].includes(mintQuote.state);
      return {
        settled,
        preimage: settled ? '' : null,
        paymentRequest: mintQuote.request,
      };
    }

    const wallet = await this.deps.getServerSparkWallet();
    const receiveRequest = await wallet.getLightningReceiveRequest({
      requestId: ref.quoteId,
    });
    if (!receiveRequest) {
      throw new NotFoundError(
        `Spark lightning receive request ${ref.quoteId} not found`,
        'not_found',
      );
    }
    return {
      settled: receiveRequest.status === 'transferCompleted',
      preimage: receiveRequest.paymentPreimage ?? null,
      paymentRequest: receiveRequest.invoice,
    };
  }

  private async createCashuReceiveQuote(
    user: { id: string; cashuLockingXpub: string; encryptionPublicKey: string },
    account: RedactedCashuAccount,
    amount: Money,
  ): Promise<LightningReceiveQuoteResult> {
    const lightningQuote = await getCashuLightningQuote({
      wallet: account.wallet,
      amount,
      xPub: user.cashuLockingXpub,
    });
    await this.deps.cashuReceiveQuoteService.createReceiveQuote({
      userId: user.id,
      userEncryptionPublicKey: user.encryptionPublicKey,
      account,
      receiveType: 'LIGHTNING',
      lightningQuote,
    });
    return {
      paymentRequest: lightningQuote.mintQuote.request,
      verify: {
        type: 'cashu',
        quoteId: lightningQuote.mintQuote.quote,
        mintUrl: account.mintUrl,
      },
    };
  }

  private async createSparkReceiveQuote(
    user: {
      id: string;
      username: string;
      sparkIdentityPublicKey: string;
      encryptionPublicKey: string;
    },
    account: SparkAccount,
    amount: Money,
  ): Promise<LightningReceiveQuoteResult> {
    const descriptionHash = await sha256Hex(
      this.buildLnurlMetadata(user.username),
    );
    const lightningQuote =
      await this.deps.sparkReceiveQuoteService.getLightningQuote({
        wallet: account.wallet,
        amount,
        receiverIdentityPubkey: user.sparkIdentityPublicKey,
        descriptionHash,
      });
    await this.deps.sparkReceiveQuoteService.createReceiveQuote({
      userId: user.id,
      userEncryptionPublicKey: user.encryptionPublicKey,
      account,
      receiveType: 'LIGHTNING',
      lightningQuote,
    });
    return {
      paymentRequest: lightningQuote.invoice.paymentRequest,
      verify: { type: 'spark', quoteId: lightningQuote.id },
    };
  }

  private buildLnurlMetadata(username: string): string {
    const address = `${username}@${this.deps.lud16Domain}`;
    return JSON.stringify([
      ['text/plain', `Pay to ${address}`],
      ['text/identifier', address],
    ]);
  }
}

/** Build a server-mode SDK facade. Throws if the server config (serviceRoleKey / serverSparkMnemonic) is missing. */
export function createServer(config: SdkConfig): ServerSdk {
  const connections = buildServerConnections(config);
  const userRepository = new UserRepository(connections.supabase);
  const serverAccountRepository = new ServerAccountRepository(
    connections.supabase,
    connections.cashuWallets,
    connections.sparkWallets,
  );
  const cashuReceiveQuoteService = new CashuReceiveQuoteServiceServer(
    new CashuReceiveQuoteRepositoryServer(connections.supabase),
  );
  const sparkReceiveQuoteService = new SparkReceiveQuoteServiceServer(
    new SparkReceiveQuoteRepositoryServer(connections.supabase),
  );
  const exchangeRate = createExchangeRateDomain();

  return new ServerSdk({
    lud16Domain: config.lud16Domain,
    userRepository,
    serverAccountRepository,
    cashuReceiveQuoteService,
    sparkReceiveQuoteService,
    exchangeRate,
    getCashuMintWallet: (mintUrl) => getCashuWallet(mintUrl),
    getServerSparkWallet: async () =>
      (await connections.sparkWallets.getInitialized('MAINNET')).wallet,
  });
}
