use crate::{AccountId, Currency, UserId};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AccountType {
    Cashu,
    Spark,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Account {
    pub id: AccountId,
    pub user_id: UserId,
    pub account_type: AccountType,
    pub currency: Currency,
    pub name: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn account_type_serializes_as_lowercase() {
        let json = serde_json::to_string(&AccountType::Cashu).unwrap();
        assert_eq!(json, "\"cashu\"");
        let json = serde_json::to_string(&AccountType::Spark).unwrap();
        assert_eq!(json, "\"spark\"");
    }

    #[test]
    fn account_constructs_with_required_fields() {
        let a = Account {
            id: AccountId::new(),
            user_id: UserId::new(),
            account_type: AccountType::Cashu,
            currency: Currency::Btc,
            name: "Test mint".to_string(),
        };
        assert_eq!(a.account_type, AccountType::Cashu);
    }
}
