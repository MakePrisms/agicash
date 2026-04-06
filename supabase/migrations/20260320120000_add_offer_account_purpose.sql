-- Add 'offer' to the account_purpose enum for promotional ecash accounts
alter type wallet.account_purpose add value if not exists 'offer';

-- Add expires_at column for keyset-based expiry (offer accounts)
alter table wallet.accounts add column if not exists expires_at timestamptz;
