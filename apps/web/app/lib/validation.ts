export const buildEmailValidator = (message: string) => {
  return (value: string | null | undefined): string | boolean => {
    if (!value) return true;

    // We don't want to create a custom email regex so we are relying on built-in html email validation
    const input = document.createElement('input');
    input.type = 'email';
    input.value = value;
    return input.checkValidity() || message;
  };
};
