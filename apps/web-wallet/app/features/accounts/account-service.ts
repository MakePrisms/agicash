// The AccountService class moved to @agicash/wallet-sdk; the re-export is
// removed in the import-cleanup PR. App code interacts with accounts through
// the curated sdk.accounts methods (e.g. sdk.accounts.add), so there is no
// service hook anymore.
export * from '@agicash/wallet-sdk/accounts/account-service';
