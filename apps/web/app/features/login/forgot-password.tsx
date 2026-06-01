import { useState } from 'react';
import { useNavigate } from 'react-router';
import { PasswordReset } from '~/features/login/password-reset';
import { RequestPasswordReset } from '~/features/login/request-password-reset';

type State =
  | { step: 'request-password-reset' }
  | { step: 'password-reset'; email: string; secret: string };

export function ForgotPassword() {
  const [state, setState] = useState<State>({ step: 'request-password-reset' });
  const navigate = useNavigate();
  const goBack = () => navigate(-1);

  if (state.step === 'request-password-reset') {
    return (
      <RequestPasswordReset
        onRequested={(email, secret) =>
          setState({ step: 'password-reset', email, secret })
        }
        onBack={goBack}
      />
    );
  }

  return (
    <PasswordReset
      email={state.email}
      secret={state.secret}
      onSuccess={() => navigate('/login')}
      onBack={() => setState({ step: 'request-password-reset' })}
    />
  );
}
