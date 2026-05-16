use clap::{Parser, Subcommand};

#[derive(Parser, Debug)]
#[command(
    name = "agicash",
    version,
    about = "Agicash CLI — self-custody Bitcoin wallet (JSON output)"
)]
pub struct Cli {
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
    /// Manage Cashu mints.
    Mint(MintArgs),
    /// Show balance for all accounts (or a specific account).
    Balance {
        /// Show balance for a specific account ID only.
        #[arg(long)]
        account: Option<String>,
    },
    /// Receive a Cashu token into the matching mint's account.
    Receive {
        /// Encoded Cashu token (`cashuA...` V3 or `cashuB...` V4).
        token: String,
    },
    /// Send a Cashu token by selecting proofs from the chosen account.
    Send {
        /// Amount to send in the account's unit (sats for BTC accounts,
        /// cents for USD).
        amount: u64,
        /// Account ID to send from. If omitted, the only Cashu account is
        /// used; if multiple Cashu accounts exist, this is required.
        #[arg(long)]
        account: Option<String>,
        /// Token format version: 4 (CBOR, default) or 3 (legacy JSON).
        #[arg(long, default_value_t = 4)]
        token_version: u8,
        /// Show preview without persisting or producing a token.
        #[arg(long)]
        dry_run: bool,
    },
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

#[derive(clap::Args, Debug)]
pub struct MintArgs {
    #[command(subcommand)]
    pub cmd: MintCommand,
}

#[derive(Subcommand, Debug)]
pub enum MintCommand {
    /// Add a Cashu mint and create an account for it.
    Add {
        /// Mint URL, e.g. <https://testnut.cashu.space>
        url: String,
        /// Currency code (BTC or USD; default BTC).
        #[arg(long, default_value = "BTC")]
        currency: String,
    },
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
        // Deferred to slice 5+; explicitly NOT in this slice.
        let res = Cli::try_parse_from(["agicash", "account", "default", "<id>"]);
        assert!(res.is_err());
    }

    #[test]
    fn parses_mint_add_with_url() {
        let cli =
            Cli::try_parse_from(["agicash", "mint", "add", "https://testnut.cashu.space"]).unwrap();
        match cli.cmd {
            Some(Command::Mint(m)) => match m.cmd {
                MintCommand::Add { url, currency } => {
                    assert_eq!(url, "https://testnut.cashu.space");
                    assert_eq!(currency, "BTC");
                }
            },
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[test]
    fn parses_mint_add_with_currency_flag() {
        let cli = Cli::try_parse_from([
            "agicash",
            "mint",
            "add",
            "https://example.com",
            "--currency",
            "USD",
        ])
        .unwrap();
        match cli.cmd {
            Some(Command::Mint(m)) => match m.cmd {
                MintCommand::Add { currency, .. } => assert_eq!(currency, "USD"),
            },
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[test]
    fn parses_balance_without_args() {
        let cli = Cli::try_parse_from(["agicash", "balance"]).unwrap();
        assert!(matches!(cli.cmd, Some(Command::Balance { account: None })));
    }

    #[test]
    fn parses_balance_with_account_filter() {
        let cli = Cli::try_parse_from(["agicash", "balance", "--account", "abc-123"]).unwrap();
        match cli.cmd {
            Some(Command::Balance { account: Some(id) }) => assert_eq!(id, "abc-123"),
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[test]
    fn parses_receive_with_token() {
        let cli = Cli::try_parse_from(["agicash", "receive", "cashuAabc"]).unwrap();
        match cli.cmd {
            Some(Command::Receive { token }) => assert_eq!(token, "cashuAabc"),
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[test]
    fn parses_receive_with_v4_token() {
        let cli = Cli::try_parse_from(["agicash", "receive", "cashuBxyz"]).unwrap();
        match cli.cmd {
            Some(Command::Receive { token }) => assert_eq!(token, "cashuBxyz"),
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[test]
    fn parses_send_with_amount() {
        let cli = Cli::try_parse_from(["agicash", "send", "100"]).unwrap();
        match cli.cmd {
            Some(Command::Send {
                amount,
                account,
                token_version,
                dry_run,
            }) => {
                assert_eq!(amount, 100);
                assert!(account.is_none());
                assert_eq!(token_version, 4);
                assert!(!dry_run);
            }
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[test]
    fn parses_send_with_account_and_dry_run() {
        let cli =
            Cli::try_parse_from(["agicash", "send", "50", "--account", "abc-123", "--dry-run"])
                .unwrap();
        match cli.cmd {
            Some(Command::Send {
                amount,
                account,
                dry_run,
                ..
            }) => {
                assert_eq!(amount, 50);
                assert_eq!(account.as_deref(), Some("abc-123"));
                assert!(dry_run);
            }
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[test]
    fn parses_send_with_token_version_3() {
        let cli = Cli::try_parse_from(["agicash", "send", "100", "--token-version", "3"]).unwrap();
        match cli.cmd {
            Some(Command::Send { token_version, .. }) => assert_eq!(token_version, 3),
            other => panic!("unexpected: {other:?}"),
        }
    }
}
