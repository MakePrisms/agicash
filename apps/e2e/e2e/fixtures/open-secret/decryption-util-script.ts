// Util script for decrypting Open Secret responses
// Run with `bun run <path>/decryption-util-script.ts`
import { decode } from '@stablelib/base64';
import { openSecretEncryption } from './encryption';

// You can get this from the network tab
const osResponseData = {
  encrypted:
    'n5ukcT64ueksM/wQUApCT4kV+EqVYixrpbQezI8HiDQvJxi6RB+3oiv/ANaO8knabDLUJPjkZRs8opaAPeELWSnUmc28XaXg1ShIdbxl3zw=',
};

// You can get this value from the session storage. It's stored under sessionKey
const key = decode('p6lVKivBlX60YVzBfHV4pUxgGdhfmig2TupMdwN7Yx4=');

const decrypted = openSecretEncryption.decryptMessage(
  key,
  osResponseData.encrypted,
);

console.log(JSON.parse(decrypted));
