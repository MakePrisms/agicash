use crate::Unit;
use agicash_domain::Currency;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Money {
    amount: Decimal,
    currency: Currency,
    unit: Unit,
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum MoneyError {
    #[error("currency mismatch: left={left}, right={right}")]
    CurrencyMismatch { left: Currency, right: Currency },
    #[error("unit mismatch: left={left}, right={right}")]
    UnitMismatch { left: Unit, right: Unit },
}

impl Money {
    #[must_use]
    pub fn new(amount: Decimal, currency: Currency, unit: Unit) -> Self {
        Self {
            amount,
            currency,
            unit,
        }
    }

    #[must_use]
    pub fn amount(&self) -> Decimal {
        self.amount
    }

    #[must_use]
    pub fn currency(&self) -> Currency {
        self.currency
    }

    #[must_use]
    pub fn unit(&self) -> Unit {
        self.unit
    }

    pub fn try_add(&self, other: &Self) -> Result<Self, MoneyError> {
        self.check_compatible(other)?;
        Ok(Self::new(
            self.amount + other.amount,
            self.currency,
            self.unit,
        ))
    }

    pub fn try_sub(&self, other: &Self) -> Result<Self, MoneyError> {
        self.check_compatible(other)?;
        Ok(Self::new(
            self.amount - other.amount,
            self.currency,
            self.unit,
        ))
    }

    #[must_use]
    pub fn is_zero(&self) -> bool {
        self.amount.is_zero()
    }

    #[must_use]
    pub fn is_positive(&self) -> bool {
        self.amount.is_sign_positive() && !self.amount.is_zero()
    }

    #[must_use]
    pub fn is_negative(&self) -> bool {
        self.amount.is_sign_negative() && !self.amount.is_zero()
    }

    fn check_compatible(&self, other: &Self) -> Result<(), MoneyError> {
        if self.currency != other.currency {
            return Err(MoneyError::CurrencyMismatch {
                left: self.currency,
                right: other.currency,
            });
        }
        if self.unit != other.unit {
            return Err(MoneyError::UnitMismatch {
                left: self.unit,
                right: other.unit,
            });
        }
        Ok(())
    }
}

impl fmt::Display for Money {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} {} {}", self.amount, self.unit, self.currency)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal_macros::dec;

    #[test]
    fn money_constructs_with_amount_currency_unit() {
        let m = Money::new(dec!(50000), Currency::Btc, Unit::Sat);
        assert_eq!(m.amount(), dec!(50000));
        assert_eq!(m.currency(), Currency::Btc);
        assert_eq!(m.unit(), Unit::Sat);
    }

    #[test]
    fn money_add_same_currency_unit() {
        let a = Money::new(dec!(50000), Currency::Btc, Unit::Sat);
        let b = Money::new(dec!(30000), Currency::Btc, Unit::Sat);
        let sum = a.try_add(&b).unwrap();
        assert_eq!(sum.amount(), dec!(80000));
    }

    #[test]
    fn money_sub_same_currency_unit() {
        let a = Money::new(dec!(50000), Currency::Btc, Unit::Sat);
        let b = Money::new(dec!(30000), Currency::Btc, Unit::Sat);
        let diff = a.try_sub(&b).unwrap();
        assert_eq!(diff.amount(), dec!(20000));
    }

    #[test]
    fn money_add_rejects_currency_mismatch() {
        let btc = Money::new(dec!(50000), Currency::Btc, Unit::Sat);
        let usd = Money::new(dec!(1000), Currency::Usd, Unit::Cent);
        assert!(matches!(
            btc.try_add(&usd),
            Err(MoneyError::CurrencyMismatch { .. })
        ));
    }

    #[test]
    fn money_add_rejects_unit_mismatch() {
        let sats = Money::new(dec!(50000), Currency::Btc, Unit::Sat);
        let btc_major = Money::new(dec!(1), Currency::Btc, Unit::Major);
        assert!(matches!(
            sats.try_add(&btc_major),
            Err(MoneyError::UnitMismatch { .. })
        ));
    }

    #[test]
    fn money_is_zero_and_sign_helpers() {
        let zero = Money::new(dec!(0), Currency::Btc, Unit::Sat);
        let pos = Money::new(dec!(1), Currency::Btc, Unit::Sat);
        let neg = Money::new(dec!(-1), Currency::Btc, Unit::Sat);
        assert!(zero.is_zero());
        assert!(pos.is_positive());
        assert!(neg.is_negative());
    }

    #[test]
    fn money_display_includes_amount_currency_unit() {
        let m = Money::new(dec!(50000), Currency::Btc, Unit::Sat);
        assert_eq!(m.to_string(), "50000 sat BTC");
    }

    #[test]
    fn money_roundtrips_through_json() {
        let m = Money::new(dec!(50000.5), Currency::Usd, Unit::Cent);
        let json = serde_json::to_string(&m).unwrap();
        let parsed: Money = serde_json::from_str(&json).unwrap();
        assert_eq!(m, parsed);
    }
}
