import { useProcessCashuReceiveQuoteTasks } from '../receive/cashu-receive-quote-hooks';
import { useProcessCashuReceiveSwapTasks } from '../receive/cashu-receive-swap-hooks';
import { useProcessSparkReceiveQuoteTasks } from '../receive/spark-receive-quote-hooks';
import { useProcessCashuSendQuoteTasks } from '../send/cashu-send-quote-hooks';
import { useProcessCashuSendSwapTasks } from '../send/cashu-send-swap-hooks';
import { useProcessSparkSendQuoteTasks } from '../send/spark-send-quote-hooks';

/**
 * Sets up background task processing.
 * Background tasks are tasks processed in the background that do not require user interaction.
 * An example of such task is processing paid cashu mint quote to mint the tokens.
 * Should be used only by the user's lead client.
 */
export const TaskProcessor = () => {
  useProcessCashuReceiveQuoteTasks();
  useProcessCashuReceiveSwapTasks();
  useProcessCashuSendQuoteTasks();
  useProcessCashuSendSwapTasks();
  useProcessSparkReceiveQuoteTasks();
  useProcessSparkSendQuoteTasks();
  return null;
};
