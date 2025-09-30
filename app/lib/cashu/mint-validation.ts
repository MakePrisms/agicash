import type { MintKeyset, WebSocketSupport } from '@cashu/cashu-ts';
import type { MintInfo } from './mint-info';
import type { CashuProtocolUnit, NUT, NUT17WebSocketCommand } from './types';

type NutValidationResult =
  | { isValid: false; message: string }
  | { isValid: true };

type NutValidation = {
  nut: NUT;
  validate: (info: MintInfo, unit: string) => NutValidationResult;
};

type BuildMintValidatorOptions = {
  /**
   * The NUTs that the mint must support.
   */
  requiredNuts: NUT[];
  /**
   * The NUT-17 WebSocket commands to check for.
   * @default: ['bolt11_mint_quote', 'bolt11_melt_quote', 'proof_state']
   */
  requiredWebSocketCommands?: NUT17WebSocketCommand[];
};

/**
 * Builds a validator function that checks if the mint is valid according to the given NUTs
 * and the selected unit. If mint info is not provided, it will be fetched from the URL.
 * @returns The validator function
 */
export const buildMintValidator = (params: BuildMintValidatorOptions) => {
  return (
    mintUrl: string,
    selectedUnit: CashuProtocolUnit,
    mintInfo: MintInfo,
    keysets: MintKeyset[],
  ): string | true => {
    if (!/^https?:\/\/.+/.test(mintUrl)) {
      return 'Must be a valid URL starting with http(s)://';
    }

    const activeUnits = keysets.filter((ks) => ks.active).map((ks) => ks.unit);

    if (!activeUnits.includes(selectedUnit)) {
      return 'Mint does not support this currency';
    }

    try {
      const featuresResult = validateMintFeatures(
        mintInfo,
        selectedUnit,
        createNutValidators(params),
      );
      if (!featuresResult.isValid) {
        return featuresResult.message;
      }

      return true;
    } catch {
      return 'Failed to connect to mint. Please make sure the URL is correct or try again.';
    }
  };
};

const createNutValidators = ({
  requiredNuts,
  requiredWebSocketCommands,
}: BuildMintValidatorOptions): NutValidation[] => {
  requiredWebSocketCommands = requiredWebSocketCommands ?? [
    'bolt11_mint_quote',
    'bolt11_melt_quote',
    'proof_state',
  ];

  const validatorMap: Record<NUT, NutValidation> = {
    4: {
      nut: 4,
      validate: (info, unit) => validateBolt11Support(info, 'minting', unit),
    },
    5: {
      nut: 5,
      validate: (info, unit) => validateBolt11Support(info, 'melting', unit),
    },
    7: {
      nut: 7,
      validate: (info) =>
        validateGenericNut(
          info,
          7,
          'Mint does not support token state checks (NUT-7)',
        ),
    },
    8: {
      nut: 8,
      validate: (info) =>
        validateGenericNut(
          info,
          8,
          'Mint does not support overpaid lightning fees (NUT-8)',
        ),
    },
    9: {
      nut: 9,
      validate: (info) =>
        validateGenericNut(
          info,
          9,
          'Mint does not support signature restoration (NUT-9)',
        ),
    },
    10: {
      nut: 10,
      validate: (info) =>
        validateGenericNut(
          info,
          10,
          'Mint does not support spending conditions (NUT-10)',
        ),
    },
    11: {
      nut: 11,
      validate: (info) =>
        validateGenericNut(info, 11, 'Mint does not support P2PK (NUT-11)'),
    },
    12: {
      nut: 12,
      validate: (info) =>
        validateGenericNut(
          info,
          12,
          'Mint does not support DLEQ proofs (NUT-12)',
        ),
    },
    17: {
      nut: 17,
      validate: (info, unit) =>
        validateWebSocketSupport(info, unit, requiredWebSocketCommands),
    },
    20: {
      nut: 20,
      validate: (info) =>
        validateGenericNut(
          info,
          20,
          'Mint does not support signed mint quotes (NUT-20)',
        ),
    },
  };

  return requiredNuts.map((nut) => validatorMap[nut]);
};

const validateBolt11Support = (
  info: MintInfo,
  operation: 'minting' | 'melting',
  unit: string,
): NutValidationResult => {
  const nut = operation === 'minting' ? 4 : 5;
  const status = info.isSupported(nut);

  if (status.disabled) {
    return {
      isValid: false,
      message: `${operation} is disabled on this mint`,
    };
  }

  const hasBolt11Support = status.params.some(
    (method) => method.method === 'bolt11' && method.unit === unit,
  );

  if (!hasBolt11Support) {
    return {
      isValid: false,
      message: `Mint does not support Lightning (bolt11) ${operation} for ${unit}`,
    };
  }

  return { isValid: true };
};

const validateGenericNut = (
  info: MintInfo,
  nut: Extract<NUT, 7 | 8 | 9 | 10 | 11 | 12 | 20>,
  message: string,
): NutValidationResult => {
  const status = info.isSupported(nut);
  if (!status.supported) {
    return {
      isValid: false,
      message,
    };
  }
  return { isValid: true };
};

const validateWebSocketSupport = (
  info: MintInfo,
  unit: string,
  requiredCommands: NUT17WebSocketCommand[],
): NutValidationResult => {
  const status = info.isSupported(17);
  if (!status.supported) {
    return {
      isValid: false,
      message: 'Mint does not support WebSockets (NUT-17)',
    };
  }

  const hasBolt11WebSocketSupport = status.params?.some(
    (support: WebSocketSupport) =>
      support.method === 'bolt11' &&
      support.unit === unit &&
      requiredCommands.every((cmd) => support.commands.includes(cmd)),
  );

  if (!hasBolt11WebSocketSupport) {
    return {
      isValid: false,
      message: `Mint does not support required WebSocket commands for ${unit} via bolt11`,
    };
  }

  return { isValid: true };
};

const validateMintFeatures = (
  mintInfo: MintInfo,
  unit: string,
  nutValidators: NutValidation[],
): NutValidationResult => {
  try {
    for (const { validate } of nutValidators) {
      const result = validate(mintInfo, unit);
      if (!result.isValid) {
        return result;
      }
    }

    return { isValid: true };
  } catch {
    return {
      isValid: false,
      message: 'Failed to connect to mint or validate features',
    };
  }
};
