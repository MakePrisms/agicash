//! `UserStorage` impl, migrated to the typesafe-supabase generated bindings.
//!
//! The trait surface (`UserStorage`) is unchanged. Internally:
//!
//! - Table/column names come from `crate::generated::tables::*` constants —
//!   no raw strings cross the call boundary into `postgrest`. This makes
//!   schema drift a compile error: rename `wallet.users.email` and the
//!   `tables::users::columns::EMAIL` constant disappears, breaking this
//!   file at the call site.
//!
//! - The `wallet.upsert_user_with_accounts` RPC name + argument shape are
//!   constructed via `crate::generated::rpcs::upsert_user_with_accounts::{NAME, Args}`,
//!   so adding a new required arg to the SQL function breaks the build at
//!   the `Args { ... }` literal below.
//!
//! - Per operator decision, generated row types still use bare `uuid::Uuid`;
//!   the domain newtypes (`UserId`, `AccountId`) live at the boundary. The
//!   private `upsert_args_from_input` adapter is where the conversion
//!   happens.
//!
//! - We continue to deserialize select responses directly into the domain
//!   structs (`User`, `Account`). The generated `*Row` structs aren't used
//!   for that — they exist to act as a compile-time mirror of the schema
//!   (read: drift sentinels). Using them at runtime would force every
//!   caller through an extra conversion that adds zero value over the
//!   existing serde-compatible domain types.

use crate::generated::{rpcs, tables};
use crate::{map_json_error, map_network_error, map_postgrest_error, SupabaseStorage};
use agicash_domain::{Account, AccountId, User, UserId};
use agicash_traits::{
    AccountInput, StorageError, UpdateUserDefaults, UpsertUserInput, UpsertUserResult, UserStorage,
};
use async_trait::async_trait;
use serde_json::{json, Map, Value};

