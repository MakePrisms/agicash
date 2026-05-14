mod cli;

use clap::Parser;
use cli::{Cli, Command};

#[tokio::main]
async fn main() {
    let args = Cli::parse();
    match args.cmd {
        Some(Command::Version) => println!("{}", env!("CARGO_PKG_VERSION")),
        None => {
            // With no subcommand and no --help/--version flag, fall through silently.
            // Real dispatch lands in slice 2 (auth).
        }
    }
}
