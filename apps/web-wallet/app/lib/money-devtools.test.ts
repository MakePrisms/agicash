import { afterEach, describe, expect, it } from 'bun:test';
import { Money } from '@agicash/money';
import { registerMoneyDevToolsFormatter } from './money-devtools';

type DevtoolsFormatter = {
  header: (obj: unknown) => unknown;
  hasBody: (obj: unknown) => boolean;
  body: (obj: unknown) => unknown;
};

const getWindow = () =>
  globalThis as { window?: { devtoolsFormatters?: DevtoolsFormatter[] } };

describe('registerMoneyDevToolsFormatter', () => {
  afterEach(() => {
    getWindow().window = undefined;
  });

  it('is a no-op when window is undefined', () => {
    getWindow().window = undefined;
    expect(() => registerMoneyDevToolsFormatter()).not.toThrow();
  });

  it('registers a formatter that discriminates and renders Money instances', () => {
    getWindow().window = {};
    registerMoneyDevToolsFormatter();

    const formatters = getWindow().window?.devtoolsFormatters;
    expect(formatters).toHaveLength(1);
    const formatter = formatters?.[0];

    const money = new Money({ amount: 1000, currency: 'USD' });
    expect(formatter?.hasBody(money)).toBe(true);
    expect(formatter?.hasBody({})).toBe(false);
    expect(formatter?.header({})).toBeNull();

    const header = formatter?.header(money) as unknown[];
    expect(header[0]).toBe('div');
    expect(header[2]).toBe(`Money ${money.toLocaleString()}`);

    const body = formatter?.body(money) as unknown[];
    expect(body[0]).toBe('div');
    expect(formatter?.body({})).toBeNull();
  });
});
