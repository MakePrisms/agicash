//! FFI session value types.
//!
//! `Session` is what the Swift side receives after a successful login. It is
//! deliberately Swift-codable (plain records) so the Swift consumer can
//! serialize and persist the `refresh_token` into the iOS Keychain.
//!
//! `AuthStatus` is what `auth_status()` returns: a tagged record indicating
//! whether the wallet currently holds a session in memory.

use agicash_traits::PersistedSession;

#[derive(Debug, Clone, uniffi::Record)]
pub struct Session {
    /// Stringified UUID for the authenticated user.
    pub user_id: String,
    /// `OpenSecret` refresh token. The Swift consumer is expected to persist
    /// this in the iOS Keychain and reload it on subsequent app launches via
    /// `AgicashWallet::set_session`.
    pub refresh_token: String,
}

impl From<PersistedSession> for Session {
    fn from(s: PersistedSession) -> Self {
        Self {
            user_id: s.user_id.to_string(),
            refresh_token: s.refresh_token,
        }
    }
}

#[derive(Debug, Clone, uniffi::Record)]
pub struct AuthStatus {
    pub logged_in: bool,
    /// Stringified user UUID when `logged_in == true`, else None.
    pub user_id: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    #[test]
    fn session_from_persisted_stringifies_uuid() {
        let uid = Uuid::new_v4();
        let p = PersistedSession {
            user_id: uid,
            refresh_token: "rt.abc".into(),
        };
        let s: Session = p.into();
        assert_eq!(s.user_id, uid.to_string());
        assert_eq!(s.refresh_token, "rt.abc");
    }
}
