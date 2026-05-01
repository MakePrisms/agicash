import {
  ClosePageButton,
  Page,
  PageContent,
  PageHeader,
  PageHeaderTitle,
} from '~/components/page';

type Props = {
  message: string;
  display?: { amount: number; unit: string };
};

export function InvalidCashuTokenPage({ message, display }: Props) {
  return (
    <Page>
      <PageHeader>
        <ClosePageButton to="/" transition="slideDown" applyTo="oldView" />
        <PageHeaderTitle>Oops!</PageHeaderTitle>
      </PageHeader>
      <PageContent className="flex flex-col items-center justify-center gap-6 text-center">
        {display && (
          <span className="inline-flex items-baseline gap-2 font-bold">
            <span className="pt-2 font-numeric text-6xl">{display.amount}</span>
            <span className="text-[3.45rem]">{display.unit}</span>
          </span>
        )}
        <p>{message}</p>
      </PageContent>
    </Page>
  );
}
