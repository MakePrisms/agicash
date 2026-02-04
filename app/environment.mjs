const possibleEnvironments = [
  'local',
  'production',
  'alpha',
  'next',
  'preview',
];

function getEnvVar(key) {
  if (typeof process !== 'undefined' && process.env) {
    return process.env[key];
  }
  return import.meta.env[key];
}

/**
 * Returns the environment name based on the branch name if running on Vercel.
 * If not running on Vercel, returns 'local'.
 */
export const getEnvironment = () => {
  const environment = getEnvVar('VITE_ENVIRONMENT');

  if (!possibleEnvironments.includes(environment)) {
    throw new Error(
      `Invalid environment: ${environment}. Set VITE_ENVIRONMENT env var to one of: ${possibleEnvironments.join(
        ', ',
      )}`,
    );
  }

  return environment;
};

const isLocalIp = (value) => {
  return (
    value.startsWith('192.168.') ||
    value.startsWith('10.') ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(value)
  );
};

/**
 * Checks if app is serverd from a local/development server. Returns true if:
 * a) built for development
 * b) VITE_LOCAL_DEV env variable is set to true
 * c) hostname is localhost, 127.0.0.1, .local domain or a local IP address.
 * d) any of the IP addresses in the ips array is a local IP address.
 */
export const isServedLocally = (hostname, ips) => {
  // Check environment variables first
  if (
    process.env.NODE_ENV === 'development' ||
    getEnvVar('VITE_LOCAL_DEV') === 'true'
  ) {
    return true;
  }

  // Check if hostname indicates local environment
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname.endsWith('.local') ||
    isLocalIp(hostname)
  ) {
    return true;
  }

  if (ips?.some(isLocalIp)) {
    return true;
  }

  return false;
};
