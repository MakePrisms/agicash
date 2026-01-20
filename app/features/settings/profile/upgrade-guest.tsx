import { useState } from 'react';
import { type SubmitHandler, useForm } from 'react-hook-form';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { getErrorMessage } from '~/features/shared/error';
import { useAuthActions } from '~/features/user/auth';
import { useUpgradeGuestToFullAccount } from '~/features/user/user-hooks';
import { useToast } from '~/hooks/use-toast';
import { buildEmailValidator } from '~/lib/validation';

type FormValues = { email: string; password: string; confirmPassword: string };

type UpgradeOption = 'email' | 'google';

const validateEmail = buildEmailValidator('Invalid email');

function UpgradeOptions({
  onSelect,
}: { onSelect: (option: UpgradeOption) => Promise<void> }) {
  const [submitting, setSubmitting] = useState<UpgradeOption | null>(null);

  const handleSelect = async (option: UpgradeOption) => {
    if (submitting) return;

    try {
      setSubmitting(option);
      await onSelect(option);
    } finally {
      setSubmitting(null);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-4">
      <h2 className="font-semibold text-lg">Backup and Sync</h2>
      <Button
        onClick={() => handleSelect('email')}
        loading={submitting === 'email'}
      >
        Upgrade with Email
      </Button>
      <Button
        onClick={() => handleSelect('google')}
        loading={submitting === 'google'}
      >
        Upgrade with Google
      </Button>
    </div>
  );
}

function UpgradeWithEmailForm({ onBack }: { onBack: () => void }) {
  const { toast } = useToast();
  const upgradeGuestToFullAccount = useUpgradeGuestToFullAccount();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>();

  const onSubmit: SubmitHandler<FormValues> = async (data) => {
    try {
      await upgradeGuestToFullAccount(data.email, data.password);
    } catch (e) {
      if (e instanceof Error && e.message === 'Email already registered') {
        toast({
          title: 'Email already taken',
          description:
            'Please try again with different email or login to your existing account',
        });
      } else {
        toast({
          variant: 'destructive',
          title: 'Error! Failed to convert account',
          description: 'Please try again later or contact support',
        });
      }
    }
  };

  return (
    <div className="mx-auto w-full max-w-sm">
      <h2 className="font-semibold text-lg">Backup and Sync</h2>
      <div className="flex flex-col gap-4">
        <form
          className="mt-2 grid gap-4"
          onSubmit={handleSubmit(onSubmit)}
          noValidate
        >
          <div className="grid gap-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="satoshi@nakamoto.com"
              aria-invalid={errors.email ? 'true' : 'false'}
              {...register('email', {
                required: 'Email is required',
                validate: validateEmail,
              })}
            />
            {errors.email && (
              <span role="alert" className="text-red-500 text-sm">
                {errors.email.message}
              </span>
            )}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              aria-invalid={errors.password ? 'true' : 'false'}
              {...register('password', {
                required: 'Password is required',
                minLength: {
                  value: 8,
                  message: 'Password must have at least 8 characters',
                },
              })}
            />
            {errors.password && (
              <span role="alert" className="text-red-500 text-sm">
                {errors.password.message}
              </span>
            )}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="confirmPassword">Confirm Password</Label>
            <Input
              id="confirmPassword"
              type="password"
              autoComplete="new-password"
              aria-invalid={errors.confirmPassword ? 'true' : 'false'}
              {...register('confirmPassword', {
                required: 'Password confirmation is required',
                validate: (value, values) =>
                  value === values.password || 'Passwords do not match',
              })}
            />
            {errors.confirmPassword && (
              <span role="alert" className="text-red-500 text-sm">
                {errors.confirmPassword.message}
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" onClick={onBack}>
              Back
            </Button>
            <Button type="submit" className="w-full" loading={isSubmitting}>
              Upgrade
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

type UpgradeStep = 'pick-option' | 'upgrade-with-email';

export function UpgradeGuest() {
  const [step, setStep] = useState<UpgradeStep>('pick-option');
  const { initiateGoogleAuth } = useAuthActions();
  const { toast } = useToast();

  const handleUpgradeWithGoogle = async () => {
    try {
      const response = await initiateGoogleAuth();
      console.debug('Initiate google upgrade response: ', response);
      window.location.href = response.authUrl;
    } catch (error) {
      console.error('Failed to initiate google upgrade', { cause: error });
      toast({
        variant: 'destructive',
        title: 'Error! Google upgrade failed',
        description: getErrorMessage(error),
      });
    }
  };

  if (step === 'pick-option') {
    return (
      <UpgradeOptions
        onSelect={async (option) => {
          if (option === 'email') {
            setStep('upgrade-with-email');
          } else if (option === 'google') {
            await handleUpgradeWithGoogle();
          }
        }}
      />
    );
  }

  return <UpgradeWithEmailForm onBack={() => setStep('pick-option')} />;
}
