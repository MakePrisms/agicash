mod account;
mod auth;
mod cli;
mod composition;
mod mint;
mod receive;
mod receive_lightning;
mod send;

use account::AccountCmdError;
use agicash_cashu::{
    MintQuoteError, MintQuoteStorageError, ReceiveSwapError, ReceiveSwapStorageError,
    SendSwapError, SendSwapStorageError,
};
use agicash_traits::{AuthError, CashuProviderError, StorageError};
use auth::rehydrate_session;
use clap::Parser;
use cli::{AccountCommand, AuthCommand, Cli, Command, MintCommand, ReceiveCommand};
use composition::{
    build_auth_deps, build_cashu_deps, build_exchange_rate_deps, build_mint_quote_deps,
    build_receive_swap_deps, build_send_swap_deps, build_storage_deps,
};
use mint::MintCmdError;
use receive::ReceiveCmdError;
use receive_lightning::ReceiveLightningCmdError;
use send::SendCmdError;
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
    if let Some(mint_err) = e.downcast_ref::<MintCmdError>() {
        return match mint_err {
            MintCmdError::NotLoggedIn => ("not-logged-in", 3),
            MintCmdError::InvalidUrl(_) => ("invalid-mint-url", 1),
            MintCmdError::MintUnreachable(_) => ("mint-unreachable", 1),
            MintCmdError::MintError(_) => ("mint-error", 1),
            MintCmdError::UnsupportedCurrency(_) => ("unsupported-currency", 1),
            MintCmdError::Auth(inner) => classify_auth(inner),
            MintCmdError::Storage(inner) => (classify_storage(inner), 1),
        };
    }
    if let Some(rcv_err) = e.downcast_ref::<ReceiveCmdError>() {
        return match rcv_err {
            ReceiveCmdError::NotLoggedIn => ("not-logged-in", 3),
            ReceiveCmdError::InvalidToken(_) => ("invalid-token", 1),
            ReceiveCmdError::NoMatchingAccount(_) => ("no-matching-account", 1),
            ReceiveCmdError::Receive(inner) => (classify_receive(inner), 1),
            ReceiveCmdError::Storage(inner) => (classify_storage(inner), 1),
            ReceiveCmdError::Auth(inner) => classify_auth(inner),
        };
    }
    if let Some(rl_err) = e.downcast_ref::<ReceiveLightningCmdError>() {
        return match rl_err {
            ReceiveLightningCmdError::NotLoggedIn => ("not-logged-in", 3),
            ReceiveLightningCmdError::NoMatchingAccount => ("no-matching-account", 1),
            ReceiveLightningCmdError::AccountAmbiguous => ("account-ambiguous", 1),
            ReceiveLightningCmdError::InvalidAccountId(_) => ("invalid-account-id", 1),
            ReceiveLightningCmdError::InvalidQuoteId(_) => ("invalid-quote-id", 1),
            ReceiveLightningCmdError::UnsupportedCurrency(_) => ("unsupported-currency", 1),
            ReceiveLightningCmdError::AmountTooSmall => ("amount-too-small", 1),
            ReceiveLightningCmdError::QuoteNotPaid => ("quote-not-paid", 1),
            ReceiveLightningCmdError::Quote(inner) => (classify_mint_quote(inner), 1),
            ReceiveLightningCmdError::Storage(inner) => (classify_storage(inner), 1),
            ReceiveLightningCmdError::Auth(inner) => classify_auth(inner),
        };
    }
    if let Some(snd_err) = e.downcast_ref::<SendCmdError>() {
        return match snd_err {
            SendCmdError::NotLoggedIn => ("not-logged-in", 3),
            SendCmdError::NoMatchingAccount => ("no-matching-account", 1),
            SendCmdError::AccountAmbiguous => ("account-ambiguous", 1),
            SendCmdError::InvalidAccountId(_) => ("invalid-account-id", 1),
            SendCmdError::UnsupportedTokenVersion(_) => ("unsupported-token-version", 1),
            SendCmdError::TokenEncode(_) => ("token-encode-error", 1),
            SendCmdError::Send(inner) => (classify_send(inner), 1),
            SendCmdError::Storage(inner) => (classify_storage(inner), 1),
            SendCmdError::Auth(inner) => classify_auth(inner),
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

fn classify_send(e: &SendSwapError) -> &'static str {
    match e {
        SendSwapError::InvalidTransition { .. } => "invalid-state",
        SendSwapError::Storage(inner) => match inner {
            SendSwapStorageError::Concurrency(_) => "concurrency-error",
            SendSwapStorageError::NotFound => "not-found",
            SendSwapStorageError::InvalidState(_) => "invalid-state",
            SendSwapStorageError::Backend(_) => "storage-backend-error",
            SendSwapStorageError::Encryption(_) => "encryption-error",
        },
        SendSwapError::Mint(inner) => match inner {
            CashuProviderError::InvalidUrl(_) => "invalid-mint-url",
            CashuProviderError::Network(_) => "mint-unreachable",
            CashuProviderError::Protocol(_) => "mint-error",
        },
        SendSwapError::InsufficientBalance { .. } => "insufficient-balance",
        SendSwapError::AmountTooSmall => "amount-too-small",
        SendSwapError::CurrencyMismatch { .. } => "currency-mismatch",
        SendSwapError::TokenEncode(_) => "token-encode-error",
    }
}

fn classify_mint_quote(e: &MintQuoteError) -> &'static str {
    match e {
        MintQuoteError::InvalidTransition { .. } => "invalid-state",
        MintQuoteError::Storage(inner) => match inner {
            MintQuoteStorageError::NotFound => "not-found",
            MintQuoteStorageError::InvalidState(_) => "invalid-state",
            MintQuoteStorageError::Backend(_) => "storage-backend-error",
            MintQuoteStorageError::Encryption(_) => "encryption-error",
        },
        MintQuoteError::Mint(inner) => match inner {
            CashuProviderError::InvalidUrl(_) => "invalid-mint-url",
            CashuProviderError::Network(_) => "mint-unreachable",
            CashuProviderError::Protocol(_) => "mint-error",
        },
        MintQuoteError::AmountTooSmall => "amount-too-small",
        MintQuoteError::CurrencyMismatch { .. } => "currency-mismatch",
        MintQuoteError::QuoteNotPaid => "quote-not-paid",
        MintQuoteError::QuoteExpired => "quote-expired",
        MintQuoteError::Unrecoverable(_) => "mint-unrecoverable",
    }
}

