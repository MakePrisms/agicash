mod auth;
mod cli;
mod composition;

use clap::Parser;
use cli::{AccountCommand, AuthCommand, Cli, Command};
use composition::build_auth_deps;

#[tokio::main]
async fn main() {
    let _ = dotenvy::dotenv();

    let args = Cli::parse();
    let exit_code = match run(args).await {
        Ok(()) => 0,
        Err(e) => {
            eprintln!("error: {e}");
            1
        }
    };
    std::process::exit(exit_code);
}

async fn run(args: Cli) -> Result<(), Box<dyn std::error::Error>> {
    match args.cmd {
        Some(Command::Version) => {
            println!("{}", env!("CARGO_PKG_VERSION"));
            Ok(())
        }
        Some(Command::Auth(a)) => match a.cmd {
            AuthCommand::Guest => {
                let deps = build_auth_deps()?;
                auth::cmd_guest(&deps).await?;
                Ok(())
            }
            AuthCommand::Login { email } => {
                let deps = build_auth_deps()?;
                auth::cmd_login(&deps, email).await?;
                Ok(())
            }
            AuthCommand::Logout => {
                let deps = build_auth_deps()?;
                auth::cmd_logout(&deps).await?;
                Ok(())
            }
            AuthCommand::Status => {
                let deps = build_auth_deps()?;
                auth::cmd_status(&deps).await?;
                Ok(())
            }
        },
        Some(Command::Account(a)) => match a.cmd {
            AccountCommand::List => {
                // Wired in slice 3 Task 17.
                Err("account list: not yet implemented in this build".into())
            }
        },
        None => Ok(()),
    }
}
