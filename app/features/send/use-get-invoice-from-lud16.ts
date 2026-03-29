import { useMutation } from '@tanstack/react-query';
import useLocationData from '~/hooks/use-location';
import { getInvoiceFromLud16, isLNURLError } from '@agicash/sdk/lib/lnurl/index';
import type { Money } from '@agicash/sdk/lib/money/index';

export function useGetInvoiceFromLud16() {
  const { domain } = useLocationData();
  return useMutation({
    mutationFn: async ({
      lud16,
      amount,
    }: { lud16: string; amount: Money<'BTC'> }) => {
      const invoiceResult = await getInvoiceFromLud16(lud16, amount, domain);
      if (isLNURLError(invoiceResult)) {
        throw new Error(invoiceResult.reason);
      }
      return invoiceResult.pr;
    },
  });
}
