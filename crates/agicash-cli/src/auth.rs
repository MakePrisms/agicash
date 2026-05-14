use crate::composition::AuthDeps;
use agicash_auth_opensecret::{login_email, logout, register_guest};
use agicash_traits::{AuthError, PersistedSession, SessionStorage};

fn random_password() -> String {
    // 16 cryptographically-random bytes => 32 hex chars of entropy.
    // getrandom is the standard cross-platform CSPRNG wrapper (macOS
    // SecRandomCopyBytes, Linux getrandom syscall, Windows BCryptGenRandom).
    let mut buf = [0u8; 16];
    getrandom::getrandom(&mut buf).expect("OS RNG must be available");
    hex::encode(buf)
}

pub async fn cmd_guest(deps: &AuthDeps) -> Result<(), AuthError> {
    let password = random_password();
    let resp = register_guest(&deps.client, password, deps.client.client_id()).await?;
    let session = PersistedSession {
        user_id: resp.id,
        refresh_token: resp.refresh_token.clone(),
    };
    deps.storage.store(&session).await?;
    println!("signed in as guest {}", resp.id);
    Ok(())
}

pub async fn cmd_login(deps: &AuthDeps, email: String) -> Result<(), AuthError> {
    let password = rpassword::prompt_password("Password: ")
        .map_err(|e| AuthError::Internal(format!("read password: {e}")))?;
    let resp = login_email(&deps.client, email, password, deps.client.client_id()).await?;
    let session = PersistedSession {
        user_id: resp.id,
        refresh_token: resp.refresh_token.clone(),
    };
    deps.storage.store(&session).await?;
    println!("signed in as {}", resp.id);
    Ok(())
}

pub async fn cmd_logout(deps: &AuthDeps) -> Result<(), AuthError> {
    if deps.storage.load().await?.is_none() {
        println!("not logged in");
        return Ok(());
    }
    // Best-effort server logout. Even if the server call fails (e.g.,
    // network error or expired session), we clear local state so the
    // command is idempotent.
    if let Err(e) = logout(&deps.client).await {
        eprintln!("warning: server logout failed: {e}");
    }
    deps.storage.clear().await?;
    println!("signed out");
    Ok(())
}

pub async fn cmd_status(deps: &AuthDeps) -> Result<(), AuthError> {
    match deps.storage.load().await? {
        None => {
            println!("not logged in");
        }
        Some(session) => {
            println!("logged in as {}", session.user_id);
        }
    }
    Ok(())
}
