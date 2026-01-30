import { useState } from 'react';
import { SignupForm } from '~/features/signup/signup-form';
import { SignupOptions } from '~/features/signup/signup-options';
import { useAuthActions } from '~/features/user/auth';
import { useToast } from '~/hooks/use-toast';
import { getErrorMessage } from '../shared/error';

type SignupStep = 'pick-option' | 'signup-with-email';

export function Signup() {
  const [step, setStep] = useState<SignupStep>('pick-option');
  const { signUpGuest, initiateGoogleAuth } = useAuthActions();
  const { toast } = useToast();

  const handleSignupAsGuest = async () => {
    try {
      await signUpGuest();
    } catch (error) {
      console.error('Failed to create guest account', { cause: error });
      toast({
        variant: 'destructive',
        title: 'Error! Guest signup failed',
        description: getErrorMessage(error),
      });
    }
  };

  const handleSignupWithGoogle = async () => {
    try {
      const response = await initiateGoogleAuth();
      window.location.href = response.authUrl;
    } catch (error) {
      console.error('Failed to initiate google signup', { cause: error });
      toast({
        variant: 'destructive',
        title: 'Error! Google signup failed',
        description: getErrorMessage(error),
      });
    }
  };

  if (step === 'pick-option') {
    return (
      <SignupOptions
        onSelect={async (option) => {
          if (option === 'email') {
            setStep('signup-with-email');
          } else if (option === 'google') {
            await handleSignupWithGoogle();
          } else if (option === 'guest') {
            await handleSignupAsGuest();
          }
        }}
      />
    );
  }

  return <SignupForm onBack={() => setStep('pick-option')} />;
}
