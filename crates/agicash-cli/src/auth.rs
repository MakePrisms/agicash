use crate::composition::AuthDeps;
use agicash_auth_opensecret::{
    auth_error_from_opensecret, login_email, logout, register_email, register_guest,
};
use agicash_traits::{AuthError, PersistedSession};
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

pub async fn cmd_signup(deps: &AuthDeps, email: String) -> Result<(), AuthError> {
    // Prompt twice to match the web `confirm-password` field. We keep the
    // confirmation enforcement here so a typo doesn't silently create an
    // account whose password the operator can't reproduce.
    let password = rpassword::prompt_password("Password: ")
        .map_err(|e| AuthError::Internal(format!("read password: {e}")))?;
    let confirm = rpassword::prompt_password("Confirm password: ")
        .map_err(|e| AuthError::Internal(format!("read password: {e}")))?;
    if password != confirm {
        return Err(AuthError::Internal("passwords do not match".into()));
    }
    if password.len() < 8 {
        return Err(AuthError::Internal(
            "password must have at least 8 characters".into(),
        ));
    }
    let resp = register_email(&deps.client, email, password, deps.client.client_id(), None).await?;
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

/// Load any persisted refresh token into the in-memory `OpenSecretClient`
/// so subsequent `TokenProvider::get_jwt()` calls succeed.
///
/// Returns `true` if a session was hydrated, `false` if the keyring was
/// empty. On refresh failure the keyring entry is cleared so the user
/// isn't stuck with a stale refresh token.
///
/// Call this from any command path that exercises `TokenProvider` before
/// the first request; commands that only need the local `PersistedSession`
/// (e.g. `auth status`) can skip it.
pub async fn rehydrate_session(deps: &AuthDeps) -> Result<bool, AuthError> {
    let Some(persisted) = deps.storage.load().await? else {
        return Ok(false);
    };

    deps.client.ensure_handshake().await?;

    // The SDK's `refresh_token()` only consults the refresh slot; the access
    // string is rewritten on success. Empty placeholder is fine here.
    deps.client
        .inner()
        .set_tokens(String::new(), Some(persisted.refresh_token))
        .map_err(auth_error_from_opensecret)?;

    if let Err(e) = deps.client.inner().refresh_token().await {
        // The stored refresh token is no good — wipe it so future runs
        // don't keep retrying the same dead session. If the wipe itself
        // fails (e.g. macOS keychain locked, permission revoked), surface
        // it as a stderr diagnostic so the user has a signal — without it
        // they'd be stuck in a loop with a stale session.
        if let Err(clear_err) = deps.storage.clear().await {
            eprintln!("warning: could not clear stale session: {clear_err}");
        }
        return Err(auth_error_from_opensecret(e));
    }

    Ok(true)
}
