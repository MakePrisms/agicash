import { useState } from 'react';
import { useLocation } from 'react-router';
import { Button } from '~/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card';
import { Checkbox } from '~/components/ui/checkbox';
import { Label } from '~/components/ui/label';
import { LinkWithViewTransition } from '~/lib/transitions';

type AcceptTermsProps = {
  onAccept: () => Promise<void>;
  onBack: () => void;
  loading?: boolean;
};

/**
 * This component shows a checkbox to accept the terms of service and a button to continue.
 * It should be used whenever the user needs to accept the terms of service,
 * such as when the user is creating a new account.
 */
export function AcceptTerms({ onAccept, onBack, loading }: AcceptTermsProps) {
  const [accepted, setAccepted] = useState(false);
  const location = useLocation();

  return (
    <Card className="mx-auto w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-2xl">Terms of Service</CardTitle>
        <CardDescription>
          Please accept the terms of service to continue
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4">
          <div className="flex items-start gap-2">
            <Checkbox
              id="terms-checkbox"
              checked={accepted}
              onCheckedChange={(value) => setAccepted(value === true)}
              className="mt-0.5 border-primary-foreground"
            />
            <Label
              htmlFor="terms-checkbox"
              className="text-muted-foreground text-xs leading-5"
            >
              By clicking the checkbox, (i) I hereby accept the{' '}
              <LinkWithViewTransition
                to={{
                  pathname: '/terms',
                  search: `redirectTo=${location.pathname}`,
                }}
                transition="slideUp"
                applyTo="newView"
                className="text-foreground underline"
              >
                TERMS OF SERVICE
              </LinkWithViewTransition>{' '}
              and agree to be bound by them; and (ii) I acknowledge receipt of
              the{' '}
              <LinkWithViewTransition
                to={{
                  pathname: '/privacy',
                  search: `redirectTo=${location.pathname}`,
                }}
                transition="slideUp"
                applyTo="newView"
                className="text-foreground underline"
              >
                Privacy Notice
              </LinkWithViewTransition>
              .
            </Label>
          </div>
          <Button onClick={onAccept} disabled={!accepted} loading={loading}>
            Continue
          </Button>
          <Button variant="ghost" onClick={onBack} disabled={loading}>
            Back
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
