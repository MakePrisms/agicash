import { describe, expect, test } from 'bun:test';
import { type DecodedBolt11, decodeBolt11 } from '@agicash/bolt11';
import type { CashuAccount } from '@agicash/wallet-sdk';
import type { GiftCardInfo } from '~/features/gift-cards/gift-card-config';
import { findMatchingOfferOrGiftCardAccount } from './find-matching-offer-or-gift-card-account';

const PINK_OWL_URL = 'https://pinkowl.agi.cash';
const PINK_OWL_DESC = 'Pink Owl Coffee';
const PINK_OWL_PUBKEY =
  '02eadbd9e7557375161df8b646776a547c5cbc2e95b3071ec81553f8ec2cea3b8c';
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
  payeeNodeKey: '00'.repeat(33),
  paymentHash: 'deadbeef',
  ...overrides,
});

const buildGiftCard = (opts: {
  url: string;
  name?: string;
  purpose?: 'gift-card' | 'offer';
  validPaymentDestinations?: { descriptions: string[]; nodePubkeys: string[] };
}): GiftCardInfo => ({
  url: opts.url,
  name: opts.name ?? opts.url,
  currency: 'BTC',
  purpose: opts.purpose ?? 'gift-card',
  isDiscoverable: true,
  image: '',
  ogImage: undefined,
  validPaymentDestinations: opts.validPaymentDestinations,
});

const buildCashuAccount = (opts: {
  mintUrl: string;
  purpose: 'gift-card' | 'offer' | 'transactional';
  currency?: 'BTC' | 'USD';
  balance: number;
}): CashuAccount =>
  ({
    id: `cashu-${opts.mintUrl}-${opts.purpose}-${opts.currency ?? 'BTC'}-${opts.balance}`,
    name: `test-${opts.purpose}`,
    type: 'cashu',
    purpose: opts.purpose,
    state: 'active',
    isOnline: true,
    currency: opts.currency ?? 'BTC',
    createdAt: '2026-01-01T00:00:00Z',
    version: 1,
    expiresAt: null,
    mintUrl: opts.mintUrl,
    isTestMint: false,
    keysetCounters: {},
    proofs: opts.balance > 0 ? [{ amount: opts.balance }] : [],
    wallet: {} as never,
  }) as unknown as CashuAccount;

