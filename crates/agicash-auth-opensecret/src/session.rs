use crate::error::auth_error_from_opensecret;
use crate::OpenSecretClient;
use agicash_traits::AuthError;
use uuid::Uuid;

pub async fn login_email(
    client: &OpenSecretClient,
    email: String,
    password: String,
    client_id: Uuid,
) -> Result<opensecret::LoginResponse, AuthError> {
    client.ensure_handshake().await?;
    client
        .inner()
        .login(email, password, client_id)
        .await
        .map_err(auth_error_from_opensecret)
}

pub async fn login_guest_by_id(
    client: &OpenSecretClient,
    id: Uuid,
    password: String,
    client_id: Uuid,
) -> Result<opensecret::LoginResponse, AuthError> {
    client.ensure_handshake().await?;
    client
        .inner()
        .login_with_id(id, password, client_id)
        .await
        .map_err(auth_error_from_opensecret)
}

pub async fn register_guest(
    client: &OpenSecretClient,
    password: String,
    client_id: Uuid,
) -> Result<opensecret::LoginResponse, AuthError> {
    client.ensure_handshake().await?;
    client
        .inner()
        .register_guest(password, client_id)
        .await
        .map_err(auth_error_from_opensecret)
}

pub async fn register_email(
    client: &OpenSecretClient,
    email: String,
    password: String,
    client_id: Uuid,
    name: Option<String>,
) -> Result<opensecret::LoginResponse, AuthError> {
    client.ensure_handshake().await?;
    client
        .inner()
        .register(email, password, client_id, name)
        .await
        .map_err(auth_error_from_opensecret)
}

pub async fn logout(client: &OpenSecretClient) -> Result<(), AuthError> {
    client.ensure_handshake().await?;
    client
        .inner()
        .logout()
        .await
        .map_err(auth_error_from_opensecret)
}

pub async fn refresh(client: &OpenSecretClient) -> Result<(), AuthError> {
    client.ensure_handshake().await?;
    client
        .inner()
        .refresh_token()
        .await
        .map_err(auth_error_from_opensecret)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[allow(dead_code)]
    async fn _typecheck(client: &OpenSecretClient) {
        let _: Result<opensecret::LoginResponse, AuthError> =
            login_email(client, "a@b.test".into(), "pw".into(), Uuid::nil()).await;
        let _: Result<opensecret::LoginResponse, AuthError> =
            login_guest_by_id(client, Uuid::nil(), "pw".into(), Uuid::nil()).await;
        let _: Result<opensecret::LoginResponse, AuthError> =
            register_guest(client, "pw".into(), Uuid::nil()).await;
        let _: Result<opensecret::LoginResponse, AuthError> =
            register_email(client, "a@b.test".into(), "pw".into(), Uuid::nil(), None).await;
        let _: Result<(), AuthError> = logout(client).await;
        let _: Result<(), AuthError> = refresh(client).await;
    }
}
