import { type SubmitHandler, useForm } from 'react-hook-form';
import { Link, useLocation } from 'react-router';
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
import { useToast } from '~/hooks/use-toast';
import { buildEmailValidator } from '~/lib/validation';

type Props = { onBack: () => void };

type FormValues = { email: string; password: string };

const validateEmail = buildEmailValidator('Invalid email');

export function LoginForm({ onBack }: Props) {
  const { signIn } = useAuthActions();
  const { toast } = useToast();
  const location = useLocation();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>();

  const onSubmit: SubmitHandler<FormValues> = async (data) => {
    try {
      await signIn(data.email, data.password);
    } catch {
      toast({
        variant: 'destructive',
        title: 'Error! Login failed',
        description: 'Please try again later or contact support',
      });
    }
  };

  return (
    <Card className="mx-auto w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-2xl">Login</CardTitle>
        <CardDescription>
          Enter your email below to login to your wallet
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
              autoComplete="username"
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
          <div className="grid gap-2">
            <div className="flex items-center">
              <Label htmlFor="password">Password</Label>
              <Link
                to="/forgot-password"
                className="ml-auto inline-block text-sm underline"
              >
                Forgot your password?
              </Link>
            </div>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              aria-invalid={errors.password ? 'true' : 'false'}
              {...register('password', { required: 'Password is required' })}
            />
            {errors.password && (
              <span
                id="passwordError"
                role="alert"
                aria-labelledby="passwordError"
                className="text-red-500 text-sm"
              >
                {errors.password.message}
              </span>
            )}
          </div>
          <Button type="submit" className="w-full" loading={isSubmitting}>
            Login
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
        <div className="mt-4 text-center text-sm">
          Don&apos;t have a wallet?{' '}
          <Link to={{ ...location, pathname: '/signup' }} className="underline">
            Sign up
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
