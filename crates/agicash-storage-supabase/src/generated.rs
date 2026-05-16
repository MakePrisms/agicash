// @generated — DO NOT EDIT MANUALLY — regenerate via `bun db:generate-types-rust`
//              (or `cargo run -p agicash-storage-supabase-codegen`).
//
// Source: introspection of schema `wallet` after applying every
// file in `supabase/migrations/` to an ephemeral postgres:17.
//
// See `crates/agicash-storage-supabase-codegen/README.md` for the
// two schema conventions this codegen relies on
// (DEFAULT NULL for nullable RPC args; `@codegen optional` column
// comment for trigger-set NOT NULL columns).
#![allow(
    dead_code,
    clippy::needless_pub_self,
    clippy::module_name_repetitions,
    clippy::too_many_lines,
    clippy::wildcard_imports,
    clippy::doc_markdown,
    clippy::struct_excessive_bools,
    clippy::struct_field_names,
    clippy::option_option,
    clippy::missing_const_for_fn,
    clippy::ref_option,
    clippy::similar_names,
    clippy::pub_underscore_fields
)]
use serde::{Deserialize, Serialize};

/// Marker trait implemented by every generated table module's
/// `Marker` zero-sized type. Lets [`TypedBuilder`] enforce that the
/// column-name string handed to `.eq()` etc. originates from the
/// matching table's `columns::` module.
pub trait Table {
    /// PostgREST table identifier.
    const NAME: &'static str;
    /// Compile-time check that a column literal belongs to this
    /// table. Implemented by the generated module.
    fn is_known_column(name: &str) -> bool;
}

/// Thin wrapper over `postgrest::Builder` that constrains filter
/// methods to column constants emitted by codegen. Most workflows
/// should construct one via `tables::<table>::select(client)`.
pub struct TypedBuilder<T: Table> {
    inner: postgrest::Builder,
    _marker: std::marker::PhantomData<T>,
}

impl<T: Table> std::fmt::Debug for TypedBuilder<T> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("TypedBuilder")
            .field("table", &T::NAME)
            .finish_non_exhaustive()
    }
}

impl<T: Table> TypedBuilder<T> {
    pub fn new(client: &postgrest::Postgrest) -> Self {
        Self {
            inner: client.from(T::NAME),
            _marker: std::marker::PhantomData,
        }
    }

    /// Escape hatch for the underlying postgrest builder — callers
    /// who need a method we haven't typed yet (e.g. embeds) can
    /// reach the raw API. Use sparingly.
    pub fn into_inner(self) -> postgrest::Builder {
        self.inner
    }

    /// `select(columns)` passthrough. `columns` is intentionally a
    /// raw `&str` so callers can use postgrest's embed syntax
    /// (`"*,accounts(*)"`) without us re-implementing it here.
    #[must_use]
    pub fn select(mut self, columns: &str) -> Self {
        self.inner = self.inner.select(columns);
        self
    }

    /// Equality filter. `column` must be one of the constants in
    /// the generated table module's `columns::` namespace —
    /// debug-asserts otherwise.
    #[must_use]
    pub fn eq(mut self, column: &'static str, value: impl AsRef<str>) -> Self {
        debug_assert!(
            T::is_known_column(column),
            "column `{}` is not declared in {}::columns",
            column,
            T::NAME,
        );
        self.inner = self.inner.eq(column, value);
        self
    }

    /// Execute the request via the underlying `postgrest::Builder`.
    /// Returns whatever postgrest returns (currently
    /// `Result<reqwest::Response, reqwest::Error>`).
    pub async fn execute(self) -> Result<reqwest::Response, reqwest::Error> {
        self.inner.execute().await
    }
}

pub mod enums {
    use super::*;

    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
    pub enum AccountPurpose {
        #[serde(rename = "transactional")]
        Transactional,
        #[serde(rename = "gift-card")]
        GiftCard,
        #[serde(rename = "offer")]
        Offer,
    }

    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
    pub enum AccountState {
        #[serde(rename = "active")]
        Active,
        #[serde(rename = "expired")]
        Expired,
    }

    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
    pub enum AccountType {
        #[serde(rename = "cashu")]
        Cashu,
        #[serde(rename = "spark")]
        Spark,
    }

    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
    pub enum AcknowledgmentStatus {
        #[serde(rename = "pending")]
        Pending,
        #[serde(rename = "acknowledged")]
        Acknowledged,
    }

    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
    pub enum CashuProofState {
        #[serde(rename = "UNSPENT")]
        Unspent,
        #[serde(rename = "RESERVED")]
        Reserved,
        #[serde(rename = "SPENT")]
        Spent,
    }

    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
    pub enum CashuReceiveQuoteState {
        #[serde(rename = "UNPAID")]
        Unpaid,
        #[serde(rename = "EXPIRED")]
        Expired,
        #[serde(rename = "PAID")]
        Paid,
        #[serde(rename = "COMPLETED")]
        Completed,
        #[serde(rename = "FAILED")]
        Failed,
    }

    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
    pub enum CashuReceiveSwapState {
        #[serde(rename = "PENDING")]
        Pending,
        #[serde(rename = "COMPLETED")]
        Completed,
        #[serde(rename = "FAILED")]
        Failed,
    }

    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
    pub enum CashuSendQuoteState {
        #[serde(rename = "UNPAID")]
        Unpaid,
        #[serde(rename = "PENDING")]
        Pending,
        #[serde(rename = "EXPIRED")]
        Expired,
        #[serde(rename = "FAILED")]
        Failed,
        #[serde(rename = "PAID")]
        Paid,
    }

    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
    pub enum CashuSendSwapState {
        #[serde(rename = "DRAFT")]
        Draft,
        #[serde(rename = "PENDING")]
        Pending,
        #[serde(rename = "COMPLETED")]
        Completed,
        #[serde(rename = "FAILED")]
        Failed,
        #[serde(rename = "REVERSED")]
        Reversed,
    }

    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
    pub enum Currency {
        #[serde(rename = "BTC")]
        Btc,
        #[serde(rename = "USD")]
        Usd,
    }

    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
    pub enum ReceiveQuoteType {
        #[serde(rename = "LIGHTNING")]
        Lightning,
        #[serde(rename = "CASHU_TOKEN")]
        CashuToken,
    }

    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
    pub enum SparkReceiveQuoteState {
        #[serde(rename = "UNPAID")]
        Unpaid,
        #[serde(rename = "EXPIRED")]
        Expired,
        #[serde(rename = "PAID")]
        Paid,
        #[serde(rename = "FAILED")]
        Failed,
    }

    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
    pub enum SparkSendQuoteState {
        #[serde(rename = "UNPAID")]
        Unpaid,
        #[serde(rename = "PENDING")]
        Pending,
        #[serde(rename = "COMPLETED")]
        Completed,
        #[serde(rename = "FAILED")]
        Failed,
    }

    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
    pub enum TransactionDirection {
        #[serde(rename = "SEND")]
        Send,
        #[serde(rename = "RECEIVE")]
        Receive,
    }

    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
    pub enum TransactionPurpose {
        #[serde(rename = "PAYMENT")]
        Payment,
        #[serde(rename = "BUY_CASHAPP")]
        BuyCashapp,
        #[serde(rename = "TRANSFER")]
        Transfer,
    }

    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
    pub enum TransactionState {
        #[serde(rename = "DRAFT")]
        Draft,
        #[serde(rename = "PENDING")]
        Pending,
        #[serde(rename = "COMPLETED")]
        Completed,
        #[serde(rename = "FAILED")]
        Failed,
        #[serde(rename = "REVERSED")]
        Reversed,
    }

    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
    pub enum TransactionType {
        #[serde(rename = "CASHU_LIGHTNING")]
        CashuLightning,
        #[serde(rename = "CASHU_TOKEN")]
        CashuToken,
        #[serde(rename = "SPARK_LIGHTNING")]
        SparkLightning,
    }
}

pub mod composites {
    use super::*;

    #[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
    pub struct AccountInput {
        #[serde(rename = "type")]
        pub r#type: crate::generated::enums::AccountType,
        pub purpose: crate::generated::enums::AccountPurpose,
        pub currency: crate::generated::enums::Currency,
        pub name: String,
        pub details: serde_json::Value,
        pub is_default: bool,
    }

    #[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
    pub struct CashuProofInput {
        #[serde(rename = "keysetId")]
        pub keyset_id: String,
        pub amount: String,
        pub secret: String,
        #[serde(rename = "unblindedSignature")]
        pub unblinded_signature: String,
        #[serde(rename = "publicKeyY")]
        pub public_key_y: String,
        pub dleq: serde_json::Value,
        pub witness: serde_json::Value,
    }
}

pub mod tables {
    use super::*;

    pub mod accounts {
        use super::*;
        /// PostgREST table identifier — checked against migrations at codegen time.
        pub const NAME: &str = "accounts";

        pub mod columns {
            pub const ID: &str = "id";
            pub const CREATED_AT: &str = "created_at";
            pub const USER_ID: &str = "user_id";
            pub const NAME: &str = "name";
            pub const TYPE: &str = "type";
            pub const PURPOSE: &str = "purpose";
            pub const CURRENCY: &str = "currency";
            pub const DETAILS: &str = "details";
            pub const VERSION: &str = "version";
            pub const EXPIRES_AT: &str = "expires_at";
            pub const STATE: &str = "state";
        }

