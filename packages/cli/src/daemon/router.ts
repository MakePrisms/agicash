import type { WalletClient } from '@agicash/sdk';
import type { ParsedArgs } from '../args';
import { handleAccountCommand } from '../commands/account';
import { handleBalanceCommand } from '../commands/balance';
import { handleDecodeCommand } from '../commands/decode';
import { handleMintCommand } from '../commands/mint';
import { handlePayCommand } from '../commands/pay';
import { handleReceiveCommand } from '../commands/receive';
import { handleSendCommand } from '../commands/send';
import type { SdkContext } from '../sdk-context';
import type {
  AccountDefaultParams,
  AccountInfoParams,
  DaemonRequest,
  DaemonResponse,
  DaemonResponseError,
  DecodeParams,
  EventsSubscribeParams,
  MintAddParams,
  PayParams,
  ReceiveParams,
  SendParams,
} from './protocol';
import { type TaskProcessorHandle, startTaskProcessors } from './task-processors';

type OnEventCallback = Parameters<typeof startTaskProcessors>[2]['onEvent'];

type RouterState = {
  taskProcessorHandle: TaskProcessorHandle | null;
  subscribeLock: Promise<void>;
  onEvent: OnEventCallback;
};

export function createRouterState(
  initialHandle: TaskProcessorHandle | null,
  onEvent: OnEventCallback,
): RouterState {
  return {
    taskProcessorHandle: initialHandle,
    subscribeLock: Promise.resolve(),
    onEvent,
  };
}

function buildParsedArgs(
  command: string,
  positional: string[],
  flags: Record<string, string | boolean>,
): ParsedArgs {
  return { command, positional, flags };
}

export async function routeRequest(
  request: DaemonRequest,
  ctx: SdkContext,
  wallet: WalletClient,
  state: RouterState,
): Promise<DaemonResponse> {
  try {
    switch (request.method) {
      case 'balance': {
        const result = await handleBalanceCommand(ctx);
        return { id: request.id, result };
      }

      case 'send': {
        const params = (request.params ?? {}) as SendParams;
        const positional = params.amount ? [params.amount] : [];
        const flags: Record<string, string | boolean> = {};
        if (params.accountId) flags.account = params.accountId;
        const args = buildParsedArgs('send', positional, flags);
        const result = await handleSendCommand(args, ctx);
        return { id: request.id, result };
      }

      case 'pay': {
        const params = (request.params ?? {}) as PayParams;
        const positional = params.bolt11 ? [params.bolt11] : [];
        const flags: Record<string, string | boolean> = {};
        if (params.accountId) flags.account = params.accountId;
        const args = buildParsedArgs('pay', positional, flags);
        const result = await handlePayCommand(args, ctx);
        return { id: request.id, result };
      }

      case 'receive': {
        const params = (request.params ?? {}) as ReceiveParams;
        const positional: string[] = [];
        const flags: Record<string, string | boolean> = {};

        if (params.list) {
          positional.push('list');
        } else if (params.checkAll) {
          flags['check-all'] = true;
        } else if (params.check) {
          flags.check = params.check;
        } else if (params.inspect && params.token) {
          flags.inspect = params.token;
        } else if (params.token) {
          positional.push(params.token);
        } else if (params.amount) {
          positional.push(params.amount);
        }

        if (params.accountId) flags.account = params.accountId;

        const args = buildParsedArgs('receive', positional, flags);
        const result = await handleReceiveCommand(args, ctx);
        return { id: request.id, result };
      }

      case 'decode': {
        const params = (request.params ?? {}) as DecodeParams;
        const positional = params.input ? [params.input] : [];
        const args = buildParsedArgs('decode', positional, {});
        const result = await handleDecodeCommand(args);
        return { id: request.id, result };
      }

      case 'account.list': {
        const args = buildParsedArgs('account', ['list'], {});
        const result = await handleAccountCommand(args, ctx);
        return { id: request.id, result };
      }

      case 'account.default': {
        const params = (request.params ?? {}) as AccountDefaultParams;
        const args = buildParsedArgs('account', ['default', params.accountId], {});
        const result = await handleAccountCommand(args, ctx);
        return { id: request.id, result };
      }

      case 'account.info': {
        const params = (request.params ?? {}) as AccountInfoParams;
        const args = buildParsedArgs('account', ['info', params.accountId], {});
        const result = await handleAccountCommand(args, ctx);
        return { id: request.id, result };
      }

      case 'mint.add': {
        const params = (request.params ?? {}) as MintAddParams;
        const positional = ['add', params.url];
        const flags: Record<string, string | boolean> = {};
        if (params.name) flags.name = params.name;
        if (params.currency) flags.currency = params.currency;
        const args = buildParsedArgs('mint', positional, flags);
        const result = await handleMintCommand(args, ctx);
        return { id: request.id, result };
      }

      case 'mint.list': {
        const args = buildParsedArgs('mint', ['list'], {});
        const result = await handleMintCommand(args, ctx);
        return { id: request.id, result };
      }

      case 'events.subscribe': {
        const params = (request.params ?? {}) as EventsSubscribeParams;
        // Serialize subscribe/unsubscribe to prevent races
        const subscribeWork = state.subscribeLock.then(async () => {
          if (state.taskProcessorHandle) {
            await state.taskProcessorHandle.shutdown();
            state.taskProcessorHandle = null;
          }
          state.taskProcessorHandle = await startTaskProcessors(ctx, wallet, {
            filter: params.filter ?? 'all',
            onEvent: state.onEvent,
          });
        });
        state.subscribeLock = subscribeWork.catch(() => {});
        await subscribeWork;
        return { id: request.id, result: { ok: true as const } };
      }

      case 'events.unsubscribe': {
        const unsubscribeWork = state.subscribeLock.then(async () => {
          if (state.taskProcessorHandle) {
            await state.taskProcessorHandle.shutdown();
            state.taskProcessorHandle = null;
          }
        });
        state.subscribeLock = unsubscribeWork.catch(() => {});
        await unsubscribeWork;
        return { id: request.id, result: { ok: true as const } };
      }

      default: {
        const errorResponse: DaemonResponseError = {
          id: request.id,
          error: {
            code: 'UNKNOWN_METHOD',
            message: `Unknown method: ${request.method as string}`,
          },
        };
        return errorResponse;
      }
    }
  } catch (err) {
    const errorResponse: DaemonResponseError = {
      id: request.id,
      error: {
        code: 'HANDLER_ERROR',
        message: err instanceof Error ? err.message : String(err),
      },
    };
    return errorResponse;
  }
}
