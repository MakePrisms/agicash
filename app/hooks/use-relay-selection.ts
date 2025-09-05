import { useSuspenseQuery } from '@tanstack/react-query';
import ky from 'ky';
import { useMemo } from 'react';
import { decodeGeohash } from '~/lib/geohash';

type Relay = {
  url: string;
  lat: number;
  lon: number;
};

/**
 * Converts degrees to radians
 */
function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

/**
 * Calculates the Haversine distance between two points on Earth
 * @param lat1 - Latitude of first point in degrees
 * @param lon1 - Longitude of first point in degrees
 * @param lat2 - Latitude of second point in degrees
 * @param lon2 - Longitude of second point in degrees
 * @returns Distance in kilometers
 */
function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371; // Earth's radius in kilometers
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

/**
 * Parses CSV content and returns relay objects
 * @param csvContent - Raw CSV string content
 * @returns Array of relay objects with url, lat, lon
 */
function parseRelaysCsv(csvContent: string): Relay[] {
  const lines = csvContent.trim().split('\n');
  const relays: Relay[] = [];

  // Skip header row
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const [url, latStr, lonStr] = line.split(',');
    const lat = Number.parseFloat(latStr);
    const lon = Number.parseFloat(lonStr);

    if (!Number.isNaN(lat) && !Number.isNaN(lon) && url) {
      relays.push({
        url:
          url.startsWith('wss://') || url.startsWith('ws://')
            ? url
            : `wss://${url}`,
        lat,
        lon,
      });
    }
  }

  return relays;
}

type RelayWithDistance = Relay & {
  distance: number;
};

/**
 * Custom hook for selecting relays based on geohash location
 */
export function useRelaySelection(geohash?: string) {
  // Fetch CSV data from GitHub
  const { data: relays } = useSuspenseQuery({
    queryKey: ['nostr-relays'],
    queryFn: async (): Promise<Relay[]> => {
      const csvData = await ky
        .get(
          'https://raw.githubusercontent.com/permissionlesstech/georelays/main/nostr_relays.csv',
        )
        .text();
      return parseRelaysCsv(csvData);
    },
    staleTime: Number.POSITIVE_INFINITY,
  });

  // Calculate closest relays based on geohash
  const closestRelays = useMemo((): RelayWithDistance[] => {
    if (!geohash?.trim() || relays.length === 0) {
      return [];
    }

    try {
      const center = decodeGeohash(geohash.trim());

      // Calculate distance for each relay and get the closest 5
      const relaysWithDistance = relays.map((relay) => ({
        ...relay,
        distance: haversineDistance(
          center.lat,
          center.lon,
          relay.lat,
          relay.lon,
        ),
      }));

      return relaysWithDistance
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 5);
    } catch {
      // TODO: show this error to the user so they know invalid geohash
      console.error('Error decoding geohash:', geohash);
      return [];
    }
  }, [geohash, relays]);

  return {
    closestRelays,
  };
}
