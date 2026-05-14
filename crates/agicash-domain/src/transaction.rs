use crate::{AccountId, TransactionId, UserId};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TransactionState {
    Draft,
    Pending,
    Completed,
    Expired,
    Failed,
    Reversed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum TransactionDirection {
    Send,
    Receive,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Transaction {
    pub id: TransactionId,
    pub user_id: UserId,
    pub account_id: AccountId,
    pub state: TransactionState,
    pub direction: TransactionDirection,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transaction_state_serializes_as_screaming_snake_case() {
        assert_eq!(
            serde_json::to_string(&TransactionState::Draft).unwrap(),
            "\"DRAFT\""
        );
        assert_eq!(
            serde_json::to_string(&TransactionState::Pending).unwrap(),
            "\"PENDING\""
        );
        assert_eq!(
            serde_json::to_string(&TransactionState::Completed).unwrap(),
            "\"COMPLETED\""
        );
    }

    #[test]
    fn transaction_direction_serializes_as_uppercase() {
        assert_eq!(
            serde_json::to_string(&TransactionDirection::Send).unwrap(),
            "\"SEND\""
        );
        assert_eq!(
            serde_json::to_string(&TransactionDirection::Receive).unwrap(),
            "\"RECEIVE\""
        );
    }
}
