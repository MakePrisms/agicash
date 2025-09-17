import { getEncodedToken } from '@cashu/cashu-ts';
import { useState } from 'react';
import { type SubmitHandler, useForm } from 'react-hook-form';
import { redirect } from 'react-router';
import { z } from 'zod';
import { Numpad } from '~/components/numpad';
import {
  ClosePageButton,
  Page,
  PageContent,
  PageFooter,
  PageHeader,
} from '~/components/page';
import { Redirect } from '~/components/redirect';
import { Button } from '~/components/ui/button';
import { Card, CardContent } from '~/components/ui/card';
import { Input } from '~/components/ui/input';
import { anonAgicashDb } from '~/features/agicash-db/database';
import { AnonLockedTokenRepository } from '~/features/locked-tokens';
import {
  lockedTokenQueryOptions,
  useGetLockedToken,
} from '~/features/locked-tokens/locked-token-hooks';
import useAnimation from '~/hooks/use-animation';
import { useToast } from '~/hooks/use-toast';
import useUserAgent from '~/hooks/use-user-agent';
import { useNavigateWithViewTransition } from '~/lib/transitions';
import { parseHashParams } from '~/lib/utils';
import { getQueryClient } from '~/query-client';
import type { Route } from './+types/_public.locked-token.$tokenHash';

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  const { tokenHash } = params;
  // Request url doesn't include hash so we need to read it from the window location instead
  const hash = window.location.hash;
  const hashParams = parseHashParams(
    hash,
    z.object({
      unlockingKey: z.string(),
    }),
  );

  if (!hashParams) {
    throw redirect('/');
  }

  const queryClient = getQueryClient();

  // Try to fetch the token without an access code first
  const repository = new AnonLockedTokenRepository(anonAgicashDb);
  const lockedTokenData = await queryClient.fetchQuery(
    lockedTokenQueryOptions({
      tokenHash,
      repository,
    }),
  );

  return {
    tokenHash,
    unlockingKey: hashParams.unlockingKey,
    lockedTokenData,
  };
}

const ACCESS_CODE_LENGTH = 4;

type FormValues = { cardCode: string };

export default function LockedTokenPage({ loaderData }: Route.ComponentProps) {
  const {
    tokenHash,
    unlockingKey,
    lockedTokenData: initialTokenData,
  } = loaderData;

  const { toast } = useToast();
  const navigate = useNavigateWithViewTransition();
  const getLockedToken = useGetLockedToken();
  const { isMobile } = useUserAgent();
  const { animationClass: shakeAnimationClass, start: startShakeAnimation } =
    useAnimation({ name: 'shake' });

  const [cardCode, setAccessCode] = useState('');
  const [isRedeeming, setIsRedeeming] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
    setValue,
  } = useForm<FormValues>();

  const handleCodeInput = (input: string) => {
    if (input === 'Backspace') {
      if (cardCode.length === 0) {
        startShakeAnimation();
        return;
      }
      const newCode = cardCode.slice(0, -1);
      setAccessCode(newCode);
      setValue('cardCode', newCode);
      return;
    }

    if (cardCode.length >= ACCESS_CODE_LENGTH) {
      startShakeAnimation();
      return;
    }

    if (!Number.isInteger(Number(input))) {
      startShakeAnimation();
      return;
    }

    const newCode = cardCode + input;
    setAccessCode(newCode);
    setValue('cardCode', newCode);
  };

  if (initialTokenData) {
    const hashContent = `token=${getEncodedToken(initialTokenData.token)}&unlockingKey=${unlockingKey}`;
    window.history.replaceState(null, '', `#${hashContent}`);
    return (
      <Redirect
        to={{
          pathname: '/receive-cashu-token',
          hash: hashContent,
        }}
      />
    );
  }

  const onSubmit: SubmitHandler<FormValues> = async (data) => {
    setIsRedeeming(true);
    try {
      const lockedTokenData = await getLockedToken(tokenHash, data.cardCode);

      if (lockedTokenData) {
        const hashContent = `token=${getEncodedToken(lockedTokenData.token)}&unlockingKey=${unlockingKey}`;
        window.history.replaceState(null, '', `#${hashContent}`);
        navigate(
          {
            pathname: '/receive-cashu-token',
            hash: hashContent,
          },
          {
            transition: 'slideLeft',
            applyTo: 'newView',
          },
        );
        // Don't set isRedeeming to false here since we're navigating away
      } else {
        setIsRedeeming(false);
        toast({
          title: 'Invalid Access Code',
          description: 'Please try again',
          duration: 2000,
          variant: 'destructive',
        });
      }
    } catch (error) {
      setIsRedeeming(false);
      console.error('Failed to redeem token', { cause: error, tokenHash });
      toast({
        title: 'Error',
        description: 'Failed to redeem gift card. Please try again.',
        duration: 2000,
        variant: 'destructive',
      });
    }
  };

  return (
    <Page>
      <PageHeader>
        <ClosePageButton to="/" transition="slideRight" applyTo="oldView" />
      </PageHeader>

      <PageContent className="flex flex-col justify-between">
        <div /> {/* spacer */}
        <div
          className={`flex flex-1 items-center justify-center ${isMobile ? 'pb-8' : ''}`}
        >
          <Card className="w-full max-w-sm">
            <CardContent className="flex flex-col gap-6 pt-6">
              <div className="text-center">
                <h3 className="mb-2 font-medium text-lg">Redeem Gift Card</h3>
                <p className="text-muted-foreground text-sm">
                  Enter the code on the back of the card
                </p>
              </div>
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                <div className="space-y-2">
                  <div className={`${shakeAnimationClass}`}>
                    <Input
                      {...register('cardCode', {
                        required: 'Card code is required',
                      })}
                      id="cardCode"
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={ACCESS_CODE_LENGTH}
                      className="text-center font-primary"
                      placeholder="Enter card code"
                      value={cardCode}
                      readOnly={isMobile}
                      onChange={
                        isMobile
                          ? undefined
                          : (e) => {
                              setAccessCode(e.target.value);
                              setValue('cardCode', e.target.value);
                            }
                      }
                      autoFocus={!isMobile}
                      disabled={isRedeeming}
                    />
                  </div>
                  {errors.cardCode && (
                    <p className="text-destructive text-sm">
                      {errors.cardCode.message}
                    </p>
                  )}
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
        <div className="flex w-full flex-col items-center gap-4">
          <div className="grid w-full max-w-sm grid-cols-3 gap-4 sm:w-auto">
            <div /> {/* spacer */}
            <div /> {/* spacer */}
            <Button
              onClick={handleSubmit(onSubmit)}
              disabled={isRedeeming || cardCode.length !== ACCESS_CODE_LENGTH}
              loading={isRedeeming}
              className="h-full w-full"
            >
              Redeem
            </Button>
          </div>
        </div>
      </PageContent>
      <PageFooter className="sm:pb-14">
        {isMobile && (
          <Numpad showDecimal={false} onButtonClick={handleCodeInput} />
        )}
      </PageFooter>
    </Page>
  );
}
