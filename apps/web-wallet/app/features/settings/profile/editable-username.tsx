import { Check, Edit } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { UniqueConstraintError } from '~/features/shared/error';
import { useUpdateUsername, useUser } from '~/features/user/user-hooks';
import useAnimation from '~/hooks/use-animation';
import { useToast } from '~/hooks/use-toast';
import { cn } from '~/lib/utils';

type FormValues = {
  username: string;
};

function validateUsername(username: string) {
  // Check length (5-20 characters)
  if (username.length < 5 || username.length > 20) {
    return 'Username must be between 5 and 20 characters';
  }

  // Check characters (only a-z, 0-9, underscore, hyphen allowed)
  // This requirement comes from LUD16 https://github.com/lnurl/luds/blob/luds/16.md
  if (!/^[a-z0-9_-]+$/.test(username)) {
    return 'Username can only contain lowercase letters, numbers, underscores and hyphens';
  }

  return true;
}

export default function EditableUsername() {
  const { animationClass, start: startAnimation } = useAnimation({
    name: 'slam',
    durationMs: 400,
  });
  const { toast } = useToast();
  const user = useUser();
  const updateUsername = useUpdateUsername();
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
    setValue,
  } = useForm<FormValues>({
    defaultValues: {
      username: user.username,
    },
  });
  const usernameRegister = register('username', { validate: validateUsername });
  const [isEditing, setIsEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.select();
    }
  }, [isEditing]);

  const onSubmit = async (data: FormValues) => {
    if (data.username === user.username) {
      setIsEditing(false);
      return;
    }

    try {
      await updateUsername(data.username);
      startAnimation();
      setIsEditing(false);
    } catch (error) {
      if (error instanceof UniqueConstraintError) {
        toast({
          title: 'Username not available',
        });
      } else {
        toast({
          title: 'Error',
          description: 'Failed to update username',
          variant: 'destructive',
        });
      }
    }
  };

  return (
    <div className="flex w-full flex-col gap-2">
      {!isEditing ? (
        <div className="flex items-center gap-2">
          <div className={cn('flex-1', animationClass)}>
            <span className="text-2xl text-white">{watch('username')}</span>
          </div>
          <button type="button" onClick={() => setIsEditing(true)}>
            <Edit className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)}>
          <div className="flex items-center gap-2">
            <div className={cn('flex-1', animationClass)}>
              <input
                {...usernameRegister}
                ref={(el) => {
                  usernameRegister.ref(el);
                  inputRef.current = el;
                }}
                type="text"
                className="w-full bg-transparent text-2xl text-white outline-hidden"
                // biome-ignore lint/a11y/noAutofocus: the rule is for accessibility reasons, but for this case it makes sense to autofocus so that the user is editing as soon as they click the edit button
                autoFocus
                spellCheck="false"
                autoCapitalize="none"
                onChange={(e) => {
                  const lowercaseValue = e.target.value.toLowerCase();
                  setValue('username', lowercaseValue);
                }}
              />
            </div>
            <button type="submit">
              <Check className="h-4 w-4" />
            </button>
          </div>

          {errors.username && (
            <div className="text-destructive text-sm">
              {errors.username.message}
            </div>
          )}
        </form>
      )}
    </div>
  );
}
