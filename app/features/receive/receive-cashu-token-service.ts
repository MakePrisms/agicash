import type { Token } from '@cashu/cashu-ts';
import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { areMintUrlsEqual, getCashuProtocolUnit } from '~/lib/cashu';
import type { Currency } from '~/lib/money';
import {
  type ExtendedAccount,
  type ExtendedCashuAccount,
  canReceiveFromLightning,
  canSendToLightning,
} from '../accounts/account';
import {
  cashuMintValidator,
  getInitializedCashuWallet,
  isTestMintQueryOptions,
  tokenToMoney,
} from '../shared/cashu';
import { getFeatureFlag } from '../shared/feature-flags';
import type {
  CashuAccountWithTokenFlags,
  ReceiveCashuTokenAccount,
} from './receive-cashu-token-models';

export class ReceiveCashuTokenService {
  constructor(private readonly queryClient: QueryClient) {}

  /**
   * Builds a cashu account object for a given mint and currency.
   * This account is not stored in the database, and has placeholder values for the id and createdAt.
   * @param mintUrl - The mint URL.
   * @param currency - The currency.
   * @returns The cashu account.
   */
  async buildAccountForMint(
    mintUrl: string,
    currency: Currency,
  ): Promise<CashuAccountWithTokenFlags> {
    const { wallet, isOnline } = await getInitializedCashuWallet(
      this.queryClient,
      mintUrl,
      currency,
      undefined,
    );

    const baseAccount = {
      id: 'cashu-account-placeholder-id',
      type: 'cashu' as const,
      purpose: wallet.purpose,
      name: mintUrl.replace('https://', '').replace('http://', ''),
      mintUrl,
      createdAt: new Date().toISOString(),
      currency,
      version: 0,
      keysetCounters: {},
      proofs: [],
      isDefault: false,
      isSource: true,
      isUnknown: true,
      wallet,
    };

    if (!isOnline) {
      return {
        ...baseAccount,
        canReceive: false,
        isOnline: false,
        isTestMint: false,
      };
    }

    const mintInfo = wallet.mintInfo;
    const unit = getCashuProtocolUnit(currency);
    const validationResult = cashuMintValidator(
      mintUrl,
      unit,
      mintInfo,
      wallet.keysets,
    );

    const isTestMint = await this.queryClient.fetchQuery(
      isTestMintQueryOptions(mintUrl),
    );

    const isValid = validationResult === true;
    const isGatedGiftCard =
      wallet.purpose === 'gift-card' && !getFeatureFlag('GIFT_CARDS');

    return {
      ...baseAccount,
      name: mintInfo.name || baseAccount.name,
      isTestMint,
      canReceive: isValid && !isGatedGiftCard,
      cannotReceiveReason: isGatedGiftCard
        ? 'Secret feature, not available yet.'
        : undefined,
      isOnline,
    };
  }

  /**
   * Gets the source account of the token and possible destination accounts that can receive the token.
   * @param token - The token to get the source and destination accounts for.
   * @param accounts - User's existing accounts.
   * @returns The source account and the possible destination accounts.
   */
  async getSourceAndDestinationAccounts(
    token: Token,
    accounts: ExtendedAccount[] = [],
  ): Promise<{
    sourceAccount: CashuAccountWithTokenFlags;
    possibleDestinationAccounts: ReceiveCashuTokenAccount[];
  }> {
    const tokenCurrency = tokenToMoney(token).currency;
    const existingCashuAccount = accounts.find(
      (a): a is ExtendedCashuAccount =>
        a.type === 'cashu' &&
        areMintUrlsEqual(a.mintUrl, token.mint) &&
        a.currency === tokenCurrency,
    );

    if (existingCashuAccount) {
      const isGatedGiftCard =
        existingCashuAccount.purpose === 'gift-card' &&
        !getFeatureFlag('GIFT_CARDS');
      const sourceAccount = {
        ...existingCashuAccount,
        isSource: true,
        isUnknown: false,
        canReceive: !isGatedGiftCard,
        cannotReceiveReason: isGatedGiftCard
          ? 'Secret feature, not available yet.'
          : undefined,
      };
      return {
        sourceAccount,
        possibleDestinationAccounts: this.getPossibleDestinationAccounts(
          sourceAccount,
          this.augmentNonSourceAccountsWithTokenFlags(
            accounts.filter((account) => account.id !== sourceAccount.id),
          ),
        ),
      };
    }

    const sourceAccount = await this.buildAccountForMint(
      token.mint,
      tokenCurrency,
    );

    return {
      sourceAccount,
      possibleDestinationAccounts: this.getPossibleDestinationAccounts(
        sourceAccount,
        this.augmentNonSourceAccountsWithTokenFlags(accounts),
      ),
    };
  }

  /**
   * Returns the default receive account, or null if the token cannot be received.
   * If the token is from a test mint or gift card, the source account will be returned if it is selectable.
   * If the token is not from a test mint or gift card, the preferred receive account will be returned if it is selectable.
   * If the preferred receive account is not selectable, the default account will be returned.
   * @param sourceAccount The source account of the token
   * @param possibleDestinationAccounts The possible destination accounts (cashu and spark)
   * @param preferredReceiveAccountId The preferred receive account id
   * @returns The default account to receive the token, or null if none available
   */
  static getDefaultReceiveAccount(
    sourceAccount: CashuAccountWithTokenFlags,
    possibleDestinationAccounts: ReceiveCashuTokenAccount[],
    preferredReceiveAccountId?: string,
  ): ReceiveCashuTokenAccount | null {
    if (!canSendToLightning(sourceAccount)) {
      return sourceAccount.canReceive ? sourceAccount : null;
    }

    const preferredReceiveAccount = possibleDestinationAccounts.find(
      (account) => account.id === preferredReceiveAccountId,
    );

    if (preferredReceiveAccount?.canReceive) {
      return preferredReceiveAccount;
    }

    const defaultAccount = possibleDestinationAccounts.find(
      (account) =>
        account.isDefault && account.currency === sourceAccount.currency,
    );

    if (defaultAccount?.canReceive) {
      return defaultAccount;
    }

    if (sourceAccount.canReceive) {
      return sourceAccount;
    }

    return null;
  }

  private augmentNonSourceAccountsWithTokenFlags(
    accounts: ExtendedAccount[],
  ): ReceiveCashuTokenAccount[] {
    return accounts.map((account) => ({
      ...account,
      isSource: false,
      isUnknown: false,
      canReceive: canReceiveFromLightning(account),
    }));
  }

  /**
   * Returns the possible destination accounts that can receive the token from the source account.
   * If the source account is from a test mint or is a gift card account, the only account that
   * can receive the token is the same source account.
   * @param sourceAccount The source account of the token
   * @param otherAccounts The other user's accounts
   * @returns The possible destination accounts
   */
  private getPossibleDestinationAccounts(
    sourceAccount: CashuAccountWithTokenFlags,
    otherAccounts: ReceiveCashuTokenAccount[],
  ): ReceiveCashuTokenAccount[] {
    if (!canSendToLightning(sourceAccount)) {
      return sourceAccount.canReceive ? [sourceAccount] : [];
    }
    return [sourceAccount, ...otherAccounts].filter(
      (account) => account.canReceive,
    );
  }
}

export function useReceiveCashuTokenService() {
  const queryClient = useQueryClient();
  return new ReceiveCashuTokenService(queryClient);
}
