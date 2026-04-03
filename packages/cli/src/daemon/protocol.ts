import type { AccountCommandResult } from '../commands/account';
import type { BalanceResult } from '../commands/balance';
import type { DecodeResult } from '../commands/decode';
import type { MintCommandResult } from '../commands/mint';
import type { PayResult } from '../commands/pay';
import type { ReceiveResult } from '../commands/receive';
import type { SendResult } from '../commands/send';

// -- Method names --

export type DaemonMethod =
  | 'balance'
  | 'send'
  | 'pay'
  | 'receive'
  | 'account.list'
  | 'account.default'
  | 'account.info'
  | 'mint.add'
  | 'mint.list'
  | 'decode'
  | 'events.subscribe'
  | 'events.unsubscribe';

// -- Per-method params --

export type BalanceParams = Record<string, never>;

export type SendParams = {
  amount: string;
  accountId?: string;
};

export type PayParams = {
  bolt11: string;
  accountId?: string;
};

export type ReceiveParams = {
  amount?: string;
  token?: string;
  accountId?: string;
  inspect?: boolean;
  check?: string;
  checkAll?: boolean;
  list?: boolean;
};

export type AccountListParams = Record<string, never>;

export type AccountDefaultParams = {
  accountId: string;
};

export type AccountInfoParams = {
  accountId: string;
};

export type MintAddParams = {
  url: string;
  name?: string;
  currency?: string;
};

export type MintListParams = Record<string, never>;

export type DecodeParams = {
  input: string;
};

export type EventsSubscribeParams = {
  filter?: 'receive' | 'send' | 'all';
};

export type EventsUnsubscribeParams = Record<string, never>;

// -- Method map: method name -> { params, result } --

export type DaemonMethodMap = {
  balance: { params: BalanceParams; result: BalanceResult };
  send: { params: SendParams; result: SendResult };
  pay: { params: PayParams; result: PayResult };
  receive: { params: ReceiveParams; result: ReceiveResult };
  'account.list': { params: AccountListParams; result: AccountCommandResult };
  'account.default': {
    params: AccountDefaultParams;
    result: AccountCommandResult;
  };
  'account.info': { params: AccountInfoParams; result: AccountCommandResult };
  'mint.add': { params: MintAddParams; result: MintCommandResult };
  'mint.list': { params: MintListParams; result: MintCommandResult };
  decode: { params: DecodeParams; result: DecodeResult };
  'events.subscribe': { params: EventsSubscribeParams; result: { ok: true } };
  'events.unsubscribe': {
    params: EventsUnsubscribeParams;
    result: { ok: true };
  };
};

// -- Request (MCP -> daemon) --

export type DaemonRequest<M extends DaemonMethod = DaemonMethod> = {
  id: string;
  method: M;
  params?: DaemonMethodMap[M]['params'];
};

// -- Response (daemon -> MCP) --

export type DaemonResponseSuccess<M extends DaemonMethod = DaemonMethod> = {
  id: string;
  result: DaemonMethodMap[M]['result'];
};

export type DaemonResponseError = {
  id: string;
  error: {
    code: string;
    message: string;
  };
};

export type DaemonResponse<M extends DaemonMethod = DaemonMethod> =
  | DaemonResponseSuccess<M>
  | DaemonResponseError;

// -- Events (daemon -> MCP, unsolicited) --

export type DaemonEventName =
  | 'receive:minted'
  | 'receive:expired'
  | 'receive:swap:completed'
  | 'send:completed'
  | 'send:failed'
  | 'send:swap:completed'
  | 'spark:receive:completed'
  | 'spark:receive:expired'
  | 'spark:send:completed'
  | 'spark:send:failed'
  | 'error'
  | 'watch:realtime:connected'
  | 'watch:lead:acquired'
  | 'watch:lead:lost'
  | 'watch:started'
  | 'watch:processors:stopped'
  | 'watch:stopping'
  | 'watch:stopped'
  | 'daemon:ready'
  | 'daemon:error';

export type DaemonEventMap = {
  'receive:minted': { quoteId: string; amount: string; accountId: string };
  'receive:expired': { quoteId: string };
  'receive:swap:completed': { tokenHash: string };
  'send:completed': { quoteId: string };
  'send:failed': { quoteId: string; reason: string };
  'send:swap:completed': { swapId: string };
  'spark:receive:completed': { quoteId: string };
  'spark:receive:expired': { quoteId: string };
  'spark:send:completed': { quoteId: string };
  'spark:send:failed': { quoteId: string };
  'error': { processor: string; action: string; message: string; quoteId?: string };
  'watch:realtime:connected': Record<string, never>;
  'watch:lead:acquired': { clientId: string };
  'watch:lead:lost': { clientId: string };
  'watch:started': { processors: string[]; filters: string };
  'watch:processors:stopped': Record<string, never>;
  'watch:stopping': Record<string, never>;
  'watch:stopped': Record<string, never>;
  'daemon:ready': Record<string, never>;
  'daemon:error': { message: string };
};

export type DaemonEvent<E extends DaemonEventName = DaemonEventName> = {
  event: E;
  data: DaemonEventMap[E];
  ts: string;
};

// -- Top-level discriminated union for all daemon output --

export type DaemonMessage = DaemonResponse | DaemonEvent;
