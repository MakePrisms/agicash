import type { NetworkType as SparkNetwork } from '@buildonspark/spark-sdk';
import type { QueryClient } from '@tanstack/react-query';
import { getCashuWallet } from '~/lib/cashu';
import { ExchangeRateService } from '~/lib/exchange-rate/exchange-rate-service';
import type {
  LNURLError,
  LNURLPayParams,
  LNURLPayResult,
  LNURLVerifyResult,
} from '~/lib/lnurl/types';
import { Money } from '~/lib/money';
import type { SparkAccount } from '../accounts/account';
import { AccountRepository } from '../accounts/account-repository';
import type { AgicashDb } from '../agicash-db/database';
import type { CashuCryptography } from '../shared/cashu';
import {
  type Encryption,
  encryptBatchToPublicKey,
  encryptToPublicKey,
} from '../shared/encryption';
import { NotFoundError } from '../shared/error';
import { sparkWalletQueryOptions } from '../shared/spark';
import { UserRepository } from '../user/user-repository';
import { CashuReceiveQuoteRepository } from './cashu-receive-quote-repository';
import { CashuReceiveQuoteService } from './cashu-receive-quote-service';
import { SparkLightningReceiveService } from './spark-lightning-receive-service';

const fakeEncryption: Encryption = {
  encrypt: async <T = unknown>(_data: T): Promise<string> => {
    throw new Error('encrypt is not supported in this context');
  },
  decrypt: async <T = unknown>(data: string): Promise<T> => data as T,
  encryptBatch: async <T extends readonly unknown[] = unknown[]>(
    _data: T,
  ): Promise<string[]> => {
    throw new Error('encryptBatch is not supported in this context');
  },
  decryptBatch: async <T extends readonly unknown[] = unknown[]>(
    _data: readonly [...{ [K in keyof T]: string }],
  ): Promise<T> => _data as T,
};

const fakeCryptography: CashuCryptography = {
  getSeed: (): Promise<Uint8Array> => {
    throw new Error('getSeed is not supported in this context');
  },
  getXpub: (): Promise<string> => {
    throw new Error('getXpub is not supported in this context');
  },
  getPrivateKey: (): Promise<string> => {
    throw new Error('getPrivateKey is not supported in this context');
  },
};

const sparkMnemonic = process.env.LNURL_SERVER_SPARK_MNEMONIC || '';
if (!sparkMnemonic) {
  throw new Error('LNURL_SERVER_SPARK_MNEMONIC is not set');
}

const getSparkWalletMnemonic = (): Promise<string> => {
  return Promise.resolve(sparkMnemonic);
};

export class LightningAddressService {
  private baseUrl: string;
  private db: AgicashDb;
  private userRepository: UserRepository;
  private accountRepository: AccountRepository;
  private minSendable: Money<'BTC'>;
  private maxSendable: Money<'BTC'>;
  private cryptography: CashuCryptography = fakeCryptography;
  private encryption: Encryption = fakeEncryption;
  private exchangeRateService: ExchangeRateService;
  private queryClient: QueryClient;
  /**
   * A client can flag that they will not validate the invoice amount.
   * This is useful for agicash <-> agicash payments so that the receiver can receive into their default currency
   * and we do not have to worry about exchange rate mismatches.
   */
  private bypassAmountValidation: boolean;

  constructor(
    request: Request,
    db: AgicashDb,
    queryClient: QueryClient,
    options?: {
      bypassAmountValidation?: boolean;
    },
  ) {
    this.queryClient = queryClient;
    this.exchangeRateService = new ExchangeRateService();
    this.db = db;
    this.accountRepository = new AccountRepository(
      db,
      {
        encrypt: this.encryption.encrypt,
        decrypt: this.encryption.decrypt,
        encryptBatch: this.encryption.encryptBatch,
        decryptBatch: this.encryption.decryptBatch,
      },
      this.queryClient,
      undefined,
      getSparkWalletMnemonic,
    );
    this.userRepository = new UserRepository(
      db,
      this.encryption,
      this.accountRepository,
    );
    this.bypassAmountValidation = options?.bypassAmountValidation ?? false;
    this.baseUrl = new URL(request.url).origin;
    this.minSendable = new Money({
      amount: 1,
      currency: 'BTC',
      unit: 'sat',
    });
    this.maxSendable = new Money({
      amount: 1_000_000,
      currency: 'BTC',
      unit: 'sat',
    });
  }

