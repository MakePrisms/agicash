import { useSearchParams } from 'react-router';
import { Page } from '~/components/page';
import AddMint from '~/features/discover/add-mint';
import type { Currency } from '~/lib/money';

export default function AddMintRoute() {
  const [searchParams] = useSearchParams();
  const mintUrl = searchParams.get('url');
  const currency = searchParams.get('currency') as Currency;
  const name = searchParams.get('name');

  if (!mintUrl || !currency || !name) {
    return (
      <Page>
        <div className="flex h-full items-center justify-center">
          <p className="text-muted-foreground">
            {!mintUrl
              ? 'Missing mint URL'
              : !currency
                ? 'Missing currency'
                : !name
                  ? 'Missing name'
                  : ''}
          </p>
        </div>
      </Page>
    );
  }

  return (
    <Page>
      <AddMint mintUrl={mintUrl} currency={currency} name={name} />
    </Page>
  );
}
