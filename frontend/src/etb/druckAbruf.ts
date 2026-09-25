import { listeEtb, type EtbFilterWerte } from '../api/etb';
import type { EtbEintragAnzeige } from '../api/types';

/** Seitengröße des Vollabrufs = `MAX_LIMIT` der Liste (`src/etb/repo.rs`). */
export const DRUCK_SEITE = 500;

export interface EtbDruckStand {
  /** Alle Einträge der Auswahl, in Serverordnung (`lfd_nr` absteigend). */
  eintraege: EtbEintragAnzeige[];
  /**
   * Alle Berichtigungen des Tagebuchs — nur bei aktivem Filter, der nicht selbst auf
   * Berichtigungen zielt; sonst stecken sie schon in `eintraege` und das Feld ist leer.
   */
  berichtigungen: EtbEintragAnzeige[];
  /** Höchste laufende Nummer der Auswahl (Stand des Schnappschusses); `null` bei leerer. */
  hoechsteLfdNr: number | null;
  /** Zeitpunkt des Ladens (ISO, UTC). */
  geladenAt: string;
}

/** Ein Filter ist aktiv, sobald eines seiner Merkmale gesetzt ist. */
function filterAktiv(filter: EtbFilterWerte): boolean {
  return Boolean(
    filter.q ||
    filter.typ ||
    filter.von ||
    filter.bis ||
    filter.erfasser_id != null ||
    filter.einheit_id != null,
  );
}

/** Alle Seiten einer Auswahl über den Cursor `before_lfd_nr`. */
async function alleSeiten(
  einsatzId: number,
  filter: EtbFilterWerte,
  melde: (geladen: number) => void,
): Promise<EtbEintragAnzeige[]> {
  const alle: EtbEintragAnzeige[] = [];
  let cursor: number | undefined;
  for (;;) {
    const seite = await listeEtb(einsatzId, {
      ...filter,
      limit: DRUCK_SEITE,
      ...(cursor != null ? { before_lfd_nr: cursor } : {}),
    });
    // Riegel: liefert eine Seite eine Nummer NICHT unterhalb des Cursors, liefe die
    // Schleife ewig (oder druckte Einträge doppelt). Lieber laut abbrechen.
    if (cursor != null && seite.some((e) => e.lfd_nr >= cursor!)) {
      throw new Error(`ETB-Vollabruf: Seite liefert Nummern nicht unterhalb des Cursors ${cursor}`);
    }
    alle.push(...seite);
    melde(alle.length);
    if (seite.length < DRUCK_SEITE) return alle;
    cursor = Math.min(...seite.map((e) => e.lfd_nr));
  }
}

/**
 * Lädt ALLE Einträge einer ETB-Auswahl für die Druckansicht (LFH-22, design.md D4).
 *
 * Über die bestehende Liste (`listeEtb`), nicht über einen eigenen Endpunkt: Gates und
 * Filterbedingung sind damit per Konstruktion dieselben wie am Bildschirm, und es gibt
 * genau EINE Abbildung Filter → Query (`api/etb.ts:filterParameter`). 1 200 Einträge sind
 * drei Anfragen.
 *
 * SCHNAPPSCHUSS: Die Schleife geht nach unten; neuere Einträge haben höhere Nummern und
 * kommen nicht dazu. `lfd_nr` wird nie nachträglich vergeben, der Stand ist konsistent.
 *
 * Scheitert eine Seite, wirft die Funktion — ein Teilergebnis gibt es nicht, denn ein
 * Teilausdruck eines Tagebuchs wäre eine falsche Beweisunterlage.
 *
 * BERICHTIGUNGS-DURCHGANG: Ist ein Filter aktiv (und zielt nicht selbst auf
 * Berichtigungen), fehlen einem gedruckten Eintrag sonst die Berichtigungen, die außerhalb
 * der Auswahl liegen — „berichtigt durch Nr. m" ginge verloren.
 *
 * BEKANNTE UNSCHÄRFE, bewusst hingenommen (Review Welle B): der Durchgang läuft NACH der
 * Hauptschleife. Wird dazwischen eine Berichtigung geschrieben, kann ein gedruckter Eintrag
 * „berichtigt durch Nr. m" tragen, obwohl der Kopf „bis Nr. X" mit X < m nennt. Falsch ist
 * das nicht — die Berichtigung existiert, und sie ist neuer als der Stand der Liste —, der
 * Kopf deckt sie nur nicht ab. Eine Kappung auf X verschwiege eine vorhandene Berichtigung
 * auf einer Beweisunterlage; das wiegt schwerer als die Unschärfe im Kopf.
 */
export async function ladeEtbVollstaendig(
  einsatzId: number,
  filter: EtbFilterWerte,
  optionen: { onFortschritt?: (geladen: number) => void } = {},
): Promise<EtbDruckStand> {
  const melde = optionen.onFortschritt ?? (() => {});
  const eintraege = await alleSeiten(einsatzId, filter, melde);
  const berichtigungen =
    filterAktiv(filter) && filter.typ !== 'berichtigung'
      ? await alleSeiten(einsatzId, { typ: 'berichtigung' }, () => {})
      : [];
  return {
    eintraege,
    berichtigungen,
    hoechsteLfdNr: eintraege.length > 0 ? Math.max(...eintraege.map((e) => e.lfd_nr)) : null,
    geladenAt: new Date().toISOString(),
  };
}
