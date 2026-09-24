// frontend/src/command-palette/datensatzAbfrage.ts
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
 * Die Abrufoptionen der Datensatz-Listen — EINE Quelle für die Palette (`useDatensaetze`)
 * und für die Lese-Vorschau je Sorte (LFH-664).
 *
 * Zwei Beobachter auf einem Fach müssen drei Dinge teilen, und jedes hat einen eigenen,
 * stillen Fehlermodus:
 *  - den **Schlüssel** — sonst lädt die Vorschau ein zweites Fach mit denselben Bytes;
 *  - die **Abruffunktion** — gleicher Schlüssel mit anderer Funktion schriebe zwei Formen in
 *    ein Fach (derselbe Fehler, den `etbSuchSchluessel` beschreibt);
 *  - die **Frische** — ein Beobachter mit der globalen Vorgabe (10 s) holt beim Einhängen neu,
 *    sobald das Fach älter ist; die Vorschau soll aber den Stand der Trefferliste zeigen.
 *
 * Eigene Datei statt Export aus `useDatensaetze.ts`: die Vorschau-Bauteile liegen in den
 * Fachmodulen und sollen nur die Optionen ziehen, nicht den ganzen Palettenhook.
 *
 * Keine Adresse entsteht hier von Hand (`routing/inlinePfade.guard.test.ts` ist auf
 * `command-palette/` gescopt) — die Abrufe laufen über die Clients in `api/*.ts`.
 */

/**
 * Wie lange eine geholte Liste als frisch gilt.
 *
 * Deutlich über dem globalen Vorgabewert (10 s, `api/queryClient.ts`), und das ist keine
 * Nachlässigkeit: diese Fächer hängen am SSE-Fan-out (`EINSATZ_STREAM_EVENTS`), eine
 * Änderung erreicht sie also über die Invalidierung und nicht über das Ablaufen der Frist.
 * Ohne die längere Frist holte jedes Öffnen der Palette bis zu zwölf Listen neu, obwohl die
 * Modulseite daneben dieselben Daten gerade anzeigt.
 */
export const FRISCH_MS = 60_000;

/**
 * Aufräumfrist der ETB-Suchfächer. Anders als die Listen bekommt der ETB JE SUCHBEGRIFF bzw.
 * je Nummer ein eigenes Fach; ohne kurze Frist sammelte eine Suchsitzung sie über die Vorgabe
 * von fünf Minuten an. Die Frist gilt nur dort — die geteilten Listenfächer gehören auch
 * anderen Seiten, ein kurzes `gcTime` von der Palette aus räumte ihnen den Cache weg.
 */
export const ETB_SUCH_GC_MS = 30_000;

/**
 * Die ARGUMENTLOSEN Bestands-Accessoren — genau die Fächer, die `ChatPage`,
 * `LageDashboardPage` und die Modulseiten selbst füllen. Kein Filterargument: ein
 * `?status=…` wäre ein eigenes Fach.
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
 * Cache-Fach des ETB-Zahlenzweigs. Ein Eintrag, ein Request: `before_lfd_nr` filtert strikt
 * `lfd_nr <` bei `ORDER BY lfd_nr DESC`, `n + 1` liefert also genau den Eintrag n — sofern es
 * ihn gibt. Ob die Antwort wirklich den gesuchten Eintrag trägt, prüft der Aufrufer (Palette:
 * die Nummer, Vorschau: die `id`); bei einer Nummernlücke liefert der Cursor den nächstälteren.
 */
export function etbNummerSchluessel(einsatzId: number, nummer: number) {
  return einsatzKeys.etbListe(einsatzId, { before_lfd_nr: nummer + 1, limit: 1 });
}

/** Abrufoptionen zum {@link etbNummerSchluessel} — Palette und ETB-Vorschau teilen sie. */
export function etbNummerAbfrage(einsatzId: number, nummer: number) {
  return queryOptions({
    queryKey: etbNummerSchluessel(einsatzId, nummer),
    queryFn: () => listeEtb(einsatzId, { before_lfd_nr: nummer + 1, limit: 1 }),
    staleTime: FRISCH_MS,
    gcTime: ETB_SUCH_GC_MS,
  });
}
