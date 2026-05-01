import { describe, expect, test } from 'bun:test';
import type { CashuAccount } from '~/features/accounts/account';
import type { GiftCardInfo } from '~/features/gift-cards/use-discover-cards';
import type { DecodedBolt11 } from '~/lib/bolt11';
import { pickSendAccount } from './pick-send-account';

const PINK_OWL_URL = 'https://pinkowl.agi.cash';
const PINK_OWL_DESC = 'Pink Owl Coffee';
const OFFER_URL = 'https://offer.agi.cash';

const buildBolt11 = (
  overrides: Partial<DecodedBolt11> = {},
): DecodedBolt11 => ({
  amountMsat: 1_000_000,
  amountSat: 1000,
  createdAtUnixMs: 1_700_000_000_000,
  expiryUnixMs: 1_700_000_003_600_000,
  network: 'bitcoin',
  description: PINK_OWL_DESC,
  paymentHash: 'deadbeef',
  ...overrides,
});

const buildGiftCard = (
  url: string,
  name: string,
  descriptions: string[],
): GiftCardInfo =>
  ({
    url,
    name,
    currency: 'BTC',
    isDiscoverable: true,
    image: '',
    validPaymentDestinations: { descriptions, nodePubkeys: [] },
  }) as GiftCardInfo;

const buildCashuAccount = (
  mintUrl: string,
  purpose: 'gift-card' | 'offer' | 'transactional',
  currency: 'BTC' | 'USD',
  balance: number,
): CashuAccount =>
  ({
    id: `cashu-${mintUrl}-${purpose}-${currency}-${balance}`,
    name: `test-${purpose}-${currency}`,
    type: 'cashu',
    purpose,
    state: 'active',
    isOnline: true,
    currency,
    createdAt: '2026-01-01T00:00:00Z',
    version: 1,
    expiresAt: null,
    mintUrl,
    isTestMint: false,
    keysetCounters: {},
    proofs: balance > 0 ? [{ amount: balance }] : [],
    wallet: {} as never,
  }) as unknown as CashuAccount;

const PINK_OWL_GIFT = buildGiftCard(PINK_OWL_URL, 'Pink Owl Coffee', [
  PINK_OWL_DESC,
]);

