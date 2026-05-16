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
    /// Receive funds into a Cashu account — either by claiming a Cashu
    /// token (NUT-03 swap) or by issuing a Lightning invoice (NUT-04
    /// mint quote).
    Receive(ReceiveArgs),
    /// Send funds out of a Cashu account — either by producing a Cashu
    /// token (NUT-03 swap) or by paying a BOLT-11 invoice (NUT-05 melt).
    Send(SendArgs),
}

#[derive(clap::Args, Debug)]
pub struct SendArgs {
    #[command(subcommand)]
    pub cmd: SendCommand,
}

#[derive(Subcommand, Debug)]
pub enum SendCommand {
    /// Produce a Cashu token from the account (NUT-03 send-swap).
    Token {
        /// Amount to send in the account's unit (sats for BTC accounts,
        /// cents for USD).
        amount: u64,
        /// Account ID to send from. If omitted, the only Cashu account
        /// is used; if multiple Cashu accounts exist, this is required.
        #[arg(long)]
        account: Option<String>,
        /// Token format version: 4 (CBOR, default) or 3 (legacy JSON).
        #[arg(long, default_value_t = 4)]
        token_version: u8,
        /// Show preview without persisting or producing a token.
        #[arg(long)]
        dry_run: bool,
    },
    /// Pay a BOLT-11 invoice via NUT-05 melt.
    Lightning {
        /// BOLT-11 invoice to pay (must include amount).
        invoice: String,
        /// Account ID to send from. If omitted, the only Cashu account
        /// is used; if multiple Cashu accounts exist, this is required.
        #[arg(long)]
        account: Option<String>,
        /// Show preview without persisting or paying.
        #[arg(long)]
        dry_run: bool,
        /// If set, request the melt quote and exit; call
        /// `agicash send lightning-complete <quote_id>` later to finish.
        #[arg(long)]
        no_wait: bool,
        /// Polling interval in milliseconds.
        #[arg(long, default_value_t = 1000)]
        poll_ms: u64,
        /// Overall timeout in seconds.
        #[arg(long, default_value_t = 300)]
        timeout_s: u64,
    },
    /// Finish a previously-initiated Lightning send (used with `--no-wait`).
    LightningComplete {
        /// The DB quote id (UUID) returned by `send lightning --no-wait`.
        quote_id: String,
        #[arg(long, default_value_t = 1000)]
        poll_ms: u64,
        #[arg(long, default_value_t = 30)]
        timeout_s: u64,
    },
    /// Pay a LUD-16 Lightning Address (`user@domain`) by resolving the
    /// well-known endpoint client-side, fetching a BOLT-11 invoice, then
    /// running the regular NUT-05 melt flow.
    LightningAddress {
        /// LUD-16 address, e.g. `alice@walletofsatoshi.com`.
        address: String,
        /// Amount to send in sats. Converted to msats for the LUD-06 callback.
        amount: u64,
        /// Account ID to send from. If omitted, the only Cashu account
        /// is used; if multiple Cashu accounts exist, this is required.
        #[arg(long)]
        account: Option<String>,
        /// Optional comment to send with the LUD-12 callback (if the
        /// remote advertises `commentAllowed`).
        #[arg(long)]
        comment: Option<String>,
        /// Show preview without persisting or paying.
        #[arg(long)]
        dry_run: bool,
        /// If set, request the melt quote and exit; call
        /// `agicash send lightning-complete <quote_id>` later to finish.
        #[arg(long)]
        no_wait: bool,
        /// Polling interval in milliseconds.
        #[arg(long, default_value_t = 1000)]
        poll_ms: u64,
        /// Overall timeout in seconds.
        #[arg(long, default_value_t = 300)]
        timeout_s: u64,
    },
}

#[derive(clap::Args, Debug)]
pub struct ReceiveArgs {
    #[command(subcommand)]
    pub cmd: ReceiveCommand,
}

