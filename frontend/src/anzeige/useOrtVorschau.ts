import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { LatLon } from './koordinaten';
import { ladeOrtVorschau, type OrtVorschau } from '../api/ortVorschau';
import { einsatzKeys } from '../api/queryKeys';
import { ortKeyVon, holeOrt, setzeOrt } from './ortCache';

/** Auf ~100 m runden (3 Nachkommastellen) — teilt den serverseitigen Cache-Treffer. */
function runde(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Debounced Ort-Vorschau (Peilung + ggf. Ortsname): Abruf erst ~debounceMs nach der letzten
 * Änderung (Nominatim-ToS). Nur bei gültiger Koordinate.
 */
export function useOrtVorschau(
  einsatzId: number,
  koord: LatLon | null,
  exclude?: string,
  debounceMs = 700,
) {
  const [debounced, setDebounced] = useState<LatLon | null>(null);

  // lat/lon als Primitive, sonst setzte die Objekt-Identität von `koord` je Render den Debounce zurück.
  const lat = koord?.lat;
  const lon = koord?.lon;
  useEffect(() => {
    if (lat == null || lon == null) {
      setDebounced(null);
      return;
    }
    const t = setTimeout(() => setDebounced({ lat, lon }), debounceMs);
    return () => clearTimeout(t);
  }, [lat, lon, debounceMs]);

  return useQuery<OrtVorschau>({
    queryKey: einsatzKeys.ortVorschau(
      einsatzId,
      debounced ? runde(debounced.lat) : null,
      debounced ? runde(debounced.lon) : null,
      exclude ?? null,
    ),
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
    // Peilung bleibt live (Marker ändern sich); der Ortsname ist über den Local-Store ohnehin dauerhaft.
    staleTime: 30_000,
  });
}