#[async_trait]
impl UserStorage for SupabaseStorage {
    async fn upsert_user_with_accounts(
        &self,
        input: UpsertUserInput,
    ) -> Result<UpsertUserResult, StorageError> {
        let client = self.authenticated_client().await?;
        let args = upsert_args_from_input(input);
        let body = serde_json::to_string(&args).map_err(|e| map_json_error(&e))?;
        let response = client
            .rpc(rpcs::upsert_user_with_accounts::NAME, body)
            .execute()
            .await
            .map_err(map_postgrest_error)?;
        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            return Err(StorageError::Backend(format!(
                "upsert_user_with_accounts: HTTP {status}: {text}"
            )));
        }
        let text = response.text().await.map_err(map_network_error)?;
        serde_json::from_str::<UpsertUserResult>(&text).map_err(|e| map_json_error(&e))
    }

    async fn get_user(&self, user_id: UserId) -> Result<Option<User>, StorageError> {
        let client = self.authenticated_client().await?;
        let response = client
            .from(tables::users::NAME)
            .select("*")
            .eq(tables::users::columns::ID, user_id.to_string())
            .execute()
            .await
            .map_err(map_postgrest_error)?;
        if !response.status().is_success() {
            return Err(StorageError::Backend(format!(
                "get_user: HTTP {}",
                response.status()
            )));
        }
        let body = response.text().await.map_err(map_network_error)?;
        let rows: Vec<User> = serde_json::from_str(&body).map_err(|e| map_json_error(&e))?;
        Ok(rows.into_iter().next())
    }

    async fn list_accounts(&self, user_id: UserId) -> Result<Vec<Account>, StorageError> {
        tracing::info!(
            target: "agicash_storage_supabase::user_storage",
            url = %format!("{}/accounts?user_id=eq.{}&state=eq.active", self.rest_url, user_id),
            method = "GET",
            "list_accounts: request"
        );
        let client = self.authenticated_client().await?;
        let response = client
            .from(tables::accounts::NAME)
            .select("*")
            .eq(tables::accounts::columns::USER_ID, user_id.to_string())
            .eq(tables::accounts::columns::STATE, "active")
            .execute()
            .await
            .map_err(map_postgrest_error)?;
        let status = response.status();
        if !status.is_success() {
            tracing::warn!(
                target: "agicash_storage_supabase::user_storage",
                http_status = status.as_u16(),
                "list_accounts: non-success HTTP status"
            );
            return Err(StorageError::Backend(format!(
                "list_accounts: HTTP {status}"
            )));
        }
        let body = response.text().await.map_err(map_network_error)?;
        tracing::info!(
            target: "agicash_storage_supabase::user_storage",
            http_status = status.as_u16(),
            body_len = body.len(),
            body_preview = %body.chars().take(200).collect::<String>(),
            "list_accounts: response"
        );
        serde_json::from_str::<Vec<Account>>(&body).map_err(|e| map_json_error(&e))
    }

    async fn get_account(&self, account_id: AccountId) -> Result<Option<Account>, StorageError> {
        let client = self.authenticated_client().await?;
        let response = client
            .from(tables::accounts::NAME)
            .select("*")
            .eq(tables::accounts::columns::ID, account_id.to_string())
            .execute()
            .await
            .map_err(map_postgrest_error)?;
        if !response.status().is_success() {
            return Err(StorageError::Backend(format!(
                "get_account: HTTP {}",
                response.status()
            )));
        }
        let body = response.text().await.map_err(map_network_error)?;
        let rows: Vec<Account> = serde_json::from_str(&body).map_err(|e| map_json_error(&e))?;
        Ok(rows.into_iter().next())
    }

    async fn update_user_defaults(
        &self,
        user_id: UserId,
        patch: UpdateUserDefaults,
    ) -> Result<User, StorageError> {
        // Build the partial body by hand so each `Option<Option<AccountId>>`
        // slot can distinguish "leave alone" (omit), "set value" (Some(Some)),
        // and "clear to NULL" (Some(None)).
        let body_value = update_defaults_body(&patch);

        // `{}` would PATCH every row to itself — refuse to send.
        if body_value.as_object().is_none_or(Map::is_empty) {
            return Err(StorageError::Internal(
                "update_user_defaults: empty patch (no fields set)".into(),
            ));
        }

        let body = serde_json::to_string(&body_value).map_err(|e| map_json_error(&e))?;

        let client = self.authenticated_client().await?;
        let response = client
            .from(tables::users::NAME)
            .eq(tables::users::columns::ID, user_id.to_string())
            .select("*")
            .update(body)
            .execute()
            .await
            .map_err(map_postgrest_error)?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            return Err(StorageError::Backend(format!(
                "update_user_defaults: HTTP {status}: {text}"
            )));
        }

        let text = response.text().await.map_err(map_network_error)?;
        // postgrest with `Prefer: return=representation` returns a JSON array
        // of the matched rows. We filtered by primary key, so 0 rows means
        // the user didn't exist; 1 row is the happy path.
        let rows: Vec<User> = serde_json::from_str(&text).map_err(|e| map_json_error(&e))?;
        rows.into_iter().next().ok_or(StorageError::NotFound)
    }
}

/// Build the JSON body sent to postgrest for the partial PATCH. Omits keys
/// whose patch entries are `None` (leave-as-is). Inner `None` becomes a
/// JSON `null` so postgrest writes SQL `NULL` to that column.
fn update_defaults_body(patch: &UpdateUserDefaults) -> Value {
    use crate::generated::enums::Currency as GenCurrency;
    use agicash_domain::Currency as DomCurrency;

    fn map_currency(c: DomCurrency) -> GenCurrency {
        match c {
            DomCurrency::Btc => GenCurrency::Btc,
            // The SQL `wallet.currency` enum doesn't have USDB; mirror to USD
            // at the boundary, matching the `upsert_args_from_input` adapter
            // above.
            DomCurrency::Usd | DomCurrency::Usdb => GenCurrency::Usd,
        }
    }

    let mut map = Map::new();
    if let Some(slot) = &patch.default_btc_account_id {
        map.insert(
            tables::users::columns::DEFAULT_BTC_ACCOUNT_ID.to_string(),
            slot.as_ref()
                .map_or(Value::Null, |id| Value::String(id.to_string())),
        );
    }
    if let Some(slot) = &patch.default_usd_account_id {
        map.insert(
            tables::users::columns::DEFAULT_USD_ACCOUNT_ID.to_string(),
            slot.as_ref()
                .map_or(Value::Null, |id| Value::String(id.to_string())),
        );
    }
    if let Some(c) = patch.default_currency {
        map.insert(
            tables::users::columns::DEFAULT_CURRENCY.to_string(),
            json!(map_currency(c)),
        );
    }
    Value::Object(map)
}

