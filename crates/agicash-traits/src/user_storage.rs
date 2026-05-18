use crate::StorageError;
use agicash_domain::{Account, AccountId, AccountPurpose, AccountType, Currency, User, UserId};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};

/// Patch shape for `UserStorage::update_user_defaults`. Each field is
/// "leave unchanged" when `None`, and "set to this value" when `Some`.
/// `default_btc_account_id` / `default_usd_account_id` further support
/// "clear" by passing `Some(None)` — useful if the underlying account is
/// deleted. (Pass `None` at the outer Option to leave the slot alone.)
///
/// Mirrors the partial update the web app does in
/// `app/features/user/user-repository.ts` (`WriteUserRepository.update`) — it
/// `PATCH`es the `wallet.users` row with whichever of `default_btc_account_id`,
/// `default_usd_account_id`, `default_currency` the caller supplied.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct UpdateUserDefaults {
    /// Outer `Option`: present? Inner `Option`: set value (Some) or null
    /// it out (None). Use the `set_*` constructors below for clarity.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_btc_account_id: Option<Option<AccountId>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_usd_account_id: Option<Option<AccountId>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_currency: Option<Currency>,
}

/// Element of `p_accounts` in `wallet.upsert_user_with_accounts`.
/// Field order matches the `wallet.account_input` composite type.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AccountInput {
    #[serde(rename = "type")]
    pub account_type: AccountType,
    pub purpose: AccountPurpose,
    pub currency: Currency,
    pub name: String,
    pub details: serde_json::Value,
    pub is_default: bool,
}

/// Input shape for `UserStorage::upsert_user_with_accounts`.
///
/// Field names use the `p_*` prefix to match the Postgres function's parameter
/// names; postgrest serializes the struct directly as the RPC body.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UpsertUserInput {
    #[serde(rename = "p_user_id")]
    pub user_id: UserId,
    #[serde(rename = "p_email")]
    pub email: Option<String>,
    #[serde(rename = "p_email_verified")]
    pub email_verified: bool,
    #[serde(rename = "p_accounts")]
    pub accounts: Vec<AccountInput>,
    #[serde(rename = "p_cashu_locking_xpub")]
    pub cashu_locking_xpub: String,
    #[serde(rename = "p_encryption_public_key")]
    pub encryption_public_key: String,
    #[serde(rename = "p_spark_identity_public_key")]
    pub spark_identity_public_key: String,
    #[serde(
        rename = "p_terms_accepted_at",
        skip_serializing_if = "Option::is_none"
    )]
    pub terms_accepted_at: Option<chrono::DateTime<chrono::Utc>>,
    #[serde(
        rename = "p_gift_card_mint_terms_accepted_at",
        skip_serializing_if = "Option::is_none"
    )]
    pub gift_card_mint_terms_accepted_at: Option<chrono::DateTime<chrono::Utc>>,
}

/// Output of `UserStorage::upsert_user_with_accounts`.
/// Postgres composite `wallet.upsert_user_with_accounts_result` is shaped
/// `{ "user": <users row>, "accounts": [<accounts rows>] }` when REST-encoded.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UpsertUserResult {
    pub user: User,
    pub accounts: Vec<Account>,
}

#[async_trait]
pub trait UserStorage: Send + Sync {
    /// Real Supabase RPC: `wallet.upsert_user_with_accounts`. Idempotent on
    /// `user_id`; safe to call repeatedly. Returns the resulting user row plus
    /// all of that user's accounts.
    async fn upsert_user_with_accounts(
        &self,
        input: UpsertUserInput,
    ) -> Result<UpsertUserResult, StorageError>;

    /// Direct postgrest select on `wallet.users` by id. Returns `Ok(None)` if
    /// the user row doesn't exist (e.g., guest hasn't been upserted yet).
    async fn get_user(&self, user_id: UserId) -> Result<Option<User>, StorageError>;

    /// Direct postgrest select on `wallet.accounts` filtered by
    /// `user_id = <uuid>` AND `state = 'active'`. Returns rows in postgrest's
    /// natural order (server-defined). Callers that need a stable order should
    /// sort client-side.
    async fn list_accounts(&self, user_id: UserId) -> Result<Vec<Account>, StorageError>;

