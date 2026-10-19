import type {
  AgicashDb,
  AgicashDbAccountWithProofs,
  AgicashDbCashuProof,
  AgicashDbCashuReceiveQuote,
  AgicashDbCashuReceiveSwap,
  AgicashDbCashuSendQuote,
  AgicashDbCashuSendSwap,
  AgicashDbContact,
  AgicashDbSparkReceiveQuote,
  AgicashDbSparkSendQuote,
  AgicashDbTransaction,
  AgicashDbUser,
} from '../../db/database';
import type { Encryption } from '../../lib/encryption';
import type { Account } from '../accounts/account';
import type { AccountRepository } from '../accounts/account-repository';
import type { Contact } from '../contacts/contact';
import { ContactRepository } from '../contacts/contact-repository';
import type { CashuReceiveQuote } from '../receive/cashu-receive-quote';
import { CashuReceiveQuoteRepository } from '../receive/cashu-receive-quote-repository';
import type { CashuReceiveSwap } from '../receive/cashu-receive-swap';
import { CashuReceiveSwapRepository } from '../receive/cashu-receive-swap-repository';
import type { SparkReceiveQuote } from '../receive/spark-receive-quote';
import { SparkReceiveQuoteRepository } from '../receive/spark-receive-quote-repository';
import type { WalletEventMap } from '../sdk';
import type { CashuSendQuote } from '../send/cashu-send-quote';
import { CashuSendQuoteRepository } from '../send/cashu-send-quote-repository';
import type { CashuSendSwap } from '../send/cashu-send-swap';
import { CashuSendSwapRepository } from '../send/cashu-send-swap-repository';
import type { SparkSendQuote } from '../send/spark-send-quote';
import { SparkSendQuoteRepository } from '../send/spark-send-quote-repository';
import type { Transaction } from '../transactions/transaction';
import { TransactionRepository } from '../transactions/transaction-repository';
import type { User } from '../user/user';
import { ReadUserRepository } from '../user/user-repository';

/** A contract event with its payload, as the feed hands it to `events.emit`. */
export type WalletEventMessage = {
  [K in keyof WalletEventMap]: { event: K; payload: WalletEventMap[K] };
}[keyof WalletEventMap];

/**
 * Turns a broadcast row into the domain object that the read path returns.
 * The row is the table row as the trigger sent it, cast and not validated,
 * as on master.
 */
export type RowMappers = {
  toAccount(row: unknown): Promise<Account>;
  toTransaction(row: unknown): Promise<Transaction>;
  toCashuReceiveQuote(row: unknown): Promise<CashuReceiveQuote>;
  toCashuReceiveSwap(row: unknown): Promise<CashuReceiveSwap>;
  toCashuSendQuote(row: unknown): Promise<CashuSendQuote>;
  toCashuSendSwap(row: unknown): Promise<CashuSendSwap>;
  toSparkReceiveQuote(row: unknown): Promise<SparkReceiveQuote>;
  toSparkSendQuote(row: unknown): Promise<SparkSendQuote>;
  toContact(row: unknown): Contact;
  toUser(row: unknown): User;
};

/** Builds each mapper on the session's repositories. */
export function createRowMappers({
  db,
  getEncryption,
  getAccountRepository,
  lightningAddressDomain,
}: {
  db: AgicashDb;
  getEncryption: () => Promise<Encryption>;
  getAccountRepository: () => Promise<AccountRepository>;
  lightningAddressDomain: string;
}): RowMappers {
  return {
    toAccount: async (row) =>
      (await getAccountRepository()).toAccount(
        row as AgicashDbAccountWithProofs,
      ),
    toTransaction: async (row) =>
      new TransactionRepository(db, await getEncryption()).toTransaction(
        row as AgicashDbTransaction,
      ),
    toCashuReceiveQuote: async (row) =>
      new CashuReceiveQuoteRepository(
        db,
        await getEncryption(),
        await getAccountRepository(),
      ).toQuote(row as AgicashDbCashuReceiveQuote),
    toCashuReceiveSwap: async (row) =>
      new CashuReceiveSwapRepository(
        db,
        await getEncryption(),
        await getAccountRepository(),
      ).toReceiveSwap(row as AgicashDbCashuReceiveSwap),
    toCashuSendQuote: async (row) =>
      new CashuSendQuoteRepository(db, await getEncryption()).toQuote(
        row as AgicashDbCashuSendQuote & {
          cashu_proofs: AgicashDbCashuProof[];
        },
      ),
    toCashuSendSwap: async (row) =>
      new CashuSendSwapRepository(db, await getEncryption()).toSwap(
        row as AgicashDbCashuSendSwap & {
          cashu_proofs: AgicashDbCashuProof[];
        },
      ),
    toSparkReceiveQuote: async (row) =>
      new SparkReceiveQuoteRepository(db, await getEncryption()).toQuote(
        row as AgicashDbSparkReceiveQuote,
      ),
    toSparkSendQuote: async (row) =>
      new SparkSendQuoteRepository(db, await getEncryption()).toQuote(
        row as AgicashDbSparkSendQuote,
      ),
    toContact: (row) =>
      ContactRepository.toContact(
        row as AgicashDbContact,
        lightningAddressDomain,
      ),
    toUser: (row) => ReadUserRepository.toUser(row as AgicashDbUser),
  };
}