/// Adapter between the public trait input (`UpsertUserInput`, which uses
/// `UserId` / domain enums) and the typed RPC `Args` (which uses bare
/// `uuid::Uuid` and generated enums). Adding a new required arg to the
/// SQL function breaks this function at the struct literal — the very
/// drift-detection signal the whole codegen exercise exists to provide.
fn upsert_args_from_input(input: UpsertUserInput) -> rpcs::upsert_user_with_accounts::Args {
    use crate::generated::composites::AccountInput as GenAccountInput;
    use crate::generated::enums::{AccountPurpose, AccountType, Currency};
    use agicash_domain as dom;

    fn map_account_type(t: dom::AccountType) -> AccountType {
        match t {
            dom::AccountType::Cashu => AccountType::Cashu,
            dom::AccountType::Spark => AccountType::Spark,
        }
    }
    fn map_purpose(p: dom::AccountPurpose) -> AccountPurpose {
        match p {
            dom::AccountPurpose::Transactional => AccountPurpose::Transactional,
            dom::AccountPurpose::GiftCard => AccountPurpose::GiftCard,
            // Add new domain variants here as they're introduced; the SQL
            // enum already carries `offer`, but the domain type doesn't
            // expose it yet (see migration 20260320120000_add_offer_account_purpose).
        }
    }
    fn map_currency(c: dom::Currency) -> Currency {
        // USDB is in the domain enum but the SQL `wallet.currency` only has
        // BTC/USD today. Mirror USDB onto USD at the boundary; the SQL
        // would reject any other choice anyway. Add the SQL variant before
        // USDB is wired to real flows, then split the match arm.
        match c {
            dom::Currency::Btc => Currency::Btc,
            dom::Currency::Usd | dom::Currency::Usdb => Currency::Usd,
        }
    }

    let accounts: Vec<GenAccountInput> = input
        .accounts
        .into_iter()
        .map(|a: AccountInput| GenAccountInput {
            r#type: map_account_type(a.account_type),
            purpose: map_purpose(a.purpose),
            currency: map_currency(a.currency),
            name: a.name,
            details: a.details,
            is_default: a.is_default,
        })
        .collect();

    rpcs::upsert_user_with_accounts::Args {
        p_user_id: input.user_id.as_uuid(),
        p_email: input.email,
        p_email_verified: Some(input.email_verified),
        p_accounts: Some(accounts),
        p_cashu_locking_xpub: Some(input.cashu_locking_xpub),
        p_encryption_public_key: Some(input.encryption_public_key),
        p_spark_identity_public_key: Some(input.spark_identity_public_key),
        p_terms_accepted_at: input.terms_accepted_at,
        p_gift_card_mint_terms_accepted_at: input.gift_card_mint_terms_accepted_at,
    }
}

#[cfg(test)]
mod tests {
    //! Schema-drift sentinels. The unit tests below never make a network call
    //! — they exist so a schema change that removes/renames a column or RPC
    //! arg breaks the build of THIS file (not just the integration tests).

    use super::*;
    use agicash_domain::{AccountPurpose, AccountType, Currency, UserId};
    use uuid::Uuid;

    /// If a new required column lands on `wallet.users`, this literal stops
    /// matching the generated `NewUsers` shape. Use the typed `NewUsers` so
    /// the test exercises the structural type — not just the column-name
    /// constants.
    #[allow(dead_code)]
    fn new_users_literal_for_drift() -> tables::users::NewUsers {
        tables::users::NewUsers {
            id: None,
            created_at: None,
            email: Some("u@example.com".into()),
            email_verified: true,
            updated_at: None,
            default_btc_account_id: None,
            default_currency: None,
            default_usd_account_id: None,
            // `username` is auto-set by the `set_default_username` trigger;
            // codegen treats it as optional via the `@codegen optional`
            // comment on the column (see migration 20260516120000).
            username: None,
            cashu_locking_xpub: "xpub".into(),
            encryption_public_key: "enc".into(),
            spark_identity_public_key: "spark".into(),
            terms_accepted_at: None,
            gift_card_mint_terms_accepted_at: None,
        }
    }

