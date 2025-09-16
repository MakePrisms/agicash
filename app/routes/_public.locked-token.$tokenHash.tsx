import { getEncodedToken } from '@cashu/cashu-ts';
import { useEffect } from 'react';
import { type SubmitHandler, useForm } from 'react-hook-form';
import { redirect } from 'react-router';
import { z } from 'zod';
import {
  ClosePageButton,
  Page,
  PageContent,
  PageHeader,
  PageHeaderTitle,
} from '~/components/page';
import { Redirect } from '~/components/redirect';
import { Button } from '~/components/ui/button';
import { Card, CardContent } from '~/components/ui/card';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { anonAgicashDb } from '~/features/agicash-db/database';
import { AnonLockedTokenRepository } from '~/features/locked-tokens';
import {
  lockedTokenQueryOptions,
  useGetLockedToken,
} from '~/features/locked-tokens/locked-token-hooks';
import { useToast } from '~/hooks/use-toast';
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

type FormValues = { accessCode: string };

export default function LockedTokenPage({ loaderData }: Route.ComponentProps) {
  const {
    tokenHash,
    unlockingKey,
    lockedTokenData: initialTokenData,
  } = loaderData;

  const { toast } = useToast();
  const navigate = useNavigateWithViewTransition();
  const getLockedToken = useGetLockedToken();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, isLoading, isSubmitSuccessful },
  } = useForm<FormValues>();

  useEffect(() => {
    console.log('IS SUBMITTING', isSubmitting);
  }, [isSubmitting]);
  useEffect(() => {
    console.log('IS SUBMIT SUCCESSFUL', isSubmitSuccessful);
  }, [isSubmitSuccessful]);
  useEffect(() => {
    console.log('IS LOADING', isLoading);
  }, [isLoading]);

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
    try {
      const lockedTokenData = await getLockedToken(tokenHash, data.accessCode);

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
      } else {
        toast({
          title: 'Invalid Access Code',
          description: 'Please try again',
          duration: 2000,
          variant: 'destructive',
        });
      }
    } catch (error) {
      console.error('Failed to unlock token', { cause: error, tokenHash });
      toast({
        title: 'Error',
        description: 'Failed to unlock gift card. Please try again.',
        duration: 2000,
        variant: 'destructive',
      });
    }
  };

  return (
    <Page>
      <PageHeader className="z-10">
        <ClosePageButton to="/" transition="slideRight" applyTo="oldView" />
        <PageHeaderTitle>Enter Access Code</PageHeaderTitle>
      </PageHeader>
      <PageContent className="flex flex-col items-center gap-4">
        <div className="absolute top-0 right-0 bottom-0 left-0 mx-auto flex max-w-sm items-center justify-center">
          <Card className="m-4 w-full">
            <CardContent className="flex flex-col gap-6 pt-6">
              <div className="text-center">
                <h3 className="mb-2 font-medium text-lg">
                  Protected Gift Card
                </h3>
                <p className="text-muted-foreground text-sm">
                  This gift card requires an access code to unlock
                </p>
              </div>
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="accessCode">Access Code</Label>
                  <Input
                    {...register('accessCode', {
                      required: 'Access code is required',
                    })}
                    id="accessCode"
                    type="text"
                    placeholder="Enter access code"
                    autoFocus
                    disabled={isSubmitting || isSubmitSuccessful}
                  />
                  {errors.accessCode && (
                    <p className="text-destructive text-sm">
                      {errors.accessCode.message}
                    </p>
                  )}
                </div>
                <Button
                  type="submit"
                  className="w-full"
                  disabled={isSubmitting || isSubmitSuccessful}
                  loading={isSubmitting || isSubmitSuccessful}
                >
                  Unlock Gift Card
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </PageContent>
    </Page>
  );
}
