import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { einsatzKeys } from '../api/queryKeys';
import { ladeModulOverrides } from '../api/einsaetze';
import { listeEtb, zaehleEtb } from '../api/etb';
import { datensatzAbfrage, ETB_SUCH_GC_MS, etbNummerAbfrage, FRISCH_MS } from './datensatzAbfrage';
import { istModulFreigegeben, modulRegistry } from '../einsatz/modulRegistry';
import {
  baueDatensatzTreffer,
  etbVolltextMoeglich,
  zahlAusSuche,
  type DatensatzKontext,
  type DatensatzQuellen,
} from './datensaetze';
import type { Treffer } from './fuzzy';
import {
  DATENSATZ_MINDESTZEICHEN,
  PALETTE_MODI,
  QUELLE_MODUL,
  modusZeigtDatensaetze,
  type DatensatzQuelle,
  type PaletteModus,
} from './typen';

/**
 * Die BESCHAFFUNG des Datensatz-Finders, Gegenpart zum reinen Kern in `datensaetze.ts`.
 *
 * ALLES IST LAZY: die Palette rendert ihren Inhalt erst beim Öffnen, jede Query hier feuert im
 * Moment des Tastendrucks; ohne Riegel wären es bis zu vierzehn kalte Abrufe. Muster ist der
 * Sachbezug-Picker in `pages/ChatPage.tsx`.
 *
 * VIER RIEGEL VOR JEDEM `enabled` (die ersten drei in {@link datensatzAbrufAktiv}):
 *  1. **Einsatzkontext**: ohne `einsatzId` keine Liste.
 *  2. **Schwelle**: erst ab `DATENSATZ_MINDESTZEICHEN` Zeichen im Rest hinter dem Präfix.
 *  3. **Modus**: was der Modus nicht anzeigt, wird nicht geholt (`PALETTE_MODI[…].quellen`).
 *  4. **Recht**: `istModulFreigegeben` JE MODUL.
 *
 * Die Entprellung liegt am Eingabefeld (`CommandPalette.tsx`), der Hook bekommt einen entprellten
 * Rest. Keine Adresse entsteht hier von Hand (`routing/inlinePfade.guard.test.ts` trifft auch
 * API-Adressen); Abrufe über `api/*.ts`, Schlüssel über `api/queryKeys.ts`.
 */

// `FRISCH_MS` und `ETB_SUCH_GC_MS` stehen in `datensatzAbfrage.ts`: die Vorschau liest dieselben
// Fächer mit derselben Frische.

/** Trefferdeckel des ETB-Volltextzweigs — geht als `limit` MIT in den Request (5 statt 100). */
const ETB_TEXT_DECKEL = 5;

export interface DatensatzAbruf {
  /** Aus dem Pfad gezogen; `null` außerhalb eines Einsatzes. */
  einsatzId: number | null;
  modus: PaletteModus;
  /** Der Rest hinter dem Präfix, BEREITS ENTPRELLT — nicht die rohe Eingabe. */
  suche: string;
}

/**
 * Die drei Riegel vor jedem `enabled`, an EINER Stelle: `useDatensaetze` und
 * `useDatensatzTreffer` brauchen sie beide, sonst liefen die Overrides in einem Zustand los, in
 * dem keine Liste folgt.
 */
export function datensatzAbrufAktiv({ einsatzId, modus, suche }: DatensatzAbruf): boolean {
  return (
    einsatzId != null &&
    suche.trim().length >= DATENSATZ_MINDESTZEICHEN &&
    modusZeigtDatensaetze(modus)
  );
}

/**
 * Cache-Fach des ETB-Volltextzweigs.
 *
 * DAS `limit` IM SCHLÜSSEL IST DIE TRENNUNG: `pages/EtbPage.tsx` belegt denselben Prefix mit
 * einer `useInfiniteQuery`, deren Filter nur q/typ/von/bis trägt. Ohne `limit` lägen beide in
 * EINEM Fach, einmal `{ pages, pageParams }` und einmal ein Array; kein Guard sähe das.
 *
 * Exportiert, damit der Test die produktive Schlüsselbildung nutzt statt sie nachzubauen.
 */
export function etbSuchSchluessel(einsatzId: number, q: string) {
  return einsatzKeys.etbListe(einsatzId, { q, limit: ETB_TEXT_DECKEL });
}

/** Cache-Fach des ETB-Zahlenzweigs, aus `datensatzAbfrage.ts` weitergereicht. */
export { etbNummerSchluessel } from './datensatzAbfrage';

/**
 * Cache-Fach der ETB-Zählung, unter dem ETB-Prefix, damit jedes `etb`-Ereignis die Zahl mit
 * invalidiert. `anzahl: true` trennt das Fach von Liste und Volltextfach (siehe
 * {@link etbSuchSchluessel}).
 */
export function etbAnzahlSchluessel(einsatzId: number, q: string) {
  return einsatzKeys.etbListe(einsatzId, { q, anzahl: true });
}

