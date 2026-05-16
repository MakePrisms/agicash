//! `agicash send lightning-address <user@host> <amount>` subcommand.
//!
//! Resolves a LUD-16 Lightning Address client-side (no Vercel hop) and
//! then defers to [`send_lightning::cmd_send_lightning`] with the
//! resulting BOLT-11 invoice. The resolver lives in the
//! `agicash-lightning-address` crate; this file is only glue.

use crate::composition::{AuthDeps, MeltQuoteDeps, SendSwapDeps, StorageDeps};
use crate::send_lightning::{cmd_send_lightning, SendLightningCmdError};
use agicash_lightning_address::{request_invoice, resolve, LightningAddressError};
use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum SendLightningAddressCmdError {
    #[error(transparent)]
    Resolve(#[from] LightningAddressError),
    #[error(transparent)]
    Send(#[from] SendLightningCmdError),
}

#[derive(Serialize)]
struct ResolvedOutput<'a> {
    status: &'a str,
    address: &'a str,
    callback: &'a str,
    min_sendable_msat: u64,
    max_sendable_msat: u64,
    comment_allowed: Option<u32>,
}

#[derive(Serialize)]
struct InvoiceFetchedOutput<'a> {
    status: &'a str,
    address: &'a str,
    amount_sat: u64,
    amount_msat: u64,
    invoice: &'a str,
}

#[allow(clippy::too_many_arguments, clippy::similar_names)]
pub async fn cmd_send_lightning_address(
    auth: &AuthDeps,
    storage_deps: &StorageDeps,
    send_swap_deps: &SendSwapDeps,
    melt_deps: &MeltQuoteDeps,
    address: String,
    amount_sat: u64,
    account: Option<String>,
    comment: Option<String>,
    dry_run: bool,
    no_wait: bool,
    poll_ms: u64,
    timeout_s: u64,
) -> Result<(), SendLightningAddressCmdError> {
    // Step 1: LUD-16 well-known lookup.
    let info = resolve(&address).await?;
    let resolved = ResolvedOutput {
        status: "resolved",
        address: &address,
        callback: &info.callback,
        min_sendable_msat: info.min_sendable,
        max_sendable_msat: info.max_sendable,
        comment_allowed: info.comment_allowed,
    };
    println!(
        "{}",
        serde_json::to_string(&resolved).expect("serialize resolved JSON")
    );

    // Step 2: LUD-06 callback for an actual BOLT-11 invoice.
    let amount_msat = amount_sat
        .checked_mul(1000)
        .ok_or_else(|| LightningAddressError::InvalidResponse("amount overflow".into()))?;
    let invoice = request_invoice(&info, amount_msat, comment.as_deref()).await?;
    let fetched = InvoiceFetchedOutput {
        status: "invoice-fetched",
        address: &address,
        amount_sat,
        amount_msat,
        invoice: &invoice,
    };
    println!(
        "{}",
        serde_json::to_string(&fetched).expect("serialize invoice JSON")
    );

    // Step 3: delegate to the regular NUT-05 melt flow.
    cmd_send_lightning(
        auth,
        storage_deps,
        send_swap_deps,
        melt_deps,
        invoice,
        account,
        dry_run,
        no_wait,
        poll_ms,
        timeout_s,
    )
    .await?;
    Ok(())
}
