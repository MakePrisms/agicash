use crate::{map_json_error, map_network_error, map_postgrest_error, SupabaseStorage};
use agicash_domain::{Account, AccountId, User, UserId};
use agicash_traits::{StorageError, UpsertUserInput, UpsertUserResult, UserStorage};
use async_trait::async_trait;

#[async_trait]
impl UserStorage for SupabaseStorage {
    async fn upsert_user_with_accounts(
        &self,
        input: UpsertUserInput,
    ) -> Result<UpsertUserResult, StorageError> {
        let client = self.authenticated_client().await?;
        let body = serde_json::to_string(&input).map_err(map_json_error)?;
        let response = client
            .rpc("upsert_user_with_accounts", body)
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
        serde_json::from_str::<UpsertUserResult>(&text).map_err(map_json_error)
    }

    async fn get_user(&self, user_id: UserId) -> Result<Option<User>, StorageError> {
        let client = self.authenticated_client().await?;
        let response = client
            .from("users")
            .select("*")
            .eq("id", user_id.to_string())
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
        let rows: Vec<User> = serde_json::from_str(&body).map_err(map_json_error)?;
        Ok(rows.into_iter().next())
    }

    async fn list_accounts(&self, user_id: UserId) -> Result<Vec<Account>, StorageError> {
        let client = self.authenticated_client().await?;
        let response = client
            .from("accounts")
            .select("*")
            .eq("user_id", user_id.to_string())
            .eq("state", "active")
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
        serde_json::from_str::<Vec<Account>>(&body).map_err(map_json_error)
    }

    async fn get_account(
        &self,
        account_id: AccountId,
    ) -> Result<Option<Account>, StorageError> {
        let client = self.authenticated_client().await?;
        let response = client
            .from("accounts")
            .select("*")
            .eq("id", account_id.to_string())
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
        let rows: Vec<Account> = serde_json::from_str(&body).map_err(map_json_error)?;
        Ok(rows.into_iter().next())
    }
}
