import { Page, PageContent } from '~/components/page';
import { Signup } from '~/features/signup/signup';

export default function SignupPage() {
  return (
    <Page>
      <PageContent className="justify-center">
        <Signup />
      </PageContent>
    </Page>
  );
}
