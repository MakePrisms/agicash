import type { Token } from '@cashu/cashu-ts';
import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import {
  areMintUrlsEqual,
  getCashuProtocolUnit,
  getCashuUnit,
  getCashuWallet,
} from '~/lib/cashu';
import type { Currency } from '~/lib/money';
import type {
  ExtendedAccount,
  ExtendedCashuAccount,
} from '../accounts/account';
import {
  allMintKeysetsQueryOptions,
  cashuMintValidator,
  isTestMintQueryOptions,
  mintInfoQueryOptions,
  mintKeysQueryOptions,
  tokenToMoney,
} from '../shared/cashu';
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
    const [info, keysets, keys, isTestMint] = await Promise.all([
      this.queryClient.fetchQuery(mintInfoQueryOptions(mintUrl)),
      this.queryClient.fetchQuery(allMintKeysetsQueryOptions(mintUrl)),
      this.queryClient.fetchQuery(mintKeysQueryOptions(mintUrl)),
      this.queryClient.fetchQuery(isTestMintQueryOptions(mintUrl)),
    ]);

    const unit = getCashuProtocolUnit(currency);
    const validationResult = cashuMintValidator(
      mintUrl,
      unit,
      info,
      keysets.keysets,
    );

    const unitKeysets = keysets.keysets.filter((ks) => ks.unit === unit);
    const activeKeyset = unitKeysets.find((ks) => ks.active);

    if (!activeKeyset) {
      throw new Error(`No active keyset found for ${currency} on ${mintUrl}`);
    }

    const activeKeysForUnit = keys.keysets.find(
      (ks) => ks.id === activeKeyset.id,
    );

    if (!activeKeysForUnit) {
      throw new Error(
        `Got active keyset ${activeKeyset.id} from ${mintUrl} but could not find keys for it`,
      );
    }

    const wallet = getCashuWallet(mintUrl, {
      unit: getCashuUnit(currency),
      mintInfo: info,
      keys: activeKeysForUnit,
      keysets: unitKeysets,
    });

    wallet.keysetId = activeKeyset.id;

    const isValid = validationResult === true;
    return {
      id: 'cashu-account-placeholder-id',
      type: 'cashu',
      mintUrl,
      createdAt: new Date().toISOString(),
      name: info?.name ?? mintUrl.replace('https://', ''),
      currency,
      isTestMint,
      version: 0,
      keysetCounters: {},
      proofs: [],
      isDefault: false,
      isSource: true,
      isUnknown: true,
      canReceive: isValid,
      isOnline: true,
      wallet,
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

  /**
   * Returns the default receive account, or null if the token cannot be received.
   * If the token is from a test mint, the source account will be returned if it is selectable, because tokens from test mint can only be claimed to the same mint.
   * If the token is not from a test mint, the preferred receive account will be returned if it is selectable.
   * If the preferred receive account is not selectable, the default account will be returned.
   * @param sourceAccount The source account of the token
   * @param possibleDestinationAccounts The possible destination accounts (cashu and spark)
   * @param preferredReceiveAccountId The preferred receive account id
   * @returns
   */
  static getDefaultReceiveAccount(
    sourceAccount: CashuAccountWithTokenFlags,
    possibleDestinationAccounts: ReceiveCashuTokenAccount[],
    preferredReceiveAccountId?: string,
  ): ReceiveCashuTokenAccount | null {
    if (sourceAccount.isTestMint) {
      if (!sourceAccount.canReceive) {
        return null;
      }
      // Tokens sourced from test mint can only be claimed to the same mint
      return sourceAccount;
    }

    const preferredReceiveAccount = possibleDestinationAccounts.find(
      (account) => account.id === preferredReceiveAccountId,
    );

    if (preferredReceiveAccount?.canReceive) {
      return preferredReceiveAccount;
    }

    if (sourceAccount.canReceive) {
      return sourceAccount;
    }

    const defaultAccount = possibleDestinationAccounts.find(
      (account) =>
        account.isDefault && account.currency === sourceAccount.currency,
    );

    if (!defaultAccount?.canReceive) {
      return null;
    }

    return defaultAccount;
  }

  private augmentNonSourceAccountsWithTokenFlags(
    accounts: ExtendedAccount[],
  ): ReceiveCashuTokenAccount[] {
    return accounts.map((account) => ({
      ...account,
      isSource: false,
      isUnknown: false,
      canReceive: account.type === 'spark' || !account.isTestMint,
    }));
  }

  /**
   * Returns the possible destination accounts that can receive the token from the source account.
   * If the source account is from a test mint, the only account that can receive the token is the same source account.
   * @param sourceAccount The source account of the token
   * @param otherAccounts The other user's accounts
   * @returns The possible destination accounts
   */
  private getPossibleDestinationAccounts(
    sourceAccount: CashuAccountWithTokenFlags,
    otherAccounts: ReceiveCashuTokenAccount[],
  ): ReceiveCashuTokenAccount[] {
    if (sourceAccount.isTestMint) {
      // Tokens sourced from test mint can only be claimed to the same mint
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
