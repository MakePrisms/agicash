import { useMutation } from '@tanstack/react-query';
import { getInvoiceFromLud16, isLNURLError } from '~/lib/lnurl';
import type { Money } from '~/lib/money';

export function useGetInvoiceFromLud16() {
  return useMutation({
    mutationFn: async ({
      lud16,
      amount,
    }: { lud16: string; amount: Money<'BTC'> }) => {
      const invoiceResult = await getInvoiceFromLud16(lud16, amount);
      if (isLNURLError(invoiceResult)) {
        throw new Error(invoiceResult.reason);
      }
      return invoiceResult.pr;
    },
  });
}
