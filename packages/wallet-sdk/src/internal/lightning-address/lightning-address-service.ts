import { Money } from '@agicash/money';
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex } from '@noble/hashes/utils';
import { NotFoundError } from '../../errors';
import { getLightningQuote } from '../cashu/receive-quote-core';
import { getCashuWallet } from '../cashu/wallet';
import type { AgicashDb } from '../db/database';
import type { DefaultAccountRepository } from '../db/default-account-repository';
import type { ReadUserRepository } from '../db/user-repository';
import type { SparkWalletManager } from '../spark/wallet-manager';
import { CashuReceiveQuoteRepositoryServer } from './cashu-receive-quote-repository.server';
import { CashuReceiveQuoteServiceServer } from './cashu-receive-quote-service.server';
import type {
  LNURLError,
  LNURLPayParams,
  LNURLPayResult,
  LNURLVerifyResult,
} from './lnurl-types';
import { SparkReceiveQuoteRepositoryServer } from './spark-receive-quote-repository.server';
import { SparkReceiveQuoteServiceServer } from './spark-receive-quote-service.server';
import { decodeVerifyToken, encodeVerifyToken } from './verify-token';

export type LightningAddressServiceDeps = {
  db: AgicashDb;
  userRepository: ReadUserRepository;
  defaultAccountRepository: DefaultAccountRepository;
  sparkWallets: SparkWalletManager;
  /** Symmetric key (raw bytes) for the LUD-21 verify-token obfuscation. */
  verifyEncryptionKey: Uint8Array;
  /** Resolves a fiat/BTC exchange rate for the bypassAmountValidation path
   * (e.g. ticker 'BTC-USD'). Required only when an agicash↔agicash payment
   * lands on a non-BTC default account. */
  getExchangeRate?: (ticker: string) => Promise<string>;
};

export class LightningAddressService {
  private readonly db: AgicashDb;
  private readonly userRepository: ReadUserRepository;
  private readonly defaultAccountRepository: DefaultAccountRepository;
  private readonly sparkWallets: SparkWalletManager;
  private readonly verifyEncryptionKey: Uint8Array;
  private readonly getExchangeRate?: (ticker: string) => Promise<string>;
  private readonly minSendable: Money<'BTC'>;
  private readonly maxSendable: Money<'BTC'>;

  constructor(deps: LightningAddressServiceDeps) {
    this.db = deps.db;
    this.userRepository = deps.userRepository;
    this.defaultAccountRepository = deps.defaultAccountRepository;
    this.sparkWallets = deps.sparkWallets;
    this.verifyEncryptionKey = deps.verifyEncryptionKey;
    this.getExchangeRate = deps.getExchangeRate;
    this.minSendable = new Money({ amount: 1, currency: 'BTC', unit: 'sat' });
    this.maxSendable = new Money({
      amount: 1_000_000,
      currency: 'BTC',
      unit: 'sat',
    });
  }

  async handleLud16Request(params: {
    username: string;
    baseUrl: string;
  }): Promise<LNURLPayParams | LNURLError> {
    try {
      const user = await this.userRepository.getByUsername(params.username);
      if (!user) {
        return { status: 'ERROR', reason: 'not found' };
      }
      const callback = `${params.baseUrl}/api/lnurlp/callback/${user.id}`;
      const metadata = this.buildLnurlpMetadata(user.username, params.baseUrl);
      return {
        callback,
        maxSendable: this.maxSendable.toNumber('msat'),
        minSendable: this.minSendable.toNumber('msat'),
        metadata,
        tag: 'payRequest',
      };
    } catch (error) {
      console.error('Error processing LNURL-pay request', { cause: error });
      return { status: 'ERROR', reason: 'Internal server error' };
    }
  }

