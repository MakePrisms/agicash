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
    /// Authentication and session management.
    Auth(AuthArgs),
    /// Accounts (cashu and spark) for the current user.
    Account(AccountArgs),
}

#[derive(clap::Args, Debug)]
pub struct AuthArgs {
    #[command(subcommand)]
    pub cmd: AuthCommand,
}

#[derive(Subcommand, Debug)]
pub enum AuthCommand {
    /// Sign in with an email and password (password prompted on stdin).
    Login {
        /// Email address.
        email: String,
    },
    /// Register and sign in as an anonymous guest user.
    Guest,
    /// Clear the local session.
    Logout,
    /// Report whether a session is active, and if so, the user id.
    Status,
}

#[derive(clap::Args, Debug)]
pub struct AccountArgs {
    #[command(subcommand)]
    pub cmd: AccountCommand,
}

#[derive(Subcommand, Debug)]
pub enum AccountCommand {
    /// List active accounts for the current user.
    List,
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::Parser;

    #[test]
    fn parses_auth_guest() {
        let cli = Cli::try_parse_from(["agicash", "auth", "guest"]).unwrap();
        match cli.cmd {
            Some(Command::Auth(a)) => assert!(matches!(a.cmd, AuthCommand::Guest)),
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[test]
    fn parses_auth_login_with_email() {
        let cli = Cli::try_parse_from(["agicash", "auth", "login", "alice@example.com"]).unwrap();
        match cli.cmd {
            Some(Command::Auth(a)) => match a.cmd {
                AuthCommand::Login { email } => assert_eq!(email, "alice@example.com"),
                other => panic!("unexpected auth subcommand: {other:?}"),
            },
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[test]
    fn parses_auth_logout() {
        let cli = Cli::try_parse_from(["agicash", "auth", "logout"]).unwrap();
        match cli.cmd {
            Some(Command::Auth(a)) => assert!(matches!(a.cmd, AuthCommand::Logout)),
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[test]
    fn parses_auth_status() {
        let cli = Cli::try_parse_from(["agicash", "auth", "status"]).unwrap();
        match cli.cmd {
            Some(Command::Auth(a)) => assert!(matches!(a.cmd, AuthCommand::Status)),
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[test]
    fn does_not_recognize_whoami() {
        let res = Cli::try_parse_from(["agicash", "whoami"]);
        assert!(res.is_err(), "whoami should NOT be a recognized subcommand");
    }

    #[test]
    fn parses_account_list() {
        let cli = Cli::try_parse_from(["agicash", "account", "list"]).unwrap();
        match cli.cmd {
            Some(Command::Account(a)) => assert!(matches!(a.cmd, AccountCommand::List)),
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[test]
    fn account_default_subcommand_is_not_recognized_yet() {
        // Deferred to slice 4+; explicitly NOT in this slice.
        let res = Cli::try_parse_from(["agicash", "account", "default", "<id>"]);
        assert!(res.is_err());
    }
}
