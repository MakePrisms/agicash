import { Page, PageContent } from '~/components/page';
import { Login } from '~/features/login/login';

export default function LoginPage() {
  return (
    <Page>
      <PageContent className="justify-center">
        <Login />
      </PageContent>
    </Page>
  );
}
