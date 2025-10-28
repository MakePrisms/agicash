import ky from 'ky';
import { type SubmitHandler, useForm } from 'react-hook-form';
import { useToast } from '~/hooks/use-toast';
import agicashLogo192 from '../../assets/icon-192x192.png';
import { PageContent } from '../../components/page';
import { Button } from '../../components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { buildEmailValidator } from '../../lib/validation';

type FormValues = {
  email: string;
};

const validateEmail = buildEmailValidator('Invalid email');

function SquarePOSLogo() {
  return (
    <svg
      className="h-20 w-20"
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>Square POS Logo</title>
      <g id="square-pos-logo">
        <g>
          <path
            d="M17,22H7c-2.8,0-5-2.2-5-5V7c0-2.8,2.2-5,5-5h10c2.8,0,5,2.2,5,5v10C22,19.7,19.8,22,17,22z M7,4C5.3,4,4,5.3,4,7v10
            c0,1.7,1.3,3,3,3h10c1.7,0,3-1.3,3-3V7c0-1.7-1.3-3-3-3H7z"
          />
        </g>
        <g>
          <path d="M14,9h-4c-0.6,0-1,0.4-1,1v4c0,0.6,0.4,1,1,1h4c0.6,0,1-0.4,1-1v-4C15,9.4,14.6,9,14,9z" />
        </g>
      </g>
    </svg>
  );
}

type ConnectSquareProps = {
  isConnected: boolean;
  error?: string | null;
};

const ERROR_MESSAGES: Record<string, string> = {
  csrf: 'Security verification failed. Please try again.',
  missing_email: 'Email is required. Please try again.',
  invalid_request: 'Invalid request. Please try again.',
};

/**
 * Component for connecting a Square merchant account to Agicash
 */
export function ConnectSquare({ isConnected, error }: ConnectSquareProps) {
  const { toast } = useToast();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, isSubmitSuccessful },
  } = useForm<FormValues>();

  const onSubmit: SubmitHandler<FormValues> = async (data) => {
    try {
      const params = new URLSearchParams({ email: data.email });
      const response = await ky
        .get<{ authUrl: string }>(`/api/square/auth-url?${params}`)
        .json();
      window.location.href = response.authUrl;
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to connect',
        variant: 'destructive',
      });
      throw err;
    }
  };

  if (error) {
    const errorMessage = ERROR_MESSAGES[error] || error;
    return (
      <PageContent className="items-center justify-center gap-4">
        <h1 className="font-semibold text-2xl ">Connection Failed</h1>
        <p className="max-w-sm text-center text-muted-foreground text-red-500">
          {errorMessage}
        </p>
        <Button
          onClick={() => {
            window.location.href = '/merchant/square';
          }}
        >
          Try Again
        </Button>
      </PageContent>
    );
  }

  if (isConnected) {
    return (
      <PageContent className="items-center justify-center gap-4">
        <div className="flex items-center gap-4">
          <img
            src={agicashLogo192}
            alt="Agicash"
            className="h-20 w-20 rounded-2xl"
          />
          <SquarePOSLogo />
        </div>
        <h1 className="font-semibold text-2xl">Connected to Square</h1>
      </PageContent>
    );
  }

  return (
    <PageContent className="items-center justify-center">
      <Card className="m-4 w-full max-w-sm">
        <CardHeader>
          <CardTitle>Create a Mint</CardTitle>
          <CardDescription>
            Enter your contact email and connect your Square account
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={handleSubmit(onSubmit)}
            noValidate
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="merchant@example.com"
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
            <Button
              type="submit"
              className="w-full"
              loading={isSubmitting || isSubmitSuccessful}
            >
              Connect to Square
            </Button>
          </form>
        </CardContent>
      </Card>
    </PageContent>
  );
}