    /// Direct postgrest select on `wallet.accounts` by id. Returns `Ok(None)`
    /// if no row matches. Does NOT filter by state — expired accounts are
    /// still readable via this method.
    async fn get_account(&self, account_id: AccountId) -> Result<Option<Account>, StorageError>;

    /// Partial PATCH on `wallet.users` for the per-currency default slots
    /// and/or the default currency. Mirrors the web's
    /// `WriteUserRepository.update` shape: only the fields whose patch
    /// values are `Some(_)` get written; the rest stay as-is.
    ///
    /// Returns the updated user row so callers can immediately surface the
    /// new state (web does the same via Supabase `.select().single()`).
    /// Errors with `StorageError::NotFound` if the user_id has no row.
    async fn update_user_defaults(
        &self,
        user_id: UserId,
        patch: UpdateUserDefaults,
    ) -> Result<User, StorageError>;
}

#[cfg(test)]
mod types_tests {
    use super::*;
    use serde_json::json;
    use uuid::Uuid;

    #[test]
    fn account_input_serializes_with_snake_case_fields() {
        let input = AccountInput {
            account_type: AccountType::Spark,
            purpose: AccountPurpose::Transactional,
            currency: Currency::Btc,
            name: "Lightning".into(),
            details: json!({"network": "MAINNET"}),
            is_default: true,
        };
        let v = serde_json::to_value(&input).unwrap();
        assert_eq!(v.get("type").and_then(|v| v.as_str()), Some("spark"));
        assert_eq!(
            v.get("purpose").and_then(|v| v.as_str()),
            Some("transactional")
        );
        assert_eq!(v.get("currency").and_then(|v| v.as_str()), Some("BTC"));
        assert_eq!(v.get("name").and_then(|v| v.as_str()), Some("Lightning"));
        assert_eq!(
            v.get("is_default").and_then(serde_json::Value::as_bool),
            Some(true)
        );
        assert!(v.get("details").unwrap().is_object());
    }

    #[test]
    fn upsert_user_input_serializes_with_p_prefixed_params() {
        let input = UpsertUserInput {
            user_id: UserId::from(Uuid::nil()),
            email: Some("u@example.com".into()),
            email_verified: true,
            accounts: vec![AccountInput {
                account_type: AccountType::Spark,
                purpose: AccountPurpose::Transactional,
                currency: Currency::Btc,
                name: "Lightning".into(),
                details: json!({"network": "MAINNET"}),
                is_default: true,
            }],
            cashu_locking_xpub: "xpub6...".into(),
            encryption_public_key: "schnorr-pub".into(),
            spark_identity_public_key: "spark-pub".into(),
            terms_accepted_at: None,
            gift_card_mint_terms_accepted_at: None,
        };
        let v = serde_json::to_value(&input).unwrap();
        // postgrest RPC body uses the function's parameter names verbatim,
        // which are prefixed with p_ in our schema.
        assert!(v.get("p_user_id").is_some());
        assert!(v.get("p_email").is_some());
        assert!(v.get("p_email_verified").is_some());
        assert!(v.get("p_accounts").is_some());
        assert!(v.get("p_cashu_locking_xpub").is_some());
        assert!(v.get("p_encryption_public_key").is_some());
        assert!(v.get("p_spark_identity_public_key").is_some());
        assert!(v.get("p_accounts").unwrap().is_array());
        // Optional terms fields omitted from serialization when None.
        assert!(v.get("p_terms_accepted_at").is_none());
        assert!(v.get("p_gift_card_mint_terms_accepted_at").is_none());
    }

    #[test]
    fn upsert_user_result_deserializes_from_composite_payload() {
        let raw = json!({
            "user": {
                "id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
                "created_at": "2026-03-01T12:00:00Z",
                "email": null,
                "email_verified": false,
                "username": "user-abc",
                "default_btc_account_id": "11111111-2222-3333-4444-555555555555",
                "default_usd_account_id": null,
                "default_currency": "BTC",
                "cashu_locking_xpub": "xpub",
                "encryption_public_key": "enc",
                "spark_identity_public_key": "spark",
                "terms_accepted_at": "2026-03-01T12:00:00Z",
                "gift_card_mint_terms_accepted_at": null
            },
            "accounts": [
                {
                    "id": "11111111-2222-3333-4444-555555555555",
                    "created_at": "2026-03-01T12:00:00Z",
                    "user_id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
                    "name": "Lightning",
                    "type": "spark",
                    "purpose": "transactional",
                    "currency": "BTC",
                    "details": {"network": "MAINNET"},
                    "version": 0,
                    "state": "active",
                    "expires_at": null
                }
            ]
        });
        let parsed: UpsertUserResult = serde_json::from_value(raw).unwrap();
        assert_eq!(parsed.user.username, "user-abc");
        assert_eq!(parsed.accounts.len(), 1);
        assert_eq!(parsed.accounts[0].name, "Lightning");
    }
}