        /// Zero-sized marker — feeds [`crate::generated::TypedBuilder`].
        #[derive(Debug, Clone, Copy, Default)]
        pub struct Marker;
        impl crate::generated::Table for Marker {
            const NAME: &'static str = NAME;
            fn is_known_column(name: &str) -> bool {
                matches!(
                    name,
                    "id" | "created_at"
                        | "user_id"
                        | "name"
                        | "type"
                        | "purpose"
                        | "currency"
                        | "details"
                        | "version"
                        | "expires_at"
                        | "state"
                )
            }
        }

        #[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
        pub struct AccountsRow {
            pub id: uuid::Uuid,
            pub created_at: chrono::DateTime<chrono::Utc>,
            pub user_id: uuid::Uuid,
            pub name: String,
            #[serde(rename = "type")]
            pub r#type: crate::generated::enums::AccountType,
            pub purpose: crate::generated::enums::AccountPurpose,
            pub currency: crate::generated::enums::Currency,
            pub details: serde_json::Value,
            pub version: i32,
            pub expires_at: Option<chrono::DateTime<chrono::Utc>>,
            pub state: crate::generated::enums::AccountState,
        }

        #[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
        pub struct NewAccounts {
            #[serde(skip_serializing_if = "Option::is_none")]
            pub id: Option<uuid::Uuid>,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub created_at: Option<chrono::DateTime<chrono::Utc>>,
            pub user_id: uuid::Uuid,
            pub name: String,
            #[serde(rename = "type")]
            pub r#type: crate::generated::enums::AccountType,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub purpose: Option<crate::generated::enums::AccountPurpose>,
            pub currency: crate::generated::enums::Currency,
            pub details: serde_json::Value,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub version: Option<i32>,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub expires_at: Option<chrono::DateTime<chrono::Utc>>,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub state: Option<crate::generated::enums::AccountState>,
        }

        /// Returns a [`crate::generated::TypedBuilder`] bound to this table.
        pub fn select(client: &postgrest::Postgrest) -> crate::generated::TypedBuilder<Marker> {
            crate::generated::TypedBuilder::<Marker>::new(client)
        }

        /// Returns the raw `postgrest::Builder` bound to this table — escape hatch for embeds / inserts that aren't yet on `TypedBuilder`.
        pub fn from(client: &postgrest::Postgrest) -> postgrest::Builder {
            client.from(NAME)
        }
    }

    pub mod app_config {
        use super::*;
        /// PostgREST table identifier — checked against migrations at codegen time.
        pub const NAME: &str = "app_config";

        pub mod columns {
            pub const KEY: &str = "key";
            pub const VALUE: &str = "value";
        }

        /// Zero-sized marker — feeds [`crate::generated::TypedBuilder`].
        #[derive(Debug, Clone, Copy, Default)]
        pub struct Marker;
        impl crate::generated::Table for Marker {
            const NAME: &'static str = NAME;
            fn is_known_column(name: &str) -> bool {
                matches!(name, "key" | "value")
            }
        }

        #[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
        pub struct AppConfigRow {
            pub key: String,
            pub value: String,
        }

        #[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
        pub struct NewAppConfig {
            pub key: String,
            pub value: String,
        }

        /// Returns a [`crate::generated::TypedBuilder`] bound to this table.
        pub fn select(client: &postgrest::Postgrest) -> crate::generated::TypedBuilder<Marker> {
            crate::generated::TypedBuilder::<Marker>::new(client)
        }

        /// Returns the raw `postgrest::Builder` bound to this table — escape hatch for embeds / inserts that aren't yet on `TypedBuilder`.
        pub fn from(client: &postgrest::Postgrest) -> postgrest::Builder {
            client.from(NAME)
        }
    }

    pub mod cashu_proofs {
        use super::*;
        /// PostgREST table identifier — checked against migrations at codegen time.
        pub const NAME: &str = "cashu_proofs";

        pub mod columns {
            pub const ID: &str = "id";
            pub const USER_ID: &str = "user_id";
            pub const ACCOUNT_ID: &str = "account_id";
            pub const KEYSET_ID: &str = "keyset_id";
            pub const AMOUNT: &str = "amount";
            pub const SECRET: &str = "secret";
            pub const UNBLINDED_SIGNATURE: &str = "unblinded_signature";
            pub const PUBLIC_KEY_Y: &str = "public_key_y";
            pub const DLEQ: &str = "dleq";
            pub const WITNESS: &str = "witness";
            pub const STATE: &str = "state";
            pub const VERSION: &str = "version";
            pub const CREATED_AT: &str = "created_at";
            pub const RESERVED_AT: &str = "reserved_at";
            pub const SPENT_AT: &str = "spent_at";
            pub const CASHU_RECEIVE_QUOTE_ID: &str = "cashu_receive_quote_id";
            pub const CASHU_RECEIVE_SWAP_TOKEN_HASH: &str = "cashu_receive_swap_token_hash";
            pub const CASHU_SEND_QUOTE_ID: &str = "cashu_send_quote_id";
            pub const SPENDING_CASHU_SEND_QUOTE_ID: &str = "spending_cashu_send_quote_id";
            pub const CASHU_SEND_SWAP_ID: &str = "cashu_send_swap_id";
            pub const SPENDING_CASHU_SEND_SWAP_ID: &str = "spending_cashu_send_swap_id";
        }

        /// Zero-sized marker — feeds [`crate::generated::TypedBuilder`].
        #[derive(Debug, Clone, Copy, Default)]
        pub struct Marker;
        impl crate::generated::Table for Marker {
            const NAME: &'static str = NAME;
            fn is_known_column(name: &str) -> bool {
                matches!(
                    name,
                    "id" | "user_id"
                        | "account_id"
                        | "keyset_id"
                        | "amount"
                        | "secret"
                        | "unblinded_signature"
                        | "public_key_y"
                        | "dleq"
                        | "witness"
                        | "state"
                        | "version"
                        | "created_at"
                        | "reserved_at"
                        | "spent_at"
                        | "cashu_receive_quote_id"
                        | "cashu_receive_swap_token_hash"
                        | "cashu_send_quote_id"
                        | "spending_cashu_send_quote_id"
                        | "cashu_send_swap_id"
                        | "spending_cashu_send_swap_id"
                )
            }
        }

        #[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
        pub struct CashuProofsRow {
            pub id: uuid::Uuid,
            pub user_id: uuid::Uuid,
            pub account_id: uuid::Uuid,
            pub keyset_id: String,
            pub amount: String,
            pub secret: String,
            pub unblinded_signature: String,
            pub public_key_y: String,
            pub dleq: Option<serde_json::Value>,
            pub witness: Option<serde_json::Value>,
            pub state: crate::generated::enums::CashuProofState,
            pub version: i32,
            pub created_at: chrono::DateTime<chrono::Utc>,
            pub reserved_at: Option<chrono::DateTime<chrono::Utc>>,
            pub spent_at: Option<chrono::DateTime<chrono::Utc>>,
            pub cashu_receive_quote_id: Option<uuid::Uuid>,
            pub cashu_receive_swap_token_hash: Option<String>,
            pub cashu_send_quote_id: Option<uuid::Uuid>,
            pub spending_cashu_send_quote_id: Option<uuid::Uuid>,
            pub cashu_send_swap_id: Option<uuid::Uuid>,
            pub spending_cashu_send_swap_id: Option<uuid::Uuid>,
        }

        #[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
        pub struct NewCashuProofs {
            #[serde(skip_serializing_if = "Option::is_none")]
            pub id: Option<uuid::Uuid>,
            pub user_id: uuid::Uuid,
            pub account_id: uuid::Uuid,
            pub keyset_id: String,
            pub amount: String,
            pub secret: String,
            pub unblinded_signature: String,
            pub public_key_y: String,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub dleq: Option<serde_json::Value>,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub witness: Option<serde_json::Value>,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub state: Option<crate::generated::enums::CashuProofState>,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub version: Option<i32>,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub created_at: Option<chrono::DateTime<chrono::Utc>>,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub reserved_at: Option<chrono::DateTime<chrono::Utc>>,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub spent_at: Option<chrono::DateTime<chrono::Utc>>,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub cashu_receive_quote_id: Option<uuid::Uuid>,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub cashu_receive_swap_token_hash: Option<String>,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub cashu_send_quote_id: Option<uuid::Uuid>,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub spending_cashu_send_quote_id: Option<uuid::Uuid>,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub cashu_send_swap_id: Option<uuid::Uuid>,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub spending_cashu_send_swap_id: Option<uuid::Uuid>,
        }

        /// Returns a [`crate::generated::TypedBuilder`] bound to this table.
        pub fn select(client: &postgrest::Postgrest) -> crate::generated::TypedBuilder<Marker> {
            crate::generated::TypedBuilder::<Marker>::new(client)
        }

        /// Returns the raw `postgrest::Builder` bound to this table — escape hatch for embeds / inserts that aren't yet on `TypedBuilder`.
        pub fn from(client: &postgrest::Postgrest) -> postgrest::Builder {
            client.from(NAME)
        }
    }

    pub mod cashu_receive_quotes {
        use super::*;
        /// PostgREST table identifier — checked against migrations at codegen time.
        pub const NAME: &str = "cashu_receive_quotes";

