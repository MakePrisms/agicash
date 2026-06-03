import {
  PageBackButton,
  PageContent,
  PageHeader,
  PageHeaderTitle,
} from '~/components/page';
import { AddMintForm } from '~/features/settings/accounts/add-mint-form';

export default function AddCashuAccountView() {
  return (
    <>
      <PageHeader>
        <PageBackButton
          to="/settings/accounts"
          transition="slideRight"
          applyTo="oldView"
        />
        <PageHeaderTitle>Create Cashu Account</PageHeaderTitle>
      </PageHeader>
      <PageContent>
        <AddMintForm />
      </PageContent>
    </>
  );
}
