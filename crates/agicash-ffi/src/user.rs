//! FFI user value type.
//!
//! Mirrors `agicash_domain::User` but exposes only the fields the iOS UI
//! actually needs today: the user id, the per-currency default account
//! slots, and the user's default currency. All UUID fields are stringified
//! at the boundary so Swift can compare them against `AccountFfi.id`
//! without needing a UUID type.
//!
//! The web tracks the same trio on its `User` type
//! (`app/features/user/user.ts` + `user-repository.ts`); the iOS-side
//! `WalletViewModel` mirrors the web's `useDefaultAccount` /
//! `isDefaultAccount` derivations off of it.

use agicash_domain::User;

#[derive(Debug, Clone, uniffi::Record)]
pub struct UserFfi {
    /// Stringified UUID for the user row.
    pub id: String,
    /// User's default BTC account id, or `None` if no BTC default is set.
    /// Stringified UUID. Matches `wallet.users.default_btc_account_id`.
    pub default_btc_account_id: Option<String>,
    /// User's default USD account id, or `None` if no USD default is set.
    pub default_usd_account_id: Option<String>,
    /// One of `"BTC"`, `"USD"`, `"USDB"`. The currency the user has
    /// picked as their "primary" — drives which default slot the
    /// home/send screens consult by default. Mirrors
    /// `wallet.users.default_currency`.
    pub default_currency: String,
}

impl From<User> for UserFfi {
    fn from(u: User) -> Self {
        Self {
            id: u.id.to_string(),
            default_btc_account_id: u.default_btc_account_id.map(|id| id.to_string()),
            default_usd_account_id: u.default_usd_account_id.map(|id| id.to_string()),
            default_currency: u.default_currency.to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use agicash_domain::{AccountId, Currency, UserId};
    use chrono::Utc;
    use uuid::Uuid;

    fn user_with_defaults(
        btc: Option<AccountId>,
        usd: Option<AccountId>,
        currency: Currency,
    ) -> User {
        User {
            id: UserId::from(Uuid::new_v4()),
            created_at: Utc::now(),
            email: None,
            email_verified: false,
            username: "user".into(),
            default_btc_account_id: btc,
            default_usd_account_id: usd,
            default_currency: currency,
            cashu_locking_xpub: "xpub".into(),
            encryption_public_key: "enc".into(),
            spark_identity_public_key: "spark".into(),
            terms_accepted_at: None,
            gift_card_mint_terms_accepted_at: None,
        }
    }

    #[test]
    fn user_ffi_serializes_optional_accounts_as_strings() {
        let btc_id = AccountId::from(Uuid::new_v4());
        let usd_id = AccountId::from(Uuid::new_v4());
        let u = user_with_defaults(Some(btc_id), Some(usd_id), Currency::Btc);
        let ffi: UserFfi = u.into();
        assert_eq!(ffi.default_btc_account_id.as_deref(), Some(btc_id.to_string().as_str()));
        assert_eq!(ffi.default_usd_account_id.as_deref(), Some(usd_id.to_string().as_str()));
        assert_eq!(ffi.default_currency, "BTC");
    }

    #[test]
    fn user_ffi_handles_none_defaults() {
        // A freshly-created user with no accounts assigned to either slot.
        let u = user_with_defaults(None, None, Currency::Btc);
        let ffi: UserFfi = u.into();
        assert!(ffi.default_btc_account_id.is_none());
        assert!(ffi.default_usd_account_id.is_none());
        assert_eq!(ffi.default_currency, "BTC");
    }

    #[test]
    fn user_ffi_default_currency_usd_round_trips() {
        let u = user_with_defaults(None, None, Currency::Usd);
        let ffi: UserFfi = u.into();
        assert_eq!(ffi.default_currency, "USD");
    }
}
