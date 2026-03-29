/**
 * Returns the decimal separator for the current locale.
 * @param locale Locale to use to format the number. If not provided the locale of the machine will be used.
 * @returns The decimal separator for the current locale.
 */
export function getLocaleDecimalSeparator(locale?: string): string {
  const formatter = new Intl.NumberFormat(locale, {
    style: 'decimal',
    minimumFractionDigits: 1,
  });

  const parts = formatter.formatToParts(1.1);
  const decimalPart = parts.find((part) => part.type === 'decimal');

  if (!decimalPart) {
    throw new Error('Could not determine decimal separator');
  }

  return decimalPart.value;
}