    /// Same sentinel for the RPC arg shape. Adding a new required arg to the
    /// SQL function breaks this literal.
    #[allow(dead_code)]
    fn upsert_args_literal_for_drift() -> rpcs::upsert_user_with_accounts::Args {
        rpcs::upsert_user_with_accounts::Args {
            p_user_id: Uuid::nil(),
            p_email: Some("u@example.com".into()),
            p_email_verified: Some(true),
            p_accounts: Some(vec![]),
            p_cashu_locking_xpub: Some("xpub".into()),
            p_encryption_public_key: Some("enc".into()),
            p_spark_identity_public_key: Some("spark".into()),
            p_terms_accepted_at: None,
            p_gift_card_mint_terms_accepted_at: None,
        }
    }

    #[test]
    fn typed_table_and_column_constants_resolve() {
        assert_eq!(tables::users::NAME, "users");
        assert_eq!(tables::accounts::NAME, "accounts");
        assert_eq!(tables::users::columns::ID, "id");
        assert_eq!(tables::users::columns::EMAIL, "email");
        assert_eq!(tables::accounts::columns::USER_ID, "user_id");
        assert_eq!(tables::accounts::columns::STATE, "state");
    }

    #[test]
    fn typed_rpc_name_constant_resolves() {
        assert_eq!(
            rpcs::upsert_user_with_accounts::NAME,
            "upsert_user_with_accounts"
        );
    }

    #[test]
    fn update_defaults_body_omits_unset_fields() {
        // Default patch -> empty object. The impl refuses to send this
        // (would PATCH every row in the table), but the body builder itself
        // should produce `{}` for an empty input.
        let body = super::update_defaults_body(&UpdateUserDefaults::default());
        assert_eq!(body, serde_json::json!({}));
    }

    #[test]
    fn update_defaults_body_writes_btc_uuid_string() {
        let id = AccountId::from(Uuid::nil());
        let body = super::update_defaults_body(&UpdateUserDefaults {
            default_btc_account_id: Some(Some(id)),
            ..Default::default()
        });
        assert_eq!(
            body.get("default_btc_account_id").and_then(|v| v.as_str()),
            Some(Uuid::nil().to_string()).as_deref()
        );
        // Only the field we set should be present.
        assert!(body.get("default_usd_account_id").is_none());
        assert!(body.get("default_currency").is_none());
    }

    #[test]
    fn update_defaults_body_writes_null_for_inner_none() {
        let body = super::update_defaults_body(&UpdateUserDefaults {
            default_usd_account_id: Some(None),
            ..Default::default()
        });
        assert!(body.get("default_usd_account_id").unwrap().is_null());
    }

    #[test]
    fn update_defaults_body_writes_currency_as_uppercase_string() {
        let body = super::update_defaults_body(&UpdateUserDefaults {
            default_currency: Some(Currency::Btc),
            ..Default::default()
        });
        assert_eq!(
            body.get("default_currency").and_then(|v| v.as_str()),
            Some("BTC")
        );
    }

    #[test]
    fn update_defaults_body_maps_usdb_currency_to_usd() {
        let body = super::update_defaults_body(&UpdateUserDefaults {
            default_currency: Some(Currency::Usdb),
            ..Default::default()
        });
        // USDB is not in the SQL enum; the adapter normalises it to USD so
        // postgrest doesn't 400 on us.
        assert_eq!(
            body.get("default_currency").and_then(|v| v.as_str()),
            Some("USD")
        );
    }

    #[test]
    fn upsert_args_serialize_with_p_prefixed_param_names_and_drop_none() {
        let args = upsert_args_from_input(UpsertUserInput {
            user_id: UserId::from(Uuid::nil()),
            email: None,
            email_verified: false,
            accounts: vec![AccountInput {
                account_type: AccountType::Spark,
                purpose: AccountPurpose::Transactional,
                currency: Currency::Btc,
                name: "Lightning".into(),
                details: serde_json::json!({"network": "MAINNET"}),
                is_default: true,
            }],
            cashu_locking_xpub: "x".into(),
            encryption_public_key: "e".into(),
            spark_identity_public_key: "s".into(),
            terms_accepted_at: None,
            gift_card_mint_terms_accepted_at: None,
        });
        let v = serde_json::to_value(&args).unwrap();
        assert!(v.get("p_user_id").is_some());
        assert!(v.get("p_accounts").is_some());
        // None-valued optional args are omitted when serialized, so PostgREST
        // sees the SQL DEFAULT instead.
        assert!(v.get("p_email").is_none());
        assert!(v.get("p_terms_accepted_at").is_none());
        assert!(v.get("p_gift_card_mint_terms_accepted_at").is_none());
    }
}
