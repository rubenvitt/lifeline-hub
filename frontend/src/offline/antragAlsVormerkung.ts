import type { SpiegelAntragAnzeige } from '../api/types';
import type { AusstehendeSchreibaktion, OfflineSchreibaktion } from './queue';

/**
 * Ein Antrag am Spiegel in der Form einer vorgemerkten Schreibaktion (LLH-1492, design.md D13,
 * Spec `spiegel-antraege`, „Anträge stehen dort, wo Vorgemerktes steht“). Die Fachseiten zeigen
 * ihn damit an derselben Stelle wie Vorgemerktes, getrennt von den Daten und nicht in deren
 * Kennzahlen; `antrag` sagt ihnen, dass „beantragt“ statt „vorgemerkt“ dasteht.
 */
export interface AntragKennung {
  id: number;
  /** `ausstehend`, `zugestellt` oder `uebernommen` (Zeile noch nicht im Spiegel). */
  zustand: string;
}

/** Wortlaut des Zustands an der Fachseite, neben „vorgemerkt“ der Warteschlange. */
export const BEANTRAGT_WORT = 'beantragt';

/**
 * Verweisfelder im Körper je Art, wie `BEANTRAGBAR` in `src/instanz/spiegel/antrag.rs` sie
 * übersetzt: der Server legt die Daten mit den Kennungen der führenden Instanz ab. Hier gelten sie
 * nichts und fallen weg, damit keine Seite einen Antrag an eine fremde Zeile hängt, die zufällig
 * dieselbe Kennung trägt.
 */
const VERWEISFELDER: Readonly<Record<string, readonly string[]>> = {
  etb: ['berichtigt_eintrag_id'],
  meldung: ['einheit_id', 'abschnitt_id'],
  person: ['uhs_id', 'bestaetigt_personal_id', 'versorgende_einheit_id', 'meldung_id'],
  sichtung: ['bestaetigt_personal_id'],
  verbleib: ['betreuungsstelle_id', 'bestaetigt_personal_id', 'einsatz_fahrzeug_id'],
  transport: ['bestaetigt_personal_id'],
  massnahme: ['bestaetigt_personal_id'],
  verletzung: ['bestaetigt_personal_id'],
  registrierung: ['haushalt_id'],
  abmeldung: ['haushalt_id', 'person_ids'],
  eintreffen: ['nachforderung_id', 'kraft', 'vorlage'],
  ausgabe: [
    'nachforderung_id',
    'verpflegungsstelle_id',
    'einheit_id',
    'abschnitt_id',
    'betreuungsstelle_id',
  ],
};

/** Die erfassten Daten ohne Verweise auf Zeilen der führenden Instanz. */
export function antragDatenOhneVerweise(art: string, daten: unknown): Record<string, unknown> {
  const kopie: Record<string, unknown> =
    daten != null && typeof daten === 'object' ? { ...(daten as Record<string, unknown>) } : {};
  for (const feld of VERWEISFELDER[art] ?? []) delete kopie[feld];
  return kopie;
}

/** Ganzzahl aus dem Ziel (`pid`, `sid`, `bid`, `zid`), sonst `-1` (passt zu keiner Zeile). */
function zielId(ziel: unknown, name: string): number {
  const wert =
    ziel != null && typeof ziel === 'object' ? (ziel as Record<string, unknown>)[name] : null;
  return typeof wert === 'number' ? wert : typeof wert === 'string' ? Number(wert) : -1;
}

/**
 * Die Aktion der Warteschlange, die diesem Antrag entspricht. Pfadziele kommen aus `ziel` (lokale
 * Kennungen), der Körper aus `daten` ohne Verweise. `bezeichnung` und `name` kennt der Antrag
 * nicht; sie bleiben leer, wie bei einer Zeile, die die Seite nicht benennen kann.
 */
function aktionAus(a: SpiegelAntragAnzeige): OfflineSchreibaktion | null {
  const daten = antragDatenOhneVerweise(a.art, a.daten) as never;
  switch (a.art) {
    case 'person':
    case 'meldung':
      return { art: a.art, daten };
    case 'stand':
      return { art: 'stand', bezirk_id: zielId(a.ziel, 'bid'), bezeichnung: '', daten };
    case 'belegung':
    case 'registrierung':
    case 'abmeldung':
      return { art: a.art, stelle_id: zielId(a.ziel, 'sid'), bezeichnung: '', daten };
    case 'ausgabe':
      return { art: 'ausgabe', zeitfenster_id: zielId(a.ziel, 'zid'), bezeichnung: '', daten };
    case 'eintreffen':
      return {
        art: 'eintreffen',
        br_id: zielId(a.ziel, 'bid'),
        bezeichnung: '',
        // Die Kraft nennt der Antrag nur über fremde Kennungen.
        name: 'Kraft',
        daten,
      };
    case 'sichtung':
    case 'anlass':
    case 'verbleib':
    case 'notiz':
    case 'transport':
    case 'massnahme':
    case 'verletzung':
      return { art: a.art, person_id: zielId(a.ziel, 'pid'), bezeichnung: '', daten };
    default:
      // `etb` hat eine eigene Zeitachse (`etb/etbZeile.ts`), unbekannte Arten bleiben im Band.
      return null;
  }
}

/** Eine vorgemerkte Schreibaktion, die ein Antrag am Spiegel ist. */
export type AntragAlsSchreibaktion = AusstehendeSchreibaktion & { antrag: AntragKennung };

/**
 * Offene Anträge (nicht abgelehnte) als vorgemerkte Schreibaktionen. Abgelehnte stehen mit Grund
 * im Hinweisband, nicht an der Fachseite: dort zählen sie wie Ablehnungen der Warteschlange.
 */
export function antraegeAlsSchreibaktionen(
  antraege: readonly SpiegelAntragAnzeige[],
  benutzerId: number,
  einsatzId: number,
): AntragAlsSchreibaktion[] {
  const ergebnis: AntragAlsSchreibaktion[] = [];
  for (const a of antraege) {
    if (a.zustand === 'abgelehnt') continue;
    const aktion = aktionAus(a);
    if (aktion == null) continue;
    ergebnis.push({
      benutzer_id: benutzerId,
      einsatz_id: einsatzId,
      aktion,
      erstellt_at: a.erfasst_at,
      antrag: { id: a.id, zustand: a.zustand },
    });
  }
  return ergebnis;
}
