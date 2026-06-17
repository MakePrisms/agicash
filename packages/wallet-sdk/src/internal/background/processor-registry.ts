import type { ProcessorTrigger } from '../realtime/change-feed-ports';
import type { ChangeFeedChange } from '../realtime/change-feed-router';
import type { Processor } from './processors/processor';

export type Processors = {
  cashuSendQuote: Processor;
  cashuSendSwap: Processor;
  sparkSendQuote: Processor;
  cashuReceiveQuote: Processor;
  cashuReceiveSwap: Processor;
  sparkReceiveQuote: Processor;
};

/**
 * Routes change-feed events to the six background processors, but only while this
 * instance is the leader. `activate` (on becoming leader) loads every work set so
 * trackers subscribe + one-shot ops fire; `deactivate` (on losing leadership /
 * stop) disposes them so NUT-17/Breez subscriptions tear down. Implements the 4b
 * `ProcessorTrigger` the change-feed drives.
 */
export class ProcessorRegistry implements ProcessorTrigger {
  private leader = false;
  private userId: string | null = null;

  constructor(private readonly processors: Processors) {}

  activate(userId: string): void {
    this.leader = true;
    this.userId = userId;
    this.reloadAll();
  }

  deactivate(): void {
    this.leader = false;
    for (const processor of Object.values(this.processors)) {
      processor.dispose();
    }
  }

  onEntityChange(change: ChangeFeedChange): void {
    if (!this.leader || !this.userId) return;
    const processor = this.processorFor(change.kind);
    if (processor) this.reload(processor);
  }

  onCatchUp(): void {
    if (!this.leader || !this.userId) return;
    this.reloadAll();
  }

  private reloadAll(): void {
    for (const processor of Object.values(this.processors)) {
      this.reload(processor);
    }
  }

  private reload(processor: Processor): void {
    if (!this.userId) return;
    void processor.reload(this.userId).catch((cause) =>
      console.error('Processor reload failed', { cause }),
    );
  }

  private processorFor(kind: ChangeFeedChange['kind']): Processor | undefined {
    switch (kind) {
      case 'cashu-send-quote':
        return this.processors.cashuSendQuote;
      case 'cashu-send-swap':
        return this.processors.cashuSendSwap;
      case 'spark-send-quote':
        return this.processors.sparkSendQuote;
      case 'cashu-receive-quote':
        return this.processors.cashuReceiveQuote;
      case 'cashu-receive-swap':
        return this.processors.cashuReceiveSwap;
      case 'spark-receive-quote':
        return this.processors.sparkReceiveQuote;
      default:
        return undefined; // user / account / transaction / contact* — no processor
    }
  }
}