type ToEvent = (row: unknown, m: RowMappers) => Promise<WalletEventMessage>;

/** Each broadcast that the `wallet:<userId>` triggers send, and its contract event. */
const broadcasts: Record<string, ToEvent> = {
  ACCOUNT_CREATED: async (row, m) => ({
    event: 'account.created',
    payload: { account: await m.toAccount(row) },
  }),
  ACCOUNT_UPDATED: async (row, m) => ({
    event: 'account.updated',
    payload: { account: await m.toAccount(row) },
  }),
  TRANSACTION_CREATED: async (row, m) => ({
    event: 'transaction.created',
    payload: { transaction: await m.toTransaction(row) },
  }),
  TRANSACTION_UPDATED: async (row, m) => ({
    event: 'transaction.updated',
    payload: { transaction: await m.toTransaction(row) },
  }),
  CASHU_RECEIVE_QUOTE_CREATED: async (row, m) => ({
    event: 'cashu-receive-quote.created',
    payload: { quote: await m.toCashuReceiveQuote(row) },
  }),
  CASHU_RECEIVE_QUOTE_UPDATED: async (row, m) => ({
    event: 'cashu-receive-quote.updated',
    payload: { quote: await m.toCashuReceiveQuote(row) },
  }),
  CASHU_RECEIVE_SWAP_CREATED: async (row, m) => ({
    event: 'cashu-receive-swap.created',
    payload: { swap: await m.toCashuReceiveSwap(row) },
  }),
  CASHU_RECEIVE_SWAP_UPDATED: async (row, m) => ({
    event: 'cashu-receive-swap.updated',
    payload: { swap: await m.toCashuReceiveSwap(row) },
  }),
  CASHU_SEND_QUOTE_CREATED: async (row, m) => ({
    event: 'cashu-send-quote.created',
    payload: { quote: await m.toCashuSendQuote(row) },
  }),
  CASHU_SEND_QUOTE_UPDATED: async (row, m) => ({
    event: 'cashu-send-quote.updated',
    payload: { quote: await m.toCashuSendQuote(row) },
  }),
  CASHU_SEND_SWAP_CREATED: async (row, m) => ({
    event: 'cashu-send-swap.created',
    payload: { swap: await m.toCashuSendSwap(row) },
  }),
  CASHU_SEND_SWAP_UPDATED: async (row, m) => ({
    event: 'cashu-send-swap.updated',
    payload: { swap: await m.toCashuSendSwap(row) },
  }),
  SPARK_RECEIVE_QUOTE_CREATED: async (row, m) => ({
    event: 'spark-receive-quote.created',
    payload: { quote: await m.toSparkReceiveQuote(row) },
  }),
  SPARK_RECEIVE_QUOTE_UPDATED: async (row, m) => ({
    event: 'spark-receive-quote.updated',
    payload: { quote: await m.toSparkReceiveQuote(row) },
  }),
  SPARK_SEND_QUOTE_CREATED: async (row, m) => ({
    event: 'spark-send-quote.created',
    payload: { quote: await m.toSparkSendQuote(row) },
  }),
  SPARK_SEND_QUOTE_UPDATED: async (row, m) => ({
    event: 'spark-send-quote.updated',
    payload: { quote: await m.toSparkSendQuote(row) },
  }),
  CONTACT_CREATED: async (row, m) => ({
    event: 'contact.created',
    payload: { contact: m.toContact(row) },
  }),
  // The trigger sends the deleted row (OLD).
  CONTACT_DELETED: async (row, m) => ({
    event: 'contact.deleted',
    payload: { contact: m.toContact(row) },
  }),
  USER_UPDATED: async (row, m) => ({
    event: 'user.updated',
    payload: { user: m.toUser(row) },
  }),
};

/**
 * Turns one broadcast into its contract event. Returns undefined for a
 * broadcast name that the wallet triggers do not send.
 */
export type ToWalletEvent = (
  name: string,
  row: unknown,
) => Promise<WalletEventMessage> | undefined;

export function createToWalletEvent(mappers: RowMappers): ToWalletEvent {
  return (name, row) =>
    Object.hasOwn(broadcasts, name)
      ? broadcasts[name](row, mappers)
      : undefined;
}
