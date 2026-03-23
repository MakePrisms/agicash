-- Add 'offer' to the account_purpose enum for promotional ecash accounts
alter type wallet.account_purpose add value if not exists 'offer';
