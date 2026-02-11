import { useState } from 'react';
import {
  Page,
  PageBackButton,
  PageContent,
  PageHeader,
  PageHeaderTitle,
} from '~/components/page';
import { Button } from '~/components/ui/button';
import type { SparkAccount } from '~/features/accounts/account';
import { useAccounts } from '~/features/accounts/account-hooks';

type TransferResult = {
  clientTime: string;
  clientTimestamp: number;
  balance: string;
  transferCount: number;
  transfers: unknown;
};

export default function DebugSparkTransfers() {
  const { data: sparkAccounts } = useAccounts({ type: 'spark' });
  const [result, setResult] = useState<TransferResult | null>(null);
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState(false);

  const account = sparkAccounts[0] as SparkAccount | undefined;

  async function handleGetTransfers() {
    if (!account) return;
    setLoading(true);
    setResult(null);
    setError('');

    // HACK: Workaround for Spark SDK bug where queryAllTransfers converts
    // Date -> {seconds, nanos} but the protobuf encoder then calls
    // toTimestamp() on that object which expects a Date with .getTime().
    // This adds getTime() to Object.prototype so the {seconds, nanos} plain
    // object survives the double conversion. Date.prototype.getTime takes
    // priority in the chain so real Dates are unaffected.
    // eslint-disable-next-line no-extend-native
    Object.defineProperty(Object.prototype, 'getTime', {
      configurable: true,
      enumerable: false,
      writable: true,
      value: function (this: Record<string, unknown>) {
        if (typeof this.seconds === 'number') {
          return (
            (this.seconds as number) * 1000 +
            Math.floor(((this.nanos as number) || 0) / 1e6)
          );
        }
        throw new TypeError('getTime is not a function');
      },
    });

    try {
      const now = Date.now();
      const createdAfter = new Date(now);

      const [transfersResponse, balanceResponse] = await Promise.all([
        account.wallet.getTransfers(100, 0, createdAfter),
        account.wallet.getBalance(),
      ]);

      const output: TransferResult = {
        clientTime: createdAfter.toISOString(),
        clientTimestamp: now,
        balance: balanceResponse.balance.toString(),
        transferCount: transfersResponse.transfers.length,
        transfers: transfersResponse,
      };

      console.log('getTransfers debug:', output);
      setResult(output);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('getTransfers error:', err);
      setError(msg);
    } finally {
      // @ts-expect-error - cleaning up our prototype hack
      Object.prototype.getTime = undefined;
      setLoading(false);
    }
  }

  return (
    <Page>
      <PageHeader>
        <PageBackButton to="/" transition="slideRight" applyTo="oldView" />
        <PageHeaderTitle>Debug: getTransfers</PageHeaderTitle>
      </PageHeader>
      <PageContent>
        <p className="text-muted-foreground text-sm">
          {account
            ? `Spark account: ${account.id} (${account.network})`
            : 'No spark account found'}
        </p>
        <Button
          className="w-full"
          onClick={handleGetTransfers}
          disabled={!account || loading}
        >
          {loading ? 'Loading...' : 'Call getTransfers(createdAfter: now)'}
        </Button>
        {result && (
          <>
            <div className="space-y-1 rounded-md bg-muted p-3 text-sm">
              <div>
                <span className="font-medium">Client time: </span>
                {result.clientTime}
              </div>
              <div>
                <span className="font-medium">Client timestamp: </span>
                {result.clientTimestamp}
              </div>
              <div>
                <span className="font-medium">Balance: </span>
                {result.balance} sats
              </div>
              <div>
                <span className="font-medium">Transfers returned: </span>
                {result.transferCount}
              </div>
            </div>
            <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-3 text-xs">
              {JSON.stringify(result.transfers, null, 2)}
            </pre>
          </>
        )}
        {error && (
          <pre className="whitespace-pre-wrap break-all rounded-md bg-destructive/10 p-3 text-destructive text-sm">
            {error}
          </pre>
        )}
      </PageContent>
    </Page>
  );
}
