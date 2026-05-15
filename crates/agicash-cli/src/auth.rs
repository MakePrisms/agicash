use crate::composition::AuthDeps;
use agicash_auth_opensecret::{login_email, logout, register_guest};
use agicash_traits::{AuthError, PersistedSession, SessionStorage};
use serde::Serialize;

#[derive(Serialize)]
struct SignedIn<'a> {
    status: &'a str,
    user_id: String,
    guest: bool,
}

#[derive(Serialize)]
#[serde(untagged)]
enum StatusOutput {
    LoggedIn { logged_in: bool, user_id: String },
    LoggedOut { logged_in: bool },
}

#[derive(Serialize)]
struct LogoutOutput<'a> {
    status: &'a str,
}

fn random_password() -> String {
    // 16 cryptographically-random bytes => 32 hex chars of entropy.
    // getrandom is the standard cross-platform CSPRNG wrapper (macOS
    // SecRandomCopyBytes, Linux getrandom syscall, Windows BCryptGenRandom).
    let mut buf = [0u8; 16];
    getrandom::getrandom(&mut buf).expect("OS RNG must be available");
    hex::encode(buf)
}

fn print_json<T: Serialize>(value: &T) {
    // Stdout is the structured result channel; agents parse line-by-line.
    println!("{}", serde_json::to_string(value).expect("serialize JSON"));
}

pub async fn cmd_guest(deps: &AuthDeps) -> Result<(), AuthError> {
    let password = random_password();
    let resp = register_guest(&deps.client, password, deps.client.client_id()).await?;
    let session = PersistedSession {
        user_id: resp.id,
        refresh_token: resp.refresh_token.clone(),
    };
    deps.storage.store(&session).await?;
    print_json(&SignedIn {
        status: "signed-in",
        user_id: resp.id.to_string(),
        guest: true,
    });
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
    print_json(&SignedIn {
        status: "signed-in",
        user_id: resp.id.to_string(),
        guest: false,
    });
    Ok(())
}

pub async fn cmd_logout(deps: &AuthDeps) -> Result<(), AuthError> {
    if deps.storage.load().await?.is_none() {
        print_json(&LogoutOutput {
            status: "not-logged-in",
        });
        return Ok(());
    }
    // Best-effort server logout. Even if the server call fails (e.g.,
    // network error or expired session), we clear local state so the
    // command is idempotent.
    if let Err(e) = logout(&deps.client).await {
        eprintln!("warning: server logout failed: {e}");
    }
    deps.storage.clear().await?;
    print_json(&LogoutOutput {
        status: "signed-out",
    });
    Ok(())
}

pub async fn cmd_status(deps: &AuthDeps) -> Result<(), AuthError> {
    let out = match deps.storage.load().await? {
        None => StatusOutput::LoggedOut { logged_in: false },
        Some(session) => StatusOutput::LoggedIn {
            logged_in: true,
            user_id: session.user_id.to_string(),
        },
    };
    print_json(&out);
    Ok(())
}
