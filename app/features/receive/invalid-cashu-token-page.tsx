import {
  ClosePageButton,
  Page,
  PageContent,
  PageHeader,
  PageHeaderTitle,
} from '~/components/page';

type Props = {
  message: string;
};

export function InvalidCashuTokenPage({ message }: Props) {
  return (
    <Page>
      <PageHeader>
        <ClosePageButton to="/" transition="slideDown" applyTo="oldView" />
        <PageHeaderTitle>Oops!</PageHeaderTitle>
      </PageHeader>
      <PageContent className="flex flex-col items-center justify-center text-center">
        <p>{message}</p>
      </PageContent>
    </Page>
  );
}
