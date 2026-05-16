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
use agicash_traits::{AccountInput, StorageError, UpsertUserInput, UpsertUserResult, UserStorage};
use async_trait::async_trait;

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
        let client = self.authenticated_client().await?;
        let response = client
            .from(tables::accounts::NAME)
            .select("*")
            .eq(tables::accounts::columns::USER_ID, user_id.to_string())
            .eq(tables::accounts::columns::STATE, "active")
            .execute()
            .await
            .map_err(map_postgrest_error)?;
        if !response.status().is_success() {
            return Err(StorageError::Backend(format!(
                "list_accounts: HTTP {}",
                response.status()
            )));
        }
        let body = response.text().await.map_err(map_network_error)?;
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
