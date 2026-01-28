import { Money } from '~/lib/money';

/**
 * Configures the Money class default settings for the Agicash wallet app.
 */
export function configureMoney() {
  Money.configure({
    currencies: {
      BTC: {
        baseUnit: 'sat', // Override BTC base unit from 'btc' to 'sat'
      },
      // USD not specified - uses all defaults
    },
  });
}
