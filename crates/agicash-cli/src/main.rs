mod account;
mod auth;
mod cli;
mod composition;

use clap::Parser;
use cli::{AccountCommand, AuthCommand, Cli, Command};
use composition::{build_auth_deps, build_storage_deps, rehydrate_session};

#[tokio::main]
async fn main() {
    let _ = dotenvy::dotenv();

    let args = Cli::parse();
    let exit_code = match run(args).await {
        Ok(()) => 0,
        Err(e) => {
            eprintln!("error: {e}");
            // "not logged in" -> exit 3 (auth required). All other errors -> 1.
            if e.to_string() == "not logged in" {
                3
            } else {
                1
            }
        }
    };
    std::process::exit(exit_code);
}

async fn run(args: Cli) -> Result<(), Box<dyn std::error::Error>> {
    // Version doesn't need auth or env vars — handle it before building deps.
    if let Some(Command::Version) = args.cmd {
        println!("{}", env!("CARGO_PKG_VERSION"));
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
