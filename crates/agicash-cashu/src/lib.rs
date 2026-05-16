//! Cashu protocol primitives and per-feature state machines.

pub mod error;
pub mod provider;
pub mod receive_flow;
pub mod receive_swap;
pub mod send_swap;

pub use provider::CdkCashuProvider;
pub use receive_flow::{
    CashuSeedProvider, MintConfirmation, ReceiveFlowError, ReceiveFlowEvent, ReceiveFlowMachine,
    ReceiveFlowResult, ReceiveFlowService, ReceiveFlowState, ReceiveStatus as ReceiveFlowStatus,
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
