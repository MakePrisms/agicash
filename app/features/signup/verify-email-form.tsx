import { useForm } from 'react-hook-form';
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
import { useRequestEmailVerificationCode } from '~/features/signup/verify-email';
import { useSignOut } from '~/features/user/auth';
import type { FullUser } from '~/features/user/user';
import { useToast } from '~/hooks/use-toast';
import { useVerifyEmail } from '../user/user-hooks';

type FormValues = { code: string };
type Props = { user: FullUser };

export function VerifyEmailForm({ user }: Props) {
  const { isSigningOut, signOut } = useSignOut();
  const verifyEmail = useVerifyEmail();
  const { toast } = useToast();
  const { requestingEmailVerificationCode, requestEmailVerificationCode } =
    useRequestEmailVerificationCode();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>();

  const onSubmit = async (data: FormValues) => {
    try {
      await verifyEmail(data.code);
    } catch (e) {
      const description =
        e instanceof Error ? e.message : 'Failed to verify email';
      toast({
        variant: 'destructive',
        title: 'Verification Failed',
        description,
      });
    }
  };

  return (
    <Card className="mx-auto w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-2xl">Verify Your Email</CardTitle>
        <CardDescription>
          Please check your email ({user.email}) to verify your account. You'll
          need to verify your email to continue using Agicash.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4"
          onSubmit={handleSubmit(onSubmit)}
          noValidate
        >
          <div className="grid gap-2">
            <Label htmlFor="verificationCode">Verification Code</Label>
            <Input
              id="verificationCode"
              type="text"
              placeholder="Enter verification code"
              aria-invalid={errors.code ? 'true' : 'false'}
              {...register('code', {
                required: 'Code is required',
              })}
            />
            {errors.code && (
              <span
                id="verificationCodeError"
                role="alert"
                aria-labelledby="verificationCodeError"
                className="text-red-500 text-sm"
              >
                {errors.code.message}
              </span>
            )}
          </div>
          <Button type="submit" className="w-full" loading={isSubmitting}>
            Verify
          </Button>
          <Button
            type="button"
            className="w-full"
            variant="outline"
            loading={requestingEmailVerificationCode}
            onClick={requestEmailVerificationCode}
          >
            Resend Verification Email
          </Button>
          <Button
            type="button"
            className="w-full"
            variant="outline"
            onClick={signOut}
            loading={isSigningOut}
          >
            Log Out
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
