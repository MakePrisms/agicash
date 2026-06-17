import { type SubmitHandler, useForm } from 'react-hook-form';
import { Button } from '~/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { useAuthActions } from '~/features/user/auth';
import { toast } from '~/hooks/use-toast';
import { buildEmailValidator } from '~/lib/validation';

type Props = {
  onRequested: (email: string, secret: string) => void;
  onBack: () => void;
};

type FormValues = { email: string };

const validateEmail = buildEmailValidator('Invalid email');

export function RequestPasswordReset({ onRequested, onBack }: Props) {
  const { requestPasswordReset } = useAuthActions();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>();

  const onSubmit: SubmitHandler<FormValues> = async (data) => {
    try {
      const { secret } = await requestPasswordReset(data.email);
      onRequested(data.email, secret);
    } catch {
      toast({
        variant: 'destructive',
        title: 'Error! Failed to request password reset',
        description: 'Please try again later or contact support',
      });
    }
  };

  return (
    <Card className="mx-auto w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-2xl">Reset Password</CardTitle>
        <CardDescription>
          Enter your email address to request a password reset.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4"
          onSubmit={handleSubmit(onSubmit)}
          noValidate
        >
          <div className="grid gap-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="satoshi@nakamoto.com"
              aria-invalid={errors.email ? 'true' : 'false'}
              {...register('email', {
                required: 'Email is required',
                validate: validateEmail,
              })}
            />
            {errors.email && (
              <span
                id="emailError"
                role="alert"
                aria-labelledby="emailError"
                className="text-red-500 text-sm"
              >
                {errors.email.message}
              </span>
            )}
          </div>
          <Button type="submit" className="w-full" loading={isSubmitting}>
            Request Password Reset
          </Button>
          <Button
            variant="ghost"
            className="w-full"
            type="button"
            onClick={onBack}
          >
            Back
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
