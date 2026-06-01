import { Page, PageContent } from '~/components/page';
import { ForgotPassword } from '~/features/login/forgot-password';

export default function ForgotPasswordPage() {
  return (
    <Page>
      <PageContent className="justify-center">
        <ForgotPassword />
      </PageContent>
    </Page>
  );
}