/**
 * Holt die Listen, aus denen `baueDatensatzTreffer` seine Treffer baut. Rückgabe ist
 * `DatensatzQuellen`, keine Trefferliste: die Fachaussagen im reinen Kern bleiben so ohne Netz
 * und Render prüfbar.
 */
export function useDatensaetze({ einsatzId, modus, suche }: DatensatzAbruf): DatensatzQuellen {
  const { benutzer } = useAuth();
  const rest = suche.trim();
  // `?? 0` ist nie eine echte Einsatz-id; ohne Einsatz liefert `datensatzAbrufAktiv` false, der
  // Schlüssel wird nie abgerufen.
  const id = einsatzId ?? 0;
  /**
   * Einsatzkontext, Schwelle und Modus in EINEM Riegel schon HIER, sonst liefe im `>`-Modus der
   * Sichtbarkeitsabruf darunter als einziger doch.
   */
  const aktiv = datensatzAbrufAktiv({ einsatzId, modus, suche });
  /** Quellen dieses Modus; `null` = keine Einschränkung. */
  const erlaubterModus = PALETTE_MODI[modus].quellen;

  /**
   * Die Overrides tragen die Sichtbarkeitsachse und kommen VOR den Listen, an derselben Schwelle:
   * ohne Begriff schweigt der Hook vollständig. `useBefehle` fordert dasselbe Fach ohnehin an,
   * TanStack führt beide Beobachter zusammen.
   */
  const overridesQuery = useQuery({
    queryKey: einsatzKeys.modulOverrides(einsatzId),
    queryFn: () => ladeModulOverrides(einsatzId!),
    enabled: aktiv,
    staleTime: FRISCH_MS,
  });

  /**
   * Erst wenn die Sichtbarkeit beantwortet ist, dürfen die Listen los; sonst liefen sie in der
   * Ladelücke gegen den Registry-Default „sichtbar“, obwohl der Einsatz ein Modul ausblenden kann.
   * `isFetched` statt `isSuccess`: ein Fehlschlag darf die Suche nicht stilllegen, dann gilt der
   * Registry-Default wie in `useBefehle`.
   */
  const rechteBekannt = overridesQuery.isFetched;
  const overrides = overridesQuery.data;

  function darfLaden(quelle: DatensatzQuelle): boolean {
    if (!aktiv || !rechteBekannt) return false;
    if (erlaubterModus !== null && !erlaubterModus.includes(quelle)) return false;
    const eintrag = modulRegistry.find((m) => m.key === QUELLE_MODUL[quelle]);
    return eintrag != null && istModulFreigegeben(eintrag, benutzer, overrides);
  }

  /**
   * Die ungefilterten Listen hängen an den ARGUMENTLOSEN Bestands-Accessoren, denselben Fächern wie
   * die Modulseiten: auf einer warmen Seite kostet das Öffnen null Requests. Deshalb auch kein
   * Filterargument (ein `?status=…` wäre ein eigenes Fach).
   */
  const personenQuery = useQuery({
    ...datensatzAbfrage.personen(id),
    enabled: darfLaden('personen'),
  });
  const schaedenQuery = useQuery({
    ...datensatzAbfrage.schaeden(id),
    enabled: darfLaden('schaeden'),
  });
  const uhsQuery = useQuery({
    ...datensatzAbfrage.uhs(id),
    enabled: darfLaden('uhs'),
  });
  const meldungenQuery = useQuery({
    ...datensatzAbfrage.meldungen(id),
    enabled: darfLaden('meldungen'),
  });
  const auftraegeQuery = useQuery({
    ...datensatzAbfrage.auftraege(id),
    enabled: darfLaden('auftraege'),
  });
  const fahrzeugeQuery = useQuery({
    ...datensatzAbfrage.fahrzeuge(id),
    enabled: darfLaden('fahrzeuge'),
  });
  const personalQuery = useQuery({
    ...datensatzAbfrage.personal(id),
    enabled: darfLaden('personal'),
  });
  const einheitenQuery = useQuery({
    ...datensatzAbfrage.einheiten(id),
    enabled: darfLaden('einheiten'),
  });
  // Dieselben geteilten Fächer wie Lageberichte-, Gefahren- und Abschnittsseite.
  const lageberichteQuery = useQuery({
    ...datensatzAbfrage.lageberichte(id),
    enabled: darfLaden('lageberichte'),
  });
  const gefahrengebieteQuery = useQuery({
    ...datensatzAbfrage.gefahrengebiete(id),
    enabled: darfLaden('gefahrengebiete'),
  });
  const abschnitteQuery = useQuery({
    ...datensatzAbfrage.abschnitte(id),
    enabled: darfLaden('abschnitte'),
  });

  /**
   * Der ETB ist die einzige serverseitig gefilterte Quelle, mit ZWEI sich ausschließenden
   * Abfragewegen:
   *
   *  - eine gedruckte Kennung ('42', '#42') geht über den Cursor. Ein Sortenbuchstabe ('R-42',
   *    'S-42') schließt den ETB aus.
   *  - alles andere geht über den Volltext; `fts_query` sucht nicht über die laufende Nummer.
   *
   * Dritter Riegel am Volltext: ohne alphanumerisches Token nimmt das Backend den MATCH-Filter ganz
   * heraus und liefert die jüngsten Einträge. Bedingung und Begründung liegen im reinen Kern
   * (`etbVolltextMoeglich`), damit Abruf und Anzeige übereinstimmen.
   */
  const zahl = zahlAusSuche(rest);
  const nummerGesucht = zahl !== null && zahl.sorte === null ? zahl.nummer : null;

  const etbNummerQuery = useQuery({
    ...etbNummerAbfrage(id, nummerGesucht ?? 0),
    enabled: darfLaden('etbNummer') && nummerGesucht !== null,
  });
  const etbTextQuery = useQuery({
    queryKey: etbSuchSchluessel(id, rest),
    queryFn: () => listeEtb(id, { q: rest, limit: ETB_TEXT_DECKEL }),
    enabled: darfLaden('etbText') && zahl === null && etbVolltextMoeglich(rest),
    staleTime: FRISCH_MS,
    gcTime: ETB_SUCH_GC_MS,
  });
  /**
   * Die Zahl hinter dem Sammeltreffer, an denselben Riegeln wie der Volltext; ohne `q` zählte die
   * Route das ganze Tagebuch.
   */
  const etbAnzahlQuery = useQuery({
    queryKey: etbAnzahlSchluessel(id, rest),
    queryFn: () => zaehleEtb(id, { q: rest }),
    enabled: darfLaden('etbAnzahl') && zahl === null && etbVolltextMoeglich(rest),
    staleTime: FRISCH_MS,
    gcTime: ETB_SUCH_GC_MS,
  });

  /**
   * Über die Datenreferenzen memoisiert: das Ergebnis geht in ein `useMemo` des Aufrufers.
   */
  return useMemo<DatensatzQuellen>(
    () => ({
      personen: personenQuery.data,
      schaeden: schaedenQuery.data,
      uhs: uhsQuery.data,
      meldungen: meldungenQuery.data,
      auftraege: auftraegeQuery.data,
      fahrzeuge: fahrzeugeQuery.data,
      personal: personalQuery.data,
      einheiten: einheitenQuery.data,
      etbNummer: etbNummerQuery.data,
      etbText: etbTextQuery.data,
      etbAnzahl: etbAnzahlQuery.data,
      lageberichte: lageberichteQuery.data,
      gefahrengebiete: gefahrengebieteQuery.data,
      abschnitte: abschnitteQuery.data,
    }),
    [
      personenQuery.data,
      schaedenQuery.data,
      uhsQuery.data,
      meldungenQuery.data,
      auftraegeQuery.data,
      fahrzeugeQuery.data,
      personalQuery.data,
      einheitenQuery.data,
      etbNummerQuery.data,
      etbTextQuery.data,
      etbAnzahlQuery.data,
      lageberichteQuery.data,
      gefahrengebieteQuery.data,
      abschnitteQuery.data,
    ],
  );
}