#[derive(Subcommand, Debug)]
pub enum ReceiveCommand {
    /// Claim a Cashu token (NUT-03 swap).
    Token {
        /// Encoded Cashu token (`cashuA...` V3 or `cashuB...` V4).
        token: String,
    },
    /// Receive sats via Lightning: request a NUT-04 mint quote from the
    /// chosen account's mint, then mint proofs once the invoice is paid.
    Lightning {
        /// Amount to receive in the account's unit (sats for BTC,
        /// cents for USD).
        amount: u64,
        /// Account ID to receive into. If omitted, the only Cashu account
        /// for the user matching `--currency` is used; if multiple, this
        /// is required.
        #[arg(long)]
        account: Option<String>,
        /// Currency code (BTC default; USD for usd-unit mints).
        #[arg(long, default_value = "BTC")]
        currency: String,
        /// Optional memo to attach to the mint quote.
        #[arg(long)]
        description: Option<String>,
        /// If set, print the invoice + quote id and exit without polling.
        /// Call `agicash receive lightning-complete <quote_id>` later.
        #[arg(long)]
        no_wait: bool,
        /// Polling interval in milliseconds.
        #[arg(long, default_value_t = 1000)]
        poll_ms: u64,
        /// Overall timeout in seconds.
        #[arg(long, default_value_t = 300)]
        timeout_s: u64,
    },
    /// Finish a previously-created Lightning receive (used with `--no-wait`).
    LightningComplete {
        /// The DB quote id (UUID) returned by `receive lightning --no-wait`.
        quote_id: String,
        /// Polling interval in milliseconds (when the quote is still UNPAID).
        #[arg(long, default_value_t = 1000)]
        poll_ms: u64,
        /// Overall timeout in seconds (when the quote is still UNPAID).
        #[arg(long, default_value_t = 30)]
        timeout_s: u64,
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
    /// Register a new email + password user (password prompted on stdin)
    /// and sign in.
    Signup {
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
    fn parses_receive_token_with_v3() {
        let cli = Cli::try_parse_from(["agicash", "receive", "token", "cashuAabc"]).unwrap();
        match cli.cmd {
            Some(Command::Receive(r)) => match r.cmd {
                ReceiveCommand::Token { token } => assert_eq!(token, "cashuAabc"),
                other => panic!("unexpected receive subcommand: {other:?}"),
            },
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[test]
    fn parses_receive_token_with_v4() {
        let cli = Cli::try_parse_from(["agicash", "receive", "token", "cashuBxyz"]).unwrap();
        match cli.cmd {
            Some(Command::Receive(r)) => match r.cmd {
                ReceiveCommand::Token { token } => assert_eq!(token, "cashuBxyz"),
                other => panic!("unexpected receive subcommand: {other:?}"),
            },
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[test]
    fn parses_receive_lightning_with_amount() {
        let cli = Cli::try_parse_from(["agicash", "receive", "lightning", "100"]).unwrap();
        match cli.cmd {
            Some(Command::Receive(r)) => match r.cmd {
                ReceiveCommand::Lightning {
                    amount,
                    account,
                    currency,
                    no_wait,
                    ..
                } => {
                    assert_eq!(amount, 100);
                    assert!(account.is_none());
                    assert_eq!(currency, "BTC");
                    assert!(!no_wait);
                }
                other => panic!("unexpected receive subcommand: {other:?}"),
            },
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[test]
    fn parses_receive_lightning_with_no_wait() {
        let cli = Cli::try_parse_from([
            "agicash",
            "receive",
            "lightning",
            "100",
            "--no-wait",
            "--currency",
            "USD",
        ])
        .unwrap();
        match cli.cmd {
            Some(Command::Receive(r)) => match r.cmd {
                ReceiveCommand::Lightning {
                    amount,
                    no_wait,
                    currency,
                    ..
                } => {
                    assert_eq!(amount, 100);
                    assert!(no_wait);
                    assert_eq!(currency, "USD");
                }
                other => panic!("unexpected receive subcommand: {other:?}"),
            },
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[test]
    fn parses_receive_lightning_complete() {
        let cli = Cli::try_parse_from([
            "agicash",
            "receive",
            "lightning-complete",
            "11111111-2222-3333-4444-555555555555",
        ])
        .unwrap();
        match cli.cmd {
            Some(Command::Receive(r)) => match r.cmd {
                ReceiveCommand::LightningComplete { quote_id, .. } => {
                    assert_eq!(quote_id, "11111111-2222-3333-4444-555555555555");
                }
                other => panic!("unexpected receive subcommand: {other:?}"),
            },
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[test]
    fn parses_send_token_with_amount() {
        let cli = Cli::try_parse_from(["agicash", "send", "token", "100"]).unwrap();
        match cli.cmd {
            Some(Command::Send(s)) => match s.cmd {
                SendCommand::Token {
                    amount,
                    account,
                    token_version,
                    dry_run,
                } => {
                    assert_eq!(amount, 100);
                    assert!(account.is_none());
                    assert_eq!(token_version, 4);
                    assert!(!dry_run);
                }
                other => panic!("unexpected send subcommand: {other:?}"),
            },
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[test]
    fn parses_send_token_with_account_and_dry_run() {
        let cli = Cli::try_parse_from([
            "agicash",
            "send",
            "token",
            "50",
            "--account",
            "abc-123",
            "--dry-run",
        ])
        .unwrap();
        match cli.cmd {
            Some(Command::Send(s)) => match s.cmd {
                SendCommand::Token {
                    amount,
                    account,
                    dry_run,
                    ..
                } => {
                    assert_eq!(amount, 50);
                    assert_eq!(account.as_deref(), Some("abc-123"));
                    assert!(dry_run);
                }
                other => panic!("unexpected send subcommand: {other:?}"),
            },
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[test]
    fn parses_send_token_with_token_version_3() {
        let cli = Cli::try_parse_from(["agicash", "send", "token", "100", "--token-version", "3"])
            .unwrap();
        match cli.cmd {
            Some(Command::Send(s)) => match s.cmd {
                SendCommand::Token { token_version, .. } => assert_eq!(token_version, 3),
                other => panic!("unexpected send subcommand: {other:?}"),
            },
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[test]
    fn parses_send_lightning_with_invoice() {
        let cli = Cli::try_parse_from(["agicash", "send", "lightning", "lnbc100n1..."]).unwrap();
        match cli.cmd {
            Some(Command::Send(s)) => match s.cmd {
                SendCommand::Lightning {
                    invoice,
                    account,
                    dry_run,
                    no_wait,
                    ..
                } => {
                    assert_eq!(invoice, "lnbc100n1...");
                    assert!(account.is_none());
                    assert!(!dry_run);
                    assert!(!no_wait);
                }
                other => panic!("unexpected send subcommand: {other:?}"),
            },
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[test]
    fn parses_send_lightning_with_no_wait() {
        let cli =
            Cli::try_parse_from(["agicash", "send", "lightning", "lnbc...", "--no-wait"]).unwrap();
        match cli.cmd {
            Some(Command::Send(s)) => match s.cmd {
                SendCommand::Lightning { no_wait, .. } => assert!(no_wait),
                other => panic!("unexpected send subcommand: {other:?}"),
            },
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[test]
    fn parses_send_lightning_address() {
        let cli = Cli::try_parse_from([
            "agicash",
            "send",
            "lightning-address",
            "alice@walletofsatoshi.com",
            "100",
        ])
        .unwrap();
        match cli.cmd {
            Some(Command::Send(s)) => match s.cmd {
                SendCommand::LightningAddress {
                    address,
                    amount,
                    account,
                    comment,
                    dry_run,
                    no_wait,
                    ..
                } => {
                    assert_eq!(address, "alice@walletofsatoshi.com");
                    assert_eq!(amount, 100);
                    assert!(account.is_none());
                    assert!(comment.is_none());
                    assert!(!dry_run);
                    assert!(!no_wait);
                }
                other => panic!("unexpected send subcommand: {other:?}"),
            },
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[test]
    fn parses_send_lightning_address_with_comment_and_flags() {
        let cli = Cli::try_parse_from([
            "agicash",
            "send",
            "lightning-address",
            "alice@example.com",
            "250",
            "--comment",
            "thanks!",
            "--dry-run",
        ])
        .unwrap();
        match cli.cmd {
            Some(Command::Send(s)) => match s.cmd {
                SendCommand::LightningAddress {
                    address,
                    amount,
                    comment,
                    dry_run,
                    ..
                } => {
                    assert_eq!(address, "alice@example.com");
                    assert_eq!(amount, 250);
                    assert_eq!(comment.as_deref(), Some("thanks!"));
                    assert!(dry_run);
                }
                other => panic!("unexpected send subcommand: {other:?}"),
            },
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[test]
    fn parses_send_lightning_complete() {
        let cli = Cli::try_parse_from([
            "agicash",
            "send",
            "lightning-complete",
            "11111111-2222-3333-4444-555555555555",
        ])
        .unwrap();
        match cli.cmd {
            Some(Command::Send(s)) => match s.cmd {
                SendCommand::LightningComplete { quote_id, .. } => {
                    assert_eq!(quote_id, "11111111-2222-3333-4444-555555555555");
                }
                other => panic!("unexpected send subcommand: {other:?}"),
            },
            other => panic!("unexpected: {other:?}"),
        }
    }
}
