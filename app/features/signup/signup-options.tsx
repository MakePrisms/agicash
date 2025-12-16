import { useState } from 'react';
import { Link, useLocation } from 'react-router';
import { Button } from '~/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card';
import { useFeatureFlag } from '~/lib/feature-flags';

type Option = 'email' | 'google' | 'guest';
type Props = { onSelect: (option: Option) => Promise<void> };

export function SignupOptions({ onSelect }: Props) {
  const [submitting, setSubmitting] = useState<Option | null>(null);
  const location = useLocation();
  const guestSignupEnabled = useFeatureFlag('GUEST_SIGNUP');

  const handeSelect = async (option: Option) => {
    if (submitting) return;

    try {
      setSubmitting(option);
      await onSelect(option);
    } finally {
      // Intentionally do not clear submitting here. Let unmount on navigation clear it.
      // If we clear it here, the button loading stops before new page is displayed. Not sure
      // why but possibly something with concurrent mode, suspense and react router.
    }
  };

  return (
    <Card className="mx-auto w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-2xl">Sign Up</CardTitle>
        <CardDescription>Choose your preferred sign-up method</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4">
          <Button
            onClick={() => handeSelect('email')}
            loading={submitting === 'email'}
          >
            Create wallet with Email
          </Button>
          <Button
            onClick={() => handeSelect('google')}
            loading={submitting === 'google'}
          >
            Create wallet with Google
          </Button>
          {guestSignupEnabled && (
            <Button
              onClick={() => handeSelect('guest')}
              loading={submitting === 'guest'}
            >
              Create wallet as Guest
            </Button>
          )}
        </div>
        <div className="mt-4 text-center text-sm">
          Already have an account?{' '}
          <Link to={{ ...location, pathname: '/login' }} className="underline">
            Log in
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
