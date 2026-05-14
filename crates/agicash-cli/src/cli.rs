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
}
