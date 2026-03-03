import { ArrowUpDown } from 'lucide-react';
import { MoneyDisplay } from '~/components/money-display';
import { Skeleton } from '~/components/ui/skeleton';
import type { Currency, CurrencyUnit } from '~/lib/money';
import { Money } from '~/lib/money';
import { getDefaultUnit } from './currencies';

type ConvertedMoneySwitcherProps = {
  onSwitch: () => void;
  money?: Money;
};

const ConvertedMoneySwitcher = ({
  onSwitch,
  money,
}: ConvertedMoneySwitcherProps) => {
  if (!money) {
    return <Skeleton className="h-6 w-24" />;
  }

  return (
    <button
      type="button"
      className="flex items-center gap-1"
      onClick={onSwitch}
    >
      <MoneyDisplay
        money={money}
        unit={getDefaultUnit(money.currency)}
        size="sm"
        variant="muted"
      />
      <ArrowUpDown className="mb-1 text-muted-foreground" />
    </button>
  );
};

function RawMoneyDisplay<C extends Currency>({
  inputValue,
  currency,
  unit,
  locale,
}: {
  inputValue: string;
  currency: C;
  unit: CurrencyUnit<C>;
  locale?: string;
}) {
  const money = new Money({ amount: inputValue, currency, unit });
  const {
    currencySymbol,
    currencySymbolPosition,
    integer,
    numberOfDecimals,
    decimalSeparator,
  } = money.toLocalizedStringParts({
    locale,
    unit,
    minimumFractionDigits: 'max',
  });

  const inputHasDecimalPoint = decimalSeparator
    ? inputValue.includes(decimalSeparator)
    : false;
  const inputDecimals = inputHasDecimalPoint
    ? inputValue.split(decimalSeparator)[1]
    : '';

  const needsPaddedZeros =
    inputHasDecimalPoint && inputDecimals.length < numberOfDecimals;
  const paddedZeros = needsPaddedZeros
    ? '0'.repeat(numberOfDecimals - inputDecimals.length)
    : '';

  const symbol = <span className="text-[3.45rem]">{currencySymbol}</span>;

  return (
    <span className="font-bold">
      {currencySymbolPosition === 'prefix' && symbol}
      <span className="pt-2 font-numeric text-6xl">
        {integer}
        {(inputDecimals || needsPaddedZeros) && (
          <>
            <span>{decimalSeparator}</span>
            <span>{inputDecimals}</span>
            {paddedZeros && (
              <span className="text-gray-400">{paddedZeros}</span>
            )}
          </>
        )}
      </span>
      {currencySymbolPosition === 'suffix' && symbol}
    </span>
  );
}

type MoneyInputDisplayProps = {
  /** Raw input string from useMoneyInput (e.g. "1", "1.", "1.00") */
  rawInputValue: string;
  /** Parsed Money from useMoneyInput */
  inputValue: Money;
  /** Converted Money from useMoneyInput (undefined while rates load) */
  convertedValue?: Money;
  /** Truthy when exchange rates failed to load */
  exchangeRateError?: Error | null;
  /** Toggle between input and converted currency */
  onSwitchCurrency: () => void;
  /** CSS class applied to the amount display on invalid input */
  inputErrorClassName?: string;
};

/**
 * Amount input display with currency switcher. Used by all input pages
 * (receive, send, transfer, buy).
 *
 * The parent owns the shake animation since it connects the numpad
 * (trigger) to this component (visual):
 *
 * ```tsx
 * const { animationClass, start: shake } = useAnimation({ name: 'shake' });
 * const moneyInput = useMoneyInput({ ... });
 *
 * <MoneyInputDisplay
 *   inputErrorClassName={animationClass}
 *   rawInputValue={moneyInput.rawInputValue}
 *   inputValue={moneyInput.inputValue}
 *   convertedValue={moneyInput.convertedValue}
 *   exchangeRateError={moneyInput.exchangeRateError}
 *   onSwitchCurrency={moneyInput.switchInputCurrency}
 * />
 * <Numpad onButtonClick={(v) => moneyInput.handleNumberInput(v, shake)} />
 * ```
 */
export function MoneyInputDisplay({
  rawInputValue,
  inputValue,
  convertedValue,
  exchangeRateError,
  onSwitchCurrency,
  inputErrorClassName,
}: MoneyInputDisplayProps) {
  return (
    <div className="flex h-[124px] flex-col items-center gap-2">
      <div className={inputErrorClassName}>
        <RawMoneyDisplay
          inputValue={rawInputValue}
          currency={inputValue.currency}
          unit={getDefaultUnit(inputValue.currency)}
        />
      </div>

      {!exchangeRateError && (
        <ConvertedMoneySwitcher
          onSwitch={onSwitchCurrency}
          money={convertedValue}
        />
      )}
    </div>
  );
}
