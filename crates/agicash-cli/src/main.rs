mod cli;
mod composition;

use clap::Parser;
use cli::{Cli, Command};

#[tokio::main]
async fn main() {
    // Load .env from the current working directory (and walk upward).
    // Silent on failure: env vars set in the shell still win, and the
    // composition root reports a clear error if the values are missing
    // when an auth command is invoked.
    let _ = dotenvy::dotenv();

    let args = Cli::parse();
    match args.cmd {
        Some(Command::Version) => println!("{}", env!("CARGO_PKG_VERSION")),
        Some(Command::Auth(_)) => {
            // Real dispatch lands in Tasks 19-22.
            unimplemented!("auth dispatch wired in subsequent tasks");
        }
        None => {}
    }
}