describe('findMatchingOfferOrGiftCardAccount', () => {
  test('matches by description', () => {
    const giftCard = buildCashuAccount({
      mintUrl: PINK_OWL_URL,
      purpose: 'gift-card',
      balance: 5000,
    });
    const result = findMatchingOfferOrGiftCardAccount({
      decodedBolt11: buildBolt11({ description: PINK_OWL_DESC }),
      accounts: [giftCard],
      giftCards: [
        buildGiftCard({
          url: PINK_OWL_URL,
          validPaymentDestinations: {
            descriptions: [PINK_OWL_DESC],
            nodePubkeys: [],
          },
        }),
      ],
    });
    expect(result).toBe(giftCard);
  });

  test('matches by payee pubkey when invoice has no description', () => {
    const giftCard = buildCashuAccount({
      mintUrl: PINK_OWL_URL,
      purpose: 'gift-card',
      balance: 5000,
    });
    const result = findMatchingOfferOrGiftCardAccount({
      decodedBolt11: buildBolt11({
        description: undefined,
        payeeNodeKey: PINK_OWL_PUBKEY,
      }),
      accounts: [giftCard],
      giftCards: [
        buildGiftCard({
          url: PINK_OWL_URL,
          validPaymentDestinations: {
            descriptions: [],
            nodePubkeys: [PINK_OWL_PUBKEY],
          },
        }),
      ],
    });
    expect(result).toBe(giftCard);
  });

  test('matches when both description and pubkey are configured and both match', () => {
    const giftCard = buildCashuAccount({
      mintUrl: PINK_OWL_URL,
      purpose: 'gift-card',
      balance: 5000,
    });
    const result = findMatchingOfferOrGiftCardAccount({
      decodedBolt11: buildBolt11({
        description: PINK_OWL_DESC,
        payeeNodeKey: PINK_OWL_PUBKEY,
      }),
      accounts: [giftCard],
      giftCards: [
        buildGiftCard({
          url: PINK_OWL_URL,
          validPaymentDestinations: {
            descriptions: [PINK_OWL_DESC],
            nodePubkeys: [PINK_OWL_PUBKEY],
          },
        }),
      ],
    });
    expect(result).toBe(giftCard);
  });

  test('returns null when both are configured but only description matches', () => {
    const result = findMatchingOfferOrGiftCardAccount({
      decodedBolt11: buildBolt11({
        description: PINK_OWL_DESC,
        payeeNodeKey: '01'.repeat(33),
      }),
      accounts: [
        buildCashuAccount({
          mintUrl: PINK_OWL_URL,
          purpose: 'gift-card',
          balance: 5000,
        }),
      ],
      giftCards: [
        buildGiftCard({
          url: PINK_OWL_URL,
          validPaymentDestinations: {
            descriptions: [PINK_OWL_DESC],
            nodePubkeys: [PINK_OWL_PUBKEY],
          },
        }),
      ],
    });
    expect(result).toBeNull();
  });

  test('returns null when both are configured but only pubkey matches', () => {
    const result = findMatchingOfferOrGiftCardAccount({
      decodedBolt11: buildBolt11({
        description: 'Some other merchant',
        payeeNodeKey: PINK_OWL_PUBKEY,
      }),
      accounts: [
        buildCashuAccount({
          mintUrl: PINK_OWL_URL,
          purpose: 'gift-card',
          balance: 5000,
        }),
      ],
      giftCards: [
        buildGiftCard({
          url: PINK_OWL_URL,
          validPaymentDestinations: {
            descriptions: [PINK_OWL_DESC],
            nodePubkeys: [PINK_OWL_PUBKEY],
          },
        }),
      ],
    });
    expect(result).toBeNull();
  });

  test('returns null when neither description nor payee pubkey match the config', () => {
    const result = findMatchingOfferOrGiftCardAccount({
      decodedBolt11: buildBolt11({
        description: 'Some other merchant',
        payeeNodeKey: '01'.repeat(33),
      }),
      accounts: [
        buildCashuAccount({
          mintUrl: PINK_OWL_URL,
          purpose: 'gift-card',
          balance: 5000,
        }),
      ],
      giftCards: [
        buildGiftCard({
          url: PINK_OWL_URL,
          validPaymentDestinations: {
            descriptions: [PINK_OWL_DESC],
            nodePubkeys: [PINK_OWL_PUBKEY],
          },
        }),
      ],
    });
    expect(result).toBeNull();
  });

  test('returns null when no account exists at the matching mint', () => {
    const result = findMatchingOfferOrGiftCardAccount({
      decodedBolt11: buildBolt11({ description: PINK_OWL_DESC }),
      accounts: [],
      giftCards: [
        buildGiftCard({
          url: PINK_OWL_URL,
          validPaymentDestinations: {
            descriptions: [PINK_OWL_DESC],
            nodePubkeys: [],
          },
        }),
      ],
    });
    expect(result).toBeNull();
  });

  test('skips accounts at mints with no validPaymentDestinations config', () => {
    const account = buildCashuAccount({
      mintUrl: PINK_OWL_URL,
      purpose: 'gift-card',
      balance: 5000,
    });
    const result = findMatchingOfferOrGiftCardAccount({
      decodedBolt11: buildBolt11({ description: PINK_OWL_DESC }),
      accounts: [account],
      giftCards: [buildGiftCard({ url: PINK_OWL_URL })],
    });
    expect(result).toBeNull();
  });

  test('skips USD accounts (BOLT11 melts are BTC)', () => {
    const usdGiftCard = buildCashuAccount({
      mintUrl: PINK_OWL_URL,
      purpose: 'gift-card',
      currency: 'USD',
      balance: 1_000_000,
    });
    const result = findMatchingOfferOrGiftCardAccount({
      decodedBolt11: buildBolt11({ description: PINK_OWL_DESC }),
      accounts: [usdGiftCard],
      giftCards: [
        buildGiftCard({
          url: PINK_OWL_URL,
          validPaymentDestinations: {
            descriptions: [PINK_OWL_DESC],
            nodePubkeys: [],
          },
        }),
      ],
    });
    expect(result).toBeNull();
  });

  describe('balance handling', () => {
    test('matches when invoice has no amount and account has positive balance', () => {
      const giftCard = buildCashuAccount({
        mintUrl: PINK_OWL_URL,
        purpose: 'gift-card',
        balance: 5000,
      });
      const result = findMatchingOfferOrGiftCardAccount({
        decodedBolt11: buildBolt11({
          description: PINK_OWL_DESC,
          amountSat: undefined,
          amountMsat: undefined,
        }),
        accounts: [giftCard],
        giftCards: [
          buildGiftCard({
            url: PINK_OWL_URL,
            validPaymentDestinations: {
              descriptions: [PINK_OWL_DESC],
              nodePubkeys: [],
            },
          }),
        ],
      });
      expect(result).toBe(giftCard);
    });

    test('returns null when invoice has no amount and account is empty', () => {
      const empty = buildCashuAccount({
        mintUrl: PINK_OWL_URL,
        purpose: 'gift-card',
        balance: 0,
      });
      const result = findMatchingOfferOrGiftCardAccount({
        decodedBolt11: buildBolt11({
          description: PINK_OWL_DESC,
          amountSat: undefined,
          amountMsat: undefined,
        }),
        accounts: [empty],
        giftCards: [
          buildGiftCard({
            url: PINK_OWL_URL,
            validPaymentDestinations: {
              descriptions: [PINK_OWL_DESC],
              nodePubkeys: [],
            },
          }),
        ],
      });
      expect(result).toBeNull();
    });

    test('returns null when all candidates have insufficient balance', () => {
      const offer = buildCashuAccount({
        mintUrl: OFFER_URL,
        purpose: 'offer',
        balance: 100,
      });
      const giftCard = buildCashuAccount({
        mintUrl: PINK_OWL_URL,
        purpose: 'gift-card',
        balance: 200,
      });
      const result = findMatchingOfferOrGiftCardAccount({
        decodedBolt11: buildBolt11({
          description: PINK_OWL_DESC,
          amountSat: 5000,
        }),
        accounts: [offer, giftCard],
        giftCards: [
          buildGiftCard({
            url: PINK_OWL_URL,
            validPaymentDestinations: {
              descriptions: [PINK_OWL_DESC],
              nodePubkeys: [],
            },
          }),
          buildGiftCard({
            url: OFFER_URL,
            validPaymentDestinations: {
              descriptions: [PINK_OWL_DESC],
              nodePubkeys: [],
            },
          }),
        ],
      });
      expect(result).toBeNull();
    });
  });

  describe('priority', () => {
    test('picks offer over gift-card when both match and have sufficient balance', () => {
      const giftCard = buildCashuAccount({
        mintUrl: PINK_OWL_URL,
        purpose: 'gift-card',
        balance: 5000,
      });
      const offer = buildCashuAccount({
        mintUrl: OFFER_URL,
        purpose: 'offer',
        balance: 5000,
      });
      const result = findMatchingOfferOrGiftCardAccount({
        decodedBolt11: buildBolt11({ description: PINK_OWL_DESC }),
        accounts: [giftCard, offer],
        giftCards: [
          buildGiftCard({
            url: PINK_OWL_URL,
            validPaymentDestinations: {
              descriptions: [PINK_OWL_DESC],
              nodePubkeys: [],
            },
          }),
          buildGiftCard({
            url: OFFER_URL,
            validPaymentDestinations: {
              descriptions: [PINK_OWL_DESC],
              nodePubkeys: [],
            },
          }),
        ],
      });
      expect(result).toBe(offer);
    });

    test('falls through to gift-card when offer has insufficient balance', () => {
      const offer = buildCashuAccount({
        mintUrl: OFFER_URL,
        purpose: 'offer',
        balance: 100,
      });
      const giftCard = buildCashuAccount({
        mintUrl: PINK_OWL_URL,
        purpose: 'gift-card',
        balance: 5000,
      });
      const result = findMatchingOfferOrGiftCardAccount({
        decodedBolt11: buildBolt11({
          description: PINK_OWL_DESC,
          amountSat: 1000,
        }),
        accounts: [offer, giftCard],
        giftCards: [
          buildGiftCard({
            url: PINK_OWL_URL,
            validPaymentDestinations: {
              descriptions: [PINK_OWL_DESC],
              nodePubkeys: [],
            },
          }),
          buildGiftCard({
            url: OFFER_URL,
            validPaymentDestinations: {
              descriptions: [PINK_OWL_DESC],
              nodePubkeys: [],
            },
          }),
        ],
      });
      expect(result).toBe(giftCard);
    });

    test('picks the first matching offer when multiple offers qualify', () => {
      const offerA = buildCashuAccount({
        mintUrl: OFFER_URL,
        purpose: 'offer',
        balance: 5000,
      });
      const offerB = buildCashuAccount({
        mintUrl: `${OFFER_URL}-2`,
        purpose: 'offer',
        balance: 5000,
      });
      const result = findMatchingOfferOrGiftCardAccount({
        decodedBolt11: buildBolt11({ description: PINK_OWL_DESC }),
        accounts: [offerA, offerB],
        giftCards: [
          buildGiftCard({
            url: OFFER_URL,
            validPaymentDestinations: {
              descriptions: [PINK_OWL_DESC],
              nodePubkeys: [],
            },
          }),
          buildGiftCard({
            url: `${OFFER_URL}-2`,
            validPaymentDestinations: {
              descriptions: [PINK_OWL_DESC],
              nodePubkeys: [],
            },
          }),
        ],
      });
      expect(result).toBe(offerA);
    });
  });

  describe('integration with decodeBolt11', () => {
    test('matches a real Square invoice by recovered payee pubkey', () => {
      const SQUARE_URL = 'https://square.agi.cash';
      const SQUARE_PUBKEY =
        '02372c5d8559e4c0d3943b0e86360207491cb8ac669b7def06427860e566771828';
      const squareInvoice =
        'LNBC140N1P5C5EK3DQVG9NKJCMPWD5QPP5FH80A2FEYQGSLDHG9RGQGXPHQ5UK84TQ3G5RLQRJM9YKEPZFXCCSSP5HHLX69PEFNPUS9CSTJ7KY38WGHY83JHU35HRKEYDDKF37SQ5HE2S9QRSGQCQPCXQZFVRZJQDEPFKU9FNG2PS0V74MUP5T5TGFJ9XP2WLNZWTYCUHAY4G0FFCNT7ZXQK5QQ0TQQQQQQQQQQQQQQQQQQ9GRZJQVSMG807VRGZKPFJXCAG7FD43XCF50ZWRR7XNXFQWL6QEAYT0M7LXZQHKGQQXMCQQGQQQQQQQQQQQQQQ9G3XYWYGTDHKTALS3GJZDL0WPDCR3MPNLDUHHT94Y8FCS6ATY8T78R6V7MCZWXZ5C4T6FPDKVSFY35EUSNZPJFVQH58ZSMYC6J3Z22K7QPMRWCRK';

      const giftCard = buildCashuAccount({
        mintUrl: SQUARE_URL,
        purpose: 'gift-card',
        balance: 5000,
      });
      const result = findMatchingOfferOrGiftCardAccount({
        decodedBolt11: decodeBolt11(squareInvoice).decoded,
        accounts: [giftCard],
        giftCards: [
          buildGiftCard({
            url: SQUARE_URL,
            validPaymentDestinations: {
              descriptions: [],
              nodePubkeys: [SQUARE_PUBKEY],
            },
          }),
        ],
      });
      expect(result).toBe(giftCard);
    });
  });
});
