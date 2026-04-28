import { AlertCircle } from 'lucide-react';

/**
 * Shared component for displaying error when token cannot be claimed
 */
export function TokenErrorDisplay({ message }: { message: string }) {
  return (
    <div className="mx-4 flex w-full flex-col items-center justify-center gap-2 rounded-lg border bg-card p-4">
      <AlertCircle className="h-8 w-8 text-foreground" />
      <p className="text-center text-muted-foreground text-sm">{message}</p>
    </div>
  );
}
