use serde::{Deserialize, Serialize};
use std::fmt;
use std::str::FromStr;
use uuid::Uuid;

macro_rules! id_type {
    ($name:ident) => {
        #[derive(
            Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize,
        )]
        #[serde(transparent)]
        pub struct $name(Uuid);

        impl $name {
            #[must_use]
            pub fn new() -> Self {
                Self(Uuid::new_v4())
            }

            #[must_use]
            pub fn as_uuid(&self) -> Uuid {
                self.0
            }
        }

        impl Default for $name {
            fn default() -> Self {
                Self::new()
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                self.0.fmt(f)
            }
        }

        impl FromStr for $name {
            type Err = uuid::Error;
            fn from_str(s: &str) -> Result<Self, Self::Err> {
                Ok(Self(Uuid::parse_str(s)?))
            }
        }

        impl From<Uuid> for $name {
            fn from(u: Uuid) -> Self {
                Self(u)
            }
        }
    };
}

id_type!(UserId);
id_type!(AccountId);
id_type!(TransactionId);
id_type!(QuoteId);
id_type!(ProofId);
id_type!(ClientId);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn user_id_generates_unique_uuids() {
        let a = UserId::new();
        let b = UserId::new();
        assert_ne!(a, b);
    }

    #[test]
    fn user_id_roundtrips_through_string() {
        let id = UserId::new();
        let s = id.to_string();
        let parsed: UserId = s.parse().unwrap();
        assert_eq!(id, parsed);
    }

    #[test]
    fn user_id_parse_rejects_garbage() {
        let result: Result<UserId, _> = "not-a-uuid".parse();
        assert!(result.is_err());
    }

    #[test]
    fn all_id_types_are_distinct() {
        // Compile-time check: these would not compile if all types were aliases.
        let _u: UserId = UserId::new();
        let _a: AccountId = AccountId::new();
        let _t: TransactionId = TransactionId::new();
        let _q: QuoteId = QuoteId::new();
        let _p: ProofId = ProofId::new();
        let _c: ClientId = ClientId::new();
    }
}
