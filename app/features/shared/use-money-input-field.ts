import type { NumpadButton } from '~/components/numpad';
import useAnimation from '~/hooks/use-animation';
import { useMoneyInput } from '~/hooks/use-money-input';
import type { Currency } from '~/lib/money';

type Props = {
  initialRawInputValue: string;
  initialInputCurrency: Currency;
  initialOtherCurrency: Currency;
};

/**
 * Composes useMoneyInput with a shake animation so consumers don't have
 * to wire them together. Every money input page (send, receive, transfer,
 * buy) uses this same combination.
 *
 * ```tsx
 * const field = useMoneyInputField({ ... });
 *
 * <MoneyInputDisplay
 *   inputErrorClassName={field.inputErrorClassName}
 *   rawInputValue={field.rawInputValue}
 *   inputValue={field.inputValue}
 *   convertedValue={field.convertedValue}
 *   exchangeRateError={field.exchangeRateError}
 *   onSwitchCurrency={field.switchInputCurrency}
 * />
 * <Numpad showDecimal={field.showDecimal} onButtonClick={field.handleNumberInput} />
 * ```
 */
export function useMoneyInputField({
  initialRawInputValue,
  initialInputCurrency,
  initialOtherCurrency,
}: Props) {
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
