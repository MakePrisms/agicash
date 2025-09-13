import type { Proof, Token } from '@cashu/cashu-ts';
import { getEncodedToken } from '@cashu/cashu-ts';
import { ChevronDown, ChevronRight, Copy } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import {
  ClosePageButton,
  Page,
  PageContent,
  PageHeader,
  PageHeaderTitle,
} from '~/components/page';
import { Button } from '~/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '~/components/ui/dialog';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { useDefaultAccount } from '~/features/accounts/account-hooks';
import { useCreateCashuTokenSwap } from '~/features/receive/cashu-token-swap-hooks';
import {
  useCreateCashuSendSwap,
  useTrackCashuSendSwap,
} from '~/features/send/cashu-send-swap-hooks';
import {
  UniqueConstraintError,
  getErrorMessage,
} from '~/features/shared/error';
import { useToast } from '~/hooks/use-toast';
import { parseSecret } from '~/lib/cashu/secret';
import type {
  P2PKSpendingConditionData,
  P2PKUnlockingData,
} from '~/lib/cashu/types';
import { safeJsonParse } from '~/lib/json';
import { Money } from '~/lib/money';
import { generateRandomKeyPair } from '~/lib/secp256k1';

const RESET_DELAY = 2000;

/**
 * Hook for managing demo state
 */
function useDemoState() {
  const [step, setStep] = useState<'setup' | 'created' | 'unlocked'>('setup');
  const [amount, setAmount] = useState('10');
  const [privateKey, setPrivateKey] = useState('');
  const [publicKey, setPublicKey] = useState('');
  const [locktime, setLocktime] = useState('');
  const [enableTimelock, setEnableTimelock] = useState(false);
  const [createdSwapId, setCreatedSwapId] = useState<string>('');
  const [encodedToken, setEncodedToken] = useState<string>('');
  const [tokenToUnlock, setTokenToUnlock] = useState<Token | null>(null);
  const [showInspector, setShowInspector] = useState(false);

  const resetState = () => {
    setStep('setup');
    setAmount('10');
    setPrivateKey('');
    setPublicKey('');
    setLocktime('');
    setEnableTimelock(false);
    setCreatedSwapId('');
    setEncodedToken('');
    setTokenToUnlock(null);
    setShowInspector(false);
  };

  return {
    step,
    setStep,
    amount,
    setAmount,
    privateKey,
    setPrivateKey,
    publicKey,
    setPublicKey,
    locktime,
    setLocktime,
    enableTimelock,
    setEnableTimelock,
    createdSwapId,
    setCreatedSwapId,
    encodedToken,
    setEncodedToken,
    tokenToUnlock,
    setTokenToUnlock,
    showInspector,
    setShowInspector,
    resetState,
  };
}

/**
 * Hook for timelock countdown functionality
 */
