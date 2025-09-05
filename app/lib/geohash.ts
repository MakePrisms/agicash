/**
 * Geohash utility functions for decoding geohashes
 */

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

type Coordinates = {
  lat: number;
  lon: number;
};

/**
 * Decodes a geohash string to latitude and longitude coordinates
 * @param geohash - The geohash string to decode
 * @returns Object with lat and lon properties
 */
export function decodeGeohash(geohash: string): Coordinates {
  let isEven = true;
  let latMin = -90.0;
  let latMax = 90.0;
  let lonMin = -180.0;
  let lonMax = 180.0;

  for (let i = 0; i < geohash.length; i++) {
    const char = geohash[i];
    const cd = BASE32.indexOf(char);

    if (cd === -1) {
      throw new Error(`Invalid geohash character: ${char}`);
    }

    for (let mask = 16; mask > 0; mask >>= 1) {
      if (isEven) {
        // longitude
        const lonMid = (lonMin + lonMax) / 2;
        if (cd & mask) {
          lonMin = lonMid;
        } else {
          lonMax = lonMid;
        }
      } else {
        // latitude
        const latMid = (latMin + latMax) / 2;
        if (cd & mask) {
          latMin = latMid;
        } else {
          latMax = latMid;
        }
      }
      isEven = !isEven;
    }
  }

  return {
    lat: (latMin + latMax) / 2,
    lon: (lonMin + lonMax) / 2,
  };
}
