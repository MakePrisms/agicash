import { test } from 'bun:test';
import type { CompletedSparkLightningSendTransactionDetails as D } from './transaction-details';

// On the BUGGY type (Required<...> & { transferId?: string }), 'transferId' collapses
// to 'string' (required), so assigning an object without transferId must fail tsc.
// On the FIXED type (Omit<Required<...>, 'transferId'> & { transferId?: string }),
// transferId is truly optional and this compiles.
test('CompletedSparkLightningSendTransactionDetails.transferId is optional', () => {
  const withoutTransferId = {} as Omit<D, 'transferId'>;
  // Direct assignment (no 'as') — fails on buggy type because transferId is required,
  // passes on fixed type because transferId is optional.
  const _ok: D = withoutTransferId;
  void _ok;
});
