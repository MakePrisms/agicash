use crate::composition::{AuthDeps, StorageDeps};
use agicash_domain::{AccountId, Currency, UserId};
use agicash_traits::{AuthError, StorageError, UpdateUserDefaults, UserStorage};
use uuid::Uuid;

#[derive(Debug, thiserror::Error)]
pub enum AccountCmdError {
    #[error("not logged in")]
    NotLoggedIn,
    #[error("invalid account id (expected UUID): {0}")]
    InvalidId(String),
    #[error("account not found: {0}")]
    NotFound(AccountId),
    #[error("currency {0:?} not supported for default-account selection (only BTC and USD)")]
    UnsupportedCurrency(Currency),
    #[error(transparent)]
    Auth(#[from] AuthError),
    #[error(transparent)]
    Storage(#[from] StorageError),
}

pub async fn cmd_list(auth: &AuthDeps, storage: &StorageDeps) -> Result<(), AccountCmdError> {
    let session = auth
        .storage
        .load()
        .await?
        .ok_or(AccountCmdError::NotLoggedIn)?;
    let user_id = UserId::from(session.user_id);
    let accounts = storage.storage.list_accounts(user_id).await?;
    println!(
        "{}",
        serde_json::to_string(&accounts).expect("serialize accounts")
    );
    Ok(())
}

pub async fn cmd_set_default(
    auth: &AuthDeps,
    storage: &StorageDeps,
    id_str: &str,
) -> Result<(), AccountCmdError> {
    let session = auth
        .storage
        .load()
        .await?
        .ok_or(AccountCmdError::NotLoggedIn)?;
    let user_id = UserId::from(session.user_id);

    let parsed = Uuid::parse_str(id_str).map_err(|_| AccountCmdError::InvalidId(id_str.into()))?;
    let account_id = AccountId::from(parsed);

    // Look up the account to figure out which per-currency slot to set.
    let accounts = storage.storage.list_accounts(user_id).await?;
    let account = accounts
        .into_iter()
        .find(|a| a.id == account_id)
        .ok_or(AccountCmdError::NotFound(account_id))?;

    let patch = match account.currency {
        Currency::Btc => UpdateUserDefaults {
            default_btc_account_id: Some(Some(account_id)),
            ..Default::default()
        },
        Currency::Usd => UpdateUserDefaults {
            default_usd_account_id: Some(Some(account_id)),
            ..Default::default()
        },
        other => return Err(AccountCmdError::UnsupportedCurrency(other)),
    };

    let user = storage.storage.update_user_defaults(user_id, patch).await?;
    println!(
        "{}",
        serde_json::to_string(&user).expect("serialize user")
    );
    Ok(())
}
