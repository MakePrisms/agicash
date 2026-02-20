import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export {
  sum,
  hexToUint8Array,
  uint8ArrayToHex,
  isSubset,
  isObject,
} from '@agicash/core/lib/utils';