  /**
   * Returns the LNURL-p params for the given username or
   * returns an error if the user is not found.
   */
  async handleLud16Request(
    username: string,
  ): Promise<LNURLPayParams | LNURLError> {
    try {
      const user = await this.userRepository.getByUsername(username);

      if (!user) {
        return {
          status: 'ERROR',
          reason: 'not found',
        };
      }

      const callback = `${this.baseUrl}/api/lnurlp/callback/${user.id}`;
      const address = `${user.username}@${new URL(this.baseUrl).host}`;
      const metadata = JSON.stringify([
        ['text/plain', `Pay to ${address}`],
        ['text/identifier', address],
      ]);

      return {
        callback,
        maxSendable: this.maxSendable.toNumber('msat'),
        minSendable: this.minSendable.toNumber('msat'),
        metadata,
        tag: 'payRequest',
      };
    } catch (error) {
      console.error('Error processing LNURL-pay request', { cause: error });
      return {
        status: 'ERROR',
        reason: 'Internal server error',
      };
    }
  }

  /**
   * Creates a new cashu receive quote for the given user and amount.
   * @returns the bolt11 invoice from the receive quote and the verify callback url.
   */
  async handleLnurlpCallback(
    userId: string,
    amount: Money<'BTC'>,
  ): Promise<LNURLPayResult | LNURLError> {
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
        return {
          status: 'ERROR',
          reason: 'not found',
        };
      }

      // For external lightning address requests, we only support BTC to avoid exchange rate mismatches.
      // However, if bypassAmountValidation is enabled, we can use the user's default currency
      // and perform exchange rate conversion to create an invoice in their preferred currency.
      const account = await this.userRepository.getDefaultAccount(
        userId,
        this.bypassAmountValidation ? undefined : 'BTC',
      );

      let amountToReceive: Money = amount as Money;
      if (amount.currency !== account.currency) {
        const rate = await this.exchangeRateService.getRate(
          `${amount.currency}-${account.currency}`,
        );
        amountToReceive = amount.convert(account.currency, rate) as Money;
      }

      if (account.type === 'cashu') {
        const cashuReceiveQuoteService = new CashuReceiveQuoteService(
          {
            ...this.cryptography,
            getXpub: () => Promise.resolve(user.cashuLockingXpub),
          },
          new CashuReceiveQuoteRepository(
            this.db,
            {
              encrypt: async (data) =>
                encryptToPublicKey(data, user.encryptionPublicKey),
              decrypt: this.encryption.decrypt,
              encryptBatch: async (data) =>
                encryptBatchToPublicKey(data, user.encryptionPublicKey),
              decryptBatch: this.encryption.decryptBatch,
            },
            this.accountRepository,
          ),
        );

        const lightningQuote = await cashuReceiveQuoteService.getLightningQuote(
          {
            account,
            amount: amountToReceive,
          },
        );

        const quote = await cashuReceiveQuoteService.createReceiveQuote({
          userId,
          account,
          receiveType: 'LIGHTNING',
          receiveQuote: lightningQuote,
        });

        return {
          pr: quote.paymentRequest,
          verify: `${this.baseUrl}/api/lnurlp/verify/${account.id}/${quote.id}`,
          routes: [],
        };
      }