        pub mod columns {
            pub const ID: &str = "id";
            pub const CREATED_AT: &str = "created_at";
            pub const ACCOUNT_ID: &str = "account_id";
            pub const USER_ID: &str = "user_id";
            pub const EXPIRES_AT: &str = "expires_at";
            pub const STATE: &str = "state";
            pub const KEYSET_ID: &str = "keyset_id";
            pub const KEYSET_COUNTER: &str = "keyset_counter";
            pub const VERSION: &str = "version";
            pub const TRANSACTION_ID: &str = "transaction_id";
            pub const TYPE: &str = "type";
            pub const LOCKING_DERIVATION_PATH: &str = "locking_derivation_path";
            pub const FAILURE_REASON: &str = "failure_reason";
            pub const ENCRYPTED_DATA: &str = "encrypted_data";
            pub const PAYMENT_HASH: &str = "payment_hash";
            pub const QUOTE_ID_HASH: &str = "quote_id_hash";
            pub const CASHU_TOKEN_MELT_INITIATED: &str = "cashu_token_melt_initiated";
        }

        /// Zero-sized marker — feeds [`crate::generated::TypedBuilder`].
        #[derive(Debug, Clone, Copy, Default)]
        pub struct Marker;
        impl crate::generated::Table for Marker {
            const NAME: &'static str = NAME;
            fn is_known_column(name: &str) -> bool {
                matches!(
                    name,
                    "id" | "created_at"
                        | "account_id"
                        | "user_id"
                        | "expires_at"
                        | "state"
                        | "keyset_id"
                        | "keyset_counter"
                        | "version"
                        | "transaction_id"
                        | "type"
                        | "locking_derivation_path"
                        | "failure_reason"
                        | "encrypted_data"
                        | "payment_hash"
                        | "quote_id_hash"
                        | "cashu_token_melt_initiated"
                )
            }
        }

        #[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
        pub struct CashuReceiveQuotesRow {
            pub id: uuid::Uuid,
            pub created_at: chrono::DateTime<chrono::Utc>,
            pub account_id: uuid::Uuid,
            pub user_id: uuid::Uuid,
            pub expires_at: chrono::DateTime<chrono::Utc>,
            pub state: crate::generated::enums::CashuReceiveQuoteState,
            pub keyset_id: Option<String>,
            pub keyset_counter: Option<i32>,
            pub version: i32,
            pub transaction_id: uuid::Uuid,
            #[serde(rename = "type")]
            pub r#type: crate::generated::enums::ReceiveQuoteType,
            pub locking_derivation_path: String,
            pub failure_reason: Option<String>,
            pub encrypted_data: String,
            pub payment_hash: String,
            pub quote_id_hash: String,
            pub cashu_token_melt_initiated: Option<bool>,
        }

        #[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
        pub struct NewCashuReceiveQuotes {
            #[serde(skip_serializing_if = "Option::is_none")]
            pub id: Option<uuid::Uuid>,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub created_at: Option<chrono::DateTime<chrono::Utc>>,
            pub account_id: uuid::Uuid,
            pub user_id: uuid::Uuid,
            pub expires_at: chrono::DateTime<chrono::Utc>,
            pub state: crate::generated::enums::CashuReceiveQuoteState,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub keyset_id: Option<String>,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub keyset_counter: Option<i32>,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub version: Option<i32>,
            pub transaction_id: uuid::Uuid,
            #[serde(rename = "type")]
            pub r#type: crate::generated::enums::ReceiveQuoteType,
            pub locking_derivation_path: String,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub failure_reason: Option<String>,
            pub encrypted_data: String,
            pub payment_hash: String,
            pub quote_id_hash: String,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub cashu_token_melt_initiated: Option<bool>,
        }

        /// Returns a [`crate::generated::TypedBuilder`] bound to this table.
        pub fn select(client: &postgrest::Postgrest) -> crate::generated::TypedBuilder<Marker> {
            crate::generated::TypedBuilder::<Marker>::new(client)
        }

        /// Returns the raw `postgrest::Builder` bound to this table — escape hatch for embeds / inserts that aren't yet on `TypedBuilder`.
        pub fn from(client: &postgrest::Postgrest) -> postgrest::Builder {
            client.from(NAME)
        }
    }

    pub mod cashu_receive_swaps {
        use super::*;
        /// PostgREST table identifier — checked against migrations at codegen time.
        pub const NAME: &str = "cashu_receive_swaps";

        pub mod columns {
            pub const TOKEN_HASH: &str = "token_hash";
            pub const CREATED_AT: &str = "created_at";
            pub const ACCOUNT_ID: &str = "account_id";
            pub const USER_ID: &str = "user_id";
            pub const KEYSET_ID: &str = "keyset_id";
            pub const KEYSET_COUNTER: &str = "keyset_counter";
            pub const STATE: &str = "state";
            pub const VERSION: &str = "version";
            pub const FAILURE_REASON: &str = "failure_reason";
            pub const TRANSACTION_ID: &str = "transaction_id";
            pub const ENCRYPTED_DATA: &str = "encrypted_data";
        }

        /// Zero-sized marker — feeds [`crate::generated::TypedBuilder`].
        #[derive(Debug, Clone, Copy, Default)]
        pub struct Marker;
        impl crate::generated::Table for Marker {
            const NAME: &'static str = NAME;
            fn is_known_column(name: &str) -> bool {
                matches!(
                    name,
                    "token_hash"
                        | "created_at"
                        | "account_id"
                        | "user_id"
                        | "keyset_id"
                        | "keyset_counter"
                        | "state"
                        | "version"
                        | "failure_reason"
                        | "transaction_id"
                        | "encrypted_data"
                )
            }
        }

        #[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
        pub struct CashuReceiveSwapsRow {
            pub token_hash: String,
            pub created_at: chrono::DateTime<chrono::Utc>,
            pub account_id: uuid::Uuid,
            pub user_id: uuid::Uuid,
            pub keyset_id: String,
            pub keyset_counter: i32,
            pub state: crate::generated::enums::CashuReceiveSwapState,
            pub version: i32,
            pub failure_reason: Option<String>,
            pub transaction_id: uuid::Uuid,
            pub encrypted_data: String,
        }

        #[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
        pub struct NewCashuReceiveSwaps {
            pub token_hash: String,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub created_at: Option<chrono::DateTime<chrono::Utc>>,
            pub account_id: uuid::Uuid,
            pub user_id: uuid::Uuid,
            pub keyset_id: String,
            pub keyset_counter: i32,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub state: Option<crate::generated::enums::CashuReceiveSwapState>,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub version: Option<i32>,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub failure_reason: Option<String>,
            pub transaction_id: uuid::Uuid,
            pub encrypted_data: String,
        }

        /// Returns a [`crate::generated::TypedBuilder`] bound to this table.
        pub fn select(client: &postgrest::Postgrest) -> crate::generated::TypedBuilder<Marker> {
            crate::generated::TypedBuilder::<Marker>::new(client)
        }

        /// Returns the raw `postgrest::Builder` bound to this table — escape hatch for embeds / inserts that aren't yet on `TypedBuilder`.
        pub fn from(client: &postgrest::Postgrest) -> postgrest::Builder {
            client.from(NAME)
        }
    }

    pub mod cashu_send_quotes {
        use super::*;
        /// PostgREST table identifier — checked against migrations at codegen time.
        pub const NAME: &str = "cashu_send_quotes";

        pub mod columns {
            pub const ID: &str = "id";
            pub const CREATED_AT: &str = "created_at";
            pub const EXPIRES_AT: &str = "expires_at";
            pub const USER_ID: &str = "user_id";
            pub const ACCOUNT_ID: &str = "account_id";
            pub const CURRENCY_REQUESTED: &str = "currency_requested";
            pub const KEYSET_ID: &str = "keyset_id";
            pub const KEYSET_COUNTER: &str = "keyset_counter";
            pub const NUMBER_OF_CHANGE_OUTPUTS: &str = "number_of_change_outputs";
            pub const STATE: &str = "state";
            pub const FAILURE_REASON: &str = "failure_reason";
            pub const VERSION: &str = "version";
            pub const TRANSACTION_ID: &str = "transaction_id";
            pub const ENCRYPTED_DATA: &str = "encrypted_data";
            pub const PAYMENT_HASH: &str = "payment_hash";
            pub const QUOTE_ID_HASH: &str = "quote_id_hash";
        }

        /// Zero-sized marker — feeds [`crate::generated::TypedBuilder`].
        #[derive(Debug, Clone, Copy, Default)]
        pub struct Marker;
        impl crate::generated::Table for Marker {
            const NAME: &'static str = NAME;
            fn is_known_column(name: &str) -> bool {
                matches!(
                    name,
                    "id" | "created_at"
                        | "expires_at"
                        | "user_id"
                        | "account_id"
                        | "currency_requested"
                        | "keyset_id"
                        | "keyset_counter"
                        | "number_of_change_outputs"
                        | "state"
                        | "failure_reason"
                        | "version"
                        | "transaction_id"
                        | "encrypted_data"
                        | "payment_hash"
                        | "quote_id_hash"
                )
            }
        }

        #[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
        pub struct CashuSendQuotesRow {
            pub id: uuid::Uuid,
            pub created_at: chrono::DateTime<chrono::Utc>,
            pub expires_at: chrono::DateTime<chrono::Utc>,
            pub user_id: uuid::Uuid,
            pub account_id: uuid::Uuid,
            pub currency_requested: crate::generated::enums::Currency,
            pub keyset_id: String,
            pub keyset_counter: i32,
            pub number_of_change_outputs: i32,
            pub state: crate::generated::enums::CashuSendQuoteState,
            pub failure_reason: Option<String>,
            pub version: i32,
            pub transaction_id: uuid::Uuid,
            pub encrypted_data: String,
            pub payment_hash: String,
            pub quote_id_hash: String,
        }

