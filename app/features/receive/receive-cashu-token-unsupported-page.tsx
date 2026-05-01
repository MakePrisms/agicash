import type { Token } from '@cashu/cashu-ts';
import {
  ClosePageButton,
  Page,
  PageContent,
  PageHeader,
  PageHeaderTitle,
} from '~/components/page';
import { sumProofs } from '~/lib/cashu';
import { CASHU_PROTOCOL_UNITS } from '~/lib/cashu/types';

type Props = {
  token: Token;
};

export function UnsupportedTokenUnitPage({ token }: Props) {
  const amount = sumProofs(token.proofs);
  const unit = token.unit ?? 'unknown';

  return (
    <Page>
      <PageHeader>
        <ClosePageButton to="/" transition="slideDown" applyTo="oldView" />
        <PageHeaderTitle>Oops!</PageHeaderTitle>
      </PageHeader>
      <PageContent className="flex flex-col items-center justify-center gap-6 text-center">
        <span className="inline-flex items-baseline gap-2 font-bold">
          <span className="pt-2 font-numeric text-6xl">{amount}</span>
          <span className="text-[3.45rem]">{unit}</span>
        </span>
        <div className="flex flex-col gap-2">
          <p>This token's unit isn't supported.</p>
          <p className="text-muted-foreground text-sm">
            Supported units: {CASHU_PROTOCOL_UNITS.join(', ')}
          </p>
        </div>
      </PageContent>
    </Page>
  );
}
