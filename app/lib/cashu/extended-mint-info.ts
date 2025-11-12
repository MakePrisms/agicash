/**
 * This class was copied from cashu-ts v2.7.2 and extended with the following methods:
 * - get iconUrl
 * - get internalMeltsOnly
 *
 * As of cashu-ts v2.7.2, the MintInfo class is not exported, so we need to copy it here in order to extend it.
 */

import type {
  GetInfoResponse,
  MPPMethod,
  SwapMethod,
  WebSocketSupport,
} from '@cashu/cashu-ts';

/**
 * A class that represents the data fetched from the mint's
 * [NUT-06 info endpoint](https://github.com/cashubtc/nuts/blob/main/06.md)
 */
export class ExtendedMintInfo {
  private readonly _mintInfo: GetInfoResponse;
  private readonly _protectedEnpoints?: {
    cache: {
      [url: string]: boolean;
    };
    apiReturn: Array<{
      method: 'GET' | 'POST';
      regex: RegExp;
      cachedValue?: boolean;
    }>;
  };

  constructor(info: GetInfoResponse) {
    this._mintInfo = info;
    if (info.nuts[22]) {
      this._protectedEnpoints = {
        cache: {},
        apiReturn: info.nuts[22].protected_endpoints.map((o) => ({
          method: o.method,
          regex: new RegExp(o.path),
        })),
      };
    }
  }

  isSupported(num: 4 | 5): { disabled: boolean; params: SwapMethod[] };
  isSupported(num: 7 | 8 | 9 | 10 | 11 | 12 | 14 | 20): { supported: boolean };
  isSupported(num: 17): { supported: boolean; params?: WebSocketSupport[] };
  isSupported(num: 15): { supported: boolean; params?: MPPMethod[] };
  isSupported(num: number) {
    switch (num) {
      case 4:
      case 5: {
        return this.checkMintMelt(num);
      }
      case 7:
      case 8:
      case 9:
      case 10:
      case 11:
      case 12:
      case 14:
      case 20: {
        return this.checkGenericNut(num);
      }
      case 17: {
        return this.checkNut17();
      }
      case 15: {
        return this.checkNut15();
      }
      default: {
        throw new Error('nut is not supported by cashu-ts');
      }
    }
  }

  requiresBlindAuthToken(path: string) {
    if (!this._protectedEnpoints) {
      return false;
    }
    if (typeof this._protectedEnpoints.cache[path] === 'boolean') {
      return this._protectedEnpoints.cache[path];
    }
    const isProtectedEndpoint = this._protectedEnpoints.apiReturn.some((e) =>
      e.regex.test(path),
    );
    this._protectedEnpoints.cache[path] = isProtectedEndpoint;
    return isProtectedEndpoint;
  }

  private checkGenericNut(num: 7 | 8 | 9 | 10 | 11 | 12 | 14 | 20) {
    if (this._mintInfo.nuts[num]?.supported) {
      return { supported: true };
    }
    return { supported: false };
  }
  private checkMintMelt(num: 4 | 5) {
    const mintMeltInfo = this._mintInfo.nuts[num];
    if (
      mintMeltInfo &&
      mintMeltInfo.methods.length > 0 &&
      !mintMeltInfo.disabled
    ) {
      return { disabled: false, params: mintMeltInfo.methods };
    }
    return { disabled: true, params: mintMeltInfo.methods };
  }
  private checkNut17() {
    if (
      this._mintInfo.nuts[17] &&
      this._mintInfo.nuts[17].supported.length > 0
    ) {
      return { supported: true, params: this._mintInfo.nuts[17].supported };
    }
    return { supported: false };
  }
  private checkNut15() {
    if (this._mintInfo.nuts[15] && this._mintInfo.nuts[15].methods.length > 0) {
      return { supported: true, params: this._mintInfo.nuts[15].methods };
    }
    return { supported: false };
  }

  get contact() {
    return this._mintInfo.contact;
  }

  get description() {
    return this._mintInfo.description;
  }

  get description_long() {
    return this._mintInfo.description_long;
  }

  get name() {
    return this._mintInfo.name;
  }

  get pubkey() {
    return this._mintInfo.pubkey;
  }

  get nuts() {
    return this._mintInfo.nuts;
  }

  get version() {
    return this._mintInfo.version;
  }

  get motd() {
    return this._mintInfo.motd;
  }

  // Below methods are added in addition to what the cashu-ts MintInfo class provides

  get iconUrl() {
    return this._mintInfo.icon_url;
  }

  /**
   * Whether the mint only allows internal melts.
   *
   * NOTE: This flag is not currently defined in the NUTs.
   * Internal melts only is a feature that we have added to agicash mints
   * for creating a closed-loop mint.
   */
  get internalMeltsOnly() {
    const methods = this._mintInfo.nuts[5].methods as (SwapMethod & {
      options?: { internal_melts_only?: boolean };
    })[];
    return methods.some(
      (method) => method.options?.internal_melts_only === true,
    );
  }
}