        #[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
        pub struct NewCashuSendQuotes {
            #[serde(skip_serializing_if = "Option::is_none")]
            pub id: Option<uuid::Uuid>,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub created_at: Option<chrono::DateTime<chrono::Utc>>,
            pub expires_at: chrono::DateTime<chrono::Utc>,
            pub user_id: uuid::Uuid,
            pub account_id: uuid::Uuid,
            pub currency_requested: crate::generated::enums::Currency,
            pub keyset_id: String,
            pub keyset_counter: i32,
            pub number_of_change_outputs: i32,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub state: Option<crate::generated::enums::CashuSendQuoteState>,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub failure_reason: Option<String>,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub version: Option<i32>,
            pub transaction_id: uuid::Uuid,
            pub encrypted_data: String,
            pub payment_hash: String,
            pub quote_id_hash: String,
        }

        /// Returns a [`crate::generated::TypedBuilder`] bound to this table.
        pub fn select(client: &postgrest::Postgrest) -> crate::generated::TypedBuilder<Marker> {
            crate::generated::TypedBuilder::<Marker>::new(client)
        }

        /// Returns the raw `postgrest::Builder` bound to this table — escape hatch for embeds / inserts that aren't yet on `TypedBuilder`.
        pub fn from(client: &postgrest::Postgrest) -> postgrest::Builder {
            client.from(NAME)
        }
    }

    pub mod cashu_send_swaps {
        use super::*;
        /// PostgREST table identifier — checked against migrations at codegen time.
        pub const NAME: &str = "cashu_send_swaps";

        pub mod columns {
            pub const ID: &str = "id";
            pub const USER_ID: &str = "user_id";
            pub const ACCOUNT_ID: &str = "account_id";
            pub const TRANSACTION_ID: &str = "transaction_id";
            pub const KEYSET_ID: &str = "keyset_id";
            pub const KEYSET_COUNTER: &str = "keyset_counter";
            pub const TOKEN_HASH: &str = "token_hash";
            pub const STATE: &str = "state";
            pub const VERSION: &str = "version";
            pub const CREATED_AT: &str = "created_at";
            pub const FAILURE_REASON: &str = "failure_reason";
            pub const ENCRYPTED_DATA: &str = "encrypted_data";
            pub const REQUIRES_INPUT_PROOFS_SWAP: &str = "requires_input_proofs_swap";
        }

        /// Zero-sized marker — feeds [`crate::generated::TypedBuilder`].
        #[derive(Debug, Clone, Copy, Default)]
        pub struct Marker;
        impl crate::generated::Table for Marker {
            const NAME: &'static str = NAME;
            fn is_known_column(name: &str) -> bool {
                matches!(
                    name,
                    "id" | "user_id"
                        | "account_id"
                        | "transaction_id"
                        | "keyset_id"
                        | "keyset_counter"
                        | "token_hash"
                        | "state"
                        | "version"
                        | "created_at"
                        | "failure_reason"
                        | "encrypted_data"
                        | "requires_input_proofs_swap"
                )
            }
        }

        #[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
        pub struct CashuSendSwapsRow {
            pub id: uuid::Uuid,
            pub user_id: uuid::Uuid,
            pub account_id: uuid::Uuid,
            pub transaction_id: uuid::Uuid,
            pub keyset_id: Option<String>,
            pub keyset_counter: Option<i32>,
            pub token_hash: Option<String>,
            pub state: crate::generated::enums::CashuSendSwapState,
            pub version: i32,
            pub created_at: chrono::DateTime<chrono::Utc>,
            pub failure_reason: Option<String>,
            pub encrypted_data: String,
            pub requires_input_proofs_swap: bool,
        }

        #[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
        pub struct NewCashuSendSwaps {
            #[serde(skip_serializing_if = "Option::is_none")]
            pub id: Option<uuid::Uuid>,
            pub user_id: uuid::Uuid,
            pub account_id: uuid::Uuid,
            pub transaction_id: uuid::Uuid,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub keyset_id: Option<String>,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub keyset_counter: Option<i32>,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub token_hash: Option<String>,
            pub state: crate::generated::enums::CashuSendSwapState,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub version: Option<i32>,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub created_at: Option<chrono::DateTime<chrono::Utc>>,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub failure_reason: Option<String>,
            pub encrypted_data: String,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub requires_input_proofs_swap: Option<bool>,
        }

        /// Returns a [`crate::generated::TypedBuilder`] bound to this table.
        pub fn select(client: &postgrest::Postgrest) -> crate::generated::TypedBuilder<Marker> {
            crate::generated::TypedBuilder::<Marker>::new(client)
        }

        /// Returns the raw `postgrest::Builder` bound to this table — escape hatch for embeds / inserts that aren't yet on `TypedBuilder`.
        pub fn from(client: &postgrest::Postgrest) -> postgrest::Builder {
            client.from(NAME)
        }
    }

    pub mod contacts {
        use super::*;
        /// PostgREST table identifier — checked against migrations at codegen time.
        pub const NAME: &str = "contacts";

        pub mod columns {
            pub const ID: &str = "id";
            pub const CREATED_AT: &str = "created_at";
            pub const OWNER_ID: &str = "owner_id";
            pub const USERNAME: &str = "username";
        }

        /// Zero-sized marker — feeds [`crate::generated::TypedBuilder`].
        #[derive(Debug, Clone, Copy, Default)]
        pub struct Marker;
        impl crate::generated::Table for Marker {
            const NAME: &'static str = NAME;
            fn is_known_column(name: &str) -> bool {
                matches!(name, "id" | "created_at" | "owner_id" | "username")
            }
        }

        #[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
        pub struct ContactsRow {
            pub id: uuid::Uuid,
            pub created_at: chrono::DateTime<chrono::Utc>,
            pub owner_id: uuid::Uuid,
            pub username: Option<String>,
        }

        #[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
        pub struct NewContacts {
            #[serde(skip_serializing_if = "Option::is_none")]
            pub id: Option<uuid::Uuid>,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub created_at: Option<chrono::DateTime<chrono::Utc>>,
            pub owner_id: uuid::Uuid,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub username: Option<String>,
        }

        /// Returns a [`crate::generated::TypedBuilder`] bound to this table.
        pub fn select(client: &postgrest::Postgrest) -> crate::generated::TypedBuilder<Marker> {
            crate::generated::TypedBuilder::<Marker>::new(client)
        }

        /// Returns the raw `postgrest::Builder` bound to this table — escape hatch for embeds / inserts that aren't yet on `TypedBuilder`.
        pub fn from(client: &postgrest::Postgrest) -> postgrest::Builder {
            client.from(NAME)
        }
    }

    pub mod feature_flags {
        use super::*;
        /// PostgREST table identifier — checked against migrations at codegen time.
        pub const NAME: &str = "feature_flags";

        pub mod columns {
            pub const KEY: &str = "key";
            pub const ENABLED: &str = "enabled";
            pub const DESCRIPTION: &str = "description";
            pub const RULES: &str = "rules";
            pub const CREATED_AT: &str = "created_at";
            pub const UPDATED_AT: &str = "updated_at";
        }

        /// Zero-sized marker — feeds [`crate::generated::TypedBuilder`].
        #[derive(Debug, Clone, Copy, Default)]
        pub struct Marker;
        impl crate::generated::Table for Marker {
            const NAME: &'static str = NAME;
            fn is_known_column(name: &str) -> bool {
                matches!(
                    name,
                    "key" | "enabled" | "description" | "rules" | "created_at" | "updated_at"
                )
            }
        }

        #[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
        pub struct FeatureFlagsRow {
            pub key: String,
            pub enabled: bool,
            pub description: Option<String>,
            pub rules: serde_json::Value,
            pub created_at: chrono::DateTime<chrono::Utc>,
            pub updated_at: chrono::DateTime<chrono::Utc>,
        }

        #[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
        pub struct NewFeatureFlags {
            pub key: String,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub enabled: Option<bool>,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub description: Option<String>,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub rules: Option<serde_json::Value>,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub created_at: Option<chrono::DateTime<chrono::Utc>>,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub updated_at: Option<chrono::DateTime<chrono::Utc>>,
        }

        /// Returns a [`crate::generated::TypedBuilder`] bound to this table.
        pub fn select(client: &postgrest::Postgrest) -> crate::generated::TypedBuilder<Marker> {
            crate::generated::TypedBuilder::<Marker>::new(client)
        }

        /// Returns the raw `postgrest::Builder` bound to this table — escape hatch for embeds / inserts that aren't yet on `TypedBuilder`.
        pub fn from(client: &postgrest::Postgrest) -> postgrest::Builder {
            client.from(NAME)
        }
    }

    pub mod spark_receive_quotes {
        use super::*;
        /// PostgREST table identifier — checked against migrations at codegen time.
        pub const NAME: &str = "spark_receive_quotes";