function useTimelockCountdown(
  enableTimelock: boolean,
  locktime: string,
  step: string,
) {
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null);
  const [isTimelockExpired, setIsTimelockExpired] = useState(false);

  useEffect(() => {
    if (!enableTimelock || !locktime || step !== 'created') {
      setTimeRemaining(null);
      setIsTimelockExpired(false);
      return;
    }

    const targetTime = new Date(locktime).getTime();

    const updateCountdown = () => {
      const now = Date.now();
      const remaining = targetTime - now;

      if (remaining <= 0) {
        setTimeRemaining(0);
        setIsTimelockExpired(true);
      } else {
        setTimeRemaining(remaining);
        setIsTimelockExpired(false);
      }
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [enableTimelock, locktime, step]);

  return { timeRemaining, isTimelockExpired };
}

/**
 * Hook for utility formatting functions
 */
function useDemoFormatters() {
  const toLocalDateTimeString = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  };

  const formatCountdown = (milliseconds: number): string => {
    if (milliseconds <= 0) return 'Expired';

    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days}d ${hours % 24}h ${minutes % 60}m ${seconds % 60}s`;
    }
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    }
    if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    }
    return `${seconds}s`;
  };

  return { toLocalDateTimeString, formatCountdown };
}

/**
 * Hook for demo actions and business logic
 */
function useDemoActions(
  state: ReturnType<typeof useDemoState>,
  account: ReturnType<typeof useDefaultAccount>,
  isTimelockExpired: boolean,
  toLocalDateTimeString: (date: Date) => string,
) {
  const { toast } = useToast();

  const { mutateAsync: createCashuSendSwap, isPending: isCreating } =
    useCreateCashuSendSwap({
      onSuccess: (swap) => {
        state.setCreatedSwapId(swap.id);
      },
      onError: (error) => {
        console.error('Failed to create send swap:', error);
        toast({
          title: 'Failed to create locked token',
          description: error.message,
          variant: 'destructive',
        });
      },
    });

  const { mutateAsync: createCashuTokenSwap, isPending: isUnlocking } =
    useCreateCashuTokenSwap();

  const { swap: trackedSwap } = useTrackCashuSendSwap({
    id: state.createdSwapId,
    onPending: (swap) => {
      if (swap.state === 'PENDING' && 'proofsToSend' in swap) {
        const token: Token = {
          mint: account.type === 'cashu' ? account.mintUrl : '',
          proofs: swap.proofsToSend,
          unit: account.currency === 'BTC' ? 'sat' : 'usd',
        };
        state.setTokenToUnlock(token);
        state.setEncodedToken(getEncodedToken(token));
        state.setStep('created');
      }
    },
    onCompleted: () => {
      state.setStep('unlocked');

      // Auto reset after 2 seconds
      setTimeout(() => {
        state.resetState();
      }, RESET_DELAY);
    },
  });

  const handleGenerateKeypair = () => {
    const { privateKey: priv, publicKey: pub } = generateRandomKeyPair({
      asBytes: false,
    });
    state.setPrivateKey(priv);
    state.setPublicKey(pub);
  };

  const handleCreateToken = async () => {
    if (!state.publicKey) {
      toast({
        title: 'Missing Public Key',
        description: 'Please generate a keypair first',
        variant: 'destructive',
      });
      return;
    }

    const amountMoney = new Money({
      amount: Number.parseFloat(state.amount),
      currency: account.currency,
      unit: account.currency === 'BTC' ? 'sat' : 'usd',
    });

    const conditions =
      state.enableTimelock && state.locktime
        ? {
            locktime: Math.floor(new Date(state.locktime).getTime() / 1000),
          }
        : null;

    const spendingConditionData: P2PKSpendingConditionData = {
      kind: 'P2PK',
      data: state.publicKey,
      conditions,
    };

    await createCashuSendSwap({
      amount: amountMoney,
      accountId: account.id,
      spendingConditionData,
      unlockingData: {
        kind: 'P2PK',
        signingKeys: [state.privateKey],
      },
    });
  };

  const handleUnlockToken = async () => {
    if (!state.tokenToUnlock) {
      toast({
        title: 'Missing Data',
        description: 'Token not available',
        variant: 'destructive',
      });
      return;
    }

    try {
      const unlockingData: P2PKUnlockingData = {
        kind: 'P2PK',
        signingKeys: [state.privateKey],
      };

      await createCashuTokenSwap({
        token: state.tokenToUnlock,
        accountId: account.id,
        unlockingData,
      });
    } catch (error) {
      if (isTimelockExpired) {
        console.warn('Timelock expired:', { cause: error });
      } else {
        console.error('Failed to unlock token:', error);
      }

      const toastOptions = {
        title: 'Failed to unlock token',
        description:
          error instanceof UniqueConstraintError
            ? 'We have a bug where if you try to claim a token with invalid unlocking data, then you can never try again.. Refresh :)'
            : getErrorMessage(error),
        variant: 'destructive' as const,
        duration: 5000,
      };
      toast(toastOptions);
    }
  };

  const handleUnlockWithTimelock = async () => {
    if (!state.tokenToUnlock) {
      toast({
        title: 'Missing Token',
        description: 'Token not available',
        variant: 'destructive',
      });
      return;
    }

    try {
      await createCashuTokenSwap({
        token: state.tokenToUnlock,
        accountId: account.id,
      });

      if (!isTimelockExpired) {
        toast({
          title: 'Timelock not expired',
          description: 'Token has been unlocked with your private key',
        });
      }
    } catch (error) {
      console.error('Failed to unlock token with timelock:', { cause: error });
      const toastOptions = {
        title: 'Failed to unlock token',
        description:
          error instanceof UniqueConstraintError
            ? 'We have a bug where if you try to claim a token with invalid unlocking data, then you can never try again.. Refresh :)'
            : getErrorMessage(error),
        variant: 'destructive' as const,
        duration: 5000,
      };
      toast(toastOptions);
    }
  };

  const handleToggleTimelock = (e: React.ChangeEvent<HTMLInputElement>) => {
    const checked = e.target.checked;
    state.setEnableTimelock(checked);
    if (checked) {
      const futureTime = new Date();
      futureTime.setMinutes(futureTime.getMinutes() + 1);
      state.setLocktime(toLocalDateTimeString(futureTime));
    } else {
      state.setLocktime('');
    }
  };

  return {
    handleGenerateKeypair,
    handleCreateToken,
    handleUnlockToken,
    handleUnlockWithTimelock,
    handleToggleTimelock,
    isCreating,
    isUnlocking,
    trackedSwap,
  };
}

type CollapsibleState = Record<string, boolean>;

/**
 * JSON formatter component with syntax highlighting and collapsible sections
 */
function CollapsibleJsonFormatter({
  json,
  indent = 0,
  path = '',
  collapsedState,
  onToggle,
}: {
  json: unknown;
  indent?: number;
  path?: string;
  collapsedState: CollapsibleState;
  onToggle: (path: string) => void;
}) {
  const indentStr = '  '.repeat(indent);
  const isCollapsed = collapsedState[path] ?? false;

  if (json === null) {
    return <span className="text-slate-400">null</span>;
  }

  if (typeof json === 'string') {
    // Check if this string might be a NUT-10 secret (JSON string)
    if (json.startsWith('[') && json.endsWith(']')) {
      const parsedJson = safeJsonParse(json);
      if (parsedJson.success && Array.isArray(parsedJson.data)) {
        // This looks like a NUT-10 secret, display it as formatted JSON
        return (
          <CollapsibleJsonFormatter
            json={parsedJson.data}
            indent={indent}
            path={`${path}.parsed`}
            collapsedState={collapsedState}
            onToggle={onToggle}
          />
        );
      }
    }

    // Color specific fields differently
    const isAmount = !Number.isNaN(Number(json)) && json.length < 10;
    const isId = json.length === 16 && /^[a-fA-F0-9]+$/.test(json);
    const isPubKey = json.length === 66 && json.startsWith('02');
    const isSecret = json.includes('[') || json.length > 20;
    const isUrl = json.startsWith('http');

    let className = 'text-green-400'; // default string color
    if (isAmount) className = 'text-yellow-400';
    else if (isId) className = 'text-purple-400';
    else if (isPubKey) className = 'text-blue-400';
    else if (isSecret) className = 'text-orange-400';
    else if (isUrl) className = 'text-cyan-400';

    return (
      <>
        <span className="text-slate-300">"</span>
        <span className={className}>{json}</span>
        <span className="text-slate-300">"</span>
      </>
    );
  }

  if (typeof json === 'number') {
    return <span className="text-yellow-400">{json}</span>;
  }

  if (typeof json === 'boolean') {
    return <span className="text-red-400">{json.toString()}</span>;
  }

  if (Array.isArray(json)) {
    if (json.length === 0) {
      return <span className="text-slate-300">[]</span>;
    }

    const isProofsArray = path.includes('proofs');

    return (
      <>
        <span className="text-slate-300">[</span>
        {isProofsArray ? (
          <button
            type="button"
            onClick={() => onToggle(path)}
            className="ml-2 inline-flex items-center gap-1 hover:text-blue-300"
            title={isCollapsed ? 'Expand array' : 'Collapse array'}
          >
            {isCollapsed ? (
              <ChevronRight className="h-3 w-3" />
            ) : (
              <ChevronDown className="h-3 w-3" />
            )}
            <span className="text-slate-400 text-sm">
              {json.length} {json.length === 1 ? 'proof' : 'proofs'}
            </span>
          </button>
        ) : null}
        {!isCollapsed && (
          <>
            {json.map((item, index) => (
              <span
                key={`${path}-${index}-${JSON.stringify(item).substring(0, 10)}`}
              >
                <br />
                {indentStr}{' '}
                <CollapsibleJsonFormatter
                  json={item}
                  indent={indent + 1}
                  path={`${path}[${index}]`}
                  collapsedState={collapsedState}
                  onToggle={onToggle}
                />
                {index < json.length - 1 && (
                  <span className="text-slate-300">,</span>
                )}
              </span>
            ))}
            <br />
            {indentStr}
          </>
        )}
        <span className="text-slate-300">]</span>
      </>
    );
  }

  if (typeof json === 'object') {
    const keys = Object.keys(json);
    if (keys.length === 0) {
      return <span className="text-slate-300">{'{}'}</span>;
    }

    const isProofObject =
      path.includes('[') &&
      keys.some((k) => ['amount', 'C', 'secret', 'id'].includes(k));

    return (
      <>
        <span className="text-slate-300">{'{'}</span>
        {isProofObject ? (
          <button
            type="button"
            onClick={() => onToggle(path)}
            className="ml-2 inline-flex items-center gap-1 hover:text-blue-300"
            title={isCollapsed ? 'Expand proof' : 'Collapse proof'}
          >
            {isCollapsed ? (
              <ChevronRight className="h-3 w-3" />
            ) : (
              <ChevronDown className="h-3 w-3" />
            )}
            <span className="text-slate-400 text-sm">
              proof{' '}
              {(json as Proof).amount ? `(${(json as Proof).amount})` : ''}
            </span>
          </button>
        ) : null}
        {!isCollapsed && (
          <>
            {keys.map((key, index) => {
              const propertyPath = `${path}.${key}`;
              const isCollapsibleProperty = ['dleq', 'secret'].includes(key);
              const isPropertyCollapsed = collapsedState[propertyPath] ?? false;

              return (
                <span key={propertyPath}>
                  <br />
                  {indentStr} <span className="text-blue-300">"{key}"</span>
                  <span className="text-slate-300">: </span>
                  {isCollapsibleProperty ? (
                    <>
                      <button
                        type="button"
                        onClick={() => onToggle(propertyPath)}
                        className="inline-flex items-center gap-1 hover:text-blue-300"
                        title={
                          isPropertyCollapsed
                            ? `Expand ${key}`
                            : `Collapse ${key}`
                        }
                      >
                        {isPropertyCollapsed ? (
                          <ChevronRight className="h-3 w-3" />
                        ) : (
                          <ChevronDown className="h-3 w-3" />
                        )}
                        <span className="text-slate-400 text-sm">{key}</span>
                      </button>
                      {!isPropertyCollapsed && (
                        <>
                          <br />
                          {indentStr}{' '}
                          <CollapsibleJsonFormatter
                            json={(json as Record<string, unknown>)[key]}
                            indent={indent + 1}
                            path={propertyPath}
                            collapsedState={collapsedState}
                            onToggle={onToggle}
                          />
                        </>
                      )}
                    </>
                  ) : (
                    <CollapsibleJsonFormatter
                      json={(json as Record<string, unknown>)[key]}
                      indent={indent + 1}
                      path={propertyPath}
                      collapsedState={collapsedState}
                      onToggle={onToggle}
                    />
                  )}
                  {index < keys.length - 1 && (
                    <span className="text-slate-300">,</span>
                  )}
                </span>
              );
            })}
            <br />
            {indentStr}
          </>
        )}
        <span className="text-slate-300">{'}'}</span>
      </>
    );
  }

  return <span className="text-slate-400">{String(json)}</span>;
}

/**
 * TokenJson component for rendering collapsible token JSON
 */
function TokenJson({
  token,
  initialCollapsed = false,
}: {
  token: Token;
  initialCollapsed?: boolean;
}) {
  const { toast } = useToast();

  // Initialize collapsed state - proofs are collapsed by default
  const initializeCollapsedState = useCallback((): CollapsibleState => {
    const state: CollapsibleState = {};

    // Collapse proofs array by default
    state.proofs = initialCollapsed;

    // Collapse individual proof objects by default
    token.proofs.forEach((_, index) => {
      state[`proofs[${index}]`] = initialCollapsed;

      // Collapse dleq and secret properties by default
      state[`proofs[${index}].dleq`] = true;
      state[`proofs[${index}].secret`] = true;
    });

    return state;
  }, [token.proofs, initialCollapsed]);

  const [collapsedState, setCollapsedState] = useState<CollapsibleState>(
    initializeCollapsedState,
  );

  const handleToggle = useCallback((path: string) => {
    setCollapsedState((prev) => ({
      ...prev,
      [path]: !prev[path],
    }));
  }, []);

  const handleCopyJson = () => {
    navigator.clipboard.writeText(JSON.stringify(token, null, 2));
    toast({
      title: 'JSON copied to clipboard',
      duration: 1000,
    });
  };

  const handleExpandAll = () => {
    const newState: CollapsibleState = {};

    // Expand proofs array
    newState.proofs = false;

    // Expand all individual proofs and their properties
    token.proofs.forEach((_, index) => {
      newState[`proofs[${index}]`] = false;
      newState[`proofs[${index}].dleq`] = false;
      newState[`proofs[${index}].secret`] = false;
    });

    setCollapsedState(newState);
  };

  const handleCollapseAll = () => {
    const newState: CollapsibleState = {};

    // Collapse proofs array
    newState.proofs = true;

    // Collapse all individual proofs and their properties
    token.proofs.forEach((_, index) => {
      newState[`proofs[${index}]`] = true;
      newState[`proofs[${index}].dleq`] = true;
      newState[`proofs[${index}].secret`] = true;
    });

    setCollapsedState(newState);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium text-sm">Token JSON:</span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExpandAll}
            className="h-7 px-2 text-xs"
          >
            Expand All
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleCollapseAll}
            className="h-7 px-2 text-xs"
          >
            Collapse All
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopyJson}
            className="h-7 px-2 text-xs"
          >
            <Copy className="mr-1 h-3 w-3" />
            Copy
          </Button>
        </div>
      </div>

      <div className="max-h-96 overflow-auto rounded bg-slate-900 p-4">
        <pre className="text-sm">
          <code>
            <CollapsibleJsonFormatter
              json={token}
              collapsedState={collapsedState}
              onToggle={handleToggle}
            />
          </code>
        </pre>
      </div>
    </div>
  );
}

export default function Demo() {
  const account = useDefaultAccount();

  const state = useDemoState();
  const { timeRemaining, isTimelockExpired } = useTimelockCountdown(
    state.enableTimelock,
    state.locktime,
    state.step,
  );
  const { toLocalDateTimeString, formatCountdown } = useDemoFormatters();
  const {
    handleGenerateKeypair,
    handleCreateToken,
    handleUnlockToken,
    handleUnlockWithTimelock,
    handleToggleTimelock,
    isCreating,
    isUnlocking,
    trackedSwap,
  } = useDemoActions(state, account, isTimelockExpired, toLocalDateTimeString);

  return (
    <Page>
      <PageHeader>
        <ClosePageButton transition="slideDown" applyTo="oldView" to="/" />
        <PageHeaderTitle>P2PK Demo</PageHeaderTitle>
      </PageHeader>
      <PageContent className="space-y-6 overflow-y-auto">
        {/* Step 1: Setup */}
        {state.step === 'setup' && (
          <>
            <Card>
              <CardHeader>
                <CardTitle>Step 1: Generate Keypair</CardTitle>
                <CardDescription>
                  Generate a secp256k1 keypair for P2PK locking
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Button onClick={handleGenerateKeypair} className="w-full">
                  Generate Random Keypair
                </Button>

                {state.publicKey && (
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <Label className="font-medium text-green-600 text-sm">
                        Public Key (for locking)
                      </Label>
                      <div className="break-all rounded border p-3 text-sm">
                        {state.publicKey}
                      </div>
                    </div>

                    <div className="space-y-1">
                      <Label className="font-medium text-red-600 text-sm">
                        Private Key (for unlocking - keep secret!)
                      </Label>
                      <div className="break-all rounded border p-3 text-sm">
                        {state.privateKey}
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Step 2: Configure Token</CardTitle>
                <CardDescription>
                  Set amount and optional timelock
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="amount">
                    Amount ({account.currency === 'BTC' ? 'sats' : 'USD'})
                  </Label>
                  <Input
                    id="amount"
                    type="number"
                    value={state.amount}
                    onChange={(e) => state.setAmount(e.target.value)}
                    placeholder="10"
                    min="1"
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center space-x-2">
                    <input
                      id="enable-timelock"
                      type="checkbox"
                      checked={state.enableTimelock}
                      onChange={handleToggleTimelock}
                      className="h-4 w-4 rounded border-gray-300"
                    />
                    <Label htmlFor="enable-timelock" className="text-sm">
                      Enable timelock (optional)
                    </Label>
                  </div>

                  {state.enableTimelock && (
                    <div className="space-y-2">
                      <Label htmlFor="locktime">
                        Token locked until this time
                      </Label>
                      <Input
                        id="locktime"
                        type="datetime-local"
                        value={state.locktime}
                        onChange={(e) => state.setLocktime(e.target.value)}
                        min={toLocalDateTimeString(new Date())}
                      />
                      {state.locktime && (
                        <p className="text-muted-foreground text-sm">
                          Token will be locked until:{' '}
                          {new Date(state.locktime).toLocaleString()}
                        </p>
                      )}
                    </div>
                  )}
                </div>

                <Button
                  onClick={handleCreateToken}
                  disabled={!state.publicKey || isCreating}
                  loading={isCreating}
                  className="w-full"
                >
                  Create P2PK Locked Token
                </Button>
              </CardContent>
            </Card>
          </>
        )}
        {/* Step 2: Token Created */}
        {state.step === 'created' && (
          <Card>
            <CardHeader>
              <CardTitle>✅ P2PK Token Created!</CardTitle>
              <CardDescription>
                Your token has been locked with P2PK conditions
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Token Details */}
              {trackedSwap && (
                <div className="space-y-3 rounded-lg border p-4">
                  <h4 className="font-medium">Token Details</h4>
                  <div className="grid grid-cols-1 gap-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Amount:</span>
                      <span className="font-mono">
                        {state.amount}{' '}
                        {account.currency === 'BTC' ? 'sats' : 'USD'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        Locked with:
                      </span>
                      <span>P2PK</span>
                    </div>
                    {state.enableTimelock && state.locktime && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Timelock:</span>
                        <div className="text-right">
                          <div className="font-mono text-xs">
                            {new Date(state.locktime).toLocaleString()}
                          </div>
                          {timeRemaining !== null && (
                            <div
                              className={`font-mono text-xs ${
                                isTimelockExpired
                                  ? 'font-semibold text-green-600'
                                  : 'text-orange-600'
                              }`}
                            >
                              {isTimelockExpired
                                ? '✅ Unlocked'
                                : `🔒 ${formatCountdown(timeRemaining)}`}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">State:</span>
                      <span className="text-green-600 capitalize">
                        {trackedSwap.state}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-2">
                <Button
                  onClick={handleUnlockToken}
                  disabled={isUnlocking}
                  loading={isUnlocking}
                  className="flex-1"
                >
                  🔓 Unlock Token with Private Key
                </Button>

                {state.enableTimelock && (
                  <Button
                    onClick={handleUnlockWithTimelock}
                    disabled={isUnlocking}
                    loading={isUnlocking}
                    variant="secondary"
                    className="flex-1"
                  >
                    ⏰ Use timelock
                  </Button>
                )}

                <div className="flex flex-col gap-2">
                  <Button
                    onClick={() => {
                      if (state.encodedToken && state.privateKey) {
                        const url = `/receive/cashu/token#${state.encodedToken}&unlockingKey=${state.privateKey}`;
                        window.open(url, '_blank');
                      }
                    }}
                    disabled={!state.encodedToken || !state.privateKey}
                    variant="outline"
                    className="flex-1"
                  >
                    Open on receive page
                  </Button>
                  <Button
                    onClick={() => {
                      if (state.encodedToken) {
                        const url = `/receive/cashu/token#${state.encodedToken}`;
                        window.open(url, '_blank');
                      }
                    }}
                    variant="outline"
                    className="flex-1"
                  >
                    Open receive w/o private key
                  </Button>
                  <Dialog
                    open={state.showInspector}
                    onOpenChange={state.setShowInspector}
                  >
                    <DialogTrigger asChild>
                      <Button variant="outline" className="flex-1">
                        🔍 Inspect
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="flex max-h-[90vh] max-w-6xl flex-col overflow-hidden">
                      <DialogHeader>
                        <DialogTitle>🔍 Proof Inspector</DialogTitle>
                        <DialogDescription>
                          Decode and inspect the token details
                        </DialogDescription>
                      </DialogHeader>
                      <div className="flex-1 overflow-y-auto">
                        {state.tokenToUnlock && (
                          <div className="space-y-4">
                            {/* JSON Display */}
                            <TokenJson
                              token={state.tokenToUnlock}
                              initialCollapsed
                            />

                            <div className="space-y-3 border-t pt-4">
                              <div>
                                <Label className="font-medium text-sm">
                                  Mint URL:
                                </Label>
                                <div className="rounded bg-muted p-2 font-mono text-sm">
                                  {state.tokenToUnlock.mint}
                                </div>
                              </div>

                              <div>
                                <Label className="font-medium text-sm">
                                  Unit:
                                </Label>
                                <div className="rounded bg-muted p-2 font-mono text-sm">
                                  {state.tokenToUnlock.unit}
                                </div>
                              </div>

                              <div>
                                <Label className="font-medium text-sm">
                                  Proofs ({state.tokenToUnlock.proofs.length}):
                                </Label>
                                <div className="max-h-60 overflow-y-auto rounded bg-muted p-2">
                                  {state.tokenToUnlock.proofs.map(
                                    (proof, i) => {
                                      const secretResult = parseSecret(
                                        proof.secret,
                                      );

                                      return (
                                        <details
                                          key={`proof-${proof.C}-${i}`}
                                          className="mb-2"
                                        >
                                          <summary className="cursor-pointer font-medium font-mono text-sm">
                                            Proof #{i + 1} ({proof.amount}{' '}
                                            {state.tokenToUnlock?.unit})
                                          </summary>
                                          <div className="mt-2 space-y-2 pl-4 text-xs">
                                            <div>
                                              <span className="font-medium">
                                                Amount:
                                              </span>{' '}
                                              {proof.amount}
                                            </div>
                                            <div>
                                              <span className="font-medium">
                                                Keyset ID:
                                              </span>
                                              <div className="break-all font-mono">
                                                {proof.id}
                                              </div>
                                            </div>

                                            {secretResult.success ? (
                                              <>
                                                <div>
                                                  <span className="font-medium">
                                                    Secret Type:
                                                  </span>{' '}
                                                  {secretResult.data.type ===
                                                  'nut10'
                                                    ? secretResult.data.secret
                                                        .kind
                                                    : 'plain'}
                                                </div>

                                                {/* Plain Secret Display */}
                                                {secretResult.data.type ===
                                                  'plain' && (
                                                  <div>
                                                    <span className="font-medium">
                                                      Secret:
                                                    </span>
                                                    <div className="break-all font-mono text-muted-foreground">
                                                      {secretResult.data.secret}
                                                    </div>
                                                  </div>
                                                )}

                                                {/* NUT-10 P2PK Secret Display */}
                                                {secretResult.data.type ===
                                                  'nut10' &&
                                                  secretResult.data.secret
                                                    .kind === 'P2PK' && (
                                                    <>
                                                      <div>
                                                        <span className="font-medium">
                                                          Public Key:
                                                        </span>
                                                        <div className="break-all font-mono text-green-600">
                                                          {
                                                            secretResult.data
                                                              .secret.data
                                                          }
                                                        </div>
                                                      </div>
                                                      <div>
                                                        <span className="font-medium">
                                                          Nonce:
                                                        </span>
                                                        <div className="break-all font-mono text-muted-foreground">
                                                          {
                                                            secretResult.data
                                                              .secret.nonce
                                                          }
                                                        </div>
                                                      </div>
                                                      {secretResult.data.secret
                                                        .tags &&
                                                        secretResult.data.secret
                                                          .tags.length > 0 && (
                                                          <div>
                                                            <span className="font-medium">
                                                              Tags:
                                                            </span>
                                                            <div className="font-mono text-xs">
                                                              {secretResult.data.secret.tags.map(
                                                                (
                                                                  tag,
                                                                  tagIndex,
                                                                ) => (
                                                                  <div
                                                                    key={`tag-${tagIndex}-${tag.join('-')}`}
                                                                    className="ml-2"
                                                                  >
                                                                    [
                                                                    {tag.map(
                                                                      (
                                                                        item,
                                                                        itemIndex,
                                                                      ) => (
                                                                        <span
                                                                          key={`item-${tagIndex}-${itemIndex}-${item}`}
                                                                        >
                                                                          "
                                                                          {item}
                                                                          "
                                                                          {itemIndex <
                                                                          tag.length -
                                                                            1
                                                                            ? ', '
                                                                            : ''}
                                                                        </span>
                                                                      ),
                                                                    )}
                                                                    ]
                                                                  </div>
                                                                ),
                                                              )}
                                                            </div>
                                                          </div>
                                                        )}
                                                    </>
                                                  )}

                                                {/* Other NUT-10 Secret Types */}
                                                {secretResult.data.type ===
                                                  'nut10' &&
                                                  secretResult.data.secret
                                                    .kind !== 'P2PK' && (
                                                    <>
                                                      <div>
                                                        <span className="font-medium">
                                                          Data:
                                                        </span>
                                                        <div className="break-all font-mono text-muted-foreground">
                                                          {
                                                            secretResult.data
                                                              .secret.data
                                                          }
                                                        </div>
                                                      </div>
                                                      <div>
                                                        <span className="font-medium">
                                                          Nonce:
                                                        </span>
                                                        <div className="break-all font-mono text-muted-foreground">
                                                          {
                                                            secretResult.data
                                                              .secret.nonce
                                                          }
                                                        </div>
                                                      </div>
                                                    </>
                                                  )}
                                              </>
                                            ) : (
                                              <div>
                                                <span className="font-medium text-red-600">
                                                  Parse Error:
                                                </span>
                                                <div className="break-all font-mono text-red-500 text-xs">
                                                  {secretResult.error}
                                                </div>
                                                <div>
                                                  <span className="font-medium">
                                                    Raw Secret:
                                                  </span>
                                                  <div className="break-all font-mono text-muted-foreground">
                                                    {proof.secret}
                                                  </div>
                                                </div>
                                              </div>
                                            )}

                                            <div>
                                              <span className="font-medium">
                                                C (unblinded sig):
                                              </span>
                                              <div className="break-all font-mono">
                                                {proof.C}
                                              </div>
                                            </div>
                                          </div>
                                        </details>
                                      );
                                    },
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
        {/* Step 3: Token Unlocked */}
        {state.step === 'unlocked' && (
          <div className="flex min-h-[400px] w-full flex-col items-center justify-center space-y-8">
            {/* Animated Success Icon */}
            <div className="relative">
              <div className="animate-bounce">
                <div className="flex h-24 w-24 animate-pulse items-center justify-center rounded-full bg-gradient-to-r from-green-400 to-emerald-500 text-4xl shadow-lg">
                  🎉
                </div>
              </div>

              {/* Sparkle animations around the icon */}
              <div className="-top-2 -left-2 absolute animate-ping text-yellow-400">
                ✨
              </div>
              <div className="-top-2 -right-2 absolute animate-ping text-yellow-400 delay-150">
                ⭐
              </div>
              <div className="-bottom-2 -left-2 absolute animate-ping text-yellow-400 delay-300">
                💫
              </div>
              <div className="-bottom-2 -right-2 absolute animate-ping text-yellow-400 delay-75">
                🌟
              </div>
            </div>

            {/* Animated Text */}
            <div className="space-y-4 text-center">
              <h1 className="animate-pulse bg-gradient-to-r from-green-600 to-emerald-600 bg-clip-text font-bold text-4xl text-transparent">
                AMAZING!
              </h1>
              <div className="animate-fade-in space-y-2">
                <p className="animate-bounce font-semibold text-green-700 text-xl">
                  Token Successfully Unlocked! 🔓
                </p>
                <p className="animate-pulse text-green-600 text-lg delay-200">
                  Your funds are now in your wallet! 💰
                </p>
              </div>
            </div>

            {/* Celebration Elements */}
            <div className="flex justify-center space-x-4 text-2xl">
              <span className="animate-bounce delay-100">🚀</span>
              <span className="animate-bounce delay-200">💎</span>
              <span className="animate-bounce delay-300">⚡</span>
              <span className="animate-bounce delay-500">🔥</span>
            </div>

            {/* Auto-reset indicator */}
            <div className="text-center">
              <p className="animate-pulse text-muted-foreground text-sm">
                Automatically resetting in {RESET_DELAY / 1000} seconds...
              </p>
            </div>
          </div>
        )}
      </PageContent>
    </Page>
  );
}
