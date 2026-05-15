//! Cashu protocol primitives and per-feature state machines.

pub mod error;
pub mod provider;
pub mod receive_swap;

pub use provider::CdkCashuProvider;
pub use receive_swap::{
    Action, CashuReceiveSwap, CashuReceiveSwapState, CashuReceiveSwapStorage,
    CompleteReceiveSwapResult, CreateReceiveSwap, CreateReceiveSwapResult, Event, MachineState,
    ReceiveSwapError, ReceiveSwapMachine, ReceiveSwapStorageError, TokenProof,
};
