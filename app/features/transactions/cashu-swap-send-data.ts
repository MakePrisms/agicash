import z from 'zod';
import { Money } from '~/lib/money';

/**
 * Schema for cashu swap receive data.
 */
export const CashuSwapSendDataSchema = z.object({
  /** Amount requested to send. */
  amountRequested: z.instanceof(Money),
  amountToSend: z.instanceof(Money),
  cashuReceiveFee: z.instanceof(Money),
  cashuSendFee: z.instanceof(Money),
  amountSpent: z.instanceof(Money),
  inputAmount: z.instanceof(Money),
  totalFees: z.instanceof(Money),
  amountToReceive: z.instanceof(Money),
  sendOutputAmounts: z.array(z.number()).optional(),
  changeOutputAmounts: z.array(z.number()).optional(),
});

export type CashuSwapSendData = z.infer<typeof CashuSwapSendDataSchema>;
