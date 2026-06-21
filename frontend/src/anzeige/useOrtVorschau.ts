import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { LatLon } from './koordinaten';
import { ladeOrtVorschau, type OrtVorschau } from '../api/ortVorschau';
import { ortKeyVon, holeOrt, setzeOrt } from './ortCache';

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
  const [debounced, setDebounced] = useState<LatLon | null>(null);

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
    queryFn: async () => {
      const key = ortKeyVon(debounced!.lat, debounced!.lon);
      try {
        const live = await ladeOrtVorschau(einsatzId, debounced!.lat, debounced!.lon, exclude);
        if (live.ortsname) {
          await setzeOrt(key, live.ortsname); // Ortsname (unveränderlich) lang persistieren
          return live;
        }
        // Live ohne Ortsname (offline/Rate-Limit) → persistierten Ort als Fallback zeigen
        return { peilung: live.peilung, ortsname: await holeOrt(key) };
      } catch (e) {
        // Server nicht erreichbar → Peilung fehlt, aber persistierter Ort kann existieren
        const persisted = await holeOrt(key);
        if (persisted) return { peilung: null, ortsname: persisted };
        throw e;
      }
    },
    enabled: Number.isFinite(einsatzId) && debounced != null,
    // Peilung bleibt live (Marker ändern sich) — KEIN Infinity. Der Ortsname ist über den
    // persistenten Local-Store ohnehin dauerhaft.
    staleTime: 30_000,
  });
}
