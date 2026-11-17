import { ZUSTAND_GRUND, type AbrufZustand } from '../../api/abrufZustand';
import type { EinsatzAnzeige, ModulFreigaben } from '../../api/types';
import { einsatzleiterAusAngabe, einsatzleiterKurz } from '../../einsatz/einsatzleiter';
import { istKeyFreigegeben } from '../../einsatz/modulRegistry';
import {
  einheitenPfad,
  einsatzabschnittePfad,
  einsatzdatenPfad,
  etbPfad,
} from '../../routing/deeplinks';

/**
 * Startliste im Überblick (LLH-1815, Spec `ueberblick-startliste`, design.md D1): fünf Punkte, die
 * einen neuen Einsatz arbeitsfähig machen. Rein und ohne Server: jeder Punkt leitet sich aus
 * Quellen ab, die der Überblick ohnehin lädt (dazu die jüngste Lagefeststellung).
 *
 * - `erledigt`: die Regel der Spec ist erfüllt; Einsatzort und Einsatzleiter tragen ihren Wert.
 * - `offen`: noch nicht erfasst; der Punkt springt in seine Erfassung (`ziel`).
 * - `gesperrt`: das Modul des Punkts ist für die Person nicht frei (gesperrt oder ausgeblendet);
 *   „—“ mit Grund, ohne Sprung, und zählt beim Verschwinden nicht als offen.
 * - `unbekannt`: eine Quelle fehlt (Fehler, lädt); nie offen oder erledigt, die Liste bleibt.
 *
 * Kein Zähler: die Startliste zeigt Haken, keine Kennzahl (Spec `lage-verdichtung`).
 */

export type StartPunktSchluessel =
  'einsatzort' | 'einsatzleiter' | 'einsatzabschnitte' | 'kraefte' | 'lage';

export type StartPunktZustand = 'erledigt' | 'offen' | 'gesperrt' | 'unbekannt';

export interface StartPunkt {
  schluessel: StartPunktSchluessel;
  titel: string;
  zustand: StartPunktZustand;
  /** Erfasster Wert (Ortstext, Name des Einsatzleiters); nur bei `erledigt`. */
  wert?: string;
  /** Zusatz zum Wert („nicht verortet“). */
  zusatz?: string;
  /** Grund bei `gesperrt` und `unbekannt`. */
  grund?: string;
  /** Sprung in die Erfassung; nur bei `offen`. */
  ziel?: string;
}

/** Eine Quelle, wie die Seite sie reicht: Daten nur aus einem gelungenen Abruf. */
export type StartQuelle<T> =
  { zustand: 'daten'; daten: T } | { zustand: Exclude<AbrufZustand, 'daten'> };

export type StartEinsatzkopf = Pick<
  EinsatzAnzeige,
  'einsatzort' | 'einsatzort_lat' | 'einsatzort_lon' | 'einsatzleiter'
>;

export interface StartlisteQuellen {
  einsatzId: number;
  einsatz: StartQuelle<StartEinsatzkopf>;
  abschnitte: StartQuelle<readonly unknown[]>;
  einheiten: StartQuelle<readonly unknown[]>;
  personal: StartQuelle<readonly unknown[]>;
  /** ETB-Einträge vom Typ „Lage“ (die Seite fragt höchstens einen ab). */
  lage: StartQuelle<readonly unknown[]>;
  /** Modulfreigaben des Servers; `undefined`, solange sie unbekannt sind (dann sperrt nichts). */
  freigaben: ModulFreigaben | undefined;
}

/**
 * Das Modul je Punkt, an dem die Sperre hängt (Schlüssel der Modul-Registry). Kräfte hängen am
 * Ziel des Sprungs, den Einheiten.
 */
export const STARTLISTE_MODUL: Record<StartPunktSchluessel, string> = {
  einsatzort: 'einsatzdaten',
  einsatzleiter: 'einsatzdaten',
  einsatzabschnitte: 'einsatzabschnitte',
  kraefte: 'einheiten',
  lage: 'etb',
};

const TITEL: Record<StartPunktSchluessel, string> = {
  einsatzort: 'Einsatzort',
  einsatzleiter: 'Einsatzleiter',
  einsatzabschnitte: 'Einsatzabschnitte',
  kraefte: 'Kräfte',
  lage: 'Erste Lagefeststellung',
};

/** Zusatz eines Einsatzorts ohne Koordinate. */
export const NICHT_VERORTET = 'nicht verortet';

/** Ergebnis der Regel eines Punkts, bevor Sperre und Ziel dazukommen. */
type Befund =
  | { zustand: 'erledigt'; wert?: string; zusatz?: string }
  | { zustand: 'offen' }
  | { zustand: 'unbekannt' };

