import { useEffect, useState } from 'react';
import { type SubmitHandler, useForm } from 'react-hook-form';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { buildEmailValidator } from '../lib/validation';

const getCookie = (name: string): string | null => {
  const match = document.cookie.match(new RegExp(`(^| )${name}=([^;]+)`));
  return match ? match[2] : null;
};

const setCookie = (name: string, value: string, maxAge: number) => {
  document.cookie = `${name}=${value}; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
};

type FormValues = {
  email: string;
};

const validateEmail = buildEmailValidator('Invalid email');

export default function MerchantSquare() {
  const [error, setError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const success = params.get('success');

    if (success === 'true') {
      setCookie('square-connected', 'true', 86400);
      setIsConnected(true);
      window.history.replaceState({}, '', '/merchant/square');
    } else {
      const connected = getCookie('square-connected');
      if (connected === 'true') {
        setIsConnected(true);
      }
    }
  }, []);

  const onSubmit: SubmitHandler<FormValues> = async (data) => {
    try {
      setError(null);
      setCookie('square-merchant-email', data.email, 600);

      const response = await fetch('/api/square/auth-url');
      if (!response.ok) {
        throw new Error('Failed to get authorization URL');
      }

      const { authUrl, state } = await response.json();
      setCookie('square-state', state, 600);
      window.location.href = authUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect');
    }
  };

  const handleDisconnect = () => {
    document.cookie = 'square-connected=; Path=/; Max-Age=0; SameSite=Lax';
    document.cookie = 'square-merchant-email=; Path=/; Max-Age=0; SameSite=Lax';
    document.cookie = 'square-state=; Path=/; Max-Age=0; SameSite=Lax';
    setIsConnected(false);
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6 rounded-lg border p-8">
        <div className="space-y-2 text-center">
          <h1 className="font-bold text-3xl">
            {isConnected ? 'Square Connected' : 'Connect Square'}
          </h1>
          <p className="text-muted-foreground">
            {isConnected
              ? 'Your Square account is successfully connected'
              : 'Enter your email and connect your Square account to accept payments'}
          </p>
        </div>

        {error && (
          <div className="rounded-lg border border-red-500 bg-red-50 p-4 text-red-600 text-sm">
            {error}
          </div>
        )}

        {isConnected ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-green-500 bg-green-50 p-4 text-center text-green-700">
              <div className="mb-2 text-4xl">✓</div>
              <div className="font-semibold">Successfully Connected</div>
              <div className="mt-1 text-sm">
                Your Square account is ready to accept payments
              </div>
            </div>
            <Button
              onClick={handleDisconnect}
              variant="outline"
              className="w-full"
              size="lg"
            >
              Disconnect
            </Button>
          </div>
        ) : (
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
              size="lg"
              loading={isSubmitting}
            >
              {isSubmitting ? 'Connecting...' : 'Connect Square Account'}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
