/**
 * DB→domain `TransactionDetails` parser round-trip — all 6 domain variants (§7, decision 7-ii).
 *
 * Drives the REAL internal pipeline via `TransactionRepository.toTransaction`: a fake `Encryption`
 * yields the per-variant decrypted `*DbData` (with live `Money`), the row carries the small
 * unencrypted `transaction_details`, and we assert the parsed DOMAIN `details` shape. This proves
 * the single-source `TransactionDetailsParser` (the 6 `z.pipe` parsers) + `TransactionSchema` work
 * re-housed in the SDK, and that the public domain shape differs from the DB-data shape.
 */
import type { Json } from '@agicash/db-types';
import { describe, expect, test } from 'bun:test';
import type { Encryption } from './encryption';
import { TransactionRepository } from './transaction-repository';
import type { AgicashDbTransaction } from './db-transaction';
import type { WalletSupabaseClient } from './supabase-client';
import { type Currency, Money } from '../types/money';
import type {
  TransactionDirection,
  TransactionState,
  TransactionType,
} from '../types/transaction';

const sats = (n: number): Money =>
  new Money({ amount: n, currency: 'BTC' as Currency, unit: 'sat' });

/**
 * Assert an object's fields against `expected`, comparing `Money` values BY VALUE (`.toString()`)
 * — two equal `Money` instances are distinct objects that bun's `toEqual` treats as unequal (see
 * `orchestrator.test.ts`). Also asserts the key SET matches exactly.
 */
function expectDetails(
  actual: Record<string, unknown>,
  expected: Record<string, unknown>,
): void {
  expect(new Set(Object.keys(actual))).toEqual(new Set(Object.keys(expected)));
  for (const [key, value] of Object.entries(expected)) {
    if (value instanceof Money) {
      expect((actual[key] as Money)?.toString()).toBe(value.toString());
    } else {
      expect(actual[key]).toBe(value as never);
    }
  }
}

/** A minimal valid cashu Proof (id/amount/secret/C; dleq/witness optional). */
const proof = { id: 'ks1', amount: 1, secret: 's', C: '02ab' };

/** A repository whose `encryption.decrypt` returns a pre-set DbData object (already deserialized). */
function repoFor(dbData: unknown): TransactionRepository {
  const encryption = {
    decrypt: async () => dbData,
  } as unknown as Encryption;
  // The db client is never touched by toTransaction (it only decrypts + parses the passed row).
  return new TransactionRepository({} as WalletSupabaseClient, encryption);
}

/** Build a transactions row for the given type/direction/state + small `transaction_details`. */
function row(
  type: TransactionType,
  direction: TransactionDirection,
  state: TransactionState,
  transactionDetails: Json | null,
): AgicashDbTransaction {
  return {
    id: 't1',
    user_id: 'u1',
    account_id: 'acc1',
    account_name: 'acc',
    account_type: type === 'SPARK_LIGHTNING' ? 'spark' : 'cashu',
    account_purpose: 'transactional',
    currency: 'BTC',
    direction,
    type,
    state,
    encrypted_transaction_details: 'ciphertext',
    transaction_details: transactionDetails,
    purpose: 'PAYMENT',
    acknowledgment_status: null,
    reversed_transaction_id: null,
    state_sort_order: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    pending_at: null,
    completed_at: null,
    failed_at: null,
    reversed_at: null,
    version: 1,
  };
}

