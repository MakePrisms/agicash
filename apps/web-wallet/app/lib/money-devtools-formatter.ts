import { Money } from '@agicash/money';

/**
 * Registers a Chrome DevTools custom formatter for Money instances.
 * Call this once at app startup to enable pretty console output.
 *
 * Lives in the web app (not @agicash/money) because it depends on `window`,
 * keeping the money package framework- and DOM-free.
 *
 * To enable custom formatters in Chrome DevTools:
 * 1. Open DevTools (F12)
 * 2. Click Settings (gear icon) or press F1
 * 3. Under "Console", check "Custom formatters"
 *
 * After enabling, Money instances will display as: Money ₿1,234.00
 */
export function registerMoneyDevToolsFormatter(): void {
  if (typeof window === 'undefined') return;

  const formatter = {
    header: (obj: unknown) => {
      if (!(obj instanceof Money)) return null;
      return [
        'div',
        { style: 'font-weight: bold; color: #9c27b0;' },
        `Money ${obj.toLocaleString()}`,
      ];
    },
    hasBody: (obj: unknown) => obj instanceof Money,
    body: (obj: unknown) => {
      if (!(obj instanceof Money)) return null;
      const money = obj as Money;
      return [
        'div',
        { style: 'margin-left: 12px;' },
        [
          'div',
          {},
          ['span', { style: 'color: #888;' }, 'currency: '],
          money.currency,
        ],
        [
          'div',
          {},
          ['span', { style: 'color: #888;' }, 'amount: '],
          money.amount().toString(),
        ],
        [
          'div',
          {},
          ['span', { style: 'color: #888;' }, 'formatted: '],
          money.toLocaleString(),
        ],
      ];
    },
  };

  // @ts-expect-error - devtoolsFormatters is a non-standard Chrome API
  window.devtoolsFormatters = window.devtoolsFormatters || [];
  // @ts-expect-error - devtoolsFormatters is a non-standard Chrome API
  window.devtoolsFormatters.push(formatter);
}
