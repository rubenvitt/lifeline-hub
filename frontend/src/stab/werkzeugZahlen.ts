import { abrufZustand, type AbrufZustand } from '../api/abrufZustand';
import type { MedienkontaktKennzahlen } from '../api/types';
import { modulRegistry, type ModulEintrag } from '../einsatz/modulRegistry';
import { bildeZaehler, ZAEHLER_QUELLEN } from '../einsatz/useModulZaehler';
import {
  auftraegeNotiz,
  auftragsStand,
  meldungenNotiz,
  nachforderungenNotiz,
  NICHT_FREIGEGEBEN,
  type ZaehlerAbfrage,
} from '../pages/lage-dashboard/fuehrungsZahlen';
import { ZUSTAND_GRUND } from './funkplan';
import type { SichtbaresWerkzeug } from './werkzeuge';

/** Was eine Werkzeugzelle als Zahl zeigt. `laden`/`fehler` tragen keinen Wert. */
export type WerkzeugZahl =
  | {
      zustand: 'daten';
      /** Die Zahl, oder „—“, wenn die Quelle fehlt (dann nennt `notiz` den Grund). */
      wert: string;
      notiz?: string;
      ton: 'neutral' | 'achtung';
      /** Voller Wortlaut für Vorleser und `title`, wie im Modulmenü. */
      beschreibung?: string;
    }
  | { zustand: 'laden' | 'fehler'; notiz: string };

/** Die Quellen der Zahlen, je einmal auf der Seite geladen. */
export interface WerkzeugZahlQuellen {
  /** `GET …/modul-zaehler`, dieselbe Abfrage wie das Modulmenü. */
  zaehler: ZaehlerAbfrage;
  /** `GET …/stab/medienkontakte/kennzahlen` (LFH-1075, über den ganzen Bestand). */
  presse: {
    data: MedienkontaktKennzahlen | undefined;
    error: unknown;
    isError: boolean;
    isPending: boolean;
  };
  /** `stab/useFunkplanLuecken.ts`. */
  funkplan: { zustand: AbrufZustand; anzahl: number | null };
  /**
   * Ohne Netz pausiert ein Abruf ohne Stand und stünde für immer auf „lädt“; dann ist er „nicht
   * geladen“, wie in `useNetzQuellen` (die Presse-Kennzahlen liegen nicht in `LAGEBILD_OFFLINE`).
   */
  ohneVerbindung?: boolean;
}

/** Zustand einer Abfrage, ohne Netz und ohne Stand „nicht geladen“ statt „lädt“. */
function quellZustand(
  q: { data: unknown; error: unknown; isError: boolean; isPending: boolean },
  ohneVerbindung: boolean | undefined,
): AbrufZustand {
  return q.data == null && ohneVerbindung ? 'fehler' : abrufZustand(q);
}

const SERVER_QUELLEN = new Set<string>(ZAEHLER_QUELLEN);

/** Eine fehlende Quelle als Zahl: „—“ mit Grund, nie 0. */
function ohneZahl(zustand: Exclude<AbrufZustand, 'daten'>): WerkzeugZahl {
  if (zustand === 'gesperrt') {
    return { zustand: 'daten', wert: '—', notiz: NICHT_FREIGEGEBEN, ton: 'neutral' };
  }
  return { zustand, notiz: ZUSTAND_GRUND[zustand] };
}

/**
 * Die eine Zahl eines Werkzeugs der Stab-Seite, nur aus einer Quelle, die die Zahl schon führt
 * (`openspec/changes/archive/2026-10-13-o5nxgqbl-stab-uebersicht/design.md`, D4; `frontend/AGENTS.md`, „Eine Heimat je
 * Zahl“). Die Seite zählt nichts selbst:
 * - ein Modul mit Server-Zähler: Zahl und Wortlaut aus `bildeZaehler` wie im Modulmenü; Aufträge
 *   und Meldungen mit der Notiz des Führungsstands (`fuehrungsZahlen.ts`), überfällige Aufträge
 *   als Achtung; Nachforderungen mit „n unterwegs“;
 * - „Pressearbeit“: die offenen Anfragen des Presse-Logs;
 * - „Funkplan“: die Zahl der Lücken (`countLuecken`).
 *
 * `null` heißt: keine Quelle, keine Zahl. Ein gesperrtes Werkzeug trägt nie eine.
 */
export function werkzeugZahl(
  werkzeug: SichtbaresWerkzeug,
  quellen: WerkzeugZahlQuellen,
  register: ModulEintrag[] = modulRegistry,
): WerkzeugZahl | null {
  if (werkzeug.zustand === 'gesperrt') return null;

  if (werkzeug.key === 'presse') {
    const zustand = quellZustand(quellen.presse, quellen.ohneVerbindung);
    if (zustand !== 'daten' || !quellen.presse.data)
      return ohneZahl(zustand === 'daten' ? 'laden' : zustand);
    return {
      zustand: 'daten',
      wert: String(quellen.presse.data.offene_anfragen),
      notiz: 'offene Anfragen',
      ton: 'neutral',
    };
  }

  if (werkzeug.key === 'funkplan') {
    const { zustand, anzahl } = quellen.funkplan;
    if (zustand !== 'daten' || anzahl == null)
      return ohneZahl(zustand === 'daten' ? 'laden' : zustand);
    return {
      zustand: 'daten',
      wert: String(anzahl),
      notiz: anzahl === 1 ? 'Lücke' : 'Lücken',
      ton: 'neutral',
    };
  }

  const quelle = register.find((m) => m.key === werkzeug.key)?.zaehlerQuelle;
  if (quelle == null || !SERVER_QUELLEN.has(quelle)) return null;
  const zustand = quellZustand(quellen.zaehler, quellen.ohneVerbindung);
  if (zustand !== 'daten' || !quellen.zaehler.data)
    return ohneZahl(zustand === 'daten' ? 'laden' : zustand);
  const anzeige = bildeZaehler(quellen.zaehler.data)[quelle];
  if (!anzeige) return ohneZahl('gesperrt');

  const basis = {
    zustand: 'daten' as const,
    wert: String(anzeige.wert),
    beschreibung: anzeige.beschreibung,
    ton: 'neutral' as const,
  };
  if (quelle === 'auftraege') {
    const stand = auftragsStand(quellen.zaehler);
    if (stand.zustand !== 'daten') return basis;
    return {
      ...basis,
      notiz: auftraegeNotiz(stand.zahl),
      ton: stand.zahl.ueberfaellig > 0 ? 'achtung' : 'neutral',
    };
  }
  if (quelle === 'meldungen' && quellen.zaehler.data.meldungen) {
    return { ...basis, notiz: meldungenNotiz(quellen.zaehler.data.meldungen) };
  }
  // LLH-1078: die offenen, davon unterwegs — dieselbe Notiz wie im Seitenkopf der Nachforderungen
  // und auf der Lagekennzahl im Band (LLH-1371).
  if (quelle === 'nachforderungen' && quellen.zaehler.data.nachforderungen) {
    return { ...basis, notiz: nachforderungenNotiz(quellen.zaehler.data.nachforderungen) };
  }
  return basis;
}