#[cfg(test)]
mod trait_tests {
    use super::*;
    use uuid::Uuid;

    struct DummyStorage;

    #[async_trait]
    impl UserStorage for DummyStorage {
        async fn upsert_user_with_accounts(
            &self,
            _input: UpsertUserInput,
        ) -> Result<UpsertUserResult, StorageError> {
            Err(StorageError::Internal("dummy".into()))
        }

        async fn get_user(&self, _user_id: UserId) -> Result<Option<User>, StorageError> {
            Ok(None)
        }

        async fn list_accounts(&self, _user_id: UserId) -> Result<Vec<Account>, StorageError> {
            Ok(Vec::new())
        }

        async fn get_account(
            &self,
            _account_id: AccountId,
        ) -> Result<Option<Account>, StorageError> {
            Ok(None)
        }

        async fn update_user_defaults(
            &self,
            _user_id: UserId,
            _patch: UpdateUserDefaults,
        ) -> Result<User, StorageError> {
            Err(StorageError::NotFound)
        }
    }

    #[tokio::test]
    async fn dummy_storage_implements_user_storage() {
        let s = DummyStorage;
        assert!(matches!(
            s.upsert_user_with_accounts(UpsertUserInput {
                user_id: UserId::from(Uuid::nil()),
                email: None,
                email_verified: false,
                accounts: vec![],
                cashu_locking_xpub: "x".into(),
                encryption_public_key: "e".into(),
                spark_identity_public_key: "s".into(),
                terms_accepted_at: None,
                gift_card_mint_terms_accepted_at: None,
            })
            .await,
            Err(StorageError::Internal(_))
        ));
        assert!(s
            .get_user(UserId::from(Uuid::nil()))
            .await
            .unwrap()
            .is_none());
        assert!(s
            .list_accounts(UserId::from(Uuid::nil()))
            .await
            .unwrap()
            .is_empty());
        assert!(s
            .get_account(AccountId::from(Uuid::nil()))
            .await
            .unwrap()
            .is_none());
        assert!(matches!(
            s.update_user_defaults(UserId::from(Uuid::nil()), UpdateUserDefaults::default())
                .await,
            Err(StorageError::NotFound)
        ));
    }

    #[test]
    fn update_user_defaults_empty_serializes_to_empty_object() {
        // An empty patch (no fields set) serializes to `{}` — the SQL PATCH
        // would be a no-op. Callers should avoid sending one of these, but
        // the type ought to roundtrip cleanly.
        let v = serde_json::to_value(UpdateUserDefaults::default()).unwrap();
        assert_eq!(v, serde_json::json!({}));
    }

    #[test]
    fn update_user_defaults_some_btc_serializes_only_that_field() {
        let id = AccountId::from(Uuid::nil());
        let v = serde_json::to_value(UpdateUserDefaults {
            default_btc_account_id: Some(Some(id)),
            ..Default::default()
        })
        .unwrap();
        assert!(v.get("default_btc_account_id").is_some());
        assert!(v.get("default_usd_account_id").is_none());
        assert!(v.get("default_currency").is_none());
    }

    #[test]
    fn update_user_defaults_clear_btc_serializes_as_null() {
        // Outer Some + inner None means "explicitly NULL this slot".
        let v = serde_json::to_value(UpdateUserDefaults {
            default_btc_account_id: Some(None),
            ..Default::default()
        })
        .unwrap();
        assert!(v.get("default_btc_account_id").unwrap().is_null());
    }

    #[test]
    fn update_user_defaults_set_currency_serializes_as_uppercase_string() {
        let v = serde_json::to_value(UpdateUserDefaults {
            default_currency: Some(Currency::Btc),
            ..Default::default()
        })
        .unwrap();
        assert_eq!(
            v.get("default_currency").and_then(|v| v.as_str()),
            Some("BTC")
        );
    }
}
