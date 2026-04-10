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

type AcceptMintTermsProps = {
  onAccept: () => Promise<void>;
  onBack: () => void;
  loading?: boolean;
};

/**
 * This component shows a checkbox to accept the mint terms of service and a button to continue.
 * It should be used whenever the user needs to accept the mint terms of service,
 * such as when the user is connecting to a new mint.
 */
export function AcceptMintTerms({
  onAccept,
  onBack,
  loading,
}: AcceptMintTermsProps) {
  const [accepted, setAccepted] = useState(false);
  const location = useLocation();

  return (
    <Card className="mx-auto w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-2xl">Mint Terms of Service</CardTitle>
        <CardDescription>
          Please accept the mint terms of service to continue
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4">
          <div className="flex items-start gap-2">
            <Checkbox
              id="mint-terms-checkbox"
              checked={accepted}
              onCheckedChange={(value) => setAccepted(value === true)}
              className="mt-0.5 border-primary-foreground"
            />
            <Label
              htmlFor="mint-terms-checkbox"
              className="text-muted-foreground text-xs leading-5"
            >
              By clicking the checkbox, I hereby accept the{' '}
              <LinkWithViewTransition
                to={{
                  pathname: '/terms',
                  search: `redirectTo=${location.pathname}`,
                }}
                transition="slideUp"
                applyTo="newView"
                className="text-foreground underline"
              >
                MINT TERMS OF SERVICE
              </LinkWithViewTransition>{' '}
              and agree to be bound by them.
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
