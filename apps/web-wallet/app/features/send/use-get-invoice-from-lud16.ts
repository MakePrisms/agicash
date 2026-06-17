import type { Money } from '@agicash/utils/money';
import { getInvoiceFromLud16, isLNURLError } from '@agicash/wallet-sdk/lnurl';
import { useMutation } from '@tanstack/react-query';
import useLocationData from '~/hooks/use-location';

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
