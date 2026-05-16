//! Cashu protocol primitives and per-feature state machines.

pub mod error;
pub mod melt_quote;
pub mod mint_quote;
pub mod provider;
pub mod receive_flow;
pub mod receive_swap;
pub mod send_swap;

pub use melt_quote::{
    Action as MeltQuoteAction, CashuMeltQuote, CashuMeltQuoteService, CashuMeltQuoteState,
    CashuMeltQuoteStorage, CompleteMeltQuote, CompleteMeltQuoteOutcome, CompleteMeltQuoteResult,
    CreateMeltQuote, CreateMeltQuoteResult, Event as MeltQuoteEvent, MeltOutcome, MeltQuoteError,
    MeltQuoteMachine, MeltQuotePreview, MeltQuoteStorageError,
};
pub use mint_quote::{
    Action as MintQuoteAction, CashuMintQuote, CashuMintQuoteService, CashuMintQuoteState,
    CashuMintQuoteStorage, CompleteMintQuote, CompleteMintQuoteOutcome, CompleteMintQuoteResult,
    CreateMintQuote, Event as MintQuoteEvent, MintQuoteError, MintQuoteMachine,
    MintQuoteStorageError, ProcessMintQuotePayment, ProcessMintQuotePaymentResult,
};
pub use provider::CdkCashuProvider;
pub use receive_flow::{
    AlreadyClaimedInfo, CashuSeedProvider, MintConfirmation, ReceiveFlowError, ReceiveFlowEvent,
    ReceiveFlowMachine, ReceiveFlowResult, ReceiveFlowService, ReceiveFlowState,
    ReceiveStatus as ReceiveFlowStatus,
};
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
