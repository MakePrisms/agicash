import { Link } from 'react-router';
import { useLocation } from 'react-router';
import { Page, PageContent, PageHeaderTitle } from '~/components/page';

export default function LandingPage() {
  const { hash, search } = useLocation();
  return (
    <Page>
      {' '}
      <PageHeaderTitle>LandingPage</PageHeaderTitle>
      <PageContent>
        <Link to={`/signup${search}${hash}`} prefetch="viewport">
          signup
        </Link>
        <Link to={`/login${search}${hash}`} prefetch="viewport">
          login
        </Link>
      </PageContent>
    </Page>
  );
}
