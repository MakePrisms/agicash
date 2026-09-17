import { Link, useLocation } from 'react-router';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card';
import { SIGNUP_DISABLED_MESSAGE } from '~/features/shared/wallet-operations';

export function Signup() {
  const location = useLocation();

  return (
    <Card className="mx-auto w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-2xl">Sign Up</CardTitle>
        <CardDescription>{SIGNUP_DISABLED_MESSAGE}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="text-center text-sm">
          Already have an account?{' '}
          <Link to={{ ...location, pathname: '/login' }} className="underline">
            Log in
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
