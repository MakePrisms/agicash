use crate::composition::{AuthDeps, StorageDeps};
use agicash_domain::UserId;
use agicash_traits::{AuthError, StorageError, UserStorage};

#[derive(Debug, thiserror::Error)]
pub enum AccountCmdError {
    #[error("not logged in")]
    NotLoggedIn,
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
