import { queryOptions } from '@tanstack/react-query';
import { einsatzKeys } from '../api/queryKeys';
import { listePersonen } from '../api/einsatzPerson';
import { listeSchaeden } from '../api/einsatzSchaden';
import { listeUhs } from '../api/einsatzUhs';
import { listeMeldungen } from '../api/meldungen';
import { listeAuftraege } from '../api/auftraege';
import { listeEinsatzFahrzeuge } from '../api/einsatzFahrzeuge';
import { listeEinsatzPersonal } from '../api/einsatzPersonal';
import { listeEinheiten } from '../api/einheiten';
import { listeEtb } from '../api/etb';
import { listeLageberichte } from '../api/lageberichte';
import { ladeGefahrengebiete } from '../api/gefahren';
import { listeAbschnitte } from '../api/einsatzabschnitte';

/**
 * Die Abrufoptionen der Datensatz-Listen, EINE Quelle für die Palette (`useDatensaetze`) und die
 * Lese-Vorschau je Sorte.
 *
 * Zwei Beobachter auf einem Fach müssen teilen, jeweils mit stillem Fehlermodus:
 *  - den **Schlüssel** (sonst ein zweites Fach mit denselben Bytes);
 *  - die **Abruffunktion** (sonst zwei Formen in einem Fach, siehe `etbSuchSchluessel`);
 *  - die **Frische** (sonst holt die Vorschau beim Einhängen neu, statt den Stand der
 *    Trefferliste zu zeigen).
 *
 * Eigene Datei, damit die Vorschau-Bauteile der Fachmodule nur die Optionen ziehen, nicht den
 * Palettenhook. Keine Adresse entsteht hier von Hand (`routing/inlinePfade.guard.test.ts`).
 */

/**
 * Wie lange eine geholte Liste als frisch gilt: deutlich über der globalen Vorgabe (10 s), weil
 * diese Fächer am SSE-Fan-out hängen und Änderungen über die Invalidierung kommen. Sonst holte
 * jedes Öffnen der Palette bis zu zwölf Listen neu.
 */
export const FRISCH_MS = 60_000;

/**
 * Aufräumfrist der ETB-Suchfächer: der ETB bekommt JE SUCHBEGRIFF bzw. Nummer ein Fach, ohne kurze
 * Frist sammelten sie sich an. Nur dort: die geteilten Listenfächer gehören auch anderen Seiten.
 */
export const ETB_SUCH_GC_MS = 30_000;

/**
 * Die ARGUMENTLOSEN Bestands-Accessoren, dieselben Fächer wie die Modulseiten. Kein
 * Filterargument: ein `?status=…` wäre ein eigenes Fach.
 */
export const datensatzAbfrage = {
  personen: (id: number) =>
    queryOptions({
      queryKey: einsatzKeys.personen(id),
      queryFn: () => listePersonen(id),
      staleTime: FRISCH_MS,
    }),
  schaeden: (id: number) =>
    queryOptions({
      queryKey: einsatzKeys.schaeden(id),
      queryFn: () => listeSchaeden(id),
      staleTime: FRISCH_MS,
    }),
  uhs: (id: number) =>
    queryOptions({
      queryKey: einsatzKeys.uhs(id),
      queryFn: () => listeUhs(id),
      staleTime: FRISCH_MS,
    }),
  meldungen: (id: number) =>
    queryOptions({
      queryKey: einsatzKeys.meldungen(id),
      queryFn: () => listeMeldungen(id),
      staleTime: FRISCH_MS,
    }),
  auftraege: (id: number) =>
    queryOptions({
      queryKey: einsatzKeys.auftraege(id),
      queryFn: () => listeAuftraege(id),
      staleTime: FRISCH_MS,
    }),
  fahrzeuge: (id: number) =>
    queryOptions({
      queryKey: einsatzKeys.fahrzeuge(id),
      queryFn: () => listeEinsatzFahrzeuge(id),
      staleTime: FRISCH_MS,
    }),
  personal: (id: number) =>
    queryOptions({
      queryKey: einsatzKeys.personal(id),
      queryFn: () => listeEinsatzPersonal(id),
      staleTime: FRISCH_MS,
    }),
  einheiten: (id: number) =>
    queryOptions({
      queryKey: einsatzKeys.einheiten(id),
      queryFn: () => listeEinheiten(id),
      staleTime: FRISCH_MS,
    }),
  lageberichte: (id: number) =>
    queryOptions({
      queryKey: einsatzKeys.lageberichte(id),
      queryFn: () => listeLageberichte(id),
      staleTime: FRISCH_MS,
    }),
  gefahrengebiete: (id: number) =>
    queryOptions({
      queryKey: einsatzKeys.gefahrengebiete(id),
      queryFn: () => ladeGefahrengebiete(id),
      staleTime: FRISCH_MS,
    }),
  abschnitte: (id: number) =>
    queryOptions({
      queryKey: einsatzKeys.abschnitte(id),
      queryFn: () => listeAbschnitte(id),
      staleTime: FRISCH_MS,
    }),
};

/**
 * Cache-Fach des ETB-Zahlenzweigs: `before_lfd_nr` filtert strikt `<` bei
 * `ORDER BY lfd_nr DESC`, `n + 1` liefert den Eintrag n, sofern es ihn gibt. Ob die Antwort der
 * gesuchte Eintrag ist, prüft der Aufrufer (Palette: Nummer, Vorschau: `id`).
 */
export function etbNummerSchluessel(einsatzId: number, nummer: number) {
  return einsatzKeys.etbListe(einsatzId, { before_lfd_nr: nummer + 1, limit: 1 });
}

/** Abrufoptionen zum {@link etbNummerSchluessel}; Palette und ETB-Vorschau teilen sie. */
export function etbNummerAbfrage(einsatzId: number, nummer: number) {
  return queryOptions({
    queryKey: etbNummerSchluessel(einsatzId, nummer),
    queryFn: () => listeEtb(einsatzId, { before_lfd_nr: nummer + 1, limit: 1 }),
    staleTime: FRISCH_MS,
    gcTime: ETB_SUCH_GC_MS,
  });
}
