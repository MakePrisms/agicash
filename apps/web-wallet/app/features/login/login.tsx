import { useState } from 'react';
import { LoginForm } from '~/features/login/login-form';
import { LoginOptions } from '~/features/login/login-options';
import { useToast } from '~/hooks/use-toast';
import { getErrorMessage } from '../shared/error';
import { useAuthActions } from '../user/auth';

type LoginStep = 'pick-option' | 'login-with-email';

export function Login() {
  const [step, setStep] = useState<LoginStep>('pick-option');
  const { initiateGoogleAuth } = useAuthActions();
  const { toast } = useToast();

  const handleLoginWithGoogle = async () => {
    try {
      const response = await initiateGoogleAuth();
      window.location.href = response.authUrl;
    } catch (error) {
      console.error('Failed to initiate google login', { cause: error });
      toast({
        variant: 'destructive',
        title: 'Error! Google login failed',
        description: getErrorMessage(error),
      });
    }
  };

  if (step === 'pick-option') {
    return (
      <LoginOptions
        onSelect={async (option) => {
          if (option === 'email') {
            setStep('login-with-email');
          } else if (option === 'google') {
            await handleLoginWithGoogle();
          }
        }}
      />
    );
  }

  return <LoginForm onBack={() => setStep('pick-option')} />;
}
