use clap::{Parser, Subcommand};

#[derive(Parser, Debug)]
#[command(
    name = "agicash",
    version,
    about = "Agicash CLI — self-custody Bitcoin wallet"
)]
pub struct Cli {
    /// Output as JSON instead of human-readable text.
    #[arg(long, global = true)]
    pub json: bool,

    #[command(subcommand)]
    pub cmd: Option<Command>,
}

#[derive(Subcommand, Debug)]
pub enum Command {
    /// Print the SDK version.
    Version,
}
