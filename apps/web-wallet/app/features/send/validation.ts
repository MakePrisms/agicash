import { buildLightningAddressFormatValidator } from '@agicash/wallet-sdk/lnurl';

// validateBolt11 (pure bolt11 send-validation) lives in the SDK; re-exported
// here so this feature's consumers keep a single validation import.
export {
  validateBolt11,
  type ValidateResult,
} from '@agicash/wallet-sdk/send/validation';

/**
 * Format-level validator for Lightning addresses. Returns `true` if the input
 * parses as a well-formed address, or an error message string otherwise.
 *
 * Web-bound: the SDK exposes the generic `buildLightningAddressFormatValidator`;
 * this pre-binds the app's error message and dev-localhost allowance.
 */
export const validateLightningAddressFormat =
  buildLightningAddressFormatValidator({
    message: 'Invalid lightning address',
    allowLocalhost: import.meta.env.MODE === 'development',
  });
