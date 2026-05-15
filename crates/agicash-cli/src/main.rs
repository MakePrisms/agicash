mod account;
mod auth;
mod cli;
mod composition;

use account::AccountCmdError;
use agicash_traits::{AuthError, StorageError};
use clap::Parser;
use cli::{AccountCommand, AuthCommand, Cli, Command};
use composition::{build_auth_deps, build_storage_deps, rehydrate_session};
use serde::Serialize;

#[derive(Serialize)]
struct VersionOutput<'a> {
    version: &'a str,
}

#[derive(Serialize)]
struct ErrorBody<'a> {
    code: &'a str,
    message: String,
}

#[derive(Serialize)]
struct ErrorOutput<'a> {
    error: ErrorBody<'a>,
}

/// Map a boxed CLI error to (error code, exit code).
///
/// Exit codes:
///   - `3` for "auth required" conditions (no session, unauthenticated)
///   - `1` for everything else
fn classify_error(e: &(dyn std::error::Error + 'static)) -> (&'static str, i32) {
    if let Some(acc) = e.downcast_ref::<AccountCmdError>() {
        return match acc {
            AccountCmdError::NotLoggedIn => ("not-logged-in", 3),
            AccountCmdError::Auth(inner) => classify_auth(inner),
            AccountCmdError::Storage(inner) => (classify_storage(inner), 1),
        };
    }
    if let Some(auth) = e.downcast_ref::<AuthError>() {
        return classify_auth(auth);
    }
    if let Some(st) = e.downcast_ref::<StorageError>() {
        return (classify_storage(st), 1);
    }
    ("unknown", 1)
}

fn classify_auth(e: &AuthError) -> (&'static str, i32) {
    match e {
        AuthError::Network(_) => ("network-error", 1),
        AuthError::Unauthenticated => ("unauthenticated", 3),
        AuthError::Backend(_) => ("auth-backend-error", 1),
        AuthError::Internal(_) => ("internal-error", 1),
    }
}

fn classify_storage(e: &StorageError) -> &'static str {
    match e {
        StorageError::Network(_) => "network-error",
        StorageError::NotFound => "not-found",
        StorageError::Backend(_) => "storage-backend-error",
        StorageError::Internal(_) => "internal-error",
    }
}

#[tokio::main]
async fn main() {
    let _ = dotenvy::dotenv();

    let args = Cli::parse();
    let exit_code = match run(args).await {
        Ok(()) => 0,
        Err(e) => {
            let (code, exit) = classify_error(e.as_ref());
            let body = ErrorOutput {
                error: ErrorBody {
                    code,
                    message: e.to_string(),
                },
            };
            eprintln!(
                "{}",
                serde_json::to_string(&body).expect("serialize error JSON")
            );
            exit
        }
    };
    std::process::exit(exit_code);
}

async fn run(args: Cli) -> Result<(), Box<dyn std::error::Error>> {
    // Version doesn't need auth or env vars — handle it before building deps.
    if let Some(Command::Version) = args.cmd {
        println!(
            "{}",
            serde_json::to_string(&VersionOutput {
                version: env!("CARGO_PKG_VERSION"),
            })
            .expect("serialize version JSON")
        );
        return Ok(());
    }

    let auth_deps = build_auth_deps()?;
    // Hydrate the in-memory SDK from the keyring once at startup so every
    // subcommand inherits a live session when one exists on disk. A failed
    // refresh clears the keyring inside the helper; we swallow the error
    // so commands like `auth status` and `auth logout` still run and
    // report the resulting logged-out state.
    let _ = rehydrate_session(&auth_deps).await;

    match args.cmd {
        Some(Command::Version) => unreachable!("handled above"),
        Some(Command::Auth(a)) => match a.cmd {
            AuthCommand::Guest => auth::cmd_guest(&auth_deps).await?,
            AuthCommand::Login { email } => auth::cmd_login(&auth_deps, email).await?,
            AuthCommand::Logout => auth::cmd_logout(&auth_deps).await?,
            AuthCommand::Status => auth::cmd_status(&auth_deps).await?,
        },
        Some(Command::Account(a)) => match a.cmd {
            AccountCommand::List => {
                let storage_deps = build_storage_deps(&auth_deps)?;
                account::cmd_list(&auth_deps, &storage_deps).await?;
            }
        },
        None => {}
    }
    Ok(())
}
