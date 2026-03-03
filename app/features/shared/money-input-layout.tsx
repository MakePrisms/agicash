import { ArrowUpDown } from 'lucide-react';
import { MoneyDisplay } from '~/components/money-display';
import type { NumpadButton } from '~/components/numpad';
import { Numpad } from '~/components/numpad';
import { PageContent, PageFooter } from '~/components/page';
import { Button } from '~/components/ui/button';
import { Skeleton } from '~/components/ui/skeleton';
import useAnimation from '~/hooks/use-animation';
import { useMoneyInput } from '~/hooks/use-money-input';
import type { Currency, CurrencyUnit } from '~/lib/money';
import { Money } from '~/lib/money';
import { getDefaultUnit } from './currencies';

// ---------------------------------------------------------------------------
// useMoneyInputField
// ---------------------------------------------------------------------------

type UseMoneyInputFieldProps = {
  initialRawInputValue: string;
  initialInputCurrency: Currency;
  initialOtherCurrency: Currency;
};

/**
 * Composes useMoneyInput with a shake animation so consumers don't have
 * to wire them together. Pass the returned `field` to `<MoneyInputLayout>`
 * which handles the display, numpad, and continue button automatically.
 *
 * ```tsx
 * const field = useMoneyInputField({ ... });
 *
 * <MoneyInputLayout field={field} onContinue={handleContinue} actions={...}>
 *   <AccountSelector ... />
 * </MoneyInputLayout>
 * ```
 */
export function useMoneyInputField({
  initialRawInputValue,
  initialInputCurrency,
  initialOtherCurrency,
}: UseMoneyInputFieldProps) {
  const { animationClass, start: shakeOnError } = useAnimation({
    name: 'shake',
  });

  const moneyInput = useMoneyInput({
    initialRawInputValue,
    initialInputCurrency,
    initialOtherCurrency,
  });

  const handleNumberInput = (input: NumpadButton) => {
    moneyInput.handleNumberInput(input, shakeOnError);
  };

  return {
    rawInputValue: moneyInput.rawInputValue,
    inputValue: moneyInput.inputValue,
    convertedValue: moneyInput.convertedValue,
    exchangeRateError: moneyInput.exchangeRateError,
    switchInputCurrency: moneyInput.switchInputCurrency,
    setInputValue: moneyInput.setInputValue,
    handleNumberInput,
    showDecimal: moneyInput.maxInputDecimals > 0,
    inputErrorClassName: animationClass,
  };
}

// ---------------------------------------------------------------------------
// MoneyInputLayout
// ---------------------------------------------------------------------------

type MoneyInputFieldReturn = ReturnType<typeof useMoneyInputField>;

type MoneyInputLayoutProps = {
  /** The money input field state (from useMoneyInputField) */
  field: MoneyInputFieldReturn;
  /** Content rendered between the display area and the action row (e.g. AccountSelector) */
  children?: React.ReactNode;
  /** Left side of the action row (e.g. paste/scan buttons) */
  actions?: React.ReactNode;
  /** Continue button handler */
  onContinue: () => void;
  /** Override the continue button label (defaults to "Continue") */
  continueLabel?: string;
  /** Additional disabled condition — isZero() is always checked */
  continueDisabled?: boolean;
  /** Show loading spinner on the continue button */
  continueLoading?: boolean;
  /** Content rendered alongside MoneyInputDisplay (e.g. destination display in send).
   *  When provided, display and this content are wrapped in a flex column. */
  belowDisplay?: React.ReactNode;
};

/**
 * Shared layout for money input pages (send, receive, transfer, buy).
 *
 * Renders: MoneyInputDisplay → children slot → action row → Numpad.
 * The parent provides the page header (title/close vary per page).
 *
 * ```tsx
 * <PageHeader>...</PageHeader>
 * <MoneyInputLayout field={field} onContinue={handleContinue} actions={...}>
 *   <AccountSelector ... />
 * </MoneyInputLayout>
 * ```
 */
export function MoneyInputLayout({
  field,
  children,
  actions,
  onContinue,
  continueLabel = 'Continue',
  continueDisabled,
  continueLoading,
  belowDisplay,
}: MoneyInputLayoutProps) {
  const display = (
    <MoneyInputDisplay
      inputErrorClassName={field.inputErrorClassName}
      rawInputValue={field.rawInputValue}
      inputValue={field.inputValue}
      convertedValue={field.convertedValue}
      exchangeRateError={field.exchangeRateError}
      onSwitchCurrency={field.switchInputCurrency}
    />
  );

  return (
    <>
      <PageContent className="mx-auto flex flex-col items-center justify-between">
        {belowDisplay ? (
          <div className="flex flex-col items-center justify-between gap-4">
            {display}
            {belowDisplay}
          </div>
        ) : (
          display
        )}

        {children}

        <div className="flex w-full flex-col items-center gap-4 sm:items-start sm:justify-between">
          <div className="grid w-full max-w-sm grid-cols-3 gap-4 sm:max-w-none">
            <div className="flex items-center justify-start gap-4">
              {actions}
            </div>
            <div />
            <div className="flex items-center justify-end">
              <Button
                onClick={onContinue}
                disabled={field.inputValue.isZero() || continueDisabled}
                loading={continueLoading}
              >
                {continueLabel}
              </Button>
            </div>
          </div>
        </div>
      </PageContent>
      <PageFooter className="sm:pb-14">
        <Numpad
          showDecimal={field.showDecimal}
          onButtonClick={field.handleNumberInput}
        />
      </PageFooter>
    </>
  );
}

// ---------------------------------------------------------------------------
// Internal display components
// ---------------------------------------------------------------------------

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
  rawInputValue: string;
  inputValue: Money;
  convertedValue?: Money;
  exchangeRateError?: Error | null;
  onSwitchCurrency: () => void;
  inputErrorClassName?: string;
};

function MoneyInputDisplay({
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