describe('TransactionDetailsParser round-trip — 6 domain variants', () => {
  test('CASHU_TOKEN SEND → CashuTokenSendTransactionDetails', async () => {
    const dbData = {
      tokenMintUrl: 'https://mint',
      amountReceived: sats(90),
      cashuReceiveFee: sats(2),
      amountToSend: sats(92),
      cashuSendFee: sats(1),
      amountSpent: sats(93),
      amountReserved: sats(100),
      totalFee: sats(3),
    };
    const tx = await repoFor(dbData).toTransaction(
      row('CASHU_TOKEN', 'SEND', 'COMPLETED', null),
    );

    expect(tx.type).toBe('CASHU_TOKEN');
    expect(tx.direction).toBe('SEND');
    expectDetails(tx.details as Record<string, unknown>, {
      tokenAmount: sats(92), // = amountToSend
      tokenMintUrl: 'https://mint',
      amountReserved: sats(100),
      amount: sats(93), // COMPLETED → amountSpent
      amountReceived: sats(90),
      cashuReceiveFee: sats(2),
      cashuSendFee: sats(1),
      totalFee: sats(3),
    });
    // Domain `amount` is lifted onto the transaction.
    expect(tx.amount.toString()).toBe(sats(93).toString());
  });

  test('CASHU_TOKEN RECEIVE (same-mint swap) → CashuTokenReceiveTransactionDetails', async () => {
    const dbData = {
      tokenMintUrl: 'https://mint',
      tokenAmount: sats(100),
      tokenProofs: [proof],
      tokenDescription: 'gift',
      amountReceived: sats(98),
      outputAmounts: [64, 32, 2],
      cashuReceiveFee: sats(2),
    };
    const tx = await repoFor(dbData).toTransaction(
      row('CASHU_TOKEN', 'RECEIVE', 'COMPLETED', null),
    );

    expectDetails(tx.details as Record<string, unknown>, {
      tokenAmount: sats(100),
      tokenMintUrl: 'https://mint',
      description: 'gift',
      amount: sats(98),
      cashuReceiveFee: sats(2),
      totalFee: sats(2), // same-mint: totalFee = cashuReceiveFee
    });
  });

  test('CASHU_LIGHTNING SEND (completed) → CompletedCashuLightningSendTransactionDetails', async () => {
    const dbData = {
      paymentRequest: 'lnbc1...',
      amountRequested: sats(50),
      amountRequestedInMsat: 50_000,
      amountReceived: sats(50),
      lightningFeeReserve: sats(5),
      cashuSendFee: sats(1),
      meltQuoteId: 'melt1',
      amountReserved: sats(56),
      paymentPreimage: 'preimage',
      amountSpent: sats(53),
      lightningFee: sats(2),
      totalFee: sats(3),
    };
    const tx = await repoFor(dbData).toTransaction(
      row('CASHU_LIGHTNING', 'SEND', 'COMPLETED', {
        paymentHash: 'hash',
      }),
    );

    // Completed adds preimage + lightningFee + totalFee on top of the incomplete shape.
    expect(tx.details).toMatchObject({
      paymentRequest: 'lnbc1...',
      paymentHash: 'hash', // read from the unencrypted transaction_details
      amountReserved: sats(56),
      amountReceived: sats(50),
      lightningFeeReserve: sats(5),
      cashuSendFee: sats(1),
      estimatedTotalFee: sats(6), // lightningFeeReserve + cashuSendFee
      preimage: 'preimage',
      lightningFee: sats(2),
      totalFee: sats(3),
    });
  });

  test('CASHU_LIGHTNING RECEIVE → CashuLightningReceiveTransactionDetails', async () => {
    const dbData = {
      paymentRequest: 'lnbc1...',
      mintQuoteId: 'mq1',
      amountReceived: sats(100),
      description: 'tip',
      mintingFee: sats(1),
      totalFee: sats(1),
    };
    const tx = await repoFor(dbData).toTransaction(
      row('CASHU_LIGHTNING', 'RECEIVE', 'COMPLETED', { paymentHash: 'hash' }),
    );

    expectDetails(tx.details as Record<string, unknown>, {
      paymentRequest: 'lnbc1...',
      paymentHash: 'hash',
      description: 'tip',
      mintingFee: sats(1),
      amount: sats(100),
      totalFee: sats(1),
      transferId: undefined,
    });
  });

  test('SPARK_LIGHTNING SEND (completed) → CompletedSparkLightningSendTransactionDetails', async () => {
    const dbData = {
      paymentRequest: 'lnbc1...',
      amountReceived: sats(40),
      estimatedLightningFee: sats(3),
      amountSpent: sats(42),
      lightningFee: sats(2),
      paymentPreimage: 'preimage',
    };
    const tx = await repoFor(dbData).toTransaction(
      row('SPARK_LIGHTNING', 'SEND', 'COMPLETED', {
        paymentHash: 'hash',
        sparkId: 'spk1',
        sparkTransferId: 'tr1',
      }),
    );

    expect(tx.details).toMatchObject({
      amountReceived: sats(40),
      estimatedFee: sats(3),
      paymentRequest: 'lnbc1...',
      paymentHash: 'hash',
      amount: sats(42), // amountSpent
      fee: sats(2), // actual lightningFee
      sparkId: 'spk1',
      sparkTransferId: 'tr1',
      paymentPreimage: 'preimage',
    });
  });

  test('SPARK_LIGHTNING RECEIVE → CompletedSparkLightningReceiveTransactionDetails', async () => {
    const dbData = {
      paymentRequest: 'lnbc1...',
      amountReceived: sats(75),
      description: 'invoice',
      paymentPreimage: 'preimage',
      totalFee: sats(0),
    };
    const tx = await repoFor(dbData).toTransaction(
      row('SPARK_LIGHTNING', 'RECEIVE', 'COMPLETED', {
        paymentHash: 'hash',
        sparkId: 'spk1',
        sparkTransferId: 'tr1',
      }),
    );

    expect(tx.details).toMatchObject({
      paymentRequest: 'lnbc1...',
      paymentHash: 'hash',
      sparkId: 'spk1',
      description: 'invoice',
      amount: sats(75),
      paymentPreimage: 'preimage',
      sparkTransferId: 'tr1',
    });
  });

  test('TRANSFER purpose injects details.transferId (a transfer leg)', async () => {
    const dbData = {
      paymentRequest: 'lnbc1...',
      mintQuoteId: 'mq1',
      amountReceived: sats(100),
      totalFee: sats(0),
    };
    const transferRow = {
      ...row('CASHU_LIGHTNING', 'RECEIVE', 'COMPLETED', {
        paymentHash: 'hash',
        transferId: 'transfer-1',
      }),
      purpose: 'TRANSFER' as const,
    };
    const tx = await repoFor(dbData).toTransaction(transferRow);

    expect(tx.purpose).toBe('TRANSFER');
    // The parser carries transferId from the unencrypted transaction_details into details.
    expect((tx.details as { transferId?: string }).transferId).toBe(
      'transfer-1',
    );
  });
});