        pub mod columns {
            pub const ID: &str = "id";
            pub const TYPE: &str = "type";
            pub const STATE: &str = "state";
            pub const CREATED_AT: &str = "created_at";
            pub const EXPIRES_AT: &str = "expires_at";
            pub const PAYMENT_HASH: &str = "payment_hash";
            pub const SPARK_ID: &str = "spark_id";
            pub const SPARK_TRANSFER_ID: &str = "spark_transfer_id";
            pub const RECEIVER_IDENTITY_PUBKEY: &str = "receiver_identity_pubkey";
            pub const USER_ID: &str = "user_id";
            pub const ACCOUNT_ID: &str = "account_id";
            pub const TRANSACTION_ID: &str = "transaction_id";
            pub const VERSION: &str = "version";
            pub const ENCRYPTED_DATA: &str = "encrypted_data";
            pub const FAILURE_REASON: &str = "failure_reason";
            pub const CASHU_TOKEN_MELT_INITIATED: &str = "cashu_token_melt_initiated";
        }

        /// Zero-sized marker — feeds [`crate::generated::TypedBuilder`].
        #[derive(Debug, Clone, Copy, Default)]
        pub struct Marker;
        impl crate::generated::Table for Marker {
            const NAME: &'static str = NAME;
            fn is_known_column(name: &str) -> bool {
                matches!(
                    name,
                    "id" | "type"
                        | "state"
                        | "created_at"
                        | "expires_at"
                        | "payment_hash"
                        | "spark_id"
                        | "spark_transfer_id"
                        | "receiver_identity_pubkey"
                        | "user_id"
                        | "account_id"
                        | "transaction_id"
                        | "version"
                        | "encrypted_data"
                        | "failure_reason"
                        | "cashu_token_melt_initiated"
                )
            }
        }

        #[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
        pub struct SparkReceiveQuotesRow {
            pub id: uuid::Uuid,
            #[serde(rename = "type")]
            pub r#type: crate::generated::enums::ReceiveQuoteType,
            pub state: crate::generated::enums::SparkReceiveQuoteState,
            pub created_at: chrono::DateTime<chrono::Utc>,
            pub expires_at: chrono::DateTime<chrono::Utc>,
            pub payment_hash: String,
            pub spark_id: String,
            pub spark_transfer_id: Option<String>,
            pub receiver_identity_pubkey: Option<String>,
            pub user_id: uuid::Uuid,
            pub account_id: uuid::Uuid,
            pub transaction_id: uuid::Uuid,
            pub version: i32,
            pub encrypted_data: String,
            pub failure_reason: Option<String>,
            pub cashu_token_melt_initiated: Option<bool>,
        }

        #[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
        pub struct NewSparkReceiveQuotes {
            #[serde(skip_serializing_if = "Option::is_none")]
            pub id: Option<uuid::Uuid>,
            #[serde(rename = "type")]
            pub r#type: crate::generated::enums::ReceiveQuoteType,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub state: Option<crate::generated::enums::SparkReceiveQuoteState>,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub created_at: Option<chrono::DateTime<chrono::Utc>>,
            pub expires_at: chrono::DateTime<chrono::Utc>,
            pub payment_hash: String,
            pub spark_id: String,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub spark_transfer_id: Option<String>,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub receiver_identity_pubkey: Option<String>,
            pub user_id: uuid::Uuid,
            pub account_id: uuid::Uuid,
            pub transaction_id: uuid::Uuid,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub version: Option<i32>,
            pub encrypted_data: String,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub failure_reason: Option<String>,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub cashu_token_melt_initiated: Option<bool>,
        }

        /// Returns a [`crate::generated::TypedBuilder`] bound to this table.
        pub fn select(client: &postgrest::Postgrest) -> crate::generated::TypedBuilder<Marker> {
            crate::generated::TypedBuilder::<Marker>::new(client)
        }

        /// Returns the raw `postgrest::Builder` bound to this table — escape hatch for embeds / inserts that aren't yet on `TypedBuilder`.
        pub fn from(client: &postgrest::Postgrest) -> postgrest::Builder {
            client.from(NAME)
        }
    }

    pub mod spark_send_quotes {
        use super::*;
        /// PostgREST table identifier — checked against migrations at codegen time.
        pub const NAME: &str = "spark_send_quotes";

        pub mod columns {
            pub const ID: &str = "id";
            pub const STATE: &str = "state";
            pub const CREATED_AT: &str = "created_at";
            pub const PAYMENT_HASH: &str = "payment_hash";
            pub const SPARK_ID: &str = "spark_id";
            pub const SPARK_TRANSFER_ID: &str = "spark_transfer_id";
            pub const FAILURE_REASON: &str = "failure_reason";
            pub const USER_ID: &str = "user_id";
            pub const ACCOUNT_ID: &str = "account_id";
            pub const TRANSACTION_ID: &str = "transaction_id";
            pub const VERSION: &str = "version";
            pub const PAYMENT_REQUEST_IS_AMOUNTLESS: &str = "payment_request_is_amountless";
            pub const EXPIRES_AT: &str = "expires_at";
            pub const ENCRYPTED_DATA: &str = "encrypted_data";
        }

        /// Zero-sized marker — feeds [`crate::generated::TypedBuilder`].
        #[derive(Debug, Clone, Copy, Default)]
        pub struct Marker;
        impl crate::generated::Table for Marker {
            const NAME: &'static str = NAME;
            fn is_known_column(name: &str) -> bool {
                matches!(
                    name,
                    "id" | "state"
                        | "created_at"
                        | "payment_hash"
                        | "spark_id"
                        | "spark_transfer_id"
                        | "failure_reason"
                        | "user_id"
                        | "account_id"
                        | "transaction_id"
                        | "version"
                        | "payment_request_is_amountless"
                        | "expires_at"
                        | "encrypted_data"
                )
            }
        }

        #[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
        pub struct SparkSendQuotesRow {
            pub id: uuid::Uuid,
            pub state: crate::generated::enums::SparkSendQuoteState,
            pub created_at: chrono::DateTime<chrono::Utc>,
            pub payment_hash: String,
            pub spark_id: Option<String>,
            pub spark_transfer_id: Option<String>,
            pub failure_reason: Option<String>,
            pub user_id: uuid::Uuid,
            pub account_id: uuid::Uuid,
            pub transaction_id: uuid::Uuid,
            pub version: i32,
            pub payment_request_is_amountless: bool,
            pub expires_at: Option<chrono::DateTime<chrono::Utc>>,
            pub encrypted_data: String,
        }

        #[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
        pub struct NewSparkSendQuotes {
            #[serde(skip_serializing_if = "Option::is_none")]
            pub id: Option<uuid::Uuid>,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub state: Option<crate::generated::enums::SparkSendQuoteState>,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub created_at: Option<chrono::DateTime<chrono::Utc>>,
            pub payment_hash: String,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub spark_id: Option<String>,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub spark_transfer_id: Option<String>,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub failure_reason: Option<String>,
            pub user_id: uuid::Uuid,
            pub account_id: uuid::Uuid,
            pub transaction_id: uuid::Uuid,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub version: Option<i32>,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub payment_request_is_amountless: Option<bool>,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub expires_at: Option<chrono::DateTime<chrono::Utc>>,
            pub encrypted_data: String,
        }

        /// Returns a [`crate::generated::TypedBuilder`] bound to this table.
        pub fn select(client: &postgrest::Postgrest) -> crate::generated::TypedBuilder<Marker> {
            crate::generated::TypedBuilder::<Marker>::new(client)
        }

        /// Returns the raw `postgrest::Builder` bound to this table — escape hatch for embeds / inserts that aren't yet on `TypedBuilder`.
        pub fn from(client: &postgrest::Postgrest) -> postgrest::Builder {
            client.from(NAME)
        }
    }

    pub mod task_processing_locks {
        use super::*;
        /// PostgREST table identifier — checked against migrations at codegen time.
        pub const NAME: &str = "task_processing_locks";

        pub mod columns {
            pub const USER_ID: &str = "user_id";
            pub const LEAD_CLIENT_ID: &str = "lead_client_id";
            pub const EXPIRES_AT: &str = "expires_at";
        }

        /// Zero-sized marker — feeds [`crate::generated::TypedBuilder`].
        #[derive(Debug, Clone, Copy, Default)]
        pub struct Marker;
        impl crate::generated::Table for Marker {
            const NAME: &'static str = NAME;
            fn is_known_column(name: &str) -> bool {
                matches!(name, "user_id" | "lead_client_id" | "expires_at")
            }
        }

        #[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
        pub struct TaskProcessingLocksRow {
            pub user_id: uuid::Uuid,
            pub lead_client_id: uuid::Uuid,
            pub expires_at: chrono::DateTime<chrono::Utc>,
        }

        #[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
        pub struct NewTaskProcessingLocks {
            pub user_id: uuid::Uuid,
            pub lead_client_id: uuid::Uuid,
            pub expires_at: chrono::DateTime<chrono::Utc>,
        }

        /// Returns a [`crate::generated::TypedBuilder`] bound to this table.
        pub fn select(client: &postgrest::Postgrest) -> crate::generated::TypedBuilder<Marker> {
            crate::generated::TypedBuilder::<Marker>::new(client)
        }

        /// Returns the raw `postgrest::Builder` bound to this table — escape hatch for embeds / inserts that aren't yet on `TypedBuilder`.
        pub fn from(client: &postgrest::Postgrest) -> postgrest::Builder {
            client.from(NAME)
        }
    }

    pub mod transactions {
        use super::*;
        /// PostgREST table identifier — checked against migrations at codegen time.
        pub const NAME: &str = "transactions";

