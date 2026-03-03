import { useQuery } from '@tanstack/react-query';
import { agicashDbClient } from '../agicash-db/database.client';

type QuoteType = 'cashu' | 'spark';

const CASHU_TERMINAL_STATES = ['COMPLETED', 'EXPIRED', 'FAILED'] as const;
const SPARK_TERMINAL_STATES = ['PAID', 'EXPIRED', 'FAILED'] as const;

function isTerminalState(state: string, quoteType: QuoteType): boolean {
  const terminalStates =
    quoteType === 'cashu' ? CASHU_TERMINAL_STATES : SPARK_TERMINAL_STATES;
  return (terminalStates as readonly string[]).includes(state);
}

function isSuccessState(state: string, quoteType: QuoteType): boolean {
  return quoteType === 'cashu' ? state === 'COMPLETED' : state === 'PAID';
}

type UseBuyQuoteStatusProps = {
  quoteId: string;
  quoteType: QuoteType;
  onSuccess?: (transactionId: string) => void;
};

export function useBuyQuoteStatus({
  quoteId,
  quoteType,
  onSuccess,
}: UseBuyQuoteStatusProps) {
  const tableName =
    quoteType === 'cashu' ? 'cashu_receive_quotes' : 'spark_receive_quotes';

  const { data: state } = useQuery({
    queryKey: ['buy-quote-status', quoteId],
    queryFn: async () => {
      const { data, error } = await agicashDbClient
        .from(tableName)
        .select('state, transaction_id')
        .eq('id', quoteId)
        .single();

      if (error) {
        throw new Error('Failed to fetch quote status', { cause: error });
      }

      if (isSuccessState(data.state, quoteType)) {
        onSuccess?.(data.transaction_id);
      }

      return data.state;
    },
    refetchInterval: (query) => {
      const currentState = query.state.data;
      if (currentState && isTerminalState(currentState, quoteType)) {
        return false;
      }
      return 5_000;
    },
    refetchOnWindowFocus: 'always',
  });

  return {
    state: state ?? 'UNPAID',
    isTerminal: state ? isTerminalState(state, quoteType) : false,
    isSuccess: state ? isSuccessState(state, quoteType) : false,
  };
}
