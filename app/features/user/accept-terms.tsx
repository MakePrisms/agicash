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
  requireWalletTerms: boolean;
  requireGiftCardMintTerms: boolean;
};

/**
 * This component shows checkboxes to accept terms of service and a button to continue.
 * It supports both wallet terms and gift-card-mint terms, controlled by props.
 * When both are required, two checkbox rows are shown.
 * The continue button is disabled until all shown checkboxes are checked.
 */
export function AcceptTerms({
  onAccept,
  onBack,
  loading,
  requireWalletTerms,
  requireGiftCardMintTerms,
}: AcceptTermsProps) {
  const [accepted, setAccepted] = useState({
    wallet: false,
    giftCardMint: false,
  });
  const location = useLocation();

  const allAccepted =
    (!requireWalletTerms || accepted.wallet) &&
    (!requireGiftCardMintTerms || accepted.giftCardMint);

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
          {requireWalletTerms && (
            <div className="flex items-start gap-2">
              <Checkbox
                id="terms-checkbox"
                checked={accepted.wallet}
                onCheckedChange={(value) =>
                  setAccepted((prev) => ({ ...prev, wallet: value === true }))
                }
                className="mt-0.5 border-primary-foreground"
              />
              <Label
                htmlFor="terms-checkbox"
                className="text-muted-foreground text-xs leading-5"
              >
                By clicking the checkbox, (i) I hereby accept the wallet{' '}
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
                the wallet{' '}
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
          )}
          {requireGiftCardMintTerms && (
            <div className="flex items-start gap-2">
              <Checkbox
                id="gift-card-mint-terms-checkbox"
                checked={accepted.giftCardMint}
                onCheckedChange={(value) =>
                  setAccepted((prev) => ({
                    ...prev,
                    giftCardMint: value === true,
                  }))
                }
                className="mt-0.5 border-primary-foreground"
              />
              <Label
                htmlFor="gift-card-mint-terms-checkbox"
                className="text-muted-foreground text-xs leading-5"
              >
                By clicking the checkbox, (i) I hereby accept the mint{' '}
                <LinkWithViewTransition
                  to={{
                    pathname: '/mint-terms',
                    search: `redirectTo=${location.pathname}`,
                  }}
                  transition="slideUp"
                  applyTo="newView"
                  className="text-foreground underline"
                >
                  TERMS OF SERVICE
                </LinkWithViewTransition>{' '}
                and agree to be bound by them; and (ii) I acknowledge receipt of
                the mint{' '}
                <LinkWithViewTransition
                  to={{
                    pathname: '/mint-privacy',
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
          )}
          <Button onClick={onAccept} disabled={!allAccepted} loading={loading}>
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
