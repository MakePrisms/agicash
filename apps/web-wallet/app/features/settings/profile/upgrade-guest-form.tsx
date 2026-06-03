import { type SubmitHandler, useForm } from 'react-hook-form';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { useUpgradeGuestToFullAccount } from '~/features/user/user-hooks';
import { useToast } from '~/hooks/use-toast';
import { buildEmailValidator } from '~/lib/validation';

type FormValues = { email: string; password: string; confirmPassword: string };

const validateEmail = buildEmailValidator('Invalid email');

export function UpgradeGuestForm() {
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
    <div className="mx-auto max-w-sm">
      <div className="mb-6">
        <h2 className="font-semibold text-lg">Upgrade</h2>
        <p className="text-muted-foreground text-sm">
          Enter your email and password to backup your account and sync across
          devices.
        </p>
      </div>
      <div>
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
          <Button type="submit" className="w-full" loading={isSubmitting}>
            Upgrade to full account
          </Button>
        </form>
      </div>
    </div>
  );
}
