import { useEffect, useState } from 'react';
import type { NumpadButton } from '~/components/numpad';
import { getDefaultUnit } from '~/features/shared/currencies';
import type { Ticker } from '~/lib/exchange-rate';
import { getLocaleDecimalSeparator } from '~/lib/locale';
import type { Currency } from '~/lib/money';
import { Money } from '~/lib/money';
import { useExchangeRates } from './use-exchange-rate';

type State = {
  input: {
    /** Raw input value */
    value: string;
    /** Currency of the input */
    currency: Currency;
  };
  converted: {
    /** Raw converted value. Undefined if rates are not loaded yet */
    value: string | undefined;
    /** Currency of the converted value */
    currency: Currency;
  };
};

type Props = {
  /** Initial input value as raw string */
  initialRawInputValue: string;
  /** Initial input currency */
  initialInputCurrency: Currency;
  /** Currency to convert to */
  initialOtherCurrency: Currency;
};

const toMoney = ({
  value,
  currency,
}: {
  value: string;
  currency: Currency;
}) => {
  return new Money({
    amount: value,
    currency,
    unit: getDefaultUnit(currency),
  });
};

const getNumberOfDecimals = (value: string, decimalSeparator: string) => {
  const decimalIndex = value.indexOf(decimalSeparator);
  if (decimalIndex === -1) {
    return 0;
  }
  return value.length - decimalIndex - 1;
};

const trimInputValue = (
  value: string | undefined,
  decimalSeparator: string,
) => {
  if (!value) {
    return '0';
  }

  const decimalIndex = value.indexOf(decimalSeparator);
  if (decimalIndex === -1) {
    return value;
  }

  // Remove trailing zeros and decimal separator if it's the last character
  return value
    .replace(/0+$/, '')
    .replace(new RegExp(`\\${decimalSeparator}$`), '');
};

export function useMoneyInput({
  initialRawInputValue,
  initialInputCurrency,
  initialOtherCurrency,
}: Props) {
  const [state, setState] = useState<State>({
    input: { value: initialRawInputValue, currency: initialInputCurrency },
    converted: { value: undefined, currency: initialOtherCurrency },
  });

  const tickers: Ticker[] = [
    `${state.input.currency}-${state.converted.currency}`,
    `${state.converted.currency}-${state.input.currency}`,
  ];

  const { data: rates, error: exchangeRateError } = useExchangeRates(tickers);

  const inputMoney = toMoney(state.input);

  const convertedMoney = state.converted.value
    ? toMoney({
        value: state.converted.value,
        currency: state.converted.currency,
      })
    : undefined;

  useEffect(() => {
    if (rates) {
      setState((current) => {
        const rate =
          rates[`${current.input.currency}-${current.converted.currency}`];

        const newConvertedValue = toMoney(current.input)
          .convert(current.converted.currency, rate)
          .toString(getDefaultUnit(current.converted.currency));

        return {
          ...current,
          converted: {
            value: newConvertedValue,
            currency: current.converted.currency,
          },
        };
      });
    }
  }, [rates]);

  const maxInputDecimals = inputMoney.getMaxDecimals(
    getDefaultUnit(state.input.currency),
  );

  const decimalSeparator = getLocaleDecimalSeparator();

  /**
   * Updates the input value and converted value
   * The `currency` should be the currency of the `newValue`.
   *
   * This function will update the input value and converted value
   * based on the currency of the `newValue`.
   *
   * If the `currency` is the same as the input currency, then the input value
   * will be updated directly; otherwise, the `newValue` will be converted before
   * updating the state.
   *
   * The returned values are the new input and converted values as Money objects.
   */
  const setValue = (
    newValue: string,
    currency: Currency,
  ): {
    newInputValue: Money;
    newConvertedValue: Money | undefined;
  } => {
    let newInputValue: string;
    let newConvertedValue: string | undefined;

    if (currency === state.input.currency) {
      newInputValue = newValue;
      const rate = rates
        ? rates[`${state.input.currency}-${state.converted.currency}`]
        : undefined;

      newConvertedValue = rate
        ? toMoney({ value: newValue, currency: state.input.currency })
            .convert(state.converted.currency, rate)
            .toString(getDefaultUnit(state.converted.currency))
        : undefined;
    } else if (currency === state.converted.currency) {
      // Converted currency input, need reverse conversion
      const rate = rates
        ? rates[`${state.converted.currency}-${state.input.currency}`]
        : undefined;

      if (!rate) throw new Error('Exchange rate not found');

      let newInputMoney = toMoney({ value: newValue, currency }).convert(
        state.input.currency,
        rate,
      );

      if (newInputMoney.isZero()) {
        newInputMoney = Money.createMinAmount(state.input.currency);
      }

      newInputValue = newInputMoney.toString(
        getDefaultUnit(state.input.currency),
      );
      newConvertedValue = newValue;
    } else {
      throw new Error(`Currency does not exist in input state: ${currency}`);
    }

    setState((current) => ({
      input: { ...current.input, value: newInputValue },
      converted: { ...current.converted, value: newConvertedValue },
    }));

    return {
      newInputValue: toMoney({
        value: newInputValue,
        currency: state.input.currency,
      }),
      newConvertedValue: newConvertedValue
        ? toMoney({
            value: newConvertedValue,
            currency: state.converted.currency,
          })
        : undefined,
    };
  };

  /** Updates the input value or calls onInvalidInput if the input is invalid */
  const handleNumberInput = (
    input: NumpadButton,
    onInvalidInput: () => void,
  ) => {
    const currentValue = state.input.value;

    if (input === 'Backspace') {
      if (currentValue === '0') {
        return onInvalidInput();
      }

      const newValue =
        currentValue.length === 1 ? '0' : currentValue.slice(0, -1);
      return setValue(newValue, state.input.currency);
    }

    const valueHasDecimal = currentValue.includes(decimalSeparator);

    if (input === decimalSeparator) {
      // Only add decimal if one doesn't exist yet
      return valueHasDecimal
        ? onInvalidInput()
        : setValue(`${currentValue}${decimalSeparator}`, state.input.currency);
    }

    const hasMaxDecimals =
      valueHasDecimal &&
      getNumberOfDecimals(currentValue, decimalSeparator) === maxInputDecimals;

    if (hasMaxDecimals) {
      return onInvalidInput();
    }

    if (input === '0' && currentValue === '0') {
      return onInvalidInput();
    }

    // replace 0 value with button value
    const newValue = currentValue === '0' ? input : currentValue + input;

    setValue(newValue, state.input.currency);
  };

  const switchInputCurrency = () => {
    setState((current) => {
      return {
        input: {
          value: trimInputValue(current.converted.value, decimalSeparator),
          currency: current.converted.currency,
        },
        converted: {
          value: current.input.value,
          currency: current.input.currency,
        },
      };
    });
  };

  return {
    rawInputValue: state.input.value,
    maxInputDecimals,
    inputValue: inputMoney,
    convertedValue: convertedMoney,
    handleNumberInput,
    switchInputCurrency,
    exchangeRateError,
    setInputValue: setValue,
  };
}
