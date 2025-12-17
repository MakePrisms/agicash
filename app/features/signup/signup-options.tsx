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
import { AcceptTerms } from './accept-terms';

type Option = 'email' | 'google' | 'guest';
type Props = { onSelect: (option: Option) => Promise<void> };

export function SignupOptions({ onSelect }: Props) {
  const [selected, setSelected] = useState<Option | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const location = useLocation();
  const guestSignupEnabled = useFeatureFlag('GUEST_SIGNUP');

  const handleAcceptTerms = async () => {
    if (submitting || !selected) return;

    try {
      setSubmitting(true);
      await onSelect(selected);
    } finally {
      // Intentionally do not clear submitting here. Let unmount on navigation clear it.
      // If we clear it here, the button loading stops before new page is displayed. Not sure
      // why but possibly something with concurrent mode, suspense and react router.
    }
  };

  if (selected) {
    return (
      <AcceptTerms
        onAccept={handleAcceptTerms}
        onBack={() => {
          setSelected(null);
          setSubmitting(false);
        }}
        loading={submitting}
      />
    );
  }

  return (
    <Card className="mx-auto w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-2xl">Sign Up</CardTitle>
        <CardDescription>Choose your preferred sign-up method</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4">
          <Button onClick={() => setSelected('email')}>
            Create wallet with Email
          </Button>
          <Button onClick={() => setSelected('google')}>
            Create wallet with Google
          </Button>
          {guestSignupEnabled && (
            <Button onClick={() => setSelected('guest')}>
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
