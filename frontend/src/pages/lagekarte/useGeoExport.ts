import { useMemo } from 'react';
import type { Nebenweg } from '../../components/EinsatzSeite';
import { exportDateiname, speichereDatei } from '../../components/dateiSpeichern';
import { collectExportObjekte, type ExportEingabe } from './geoExport';
import { GEOJSON_ENDUNG, GEOJSON_MEDIENTYP, writeGeojson } from './geojsonWriter';
import { packKmz } from './kmzPacker';

/** Label-Zusatz eines gesperrten Eintrags: der Grund steht sichtbar am Element. */
export const EXPORT_SPERRGRUND = 'Nichts eingeblendet';
export const EXPORT_KMZ = 'Exportieren: Google Earth (KMZ)';
export const EXPORT_GEOJSON = 'Exportieren: GIS (GeoJSON)';

/**
 * Die Lagekarte als Datei für Google Earth (KMZ) und GIS (GeoJSON) — zwei Nebenwege des Kopfes
 * (Spec `lagekarte-geo-export`). Lesen genügt, kein Schreibrecht. Ein Fehler beim Erzeugen geht an
 * dem Melder, den `beginneExport` je Klick liefert (Seitenfehler der Karte; ein neuer Versuch räumt den alten Grund); ohne Eingabe oder ohne sichtbares Objekt sind beide gesperrt.
 */
export function useGeoExport(
  eingabe: ExportEingabe | null,
  einsatzId: number,
  beginneExport?: () => (fehler: unknown) => void,
): { nebenwege: Nebenweg[] } {
  const objekte = useMemo(() => (eingabe ? collectExportObjekte(eingabe) : []), [eingabe]);
  const leer = objekte.length === 0;

  const nebenwege = useMemo<Nebenweg[]>(() => {
    const eintrag = (
      key: string,
      label: string,
      endung: string,
      erzeuge: (stand: ExportEingabe) => Promise<Blob> | Blob,
    ): Nebenweg => ({
      key,
      label: leer ? `${label} (${EXPORT_SPERRGRUND})` : label,
      ...(leer ? { gesperrt: true as const } : {}),
      onWahl: () => {
        if (!eingabe || leer) return;
        const meldeFehler = beginneExport?.();
        void (async () => {
          try {
            // Der Stand ist der Moment des Klicks, nicht der des letzten Datenwechsels.
            const datei = await erzeuge({ ...eingabe, stand: new Date() });
            speichereDatei(datei, exportDateiname('lagekarte', einsatzId, endung));
          } catch (e) {
            meldeFehler?.(e);
          }
        })();
      },
    });
    const meta = (e: ExportEingabe) => ({ stand: e.stand, einsatzName: e.einsatzName });
    return [
      eintrag('export-kmz', EXPORT_KMZ, 'kmz', (e) => packKmz(objekte, meta(e))),
      eintrag(
        'export-geojson',
        EXPORT_GEOJSON,
        GEOJSON_ENDUNG,
        (e) => new Blob([writeGeojson(objekte, meta(e))], { type: GEOJSON_MEDIENTYP }),
      ),
    ];
  }, [eingabe, einsatzId, leer, objekte, beginneExport]);

  return { nebenwege };
}