fn classify_receive(e: &ReceiveSwapError) -> &'static str {
    match e {
        ReceiveSwapError::InvalidTransition { .. } => "invalid-state",
        ReceiveSwapError::Storage(inner) => match inner {
            ReceiveSwapStorageError::AlreadyClaimed => "already-claimed",
            ReceiveSwapStorageError::NotFound => "not-found",
            ReceiveSwapStorageError::InvalidState(_) => "invalid-state",
            ReceiveSwapStorageError::Backend(_) => "storage-backend-error",
            ReceiveSwapStorageError::Encryption(_) => "encryption-error",
        },
        ReceiveSwapError::Mint(inner) => match inner {
            CashuProviderError::InvalidUrl(_) => "invalid-mint-url",
            CashuProviderError::Network(_) => "mint-unreachable",
            CashuProviderError::Protocol(_) => "mint-error",
        },
        ReceiveSwapError::TokenParse(_) => "invalid-token",
        ReceiveSwapError::AmountTooSmall => "amount-too-small",
        ReceiveSwapError::MintMismatch { .. } => "mint-mismatch",
        ReceiveSwapError::CurrencyMismatch { .. } => "currency-mismatch",
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

#[allow(clippy::too_many_lines)]
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
        Some(Command::Mint(m)) => match m.cmd {
            MintCommand::Add { url, currency } => {
                let storage_deps = build_storage_deps(&auth_deps)?;
                let cashu_deps = build_cashu_deps();
                mint::cmd_mint_add(&auth_deps, &storage_deps, &cashu_deps, &url, &currency).await?;
            }
        },
        Some(Command::Balance { account: _ }) => {
            let storage_deps = build_storage_deps(&auth_deps)?;
            let rate_deps = build_exchange_rate_deps();
            mint::cmd_balance(&auth_deps, &storage_deps, &rate_deps).await?;
        }
        Some(Command::Receive(r)) => match r.cmd {
            ReceiveCommand::Token { token } => {
                let storage_deps = build_storage_deps(&auth_deps)?;
                let cashu_deps = build_cashu_deps();
                let receive_deps = build_receive_swap_deps(&storage_deps, &cashu_deps);
                receive::cmd_receive(
                    &auth_deps,
                    &storage_deps,
                    &cashu_deps,
                    &receive_deps,
                    &token,
                )
                .await?;
            }
            ReceiveCommand::Lightning {
                amount,
                account,
                currency,
                description,
                no_wait,
                poll_ms,
                timeout_s,
            } => {
                let storage_deps = build_storage_deps(&auth_deps)?;
                let cashu_deps = build_cashu_deps();
                let quote_deps = build_mint_quote_deps(&storage_deps, &cashu_deps);
                receive_lightning::cmd_receive_lightning(
                    &auth_deps,
                    &storage_deps,
                    &quote_deps,
                    amount,
                    account,
                    currency,
                    description,
                    no_wait,
                    poll_ms,
                    timeout_s,
                )
                .await?;
            }
            ReceiveCommand::LightningComplete {
                quote_id,
                poll_ms,
                timeout_s,
            } => {
                let storage_deps = build_storage_deps(&auth_deps)?;
                let cashu_deps = build_cashu_deps();
                let quote_deps = build_mint_quote_deps(&storage_deps, &cashu_deps);
                receive_lightning::cmd_receive_lightning_complete(
                    &auth_deps,
                    &storage_deps,
                    &quote_deps,
                    quote_id,
                    poll_ms,
                    timeout_s,
                )
                .await?;
            }
        },
        Some(Command::Send {
            amount,
            account,
            token_version,
            dry_run,
        }) => {
            let storage_deps = build_storage_deps(&auth_deps)?;
            let cashu_deps = build_cashu_deps();
            let send_deps = build_send_swap_deps(&storage_deps, &cashu_deps);
            send::cmd_send(
                &auth_deps,
                &storage_deps,
                &cashu_deps,
                &send_deps,
                amount,
                account,
                token_version,
                dry_run,
            )
            .await?;
        }
        None => {}
    }
    Ok(())
}