        pub mod columns {
            pub const ID: &str = "id";
            pub const USER_ID: &str = "user_id";
            pub const DIRECTION: &str = "direction";
            pub const TYPE: &str = "type";
            pub const STATE: &str = "state";
            pub const ACCOUNT_ID: &str = "account_id";
            pub const CURRENCY: &str = "currency";
            pub const CREATED_AT: &str = "created_at";
            pub const PENDING_AT: &str = "pending_at";
            pub const COMPLETED_AT: &str = "completed_at";
            pub const FAILED_AT: &str = "failed_at";
            pub const REVERSED_TRANSACTION_ID: &str = "reversed_transaction_id";
            pub const REVERSED_AT: &str = "reversed_at";
            pub const STATE_SORT_ORDER: &str = "state_sort_order";
            pub const ENCRYPTED_TRANSACTION_DETAILS: &str = "encrypted_transaction_details";
            pub const ACKNOWLEDGMENT_STATUS: &str = "acknowledgment_status";
            pub const TRANSACTION_DETAILS: &str = "transaction_details";
            pub const VERSION: &str = "version";
            pub const PURPOSE: &str = "purpose";
            pub const ACCOUNT_NAME: &str = "account_name";
            pub const ACCOUNT_TYPE: &str = "account_type";
            pub const ACCOUNT_PURPOSE: &str = "account_purpose";
        }

        /// Zero-sized marker — feeds [`crate::generated::TypedBuilder`].
        #[derive(Debug, Clone, Copy, Default)]
        pub struct Marker;
        impl crate::generated::Table for Marker {
            const NAME: &'static str = NAME;
            fn is_known_column(name: &str) -> bool {
                matches!(
                    name,
                    "id" | "user_id"
                        | "direction"
                        | "type"
                        | "state"
                        | "account_id"
                        | "currency"
                        | "created_at"
                        | "pending_at"
                        | "completed_at"
                        | "failed_at"
                        | "reversed_transaction_id"
                        | "reversed_at"
                        | "state_sort_order"
                        | "encrypted_transaction_details"
                        | "acknowledgment_status"
                        | "transaction_details"
                        | "version"
                        | "purpose"
                        | "account_name"
                        | "account_type"
                        | "account_purpose"
                )
            }
        }

        #[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
        pub struct TransactionsRow {
            pub id: uuid::Uuid,
            pub user_id: uuid::Uuid,
            pub direction: crate::generated::enums::TransactionDirection,
            #[serde(rename = "type")]
            pub r#type: crate::generated::enums::TransactionType,
            pub state: crate::generated::enums::TransactionState,
            pub account_id: Option<uuid::Uuid>,
            pub currency: crate::generated::enums::Currency,
            pub created_at: chrono::DateTime<chrono::Utc>,
            pub pending_at: Option<chrono::DateTime<chrono::Utc>>,
            pub completed_at: Option<chrono::DateTime<chrono::Utc>>,
            pub failed_at: Option<chrono::DateTime<chrono::Utc>>,
            pub reversed_transaction_id: Option<uuid::Uuid>,
            pub reversed_at: Option<chrono::DateTime<chrono::Utc>>,
            pub state_sort_order: Option<i32>,
            pub encrypted_transaction_details: String,
            pub acknowledgment_status: Option<crate::generated::enums::AcknowledgmentStatus>,
            pub transaction_details: Option<serde_json::Value>,
            pub version: i32,
            pub purpose: crate::generated::enums::TransactionPurpose,
            pub account_name: String,
            pub account_type: crate::generated::enums::AccountType,
            pub account_purpose: crate::generated::enums::AccountPurpose,
        }

        #[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
        pub struct NewTransactions {
            #[serde(skip_serializing_if = "Option::is_none")]
            pub id: Option<uuid::Uuid>,
            pub user_id: uuid::Uuid,
            pub direction: crate::generated::enums::TransactionDirection,
            #[serde(rename = "type")]
            pub r#type: crate::generated::enums::TransactionType,
            pub state: crate::generated::enums::TransactionState,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub account_id: Option<uuid::Uuid>,
            pub currency: crate::generated::enums::Currency,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub created_at: Option<chrono::DateTime<chrono::Utc>>,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub pending_at: Option<chrono::DateTime<chrono::Utc>>,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub completed_at: Option<chrono::DateTime<chrono::Utc>>,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub failed_at: Option<chrono::DateTime<chrono::Utc>>,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub reversed_transaction_id: Option<uuid::Uuid>,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub reversed_at: Option<chrono::DateTime<chrono::Utc>>,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub state_sort_order: Option<i32>,
            pub encrypted_transaction_details: String,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub acknowledgment_status: Option<crate::generated::enums::AcknowledgmentStatus>,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub transaction_details: Option<serde_json::Value>,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub version: Option<i32>,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub purpose: Option<crate::generated::enums::TransactionPurpose>,
            pub account_name: String,
            pub account_type: crate::generated::enums::AccountType,
            pub account_purpose: crate::generated::enums::AccountPurpose,
        }

        /// Returns a [`crate::generated::TypedBuilder`] bound to this table.
        pub fn select(client: &postgrest::Postgrest) -> crate::generated::TypedBuilder<Marker> {
            crate::generated::TypedBuilder::<Marker>::new(client)
        }

        /// Returns the raw `postgrest::Builder` bound to this table — escape hatch for embeds / inserts that aren't yet on `TypedBuilder`.
        pub fn from(client: &postgrest::Postgrest) -> postgrest::Builder {
            client.from(NAME)
        }
    }

    pub mod users {
        use super::*;
        /// PostgREST table identifier — checked against migrations at codegen time.
        pub const NAME: &str = "users";

        pub mod columns {
            pub const ID: &str = "id";
            pub const CREATED_AT: &str = "created_at";
            pub const EMAIL: &str = "email";
            pub const EMAIL_VERIFIED: &str = "email_verified";
            pub const UPDATED_AT: &str = "updated_at";
            pub const DEFAULT_BTC_ACCOUNT_ID: &str = "default_btc_account_id";
            pub const DEFAULT_CURRENCY: &str = "default_currency";
            pub const DEFAULT_USD_ACCOUNT_ID: &str = "default_usd_account_id";
            pub const USERNAME: &str = "username";
            pub const CASHU_LOCKING_XPUB: &str = "cashu_locking_xpub";
            pub const ENCRYPTION_PUBLIC_KEY: &str = "encryption_public_key";
            pub const SPARK_IDENTITY_PUBLIC_KEY: &str = "spark_identity_public_key";
            pub const TERMS_ACCEPTED_AT: &str = "terms_accepted_at";
            pub const GIFT_CARD_MINT_TERMS_ACCEPTED_AT: &str = "gift_card_mint_terms_accepted_at";
        }

        /// Zero-sized marker — feeds [`crate::generated::TypedBuilder`].
        #[derive(Debug, Clone, Copy, Default)]
        pub struct Marker;
        impl crate::generated::Table for Marker {
            const NAME: &'static str = NAME;
            fn is_known_column(name: &str) -> bool {
                matches!(
                    name,
                    "id" | "created_at"
                        | "email"
                        | "email_verified"
                        | "updated_at"
                        | "default_btc_account_id"
                        | "default_currency"
                        | "default_usd_account_id"
                        | "username"
                        | "cashu_locking_xpub"
                        | "encryption_public_key"
                        | "spark_identity_public_key"
                        | "terms_accepted_at"
                        | "gift_card_mint_terms_accepted_at"
                )
            }
        }

        #[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
        pub struct UsersRow {
            pub id: uuid::Uuid,
            pub created_at: chrono::DateTime<chrono::Utc>,
            pub email: Option<String>,
            pub email_verified: bool,
            pub updated_at: chrono::DateTime<chrono::Utc>,
            pub default_btc_account_id: Option<uuid::Uuid>,
            pub default_currency: crate::generated::enums::Currency,
            pub default_usd_account_id: Option<uuid::Uuid>,
            pub username: String,
            pub cashu_locking_xpub: String,
            pub encryption_public_key: String,
            pub spark_identity_public_key: String,
            pub terms_accepted_at: Option<chrono::DateTime<chrono::Utc>>,
            pub gift_card_mint_terms_accepted_at: Option<chrono::DateTime<chrono::Utc>>,
        }

        #[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
        pub struct NewUsers {
            #[serde(skip_serializing_if = "Option::is_none")]
            pub id: Option<uuid::Uuid>,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub created_at: Option<chrono::DateTime<chrono::Utc>>,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub email: Option<String>,
            pub email_verified: bool,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub updated_at: Option<chrono::DateTime<chrono::Utc>>,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub default_btc_account_id: Option<uuid::Uuid>,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub default_currency: Option<crate::generated::enums::Currency>,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub default_usd_account_id: Option<uuid::Uuid>,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub username: Option<String>,
            pub cashu_locking_xpub: String,
            pub encryption_public_key: String,
            pub spark_identity_public_key: String,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub terms_accepted_at: Option<chrono::DateTime<chrono::Utc>>,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub gift_card_mint_terms_accepted_at: Option<chrono::DateTime<chrono::Utc>>,
        }

        /// Returns a [`crate::generated::TypedBuilder`] bound to this table.
        pub fn select(client: &postgrest::Postgrest) -> crate::generated::TypedBuilder<Marker> {
            crate::generated::TypedBuilder::<Marker>::new(client)
        }

        /// Returns the raw `postgrest::Builder` bound to this table — escape hatch for embeds / inserts that aren't yet on `TypedBuilder`.
        pub fn from(client: &postgrest::Postgrest) -> postgrest::Builder {
            client.from(NAME)
        }
    }
}

