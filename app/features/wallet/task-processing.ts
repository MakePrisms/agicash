import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { agicashDbClient } from '../agicash-db/database.client';
import { useProcessCashuReceiveQuoteTasks } from '../receive/cashu-receive-quote-hooks';
import { useProcessCashuTokenSwapTasks } from '../receive/cashu-token-swap-hooks';
import { useProcessSparkReceiveQuoteTasks } from '../receive/spark-receive-quote-hooks';
import { useProcessCashuSendQuoteTasks } from '../send/cashu-send-quote-hooks';
import { useProcessCashuSendSwapTasks } from '../send/cashu-send-swap-hooks';
import { useProcessSparkSendQuoteTasks } from '../send/spark-send-quote-hooks';
import { useUser } from '../user/user-hooks';
import { TaskProcessingLockRepository } from './task-processing-lock-repository';

const taskProcessingLockRepository = new TaskProcessingLockRepository(
  agicashDbClient,
);

/**
 * Use to take a lead on task processing.
 * Prevents multiple instances of the task processor from running at the same time on different clients (browser tabs or different devices).
 * Attempts to take the lead every 5 seconds and if another client is already taking the lead, it will return false.
 * @returns true if the lead was taken, false if it failed to take the lead.
 */
export const useTakeTaskProcessingLead = () => {
  const userId = useUser((user) => user.id);
  const [clientId] = useState(() => {
    const isRunningInBrowser = typeof window !== 'undefined';
    if (!isRunningInBrowser) {
      return '';
    }
    return crypto.randomUUID();
  });

  const { data: takeLeadResult, error } = useQuery({
    enabled: !!clientId,
    queryKey: ['take-lead', clientId],
    queryFn: () => {
      return taskProcessingLockRepository.takeLead(userId, clientId);
    },
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  });

  useEffect(() => {
    if (error) {
      console.warn(
        'Error. Take lead request failed. Will retry in 5 seconds.',
        {
          cause: error,
        },
      );
    }
  }, [error]);

  useEffect(() => {
    if (takeLeadResult) {
      console.debug('Taking lead on task processing', {
        clientId,
      });
    } else if (takeLeadResult === false) {
      console.debug('Yielded lead on task processing', {
        clientId,
      });
    }
  }, [takeLeadResult, clientId]);

  return takeLeadResult ?? false;
};

/**
 * Sets up background task processing.
 * Background tasks are tasks processed in the background that do not require user interaction.
 * An example of such task is processing paid cashu mint quote to mint the tokens.
 * Should be used only by the user's lead client.
 */
export const TaskProcessor = () => {
  useProcessCashuReceiveQuoteTasks();
  useProcessCashuTokenSwapTasks();
  useProcessCashuSendQuoteTasks();
  useProcessCashuSendSwapTasks();
  useProcessSparkReceiveQuoteTasks();
  useProcessSparkSendQuoteTasks();
  return null;
};
