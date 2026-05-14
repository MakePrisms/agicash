mod cli;

use clap::Parser;
use cli::{Cli, Command};

#[tokio::main]
async fn main() {
    let args = Cli::parse();
    match args.cmd {
        Some(Command::Version) => println!("{}", env!("CARGO_PKG_VERSION")),
        Some(Command::Auth(_)) => unimplemented!("auth dispatch lands in Task 18+"),
        None => {
            // With no subcommand and no --help/--version flag, fall through silently.
        }
    }
}
