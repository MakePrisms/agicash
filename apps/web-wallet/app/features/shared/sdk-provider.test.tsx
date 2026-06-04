import { expect, test } from 'bun:test';
import { AgicashProvider, useSdk } from '@agicash/react-wallet-sdk';
import type { Sdk } from '@agicash/wallet-sdk';
import { renderToStaticMarkup } from 'react-dom/server';
import { SdkProvider } from './sdk-provider';

/**
 * PR8a smoke. `renderToStaticMarkup` runs with `isServer === true`, so it exercises
 * `SdkProvider`'s server branch: it must be an inert pass-through (no `window`/`Sdk.create`
 * access, no throw) that renders its children. The client branch (which `use(getSdk())`s the
 * browser singleton) is covered by hydration in the browser, not here.
 */
test('SdkProvider renders children on the server without touching the browser SDK', () => {
  const html = renderToStaticMarkup(
    <SdkProvider>
      <span>child</span>
    </SdkProvider>,
  );
  expect(html).toContain('child');
});

/**
 * The provider/consumer contract the web wires to (PR8a): a tree wrapped in `AgicashProvider`
 * resolves the supplied `Sdk` via `useSdk`. This is what `SdkProvider`'s client branch composes
 * once the singleton resolves.
 */
test('AgicashProvider resolves the provided Sdk via useSdk', () => {
  const sdk = { id: 'pr8a-smoke' } as unknown as Sdk;

  function Probe() {
    const resolved = useSdk() as unknown as { id: string };
    return <span>{resolved.id}</span>;
  }

  const html = renderToStaticMarkup(
    <AgicashProvider sdk={sdk}>
      <Probe />
    </AgicashProvider>,
  );
  expect(html).toContain('pr8a-smoke');
});