describe('pickSendAccount', () => {
  test('returns null when invoice has no description', () => {
    const result = pickSendAccount({
      decodedBolt11: buildBolt11({ description: undefined }),
      accounts: [buildCashuAccount(PINK_OWL_URL, 'gift-card', 'BTC', 5000)],
      giftCards: [PINK_OWL_GIFT],
    });
    expect(result).toBeNull();
  });

  test('picks matching account with positive balance when invoice has no amount', () => {
    const giftCard = buildCashuAccount(PINK_OWL_URL, 'gift-card', 'BTC', 5000);
    const result = pickSendAccount({
      decodedBolt11: buildBolt11({
        amountSat: undefined,
        amountMsat: undefined,
      }),
      accounts: [giftCard],
      giftCards: [PINK_OWL_GIFT],
    });
    expect(result).toBe(giftCard);
  });

  test('returns null when invoice has no amount and matching account is empty', () => {
    const giftCard = buildCashuAccount(PINK_OWL_URL, 'gift-card', 'BTC', 0);
    const result = pickSendAccount({
      decodedBolt11: buildBolt11({
        amountSat: undefined,
        amountMsat: undefined,
      }),
      accounts: [giftCard],
      giftCards: [PINK_OWL_GIFT],
    });
    expect(result).toBeNull();
  });

  test('returns null when description matches no gift card config', () => {
    const result = pickSendAccount({
      decodedBolt11: buildBolt11({ description: 'Some other merchant' }),
      accounts: [buildCashuAccount(PINK_OWL_URL, 'gift-card', 'BTC', 5000)],
      giftCards: [PINK_OWL_GIFT],
    });
    expect(result).toBeNull();
  });

  test('returns null when matching mint user has no account at', () => {
    const result = pickSendAccount({
      decodedBolt11: buildBolt11(),
      accounts: [],
      giftCards: [PINK_OWL_GIFT],
    });
    expect(result).toBeNull();
  });

  test('picks gift-card account when only gift-card matches', () => {
    const giftCard = buildCashuAccount(PINK_OWL_URL, 'gift-card', 'BTC', 5000);
    const result = pickSendAccount({
      decodedBolt11: buildBolt11(),
      accounts: [giftCard],
      giftCards: [PINK_OWL_GIFT],
    });
    expect(result).toBe(giftCard);
  });

  test('picks offer over gift-card when both match', () => {
    const giftCard = buildCashuAccount(PINK_OWL_URL, 'gift-card', 'BTC', 5000);
    const offer = buildCashuAccount(OFFER_URL, 'offer', 'BTC', 5000);
    const giftCardConfig = buildGiftCard(PINK_OWL_URL, 'Pink Owl Coffee', [
      PINK_OWL_DESC,
    ]);
    const offerConfig = buildGiftCard(OFFER_URL, 'Pink Owl Offer', [
      PINK_OWL_DESC,
    ]);
    const result = pickSendAccount({
      decodedBolt11: buildBolt11({ description: PINK_OWL_DESC }),
      accounts: [giftCard, offer],
      giftCards: [giftCardConfig, offerConfig],
    });
    expect(result).toBe(offer);
  });

  test('falls through to gift-card when offer has insufficient balance', () => {
    const offer = buildCashuAccount(OFFER_URL, 'offer', 'BTC', 100);
    const giftCard = buildCashuAccount(PINK_OWL_URL, 'gift-card', 'BTC', 5000);
    const giftCardConfig = buildGiftCard(PINK_OWL_URL, 'Pink Owl Coffee', [
      PINK_OWL_DESC,
    ]);
    const offerConfig = buildGiftCard(OFFER_URL, 'Pink Owl Offer', [
      PINK_OWL_DESC,
    ]);
    const result = pickSendAccount({
      decodedBolt11: buildBolt11({ amountSat: 1000 }),
      accounts: [offer, giftCard],
      giftCards: [giftCardConfig, offerConfig],
    });
    expect(result).toBe(giftCard);
  });

  test('returns null when all candidates have insufficient balance', () => {
    const offer = buildCashuAccount(OFFER_URL, 'offer', 'BTC', 100);
    const giftCard = buildCashuAccount(PINK_OWL_URL, 'gift-card', 'BTC', 200);
    const giftCardConfig = buildGiftCard(PINK_OWL_URL, 'Pink Owl Coffee', [
      PINK_OWL_DESC,
    ]);
    const offerConfig = buildGiftCard(OFFER_URL, 'Pink Owl Offer', [
      PINK_OWL_DESC,
    ]);
    const result = pickSendAccount({
      decodedBolt11: buildBolt11({ amountSat: 5000 }),
      accounts: [offer, giftCard],
      giftCards: [giftCardConfig, offerConfig],
    });
    expect(result).toBeNull();
  });

  test('skips USD candidates', () => {
    const usdGiftCard = buildCashuAccount(
      PINK_OWL_URL,
      'gift-card',
      'USD',
      1_000_000,
    );
    const result = pickSendAccount({
      decodedBolt11: buildBolt11(),
      accounts: [usdGiftCard],
      giftCards: [PINK_OWL_GIFT],
    });
    expect(result).toBeNull();
  });

  test('skips accounts at mints with no validPaymentDestinations config', () => {
    const noConfigCard: GiftCardInfo = {
      url: PINK_OWL_URL,
      name: 'Pink Owl Coffee',
      currency: 'BTC',
      isDiscoverable: true,
      image: '',
    } as GiftCardInfo;
    const account = buildCashuAccount(PINK_OWL_URL, 'gift-card', 'BTC', 5000);
    const result = pickSendAccount({
      decodedBolt11: buildBolt11(),
      accounts: [account],
      giftCards: [noConfigCard],
    });
    expect(result).toBeNull();
  });

  test('picks first BTC offer when multiple offers match', () => {
    const offerA = buildCashuAccount(OFFER_URL, 'offer', 'BTC', 5000);
    const offerB = buildCashuAccount(`${OFFER_URL}-2`, 'offer', 'BTC', 5000);
    const config = buildGiftCard(OFFER_URL, 'Pink Owl Offer', [PINK_OWL_DESC]);
    const configB = buildGiftCard(`${OFFER_URL}-2`, 'Pink Owl Offer 2', [
      PINK_OWL_DESC,
    ]);
    const result = pickSendAccount({
      decodedBolt11: buildBolt11(),
      accounts: [offerA, offerB],
      giftCards: [config, configB],
    });
    expect(result).toBe(offerA);
  });
});
