import { type PropsWithChildren, createContext, useContext } from 'react';
import type { ApplyTo, Transition } from '~/lib/transitions';

/**
 * A navigation action with destination and animation.
 * The `to` is an object with pathname and search to ensure we can spread hash into it.
 */
export type NavAction = {
  to: { pathname: string; search: string };
  transition: Transition;
  applyTo: ApplyTo;
};

/** Dynamic navigation action that requires parameters */
type DynamicNavAction<T extends unknown[]> = (...args: T) => NavAction;

/**
 * The complete receive flow definition.
 * Step and action names are self-documenting to describe the flow structure.
 */
export type ReceiveFlowDefinition = {
  amountInput: {
    close: NavAction;
    next: {
      cashuLightningInvoice: NavAction;
      sparkLightningInvoice: NavAction;
    };
    actions: {
      scanToken: NavAction;
      claimCashuToken: DynamicNavAction<[string]>;
    };
  };
  scanToken: {
    back: NavAction;
    next: {
      claimCashuToken: DynamicNavAction<[string]>;
    };
  };
  cashuLightningInvoice: {
    back: NavAction;
    onSuccess: (transactionId: string) => void;
  };
  sparkLightningInvoice: {
    back: NavAction;
    onSuccess: (transactionId: string) => void;
  };
  claimCashuToken: {
    back: NavAction;
    onSuccess: (transactionId: string) => void;
  };
};

const ReceiveFlowContext = createContext<ReceiveFlowDefinition | null>(null);

type ReceiveFlowProviderProps = PropsWithChildren<{
  flow: ReceiveFlowDefinition;
}>;

/**
 * Provider that makes the receive flow navigation available to all child components.
 * Should be used in the receive layout to wrap the Outlet.
 */
export const ReceiveFlowProvider = ({
  flow,
  children,
}: ReceiveFlowProviderProps) => {
  return (
    <ReceiveFlowContext.Provider value={flow}>
      {children}
    </ReceiveFlowContext.Provider>
  );
};

/**
 * Hook for components to get their step's navigation actions.
 * Components think in terms of back/next/close, not explicit destinations.
 *
 * @example
 * const { close, next, actions } = useReceiveFlowStep('amountInput');
 * <ClosePageButton {...close} />
 * navigate(next.cashuLightningInvoice.to, { transition: next.cashuLightningInvoice.transition });
 */
export function useReceiveFlowStep<K extends keyof ReceiveFlowDefinition>(
  stepName: K,
): ReceiveFlowDefinition[K] {
  const flow = useContext(ReceiveFlowContext);
  if (!flow) {
    throw new Error(
      'useReceiveFlowStep must be used within ReceiveFlowProvider',
    );
  }
  return flow[stepName];
}
