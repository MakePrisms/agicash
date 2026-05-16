//! Encryption seam for sensitive wallet data (proofs, swap metadata).
//!
//! Mirrors `app/features/shared/encryption.ts` — the bytes-in / bytes-out shape
//! lets a higher layer serialize a domain value to bytes, encrypt the bytes,
//! and stash the resulting ciphertext (base64-encoded by the storage layer) in
//! Supabase's `encrypted_data` columns. The real impl (a future slice) will use
//! ECIES with a per-call ephemeral key; slice 5 uses a passthrough so the
//! storage round-trip works without an Open Secret round trip.

use async_trait::async_trait;

#[derive(Debug, thiserror::Error)]
pub enum EncryptionError {
    #[error("encryption failed: {0}")]
    Encrypt(String),
    #[error("decryption failed: {0}")]
    Decrypt(String),
    #[error("encryption key unavailable")]
    NoKey,
}

/// Encrypts and decrypts opaque byte blobs. Real impls MUST derive a fresh
/// nonce per call and MUST NOT be deterministic; the passthrough impl in this
/// crate is for local dev only.
///
/// Storage callers are responsible for serializing domain values to bytes
/// before calling [`encrypt`] (and deserializing after [`decrypt`]) — the
/// trait stays plaintext-agnostic on purpose.
#[async_trait]
pub trait ProofEncryption: Send + Sync {
    async fn encrypt(&self, plaintext: &[u8]) -> Result<Vec<u8>, EncryptionError>;
    async fn decrypt(&self, ciphertext: &[u8]) -> Result<Vec<u8>, EncryptionError>;
}

/// Slice-5 passthrough impl. Stores plaintext as-is in the "ciphertext" channel
/// so the storage RPCs see the expected wire shape (a string blob) without a
/// real Open Secret round trip. SAFE FOR LOCAL DEV ONLY — anyone with read
/// access to the row can recover the underlying JSON.
#[derive(Debug, Clone, Default)]
pub struct PassthroughProofEncryption;

#[async_trait]
impl ProofEncryption for PassthroughProofEncryption {
    async fn encrypt(&self, plaintext: &[u8]) -> Result<Vec<u8>, EncryptionError> {
        Ok(plaintext.to_vec())
    }

    async fn decrypt(&self, ciphertext: &[u8]) -> Result<Vec<u8>, EncryptionError> {
        Ok(ciphertext.to_vec())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn passthrough_round_trips_bytes() {
        let enc = PassthroughProofEncryption;
        let payload = b"some proof data";
        let cipher = enc.encrypt(payload).await.unwrap();
        let plain = enc.decrypt(&cipher).await.unwrap();
        assert_eq!(plain, payload);
    }

    #[tokio::test]
    async fn passthrough_round_trips_empty_bytes() {
        let enc = PassthroughProofEncryption;
        let cipher = enc.encrypt(&[]).await.unwrap();
        assert!(cipher.is_empty());
        let plain = enc.decrypt(&cipher).await.unwrap();
        assert!(plain.is_empty());
    }

    #[test]
    fn passthrough_proof_encryption_is_send_sync() {
        fn assert_send_sync<T: Send + Sync>() {}
        assert_send_sync::<PassthroughProofEncryption>();
    }
}
