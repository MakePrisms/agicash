import {
  ClosePageButton,
  Page,
  PageContent,
  PageHeader,
  PageHeaderTitle,
} from '~/components/page';

type Props = {
  unit?: string;
};

export function UnsupportedTokenUnitPage({ unit }: Props) {
  return (
    <Page>
      <PageHeader>
        <ClosePageButton to="/" transition="slideDown" applyTo="oldView" />
        <PageHeaderTitle>Unsupported token</PageHeaderTitle>
      </PageHeader>
      <PageContent className="flex flex-col items-center justify-center gap-2 text-center">
        <p>
          This token uses the unit '{unit ?? 'unknown'}' which isn't supported.
        </p>
        <p className="text-muted-foreground text-sm">
          Agicash supports BTC (sat) and USD tokens.
        </p>
      </PageContent>
    </Page>
  );
}