pub mod rpcs {
    use super::*;

    pub mod add_cashu_proofs {
        use super::*;
        pub const NAME: &str = "add_cashu_proofs";

        #[derive(Debug, Clone, Serialize)]
        pub struct Args {
            pub p_proofs: Vec<crate::generated::composites::CashuProofInput>,
            pub p_user_id: uuid::Uuid,
            pub p_account_id: uuid::Uuid,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub p_proofs_state: Option<crate::generated::enums::CashuProofState>,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub p_cashu_receive_quote_id: Option<uuid::Uuid>,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub p_cashu_receive_swap_token_hash: Option<String>,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub p_cashu_send_quote_id: Option<uuid::Uuid>,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub p_cashu_send_swap_id: Option<uuid::Uuid>,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub p_spending_cashu_send_swap_id: Option<uuid::Uuid>,
        }

        pub type Returns = Vec<crate::generated::tables::cashu_proofs::CashuProofsRow>;
    }

    pub mod add_cashu_proofs_and_update_account {
        use super::*;
        pub const NAME: &str = "add_cashu_proofs_and_update_account";

        #[derive(Debug, Clone, Serialize)]
        pub struct Args {
            pub p_proofs: Vec<crate::generated::composites::CashuProofInput>,
            pub p_user_id: uuid::Uuid,
            pub p_account_id: uuid::Uuid,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub p_proofs_state: Option<crate::generated::enums::CashuProofState>,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub p_cashu_receive_quote_id: Option<uuid::Uuid>,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub p_cashu_receive_swap_token_hash: Option<String>,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub p_cashu_send_quote_id: Option<uuid::Uuid>,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub p_cashu_send_swap_id: Option<uuid::Uuid>,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub p_spending_cashu_send_swap_id: Option<uuid::Uuid>,
        }

        pub type Returns = serde_json::Value;
    }

    pub mod check_not_self_contact {
        use super::*;
        pub const NAME: &str = "check_not_self_contact";

        #[derive(Debug, Clone, Serialize)]
        pub struct Args {
            pub owner_id: uuid::Uuid,
            pub contact_username: String,
        }

        pub type Returns = bool;
    }

    pub mod commit_proofs_to_send {
        use super::*;
        pub const NAME: &str = "commit_proofs_to_send";

        #[derive(Debug, Clone, Serialize)]
        pub struct Args {
            pub p_swap_id: uuid::Uuid,
            pub p_proofs_to_send: Vec<crate::generated::composites::CashuProofInput>,
            pub p_change_proofs: Vec<crate::generated::composites::CashuProofInput>,
            pub p_token_hash: String,
        }

        pub type Returns = serde_json::Value;
    }

    pub mod complete_cashu_receive_quote {
        use super::*;
        pub const NAME: &str = "complete_cashu_receive_quote";

        #[derive(Debug, Clone, Serialize)]
        pub struct Args {
            pub p_quote_id: uuid::Uuid,
            pub p_proofs: Vec<crate::generated::composites::CashuProofInput>,
        }

        pub type Returns = serde_json::Value;
    }

    pub mod complete_cashu_receive_swap {
        use super::*;
        pub const NAME: &str = "complete_cashu_receive_swap";

        #[derive(Debug, Clone, Serialize)]
        pub struct Args {
            pub p_token_hash: String,
            pub p_user_id: uuid::Uuid,
            pub p_proofs: Vec<crate::generated::composites::CashuProofInput>,
        }

        pub type Returns = serde_json::Value;
    }

    pub mod complete_cashu_send_quote {
        use super::*;
        pub const NAME: &str = "complete_cashu_send_quote";

        #[derive(Debug, Clone, Serialize)]
        pub struct Args {
            pub p_quote_id: uuid::Uuid,
            pub p_change_proofs: Vec<crate::generated::composites::CashuProofInput>,
            pub p_encrypted_data: String,
        }

        pub type Returns = serde_json::Value;
    }

    pub mod complete_cashu_send_swap {
        use super::*;
        pub const NAME: &str = "complete_cashu_send_swap";

        #[derive(Debug, Clone, Serialize)]
        pub struct Args {
            pub p_swap_id: uuid::Uuid,
        }

        pub type Returns = serde_json::Value;
    }

    pub mod complete_spark_receive_quote {
        use super::*;
        pub const NAME: &str = "complete_spark_receive_quote";

        #[derive(Debug, Clone, Serialize)]
        pub struct Args {
            pub p_quote_id: uuid::Uuid,
            pub p_spark_transfer_id: String,
            pub p_encrypted_data: String,
        }

        pub type Returns = crate::generated::tables::spark_receive_quotes::SparkReceiveQuotesRow;
    }

    pub mod complete_spark_send_quote {
        use super::*;
        pub const NAME: &str = "complete_spark_send_quote";

        #[derive(Debug, Clone, Serialize)]
        pub struct Args {
            pub p_quote_id: uuid::Uuid,
            pub p_encrypted_data: String,
        }

        pub type Returns = crate::generated::tables::spark_send_quotes::SparkSendQuotesRow;
    }

    pub mod create_cashu_receive_quote {
        use super::*;
        pub const NAME: &str = "create_cashu_receive_quote";

        #[derive(Debug, Clone, Serialize)]
        pub struct Args {
            pub p_user_id: uuid::Uuid,
            pub p_account_id: uuid::Uuid,
            pub p_currency: crate::generated::enums::Currency,
            pub p_expires_at: chrono::DateTime<chrono::Utc>,
            pub p_locking_derivation_path: String,
            pub p_receive_type: crate::generated::enums::ReceiveQuoteType,
            pub p_encrypted_data: String,
            pub p_quote_id_hash: String,
            pub p_payment_hash: String,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub p_purpose: Option<crate::generated::enums::TransactionPurpose>,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub p_transfer_id: Option<uuid::Uuid>,
        }

        pub type Returns = crate::generated::tables::cashu_receive_quotes::CashuReceiveQuotesRow;
    }

    pub mod create_cashu_receive_swap {
        use super::*;
        pub const NAME: &str = "create_cashu_receive_swap";

        #[derive(Debug, Clone, Serialize)]
        pub struct Args {
            pub p_token_hash: String,
            pub p_account_id: uuid::Uuid,
            pub p_user_id: uuid::Uuid,
            pub p_currency: crate::generated::enums::Currency,
            pub p_keyset_id: String,
            pub p_number_of_outputs: i32,
            pub p_encrypted_data: String,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub p_reversed_transaction_id: Option<uuid::Uuid>,
        }

        pub type Returns = serde_json::Value;
    }

    pub mod create_cashu_send_quote {
        use super::*;
        pub const NAME: &str = "create_cashu_send_quote";

        #[derive(Debug, Clone, Serialize)]
        pub struct Args {
            pub p_user_id: uuid::Uuid,
            pub p_account_id: uuid::Uuid,
            pub p_currency: crate::generated::enums::Currency,
            pub p_expires_at: chrono::DateTime<chrono::Utc>,
            pub p_currency_requested: crate::generated::enums::Currency,
            pub p_keyset_id: String,
            pub p_number_of_change_outputs: i32,
            pub p_proofs_to_send: Vec<uuid::Uuid>,
            pub p_encrypted_data: String,
            pub p_quote_id_hash: String,
            pub p_payment_hash: String,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub p_purpose: Option<crate::generated::enums::TransactionPurpose>,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub p_transfer_id: Option<uuid::Uuid>,
        }

        pub type Returns = serde_json::Value;
    }

    pub mod create_cashu_send_swap {
        use super::*;
        pub const NAME: &str = "create_cashu_send_swap";

        #[derive(Debug, Clone, Serialize)]
        pub struct Args {
            pub p_user_id: uuid::Uuid,
            pub p_account_id: uuid::Uuid,
            pub p_input_proofs: Vec<uuid::Uuid>,
            pub p_currency: crate::generated::enums::Currency,
            pub p_encrypted_data: String,
            pub p_requires_input_proofs_swap: bool,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub p_token_hash: Option<String>,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub p_keyset_id: Option<String>,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub p_number_of_outputs: Option<i32>,
        }

        pub type Returns = serde_json::Value;
    }

    pub mod create_spark_receive_quote {
        use super::*;
        pub const NAME: &str = "create_spark_receive_quote";

        #[derive(Debug, Clone, Serialize)]
        pub struct Args {
            pub p_user_id: uuid::Uuid,
            pub p_account_id: uuid::Uuid,
            pub p_currency: crate::generated::enums::Currency,
            pub p_payment_hash: String,
            pub p_expires_at: chrono::DateTime<chrono::Utc>,
            pub p_spark_id: String,
            pub p_receiver_identity_pubkey: String,
            pub p_receive_type: crate::generated::enums::ReceiveQuoteType,
            pub p_encrypted_data: String,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub p_purpose: Option<crate::generated::enums::TransactionPurpose>,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub p_transfer_id: Option<uuid::Uuid>,
        }

        pub type Returns = crate::generated::tables::spark_receive_quotes::SparkReceiveQuotesRow;
    }

    pub mod create_spark_send_quote {
        use super::*;
        pub const NAME: &str = "create_spark_send_quote";

