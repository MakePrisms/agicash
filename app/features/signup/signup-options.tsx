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
import { useFeatureFlag } from '~/features/shared/feature-flags';
import { pendingTermsStorage } from '~/features/user/pending-terms-storage';
import { AcceptTerms } from './accept-terms';

type Option = 'email' | 'google' | 'guest';
type Props = { onSelect: (option: Option) => Promise<void> };

type Step =
  | { name: 'pick-signup-option' }
  | { name: 'accept-terms'; selectedOption: Option; submitting: boolean };

export function SignupOptions({ onSelect }: Props) {
  const [step, setStep] = useState<Step>({ name: 'pick-signup-option' });
  const location = useLocation();
  const guestSignupEnabled = useFeatureFlag('GUEST_SIGNUP');

  const selectOption = (option: Option) =>
    setStep({
      name: 'accept-terms',
      selectedOption: option,
      submitting: false,
    });

  if (step.name === 'accept-terms') {
    const handleAcceptTerms = async () => {
      if (step.submitting) return;

      pendingTermsStorage.set(new Date().toISOString());

      setStep({ ...step, submitting: true });
      await onSelect(step.selectedOption);
      // Intentionally do not clear submitting here. Let unmount on navigation clear it.
      // If we clear it here, the button loading stops before new page is displayed. Not sure
      // why but possibly something with concurrent mode, suspense and react router.
    };

    return (
      <AcceptTerms
        onAccept={handleAcceptTerms}
        onBack={() => setStep({ name: 'pick-signup-option' })}
        loading={step.submitting}
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
          <Button onClick={() => selectOption('email')}>
            Create wallet with Email
          </Button>
          <Button onClick={() => selectOption('google')}>
            Create wallet with Google
          </Button>
          {guestSignupEnabled && (
            <Button onClick={() => selectOption('guest')}>
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
