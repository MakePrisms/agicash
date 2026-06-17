import {
  type MintValidator,
  areMintUrlsEqual,
  checkIsTestMint,
  findFirstActiveKeyset,
  getCashuProtocolUnit,
  getKeysetExpiry,
} from '@agicash/cashu';
import type { Currency } from '@agicash/utils/money';
import type { Token } from '@cashu/cashu-ts';
import type { QueryClient } from '@tanstack/query-core';
import {
  type ExtendedAccount,
  type ExtendedCashuAccount,
  canReceiveFromLightning,
  canSendToLightning,
} from '../accounts/account';
import { getInitializedCashuWallet, tokenToMoney } from '../cashu';
import type {
  CashuAccountWithTokenFlags,
  ReceiveCashuTokenAccount,
} from './receive-cashu-token-models';

export class ReceiveCashuTokenService {
  constructor(
    private readonly queryClient: QueryClient,
    private readonly cashuMintValidator: MintValidator,
  ) {}

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
    const { wallet, isOnline } = await getInitializedCashuWallet({
      queryClient: this.queryClient,
      mintUrl,
      currency,
    });

    let expiresAt: string | null = null;
    if (wallet.purpose === 'offer') {
      const activeKeyset = findFirstActiveKeyset(
        wallet.keyChain.getKeysets(),
        currency,
      );
      if (activeKeyset) {
        expiresAt = getKeysetExpiry(activeKeyset)?.toISOString() ?? null;
      }
    }

    const isExpired = expiresAt !== null && new Date(expiresAt) <= new Date();

    const baseAccount = {
      id: 'cashu-account-placeholder-id',
      type: 'cashu' as const,
      purpose: wallet.purpose,
      state: isExpired ? ('expired' as const) : ('active' as const),
      name: mintUrl.replace('https://', '').replace('http://', ''),
      mintUrl,
      createdAt: new Date().toISOString(),
      currency,
      version: 0,
      keysetCounters: {},
      expiresAt,
      proofs: [],
      isDefault: false,
      isSource: true,
      isUnknown: true,
      wallet,
    };

    if (!isOnline || isExpired) {
      return {
        ...baseAccount,
        canReceive: false,
        cannotReceiveReason: isExpired ? 'This offer has expired' : undefined,
        isOnline,
        isTestMint: false,
      };
    }

    const mintInfo = wallet.getMintInfo();
    const unit = getCashuProtocolUnit(currency);
    const validationResult = this.cashuMintValidator(
      mintUrl,
      unit,
      mintInfo,
      wallet.keyChain.getKeysets().map((ks) => ks.toMintKeyset()),
    );

    const isTestMint = checkIsTestMint(mintUrl);

    const isValid = validationResult === true;

    return {
      ...baseAccount,
      name: mintInfo.name || baseAccount.name,
      isTestMint,
      canReceive: isValid,
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
      const sourceAccount = {
        ...existingCashuAccount,
        isSource: true,
        isUnknown: false,
        canReceive: true,
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
