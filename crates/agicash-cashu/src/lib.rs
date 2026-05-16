//! Cashu protocol primitives and per-feature state machines.

pub mod error;
pub mod mint_quote;
pub mod provider;
pub mod receive_swap;
pub mod send_swap;

pub use mint_quote::{CashuMintQuote, CashuMintQuoteState};
pub use provider::CdkCashuProvider;
pub use receive_swap::{
    Action, CashuReceiveSwap, CashuReceiveSwapService, CashuReceiveSwapState,
    CashuReceiveSwapStorage, CompleteOutcome, CompleteReceiveSwapResult, CreateReceiveSwap,
    CreateReceiveSwapResult, Event, MachineState, ParsedToken, ReceiveSwapError,
    ReceiveSwapMachine, ReceiveSwapStorageError, TokenProof,
};
pub use send_swap::{
    CashuSendSwap, CashuSendSwapService, CashuSendSwapState, CashuSendSwapStorage,
    CommitProofsToSend, CreateSendSwap, CreateSendSwapResult, OutputAmounts, ProofWithId,
    SendQuote, SendSwapError, SendSwapMachine, SendSwapStorageError,
};