/**
 * Beschaffung UND reiner Kern in einem Griff, für den `PaletteHost`. HIER statt im Provider, weil
 * auch der Abruf der Sichtbarkeits-Overrides an `datensatzAbrufAktiv` hängen muss; ohne die
 * Riegel feuerte er beim bloßen Öffnen der Palette auf jeder Modulseite. Der zweite Beobachter
 * auf `modulOverrides` kostet keinen zweiten Request.
 */
export function useDatensatzTreffer({
  einsatzId,
  modus,
  suche,
  aktuellerModulKey,
  navigate,
}: DatensatzAbruf & {
  aktuellerModulKey: string | null;
  navigate: DatensatzKontext['navigate'];
}): Treffer[] {
  const { benutzer } = useAuth();
  const quellen = useDatensaetze({ einsatzId, modus, suche });
  const { data: overrides } = useQuery({
    queryKey: einsatzKeys.modulOverrides(einsatzId),
    queryFn: () => ladeModulOverrides(einsatzId!),
    enabled: datensatzAbrufAktiv({ einsatzId, modus, suche }),
    staleTime: FRISCH_MS,
  });

  // `aktuellerModulKey` gehört NICHT in `DatensatzAbruf`: er entscheidet nur die Rangfolge. Dort
  // hinge das `enabled` der Abrufe an ihm, und ein Modulwechsel startete sie neu.
  return useMemo(
    () =>
      einsatzId == null
        ? LEER
        : baueDatensatzTreffer({
            einsatzId,
            modus,
            suche,
            benutzer,
            overrides,
            aktuellerModulKey,
            navigate,
            quellen,
          }),
    [einsatzId, modus, suche, benutzer, overrides, aktuellerModulKey, navigate, quellen],
  );
}

/**
 * EIN Leer-Array für alle Runden ohne Einsatz; ein `[]` im Rückgabeausdruck wäre je Render eine
 * neue Identität und machte das `useMemo` im Aufrufer wirkungslos.
 */
const LEER: Treffer[] = [];