      if (account.type === 'spark') {
        const sparkWallet = await this.getSparkWalletOrThrow(account.network);
        const sparkReceiveLightningService = new SparkLightningReceiveService(
          sparkWallet,
        );
        const request = await sparkReceiveLightningService.create({
          amount: amountToReceive,
          receiverIdentityPubkey: user.sparkPublicKey,
        });

        return {
          pr: request.paymentRequest,
          verify: `${this.baseUrl}/api/lnurlp/verify/${account.id}/${request.id}`,
          routes: [],
        };
      }

      throw new Error(`Account type not supported. Got ${account.type}`);
    } catch (error) {
      console.error('Error processing LNURL-pay callback', { cause: error });
      return {
        status: 'ERROR',
        reason: 'Internal server error',
      };
    }
  }

  /**
   * Checks if an LNURL-pay request has been settled.
   * @param accountId the account ID
   * @param requestId the ID to lookup the request
   * @return the lnurl-verify result or error
   */
  async handleLnurlpVerify(
    accountId: string,
    requestId: string,
  ): Promise<LNURLVerifyResult | LNURLError> {
    try {
      const account = await this.accountRepository.get(accountId);
      if (account.type === 'cashu') {
        return this.handleCashuLnurlpVerify(requestId);
      }
      if (account.type === 'spark') {
        return this.handleSparkLnurlpVerify(account, requestId);
      }
      throw new Error(
        `Account type not supported. Got ${account.type} for account ${accountId}`,
      );
    } catch (error) {
      console.error('Error processing LNURL-pay verify', { cause: error });
      const errorMessage =
        error instanceof NotFoundError ? 'Not found' : 'Internal server error';
      return {
        status: 'ERROR',
        reason: errorMessage,
      };
    }
  }

  /**
   * Checks if the payment of a Cashu receive quote has been settled.
   * @param receiveQuoteId the id of the Cashu receive quote to check
   * @return the lnurl-verify result
   */
  private async handleCashuLnurlpVerify(
    receiveQuoteId: string,
  ): Promise<LNURLVerifyResult> {
    const cashuReceiveQuoteRepository = new CashuReceiveQuoteRepository(
      this.db,
      this.encryption,
      this.accountRepository,
    );
    const quote = await cashuReceiveQuoteRepository.get(receiveQuoteId);

    if (!quote) {
      throw new NotFoundError(
        `Cashu receive quote ${receiveQuoteId} not found`,
      );
    }

    const account = await this.accountRepository.get(quote.accountId);
    if (account.type !== 'cashu') {
      throw new Error(`Account type not supported. Got ${account.type}`);
    }

    const wallet = getCashuWallet(account.mintUrl);
    const quoteState = await wallet.checkMintQuote(quote.quoteId);

    if (['PAID', 'ISSUED'].includes(quoteState.state)) {
      return {
        status: 'OK',
        settled: true,
        preimage: '',
        pr: quote.paymentRequest,
      };
    }

    return {
      status: 'OK',
      settled: false,
      preimage: null,
      pr: quote.paymentRequest,
    };
  }

  /**
   * Checks if a Spark lightning invoice has been settled.
   * @param account the Spark account
   * @param receiveRequestId the Spark receive request ID to check
   * @return the lnurl-verify result
   */
  private async handleSparkLnurlpVerify(
    account: SparkAccount,
    receiveRequestId: string,
  ): Promise<LNURLVerifyResult> {
    const wallet = await this.getSparkWalletOrThrow(account.network);
    const receiveService = new SparkLightningReceiveService(wallet);
    const receiveRequest = await receiveService.get(receiveRequestId);

    const settled = receiveRequest.state === 'COMPLETED';
    const preimage = receiveRequest.preimage ?? null;

    return {
      status: 'OK',
      settled,
      preimage,
      pr: receiveRequest.paymentRequest,
    };
  }

  private async getSparkWalletOrThrow(network: SparkNetwork) {
    const wallet = await this.queryClient.fetchQuery(
      sparkWalletQueryOptions({ network, mnemonic: sparkMnemonic }),
    );
    if (!wallet) {
      throw new Error(`Spark wallet not found for network ${network}`);
    }
    return wallet;
  }
}
