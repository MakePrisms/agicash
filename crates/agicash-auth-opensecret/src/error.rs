use agicash_traits::AuthError;

/// Map an [`opensecret::Error`] into an [`AuthError`].
///
/// The orphan rule prevents us from writing `impl From<opensecret::Error> for AuthError`
/// here (both types are foreign to this crate), so impls call this helper instead.
/// Takes the error by value so it can be passed directly to `.map_err(...)`.
#[must_use]
#[allow(clippy::needless_pass_by_value)]
pub fn auth_error_from_opensecret(err: opensecret::Error) -> AuthError {
    AuthError::Backend(format!("{err}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opensecret_error_maps_to_auth_error() {
        let err: opensecret::Error = opensecret::Error::Other("boom".to_string());
        let mapped: AuthError = auth_error_from_opensecret(err);
        assert!(matches!(mapped, AuthError::Backend(_)));
        assert!(format!("{mapped}").contains("boom"));
    }
}
