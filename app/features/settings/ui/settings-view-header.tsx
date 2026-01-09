import {
  PageBackButton,
  type PageBackButtonProps,
  PageHeader,
  PageHeaderItem,
  PageHeaderTitle,
} from '~/components/page';

export const SettingsViewHeader = ({
  title,
  navBack,
  children,
}: {
  title?: string;
  navBack: PageBackButtonProps;
  children?: React.ReactNode;
}) => {
  return (
    <PageHeader>
      <PageBackButton {...navBack} />
      {title && <PageHeaderTitle>{title}</PageHeaderTitle>}
      {children && <PageHeaderItem position="right">{children}</PageHeaderItem>}
    </PageHeader>
  );
};
