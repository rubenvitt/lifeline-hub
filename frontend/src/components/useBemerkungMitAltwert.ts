import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useFeldKonflikt } from './useFeldKonflikt';

/** Leer oder nur Leerraum ist „ohne Angabe“ (`null`), wie der Server die Bemerkung speichert. */
const alsBemerkung = (w: string | null | undefined): string | null => (w?.trim() ? w : null);

export interface BemerkungMitAltwert<Z> {
  /** Schlüssel der Liste, die die Zeile trägt; nach einem 409 frisch geladen. */
  queryKey: QueryKey;
  laden: () => Promise<Z[]>;
  /** Schickt die Bemerkung; `erwartet` undefiniert = ohne Vergleich. Lehnt bei Fehlern ab. */
  speichern: (
    id: number,
    bemerkung: string,
    erwartet: string | null | undefined,
  ) => Promise<unknown>;
  /** Grund einer Ablehnung an die Zeile; ein 409 mit Rückfrage ist keiner. */
  melde: (id: number, fehler: unknown) => void;
}

/**
 * Bemerkung einer Listenzeile (`BemerkungZelle`) mit Feld-CAS (LLH-1945, Spec `formularseiten`,
 * „Einzelangabe prüft auf zwischenzeitliche Änderung“): der Wert beim Öffnen der Zelle geht als
 * Altwert mit; hat ein anderer die Bemerkung inzwischen geändert, fragt `useFeldKonflikt`
 * „Zwischenzeitlich geändert“. Gemeinsam für Personal, Fahrzeuge und Material.
 *
 * Liefert das Ergebnis der Rückfrage (`OFFEN_LASSEN`: die Zelle bleibt mit dem Entwurf offen,
 * `VERWORFEN`: sie schließt mit dem frischen Stand); eine echte Ablehnung steht an der Zeile und
 * lehnt ab.
 */
export function useBemerkungMitAltwert<Z extends { id: number; bemerkung?: string | null }>(
  o: BemerkungMitAltwert<Z>,
) {
  const qc = useQueryClient();
  const konflikt = useFeldKonflikt();
  return (id: number, bemerkung: string, beimOeffnen: string | null) =>
    konflikt({
      etikett: 'Bemerkung',
      erwartet: alsBemerkung(beimOeffnen),
      speichern: async (erwartet) => {
        await o.speichern(id, bemerkung, erwartet);
      },
      ladeFrisch: async () => {
        const liste = await qc.fetchQuery({ queryKey: o.queryKey, queryFn: o.laden, staleTime: 0 });
        return liste.find((z) => z.id === id);
      },
      // Eine inzwischen entlassene Zeile fehlt in der Liste: dann kein Feldkonflikt.
      aktuell: (frisch) => frisch && { wert: alsBemerkung(frisch.bemerkung) },
      text: (w) => w ?? '',
    }).catch((e: unknown) => {
      o.melde(id, e);
      throw e;
    });
}
