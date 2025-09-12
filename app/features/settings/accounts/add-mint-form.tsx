import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { Controller, useForm } from 'react-hook-form';
import { useLocation, useNavigate } from 'react-router';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';
import { useAddCashuAccount } from '~/features/accounts/account-hooks';
import {
  allMintKeysetsQueryOptions,
  cashuMintValidator,
  mintInfoQueryOptions,
} from '~/features/shared/cashu';
import { useUser } from '~/features/user/user-hooks';
import { useToast } from '~/hooks/use-toast';
import { getCashuProtocolUnit } from '~/lib/cashu';
import type { Currency } from '~/lib/money';
import { LinkWithViewTransition } from '~/lib/transitions';

type FormValues = {
  name: string;
  currency: Currency;
  mintUrl: string;
};

const currencies = [
  { value: 'BTC', label: 'BTC' },
  { value: 'USD', label: 'USD' },
];

const validateMint = async (
  value: string,
  formValues: FormValues,
  queryClient: QueryClient,
): Promise<string | true> => {
  const unit = getCashuProtocolUnit(formValues.currency);
  const [mintInfo, keysets] = await Promise.all([
    queryClient.fetchQuery(mintInfoQueryOptions(value)),
    queryClient.fetchQuery(allMintKeysetsQueryOptions(value)),
  ]);
  return cashuMintValidator(value, unit, mintInfo, keysets.keysets);
};

export function AddMintForm() {
  const addAccount = useAddCashuAccount();
  const { toast } = useToast();
  const navigate = useNavigate();
  const defaultCurrency = useUser((u) => u.defaultCurrency);
  const location = useLocation();
  const queryClient = useQueryClient();

  const {
    register,
    handleSubmit,
    control,
    getValues,
    formState: { isSubmitting, errors },
  } = useForm<FormValues>({
    defaultValues: {
      currency: defaultCurrency,
    },
  });

  const onSubmit = async (data: FormValues) => {
    try {
      await addAccount({
        name: data.name,
        currency: data.currency,
        mintUrl: data.mintUrl,
        type: 'cashu',
      });
      toast({
        title: 'Success',
        description: 'Account added successfully',
      });
      navigate('/settings/accounts');
    } catch (e) {
      const message =
        e instanceof Error
          ? e.message
          : 'Unknown error. Failed to add account.';
      toast({
        title: 'Error',
        description: message,
        variant: 'destructive',
      });
    }
  };

  const currency = getValues('currency');
  const unit = getCashuProtocolUnit(currency);

  return (
    <form
      className="mb-5 flex flex-col gap-4"
      onSubmit={handleSubmit(onSubmit)}
      noValidate
    >
      <div className="grid gap-2">
        <Label htmlFor="name">Name</Label>
        <Input
          id="name"
          type="text"
          aria-invalid={errors.name ? 'true' : 'false'}
          {...register('name', {
            required: 'Name is required',
          })}
        />
        {errors.name && (
          <span
            id="nameError"
            role="alert"
            aria-labelledby="nameError"
            className="text-red-500 text-sm"
          >
            {errors.name.message}
          </span>
        )}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="currency">Currency</Label>
        <Controller
          control={control}
          name="currency"
          rules={{ required: 'Currency is required' }}
          render={({ field }) => (
            <Select
              onValueChange={field.onChange}
              value={field.value}
              name={field.name}
            >
              <SelectTrigger
                id="currency"
                aria-invalid={errors.currency ? 'true' : 'false'}
              >
                <SelectValue placeholder="Select a currency" />
              </SelectTrigger>
              <SelectContent>
                {currencies.map((currency) => (
                  <SelectItem key={currency.value} value={currency.value}>
                    {currency.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
        {errors.currency && (
          <span
            id="currencyError"
            role="alert"
            aria-labelledby="currencyError"
            className="text-red-500 text-sm"
          >
            {errors.currency.message}
          </span>
        )}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="mintUrl">Mint URL</Label>
        <Input
          id="mintUrl"
          type="url"
          placeholder="Mint URL (https://...)"
          {...register('mintUrl', {
            required: 'Mint URL is required',
            validate: (value) => validateMint(value, getValues(), queryClient),
          })}
        />
        {errors.mintUrl && (
          <span
            id="mintUrlError"
            role="alert"
            aria-labelledby="mintUrlError"
            className="text-red-500 text-sm"
          >
            {errors.mintUrl.message}
          </span>
        )}
        <p className="text-muted-foreground text-sm">
          Search at{' '}
          <a
            className="underline"
            href={`https://bitcoinmints.com?show=cashu&units=${unit}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            bitcoinmints.com
          </a>
          . Understand mint{' '}
          <LinkWithViewTransition
            className="underline"
            to={{
              pathname: '/mint-risks',
              search: `redirectTo=${location.pathname}`,
            }}
            transition="slideUp"
            applyTo="newView"
          >
            risks
          </LinkWithViewTransition>
          .
        </p>
      </div>

      <Button type="submit" className="self-end" loading={isSubmitting}>
        Add
      </Button>
    </form>
  );
}
