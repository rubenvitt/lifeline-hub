import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { LatLon } from './koordinaten';
import { ladeOrtVorschau, type OrtVorschau } from '../api/ortVorschau';

/** Auf ~100 m runden (3 Nachkommastellen) — teilt den serverseitigen Cache-Treffer. */
function runde(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Debounced Ort-Vorschau (Peilung + ggf. Ortsname). Ruft den Endpoint erst ~debounceMs
 * nach der letzten Koordinaten-Änderung (kein Per-Tastenanschlag, Nominatim-ToS).
 * `enabled` nur bei gültiger Koordinate; Query-Key inkl. gerundeter Koordinate.
 */
export function useOrtVorschau(
  einsatzId: number,
  koord: LatLon | null,
  exclude?: string,
  debounceMs = 700,
) {
  const [debounced, setDebounced] = useState<LatLon | null>(koord);

  useEffect(() => {
    if (!koord) {
      setDebounced(null);
      return;
    }
    const t = setTimeout(() => setDebounced({ lat: koord.lat, lon: koord.lon }), debounceMs);
    return () => clearTimeout(t);
  }, [koord?.lat, koord?.lon, debounceMs]);

  return useQuery<OrtVorschau>({
    queryKey: [
      'ort-vorschau',
      einsatzId,
      debounced ? runde(debounced.lat) : null,
      debounced ? runde(debounced.lon) : null,
      exclude ?? null,
    ],
    queryFn: () => ladeOrtVorschau(einsatzId, debounced!.lat, debounced!.lon, exclude),
    enabled: Number.isFinite(einsatzId) && debounced != null,
    // Ergebnis ist faktisch unveränderlich (Ort einer Koordinate) → nicht neu laden.
    staleTime: Infinity,
  });
}