  async handleLnurlpCallback(params: {
    userId: string;
    amount: Money<'BTC'>;
    baseUrl: string;
    bypassAmountValidation?: boolean;
  }): Promise<LNURLPayResult | LNURLError> {
    const { userId, amount, baseUrl } = params;
    const bypassAmountValidation = params.bypassAmountValidation ?? false;

    if (
      amount.lessThan(this.minSendable) ||
      amount.greaterThan(this.maxSendable)
    ) {
      return {
        status: 'ERROR',
        reason: `Amount out of range. Min: ${this.minSendable.toNumber('sat')} sats, Max: ${this.maxSendable.toNumber('sat').toLocaleString()} sats.`,
      };
    }

    try {
      const user = await this.userRepository.get(userId);
      if (!user) {
        return { status: 'ERROR', reason: 'not found' };
      }

      // External lightning-address requests only support BTC to avoid exchange
      // rate mismatches. bypassAmountValidation (agicash↔agicash) allows the
      // user's default currency + a conversion.
      const account = await this.defaultAccountRepository.getDefault(
        userId,
        bypassAmountValidation ? undefined : 'BTC',
      );

      let amountToReceive = amount as Money;
      if (amount.currency !== account.currency) {
        if (!this.getExchangeRate) {
          throw new Error(
            'getExchangeRate is required to convert across currencies',
          );
        }
        const rate = await this.getExchangeRate(
          `${amount.currency}-${account.currency}`,
        );
        amountToReceive = amount.convert(account.currency, rate) as Money;
      }

      if (account.type === 'cashu') {
        // cashu cannot set the invoice description_hash:
        // https://github.com/cashubtc/nuts/issues/110#issuecomment-2062898765
        const lightningQuote = await getLightningQuote({
          wallet: account.wallet,
          amount: amountToReceive,
          xPub: user.cashuLockingXpub,
        });

        const cashuReceiveQuoteService = new CashuReceiveQuoteServiceServer(
          new CashuReceiveQuoteRepositoryServer(this.db),
        );
        await cashuReceiveQuoteService.createReceiveQuote({
          userId,
          userEncryptionPublicKey: user.encryptionPublicKey,
          account,
          receiveType: 'LIGHTNING',
          lightningQuote,
        });

        const encryptedQuoteData = encodeVerifyToken(
          {
            type: 'cashu',
            quoteId: lightningQuote.mintQuote.quote,
            mintUrl: account.mintUrl,
          },
          this.verifyEncryptionKey,
        );

        return {
          pr: lightningQuote.mintQuote.request,
          verify: `${baseUrl}/api/lnurlp/verify/${encryptedQuoteData}`,
          routes: [],
        };
      }

      const sparkReceiveQuoteService = new SparkReceiveQuoteServiceServer(
        new SparkReceiveQuoteRepositoryServer(this.db),
      );
      const metadata = this.buildLnurlpMetadata(user.username, baseUrl);
      const descriptionHash = bytesToHex(
        sha256(new TextEncoder().encode(metadata)),
      );

      const lightningQuote = await sparkReceiveQuoteService.getLightningQuote({
        wallet: account.wallet,
        amount: amountToReceive,
        receiverIdentityPubkey: user.sparkIdentityPublicKey,
        descriptionHash,
      });
      await sparkReceiveQuoteService.createReceiveQuote({
        userId,
        userEncryptionPublicKey: user.encryptionPublicKey,
        account,
        lightningQuote,
        receiveType: 'LIGHTNING',
      });

      const encryptedQuoteData = encodeVerifyToken(
        { type: 'spark', quoteId: lightningQuote.id },
        this.verifyEncryptionKey,
      );

      return {
        pr: lightningQuote.invoice.paymentRequest,
        verify: `${baseUrl}/api/lnurlp/verify/${encryptedQuoteData}`,
        routes: [],
      };
    } catch (error) {
      console.error('Error processing LNURL-pay callback', { cause: error });
      return { status: 'ERROR', reason: 'Internal server error' };
    }
  }

  async handleLnurlpVerify(params: {
    encryptedQuoteData: string;
  }): Promise<LNURLVerifyResult | LNURLError> {
    try {
      const payload = decodeVerifyToken(
        params.encryptedQuoteData,
        this.verifyEncryptionKey,
      );
      if (payload.type === 'cashu') {
        return await this.handleCashuLnurlpVerify(
          payload.quoteId,
          payload.mintUrl,
        );
      }
      return await this.handleSparkLnurlpVerify(payload.quoteId);
    } catch (error) {
      console.error('Error processing LNURL-pay verify', { cause: error });
      const reason =
        error instanceof NotFoundError ? 'Not found' : 'Internal server error';
      return { status: 'ERROR', reason };
    }
  }

  private async handleCashuLnurlpVerify(
    mintQuoteId: string,
    mintUrl: string,
  ): Promise<LNURLVerifyResult> {
    const wallet = getCashuWallet(mintUrl);
    const mintQuote = await wallet.checkMintQuoteBolt11(mintQuoteId);
    if (['PAID', 'ISSUED'].includes(mintQuote.state)) {
      return {
        status: 'OK',
        settled: true,
        preimage: '',
        pr: mintQuote.request,
      };
    }
    return {
      status: 'OK',
      settled: false,
      preimage: null,
      pr: mintQuote.request,
    };
  }

  private async handleSparkLnurlpVerify(
    receiveRequestId: string,
  ): Promise<LNURLVerifyResult> {
    const { wallet } = await this.sparkWallets.getWallet('MAINNET');
    const receiveRequest = await wallet.getLightningReceiveRequest({
      requestId: receiveRequestId,
    });
    if (!receiveRequest) {
      throw new NotFoundError(
        `Spark lightning receive request ${receiveRequestId} not found`,
      );
    }
    const settled = receiveRequest.status === 'transferCompleted';
    return {
      status: 'OK',
      settled,
      preimage: receiveRequest.paymentPreimage ?? null,
      pr: receiveRequest.invoice,
    };
  }

  private buildLnurlpMetadata(username: string, baseUrl: string): string {
    const address = `${username}@${new URL(baseUrl).host}`;
    return JSON.stringify([
      ['text/plain', `Pay to ${address}`],
      ['text/identifier', address],
    ]);
  }
}