        #[derive(Debug, Clone, Serialize)]
        pub struct Args {
            pub p_user_id: uuid::Uuid,
            pub p_account_id: uuid::Uuid,
            pub p_currency: crate::generated::enums::Currency,
            pub p_payment_hash: String,
            pub p_payment_request_is_amountless: bool,
            pub p_encrypted_data: String,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub p_expires_at: Option<chrono::DateTime<chrono::Utc>>,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub p_purpose: Option<crate::generated::enums::TransactionPurpose>,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub p_transfer_id: Option<uuid::Uuid>,
        }

        pub type Returns = crate::generated::tables::spark_send_quotes::SparkSendQuotesRow;
    }

    pub mod evaluate_feature_flags {
        use super::*;
        pub const NAME: &str = "evaluate_feature_flags";

        #[derive(Debug, Clone, Serialize)]
        pub struct Args {}

        pub type Returns = serde_json::Value;
    }

    pub mod expire_cashu_receive_quote {
        use super::*;
        pub const NAME: &str = "expire_cashu_receive_quote";

        #[derive(Debug, Clone, Serialize)]
        pub struct Args {
            pub p_quote_id: uuid::Uuid,
        }

        pub type Returns = crate::generated::tables::cashu_receive_quotes::CashuReceiveQuotesRow;
    }

    pub mod expire_cashu_send_quote {
        use super::*;
        pub const NAME: &str = "expire_cashu_send_quote";

        #[derive(Debug, Clone, Serialize)]
        pub struct Args {
            pub p_quote_id: uuid::Uuid,
        }

        pub type Returns = serde_json::Value;
    }

    pub mod expire_spark_receive_quote {
        use super::*;
        pub const NAME: &str = "expire_spark_receive_quote";

        #[derive(Debug, Clone, Serialize)]
        pub struct Args {
            pub p_quote_id: uuid::Uuid,
        }

        pub type Returns = crate::generated::tables::spark_receive_quotes::SparkReceiveQuotesRow;
    }

    pub mod fail_cashu_receive_quote {
        use super::*;
        pub const NAME: &str = "fail_cashu_receive_quote";

        #[derive(Debug, Clone, Serialize)]
        pub struct Args {
            pub p_quote_id: uuid::Uuid,
            pub p_failure_reason: String,
        }

        pub type Returns = crate::generated::tables::cashu_receive_quotes::CashuReceiveQuotesRow;
    }

    pub mod fail_cashu_receive_swap {
        use super::*;
        pub const NAME: &str = "fail_cashu_receive_swap";

        #[derive(Debug, Clone, Serialize)]
        pub struct Args {
            pub p_token_hash: String,
            pub p_user_id: uuid::Uuid,
            pub p_failure_reason: String,
        }

        pub type Returns = crate::generated::tables::cashu_receive_swaps::CashuReceiveSwapsRow;
    }

    pub mod fail_cashu_send_quote {
        use super::*;
        pub const NAME: &str = "fail_cashu_send_quote";

        #[derive(Debug, Clone, Serialize)]
        pub struct Args {
            pub p_quote_id: uuid::Uuid,
            pub p_failure_reason: String,
        }

        pub type Returns = serde_json::Value;
    }

    pub mod fail_cashu_send_swap {
        use super::*;
        pub const NAME: &str = "fail_cashu_send_swap";

        #[derive(Debug, Clone, Serialize)]
        pub struct Args {
            pub p_swap_id: uuid::Uuid,
            pub p_reason: String,
        }

        pub type Returns = serde_json::Value;
    }

    pub mod fail_spark_receive_quote {
        use super::*;
        pub const NAME: &str = "fail_spark_receive_quote";

        #[derive(Debug, Clone, Serialize)]
        pub struct Args {
            pub p_quote_id: uuid::Uuid,
            pub p_failure_reason: String,
        }

        pub type Returns = crate::generated::tables::spark_receive_quotes::SparkReceiveQuotesRow;
    }

    pub mod fail_spark_send_quote {
        use super::*;
        pub const NAME: &str = "fail_spark_send_quote";

        #[derive(Debug, Clone, Serialize)]
        pub struct Args {
            pub p_quote_id: uuid::Uuid,
            pub p_failure_reason: String,
        }

        pub type Returns = crate::generated::tables::spark_send_quotes::SparkSendQuotesRow;
    }

    pub mod find_contact_candidates {
        use super::*;
        pub const NAME: &str = "find_contact_candidates";

        #[derive(Debug, Clone, Serialize)]
        pub struct Args {
            pub partial_username: String,
            pub current_user_id: uuid::Uuid,
        }

        pub type Returns = Vec<serde_json::Value>;
    }

    pub mod get_account_proofs {
        use super::*;
        pub const NAME: &str = "get_account_proofs";

        #[derive(Debug, Clone, Serialize)]
        pub struct Args {
            pub p_account_id: uuid::Uuid,
        }

        pub type Returns = Vec<crate::generated::tables::cashu_proofs::CashuProofsRow>;
    }

    pub mod get_account_with_proofs {
        use super::*;
        pub const NAME: &str = "get_account_with_proofs";

        #[derive(Debug, Clone, Serialize)]
        pub struct Args {
            pub p_account_id: uuid::Uuid,
        }

        pub type Returns = serde_json::Value;
    }

    pub mod is_feature_enabled {
        use super::*;
        pub const NAME: &str = "is_feature_enabled";

        #[derive(Debug, Clone, Serialize)]
        pub struct Args {
            pub p_flag_key: String,
        }

        pub type Returns = bool;
    }

    pub mod list_transactions {
        use super::*;
        pub const NAME: &str = "list_transactions";

        #[derive(Debug, Clone, Serialize)]
        pub struct Args {
            pub p_user_id: uuid::Uuid,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub p_cursor_state_sort_order: Option<i32>,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub p_cursor_created_at: Option<chrono::DateTime<chrono::Utc>>,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub p_cursor_id: Option<uuid::Uuid>,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub p_page_size: Option<i32>,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub p_account_id: Option<uuid::Uuid>,
        }

        pub type Returns = Vec<crate::generated::tables::transactions::TransactionsRow>;
    }

    pub mod mark_cashu_receive_quote_cashu_token_melt_initiated {
        use super::*;
        pub const NAME: &str = "mark_cashu_receive_quote_cashu_token_melt_initiated";

        #[derive(Debug, Clone, Serialize)]
        pub struct Args {
            pub p_quote_id: uuid::Uuid,
        }

        pub type Returns = crate::generated::tables::cashu_receive_quotes::CashuReceiveQuotesRow;
    }

    pub mod mark_cashu_send_quote_as_pending {
        use super::*;
        pub const NAME: &str = "mark_cashu_send_quote_as_pending";

        #[derive(Debug, Clone, Serialize)]
        pub struct Args {
            pub p_quote_id: uuid::Uuid,
        }

        pub type Returns = serde_json::Value;
    }

    pub mod mark_spark_receive_quote_cashu_token_melt_initiated {
        use super::*;
        pub const NAME: &str = "mark_spark_receive_quote_cashu_token_melt_initiated";

        #[derive(Debug, Clone, Serialize)]
        pub struct Args {
            pub p_quote_id: uuid::Uuid,
        }

        pub type Returns = crate::generated::tables::spark_receive_quotes::SparkReceiveQuotesRow;
    }

    pub mod mark_spark_send_quote_as_pending {
        use super::*;
        pub const NAME: &str = "mark_spark_send_quote_as_pending";

        #[derive(Debug, Clone, Serialize)]
        pub struct Args {
            pub p_quote_id: uuid::Uuid,
            pub p_spark_id: String,
            pub p_spark_transfer_id: String,
            pub p_encrypted_data: String,
        }

        pub type Returns = crate::generated::tables::spark_send_quotes::SparkSendQuotesRow;
    }

    pub mod process_cashu_receive_quote_payment {
        use super::*;
        pub const NAME: &str = "process_cashu_receive_quote_payment";

        #[derive(Debug, Clone, Serialize)]
        pub struct Args {
            pub p_quote_id: uuid::Uuid,
            pub p_keyset_id: String,
            pub p_number_of_outputs: i32,
            pub p_encrypted_data: String,
        }

        pub type Returns = serde_json::Value;
    }

    pub mod take_lead {
        use super::*;
        pub const NAME: &str = "take_lead";

        #[derive(Debug, Clone, Serialize)]
        pub struct Args {
            pub p_user_id: uuid::Uuid,
            pub p_client_id: uuid::Uuid,
        }

        pub type Returns = bool;
    }

    pub mod to_account_with_proofs {
        use super::*;
        pub const NAME: &str = "to_account_with_proofs";

        #[derive(Debug, Clone, Serialize)]
        pub struct Args {
            pub p_account: crate::generated::tables::accounts::AccountsRow,
        }

        pub type Returns = serde_json::Value;
    }

    pub mod upsert_user_with_accounts {
        use super::*;
        pub const NAME: &str = "upsert_user_with_accounts";

        #[derive(Debug, Clone, Serialize)]
        pub struct Args {
            pub p_user_id: uuid::Uuid,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub p_email: Option<String>,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub p_email_verified: Option<bool>,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub p_accounts: Option<Vec<crate::generated::composites::AccountInput>>,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub p_cashu_locking_xpub: Option<String>,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub p_encryption_public_key: Option<String>,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub p_spark_identity_public_key: Option<String>,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub p_terms_accepted_at: Option<chrono::DateTime<chrono::Utc>>,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub p_gift_card_mint_terms_accepted_at: Option<chrono::DateTime<chrono::Utc>>,
        }

        pub type Returns = serde_json::Value;
    }
}
