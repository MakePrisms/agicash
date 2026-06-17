/**
 * Builds a synchronous LUD-16 lightning-address *format* validator (regex only;
 * no network lookup). Returns `true` when the address is well-formed, or an
 * error message string describing the first problem.
 *
 * @param message - The message returned when the local-part/domain split fails.
 * @param allowLocalhost - When true, `name@localhost[:port]` is accepted (for
 *   local development). Defaults to false.
 */
export const buildLightningAddressFormatValidator = ({
  message,
  allowLocalhost = false,
}: {
  message: string;
  allowLocalhost?: boolean;
}) => {
  return (value: string | null | undefined): string | boolean => {
    if (!value) {
      return false;
    }

    // Handle localhost case if allowed
    if (allowLocalhost) {
      const localhostRegex = /^[a-zA-Z0-9._%+-]+@localhost(:\d+)?$/;
      if (localhostRegex.test(value)) {
        return true;
      }
    }

    // Lightning address format is described here https://datatracker.ietf.org/doc/html/rfc5322#section-3.4.1

    // Split into local part and domain
    const [localPart, domain] = value.split('@');

    // Check if we have both parts
    if (!localPart || !domain) {
      return message;
    }

    // Validate local part according to LUD-16
    // Only allow lowercase letters, numbers, underscores and hyphens
    if (!/^[a-z0-9_-]+$/.test(localPart)) {
      return 'Username can only contain lowercase letters, numbers, underscores and hyphens';
    }

    // Validate domain
    // Must have at least one dot (except for localhost which is handled above)
    if (!domain.includes('.')) {
      return 'Domain must be a valid domain name (e.g. example.com)';
    }

    // Domain parts must be valid
    const domainParts = domain.split('.');
    const domainRegex = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

    for (const part of domainParts) {
      if (!domainRegex.test(part)) {
        return 'Domain contains invalid characters';
      }
    }

    // Last part (TLD) must be at least 2 characters
    const tld = domainParts[domainParts.length - 1];
    if (tld.length < 2) {
      return 'Invalid domain name';
    }

    return true;
  };
};
