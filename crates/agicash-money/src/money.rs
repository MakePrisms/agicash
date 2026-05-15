use crate::Unit;
use agicash_domain::Currency;
use rust_decimal::{Decimal, RoundingStrategy};
use serde::{Deserialize, Serialize};
use std::fmt;
use std::str::FromStr;

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
    #[error("incompatible unit: {unit} is not valid for currency {currency}")]
    IncompatibleUnit { currency: Currency, unit: Unit },
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

    /// Multiplies this amount by `factor`. Unit and currency preserved.
    /// No rounding (full decimal precision retained); callers floor for wire format.
    #[must_use]
    pub fn multiply(&self, factor: Decimal) -> Self {
        Self::new(self.amount * factor, self.currency, self.unit)
    }

    /// Divides by `divisor`, flooring to the precision of the current unit.
    /// Mirrors TS `Money.divide` which uses `big.js` default precision and then
    /// reduces to the unit's decimals (round-down) on read.
    ///
    /// Panics if `divisor` is zero.
    #[must_use]
    pub fn divide(&self, divisor: Decimal) -> Self {
        let raw = self.amount / divisor;
        let scale = unit_scale(self.currency, self.unit);
        let floored = raw.round_dp_with_strategy(scale, RoundingStrategy::ToZero);
        Self::new(floored, self.currency, self.unit)
    }

    /// Sums a list of moneys. Empty -> `None`. All items must share currency
    /// and unit; if they don't, this returns the first encountered mismatch
    /// as an error in the panic message. Mirrors TS `Money.sum` which throws
    /// on empty + missing currency; here we return `Option` so callers can
    /// supply a sensible default.
    #[must_use]
    pub fn sum(moneys: Vec<Self>) -> Option<Self> {
        let mut iter = moneys.into_iter();
        let first = iter.next()?;
        Some(iter.fold(first, |acc, m| {
            acc.try_add(&m).expect("sum: currency/unit mismatch")
        }))
    }

    /// Returns the smallest money in the list by amount. Empty -> `None`.
    /// Does NOT enforce same currency/unit (mirrors TS behavior, which
    /// only enforces it on add/sub).
    #[must_use]
    pub fn min(moneys: Vec<Self>) -> Option<Self> {
        moneys
            .into_iter()
            .reduce(|a, b| if b.amount < a.amount { b } else { a })
    }

    /// Returns the largest money in the list by amount. Empty -> `None`.
    #[must_use]
    pub fn max(moneys: Vec<Self>) -> Option<Self> {
        moneys
            .into_iter()
            .reduce(|a, b| if b.amount > a.amount { b } else { a })
    }

    /// Converts this money to another currency given an exchange rate.
    /// The rate is expressed in target-major-units per source-major-unit
    /// (e.g., for BTC->USD pass the BTC/USD price like 50000).
    /// Result is denominated in `target` at `Unit::Major`, rounded to the
    /// target's major-unit precision (8 dp for BTC, 2 dp for USD/USDB).
    ///
    /// # Panics
    /// Panics if the source unit is incompatible with the source currency.
    #[must_use]
    pub fn convert(&self, target: Currency, rate: Decimal) -> Money {
        let in_major = self
            .to_unit(Unit::Major)
            .expect("convert: source unit incompatible with currency");
        let raw = in_major.amount * rate;
        let scale = unit_scale(target, Unit::Major);
        // TS source rounds with `Big.roundHalfUp` (ties go away from zero, not
        // banker's). Match that — divergence here would mis-quote user-facing
        // converted amounts at exact half-units.
        let rounded = raw.round_dp_with_strategy(scale, RoundingStrategy::MidpointAwayFromZero);
        Money::new(rounded, target, Unit::Major)
    }

    /// Converts to a different unit within the same currency. Returns
    /// `MoneyError::IncompatibleUnit` if the requested unit does not belong
    /// to this money's currency (e.g., USD -> Sat).
    pub fn to_unit(&self, target: Unit) -> Result<Self, MoneyError> {
        if self.unit == target {
            return Ok(*self);
        }
        let from_factor = unit_factor(self.currency, self.unit)?;
        let to_factor = unit_factor(self.currency, target)?;
        let raw = self.amount * from_factor / to_factor;
        let scale = unit_scale(self.currency, target);
        let floored = raw.round_dp_with_strategy(scale, RoundingStrategy::ToZero);
        Ok(Self::new(floored, self.currency, target))
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

/// Precision (decimal places) for amounts in (`currency`, `unit`).
/// Sub-units (sat/msat/cent) are integers => 0 dp. Major units carry their
/// natural fractional precision (8 dp BTC, 2 dp USD/USDB).
fn unit_scale(currency: Currency, unit: Unit) -> u32 {
    match (currency, unit) {
        (_, Unit::Sat | Unit::Msat | Unit::Cent) => 0,
        (Currency::Btc, Unit::Major) => 8,
        (Currency::Usd | Currency::Usdb, Unit::Major) => 2,
    }
}

/// Multiplicative factor that converts an amount in `unit` to the major unit
/// of `currency`. E.g. `unit_factor(Btc, Sat) = 1e-8` because 1 sat = 1e-8 BTC.
fn unit_factor(currency: Currency, unit: Unit) -> Result<Decimal, MoneyError> {
    match (currency, unit) {
        (Currency::Btc | Currency::Usd | Currency::Usdb, Unit::Major) => Ok(Decimal::ONE),
        (Currency::Btc, Unit::Sat) => Ok(Decimal::from_str("0.00000001").unwrap()),
        (Currency::Btc, Unit::Msat) => Ok(Decimal::from_str("0.00000000001").unwrap()),
        (Currency::Usd | Currency::Usdb, Unit::Cent) => Ok(Decimal::from_str("0.01").unwrap()),
        _ => Err(MoneyError::IncompatibleUnit { currency, unit }),
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

    #[test]
    fn money_multiply() {
        let m = Money::new(dec!(1000), Currency::Btc, Unit::Sat);
        let result = m.multiply(dec!(1.5));
        assert_eq!(result.amount(), dec!(1500));
        assert_eq!(result.unit(), Unit::Sat);
    }

    #[test]
    fn money_divide() {
        let m = Money::new(dec!(1000), Currency::Btc, Unit::Sat);
        let result = m.divide(dec!(4));
        assert_eq!(result.amount(), dec!(250));
    }

    #[test]
    fn money_divide_rounds_down() {
        // 1000 / 3 = 333.33... -> 333 sat (floor to unit precision)
        let m = Money::new(dec!(1000), Currency::Btc, Unit::Sat);
        let result = m.divide(dec!(3));
        assert_eq!(result.amount(), dec!(333));
    }

    #[test]
    fn money_sum_non_empty() {
        let moneys = vec![
            Money::new(dec!(100), Currency::Btc, Unit::Sat),
            Money::new(dec!(200), Currency::Btc, Unit::Sat),
            Money::new(dec!(300), Currency::Btc, Unit::Sat),
        ];
        let total = Money::sum(moneys).unwrap();
        assert_eq!(total.amount(), dec!(600));
    }

    #[test]
    fn money_sum_empty_returns_none() {
        let result = Money::sum(Vec::<Money>::new());
        assert!(result.is_none());
    }

    #[test]
    fn money_min_max() {
        let moneys = vec![
            Money::new(dec!(100), Currency::Btc, Unit::Sat),
            Money::new(dec!(500), Currency::Btc, Unit::Sat),
            Money::new(dec!(200), Currency::Btc, Unit::Sat),
        ];
        assert_eq!(Money::min(moneys.clone()).unwrap().amount(), dec!(100));
        assert_eq!(Money::max(moneys).unwrap().amount(), dec!(500));
    }

    #[test]
    fn money_min_max_empty_returns_none() {
        assert!(Money::min(Vec::<Money>::new()).is_none());
        assert!(Money::max(Vec::<Money>::new()).is_none());
    }

    #[test]
    fn money_convert_btc_to_usd() {
        let btc = Money::new(dec!(1), Currency::Btc, Unit::Major);
        let usd = btc.convert(Currency::Usd, dec!(50000));
        assert_eq!(usd.currency(), Currency::Usd);
        assert_eq!(usd.amount(), dec!(50000));
        assert_eq!(usd.unit(), Unit::Major);
    }

    #[test]
    fn money_convert_rounds_half_away_from_zero_at_target_precision() {
        // 0.0001 BTC * 50 USD/BTC = 0.005 USD, exactly the midpoint at USD
        // major-unit precision (2 dp). TS uses Big.roundHalfUp so this must
        // round to 0.01, not 0.00 (which banker's rounding would produce
        // because 0 is even).
        let btc = Money::new(dec!(0.0001), Currency::Btc, Unit::Major);
        let usd = btc.convert(Currency::Usd, dec!(50));
        assert_eq!(usd.amount(), dec!(0.01));
    }

    #[test]
    fn money_to_unit_sat_to_msat() {
        let sats = Money::new(dec!(1000), Currency::Btc, Unit::Sat);
        let msat = sats.to_unit(Unit::Msat).unwrap();
        assert_eq!(msat.amount(), dec!(1_000_000));
        assert_eq!(msat.unit(), Unit::Msat);
    }

    #[test]
    fn money_to_unit_msat_to_sat_floors() {
        // 1500 msat = 1.5 sat -> floor to 1 sat
        let msat = Money::new(dec!(1500), Currency::Btc, Unit::Msat);
        let sats = msat.to_unit(Unit::Sat).unwrap();
        assert_eq!(sats.amount(), dec!(1));
    }

    #[test]
    fn money_to_unit_rejects_incompatible_currency_unit_pair() {
        let usd = Money::new(dec!(100), Currency::Usd, Unit::Major);
        assert!(matches!(
            usd.to_unit(Unit::Sat),
            Err(MoneyError::IncompatibleUnit { .. })
        ));
    }
}
