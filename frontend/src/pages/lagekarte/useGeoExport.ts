import { useMemo, useRef, useState } from 'react';
import type { Nebenweg } from '../../components/EinsatzSeite';
import { exportDateiname, speichereDatei } from '../../components/dateiSpeichern';
import { collectExportObjekte, type ExportEingabe } from './geoExport';
import { GEOJSON_ENDUNG, GEOJSON_MEDIENTYP, writeGeojson } from './geojsonWriter';
import { GPX_ENDUNG, GPX_MEDIENTYP, writeGpx } from './gpxWriter';
import { packKmz } from './kmzPacker';

/** Label-Zusatz eines gesperrten Eintrags: der Grund steht sichtbar am Element. */
export const EXPORT_SPERRGRUND = 'Nichts eingeblendet';
/** Zusatz, solange die Daten der Karte noch laden (`eingabe: null`). */
export const EXPORT_LAEDT = 'lädt';
/** Zusatz, solange die Datei dieses Eintrags erzeugt wird. */
export const EXPORT_LAEUFT = 'läuft';
export const EXPORT_KMZ = 'Exportieren: Google Earth (KMZ)';
export const EXPORT_GEOJSON = 'Exportieren: GIS (GeoJSON)';
export const EXPORT_GPX = 'Exportieren: Fireboard (GPX)';

/**
 * Die Lagekarte als Datei für Google Earth (KMZ), GIS (GeoJSON) und Fireboard (GPX, LLH-2128) —
 * drei Nebenwege des Kopfes (Spec `lagekarte-geo-export`). Lesen genügt, kein Schreibrecht. Ein Fehler beim Erzeugen geht an
 * den Melder, den `beginneExport` je Klick liefert (Seitenfehler der Karte; ein neuer Versuch räumt
 * den alten Grund). Gesperrt, mit dem Grund am Eintrag: solange die Daten laden (`eingabe: null`),
 * ohne sichtbares Objekt und solange die Datei des Eintrags entsteht (ein zweiter Klick speicherte
 * sonst eine zweite Datei).
 *
 * Der Stand der Datei ist `eingabe.stand` (der gezeigte gesicherte Stand der Historienansicht),
 * in der Live-Ansicht (`null`) der Moment des Klicks.
 */
export function useGeoExport(
  eingabe: ExportEingabe | null,
  einsatzId: number,
  beginneExport?: () => (fehler: unknown) => void,
): { nebenwege: Nebenweg[] } {
  const objekte = useMemo(() => (eingabe ? collectExportObjekte(eingabe) : []), [eingabe]);
  const leer = objekte.length === 0;
  // Die Sperre greift synchron (Ref) und zeigt sich am Eintrag (State).
  const laufendRef = useRef(new Set<string>());
  const [laufend, setLaufend] = useState<ReadonlySet<string>>(() => new Set());

  const nebenwege = useMemo<Nebenweg[]>(() => {
    const setzeLaufend = (key: string, an: boolean) => {
      if (an) laufendRef.current.add(key);
      else laufendRef.current.delete(key);
      setLaufend(new Set(laufendRef.current));
    };
    const eintrag = (
      key: string,
      label: string,
      endung: string,
      erzeuge: (stand: Date) => Promise<Blob> | Blob,
    ): Nebenweg => {
      const grund = !eingabe
        ? EXPORT_LAEDT
        : leer
          ? EXPORT_SPERRGRUND
          : laufend.has(key)
            ? EXPORT_LAEUFT
            : null;
      return {
        key,
        label: grund ? `${label} (${grund})` : label,
        ...(grund ? { gesperrt: true as const } : {}),
        onWahl: () => {
          if (!eingabe || leer || laufendRef.current.has(key)) return;
          const meldeFehler = beginneExport?.();
          setzeLaufend(key, true);
          void (async () => {
            try {
              const datei = await erzeuge(eingabe.stand ?? new Date());
              speichereDatei(datei, exportDateiname('lagekarte', einsatzId, endung));
            } catch (e) {
              meldeFehler?.(e);
            } finally {
              setzeLaufend(key, false);
            }
          })();
        },
      };
    };
    const meta = (stand: Date) => ({ stand, einsatzName: eingabe?.einsatzName ?? '' });
    return [
      eintrag('export-kmz', EXPORT_KMZ, 'kmz', (s) => packKmz(objekte, meta(s))),
      eintrag(
        'export-geojson',
        EXPORT_GEOJSON,
        GEOJSON_ENDUNG,
        (s) => new Blob([writeGeojson(objekte, meta(s))], { type: GEOJSON_MEDIENTYP }),
      ),
      eintrag(
        'export-gpx',
        EXPORT_GPX,
        GPX_ENDUNG,
        (s) => new Blob([writeGpx(objekte, meta(s))], { type: GPX_MEDIENTYP }),
      ),
    ];
  }, [eingabe, einsatzId, leer, objekte, beginneExport, laufend]);

  return { nebenwege };
}