const UNBEKANNT: Befund = { zustand: 'unbekannt' };
const OFFEN: Befund = { zustand: 'offen' };

/** Eine Liste mit mindestens einem Eintrag; `undefined`, wenn die Quelle nichts weiß. */
function hatEintrag(q: StartQuelle<readonly unknown[]>): boolean | undefined {
  return q.zustand === 'daten' ? q.daten.length > 0 : undefined;
}

function einsatzortBefund(q: StartQuelle<StartEinsatzkopf>): Befund {
  if (q.zustand !== 'daten') return UNBEKANNT;
  const ort = q.daten.einsatzort?.trim();
  if (!ort) return OFFEN;
  const verortet = q.daten.einsatzort_lat != null && q.daten.einsatzort_lon != null;
  return verortet
    ? { zustand: 'erledigt', wert: ort }
    : { zustand: 'erledigt', wert: ort, zusatz: NICHT_VERORTET };
}

function einsatzleiterBefund(q: StartQuelle<StartEinsatzkopf>): Befund {
  if (q.zustand !== 'daten') return UNBEKANNT;
  const darstellung = einsatzleiterAusAngabe(q.daten.einsatzleiter);
  return darstellung.art === 'erfasst'
    ? { zustand: 'erledigt', wert: einsatzleiterKurz(darstellung) }
    : OFFEN;
}

function listenBefund(q: StartQuelle<readonly unknown[]>): Befund {
  const da = hatEintrag(q);
  return da === undefined ? UNBEKANNT : da ? { zustand: 'erledigt' } : OFFEN;
}

/**
 * Kräfte: eine Einheit ODER eine Einsatzkraft. Eine gesperrte Personalliste trägt nichts bei (der
 * Weg in die Einheiten steht); eine ausgefallene macht „keine Einheit“ zu keiner Aussage.
 */
function kraefteBefund(
  einheiten: StartQuelle<readonly unknown[]>,
  personal: StartQuelle<readonly unknown[]>,
): Befund {
  const e = hatEintrag(einheiten);
  const p = personal.zustand === 'gesperrt' ? false : hatEintrag(personal);
  if (e === true || p === true) return { zustand: 'erledigt' };
  if (e === undefined || p === undefined) return UNBEKANNT;
  return OFFEN;
}

function ziel(schluessel: StartPunktSchluessel, einsatzId: number): string {
  switch (schluessel) {
    case 'einsatzort':
      return einsatzdatenPfad(einsatzId, { paneel: 'einsatzort' });
    case 'einsatzleiter':
      return einsatzdatenPfad(einsatzId, { paneel: 'fuehrungsstelle' });
    case 'einsatzabschnitte':
      return einsatzabschnittePfad(einsatzId, { neu: true });
    case 'kraefte':
      return einheitenPfad(einsatzId);
    case 'lage':
      return etbPfad(einsatzId, { neu: true });
  }
}

/** Die fünf Punkte in der Reihenfolge der Spec. */
export function startliste(q: StartlisteQuellen): StartPunkt[] {
  const befunde: [StartPunktSchluessel, Befund][] = [
    ['einsatzort', einsatzortBefund(q.einsatz)],
    ['einsatzleiter', einsatzleiterBefund(q.einsatz)],
    ['einsatzabschnitte', listenBefund(q.abschnitte)],
    ['kraefte', kraefteBefund(q.einheiten, q.personal)],
    ['lage', listenBefund(q.lage)],
  ];
  return befunde.map(([schluessel, befund]): StartPunkt => {
    const titel = TITEL[schluessel];
    // Gesperrt nur, wenn der Server es sagt; unbekannte Freigaben sperren nichts (die Quellen der
    // gebundenen Punkte stehen dann selbst als Fehler oder Laden).
    if (q.freigaben && !istKeyFreigegeben(STARTLISTE_MODUL[schluessel], q.freigaben)) {
      return { schluessel, titel, zustand: 'gesperrt', grund: ZUSTAND_GRUND.gesperrt };
    }
    switch (befund.zustand) {
      case 'erledigt':
        return { schluessel, titel, ...befund };
      case 'offen':
        return { schluessel, titel, zustand: 'offen', ziel: ziel(schluessel, q.einsatzId) };
      case 'unbekannt':
        return { schluessel, titel, zustand: 'unbekannt', grund: ZUSTAND_GRUND.fehler };
    }
  });
}

/** Steht die Startliste? Wahr, solange ein Punkt offen oder unbekannt ist. */
export function startlisteOffen(punkte: readonly StartPunkt[]): boolean {
  return punkte.some((p) => p.zustand === 'offen' || p.zustand === 'unbekannt');
}
