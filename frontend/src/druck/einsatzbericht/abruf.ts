import { ApiError } from '../../api/client';
import { ladeBetreuung } from '../../api/betreuung';
import { ladeEinsatz, ladeMitglieder } from '../../api/einsaetze';
import { listeEinheiten } from '../../api/einheiten';
import { listeEinsatzFahrzeuge } from '../../api/einsatzFahrzeuge';
import { listePersonen } from '../../api/einsatzPerson';
import { listeEinsatzPersonal } from '../../api/einsatzPersonal';
import { listeSchaeden } from '../../api/einsatzSchaden';
import { ladeEtbZaehler } from '../../api/etb';
import { listeEinheitenPerioden, listePersonalPerioden } from '../../api/kraefteZeitachse';
import { listeLageberichte } from '../../api/lageberichte';
import { ladeLagebesprechungen, ladeStab } from '../../api/stab';
import { ladeVerpflegung } from '../../api/verpflegung';
import { ladeEtbVollstaendig } from '../../etb/druckAbruf';
import { QUELLEN, modulLabel, type QuellenFreigabe, type QuellenSchluessel } from './quellen';

/**
 * Abruf des Einsatzberichts (LFH-726, design.md D4): alle freigegebenen Quellen parallel, EIN
 * Stand. Nie verworfen wird das Ganze wegen einer Quelle — jede trägt ihren eigenen Zustand, und
 * die Seite entscheidet, ob gedruckt werden darf (Spec „Vollständig oder gar nicht“).
 *
 * Eine Quelle auf `gesperrt`, `nicht-genutzt` oder `nicht-gewaehlt` geht nicht ans Netz: ein Abruf ergäbe nur ein
 * 403 und am Server einen Fehlversuch ohne Erkenntnis.
 */

/** Die Abruffunktionen je Quelle. Die Entscheidungen kommen vollständig, nicht gedeckelt. */
const ABRUF = {
  einsatz: ladeEinsatz,
  mitglieder: ladeMitglieder,
  stab: ladeStab,
  lagebesprechungen: ladeLagebesprechungen,
  einheiten: listeEinheiten,
  einheitenPerioden: listeEinheitenPerioden,
  personal: listeEinsatzPersonal,
  personalPerioden: listePersonalPerioden,
  fahrzeuge: listeEinsatzFahrzeuge,
  lageberichte: listeLageberichte,
  personen: (id: number) => listePersonen(id),
  schaeden: (id: number) => listeSchaeden(id),
  betreuung: ladeBetreuung,
  verpflegung: ladeVerpflegung,
  etbZaehler: (id: number) => ladeEtbZaehler(id),
  etbEntscheidungen: (id: number) => ladeEtbVollstaendig(id, { typ: 'entscheidung' }),
} satisfies Record<QuellenSchluessel, (einsatzId: number) => Promise<unknown>>;

type Abruf = typeof ABRUF;

export type QuellenErgebnis<T> =
  | { zustand: 'daten'; daten: T }
  | { zustand: 'fehler'; fehler: unknown }
  /** 403: gesperrt, Org-Vorgabe oder Aufbewahrungsfrist — nie ein leerer Bestand. */
  | { zustand: 'kein-zugriff' }
  | { zustand: 'nicht-genutzt' }
  /** Kein gewählter Block schöpft daraus (LFH-902) — nicht abgerufen. */
  | { zustand: 'nicht-gewaehlt' };

export type BerichtQuellen = {
  [K in QuellenSchluessel]: QuellenErgebnis<Awaited<ReturnType<Abruf[K]>>>;
};

export interface EinsatzberichtRoh {
  quellen: BerichtQuellen;
  /** Stand des Schnappschusses (ISO, UTC): Beginn des Abrufs. */
  geladenAt: string;
}

async function eineQuelle<T>(
  freigabe: QuellenFreigabe,
  laden: () => Promise<T>,
): Promise<QuellenErgebnis<T>> {
  if (freigabe === 'nicht-genutzt') return { zustand: 'nicht-genutzt' };
  if (freigabe === 'nicht-gewaehlt') return { zustand: 'nicht-gewaehlt' };
  if (freigabe === 'gesperrt') return { zustand: 'kein-zugriff' };
  try {
    return { zustand: 'daten', daten: await laden() };
  } catch (fehler) {
    if (fehler instanceof ApiError && fehler.status === 403) return { zustand: 'kein-zugriff' };
    return { zustand: 'fehler', fehler };
  }
}

export async function ladeEinsatzbericht(
  einsatzId: number,
  freigabe: Record<QuellenSchluessel, QuellenFreigabe>,
): Promise<EinsatzberichtRoh> {
  const geladenAt = new Date().toISOString();
  const schluessel = Object.keys(ABRUF) as QuellenSchluessel[];
  const ergebnisse = await Promise.all(
    // Je Schlüssel stimmt der Typ (`BerichtQuellen`); über die Union hinweg kann TS ihn nicht
    // verfolgen, daher `unknown` im Durchlauf und die Zusicherung beim Zusammensetzen.
    schluessel.map((k) =>
      eineQuelle<unknown>(freigabe[k], () => ABRUF[k](einsatzId) as Promise<unknown>),
    ),
  );
  const quellen = Object.fromEntries(
    schluessel.map((k, i) => [k, ergebnisse[i]]),
  ) as BerichtQuellen;
  return { quellen, geladenAt };
}

export type BerichtZustand =
  | { art: 'bereit' }
  /** Mindestens eine Quelle antwortete 403 — Drucken ausgeschlossen, ein neuer Versuch hilft nicht. */
  | { art: 'kein-zugriff'; module: string[] }
  /** Mindestens eine Quelle scheiterte — Drucken gesperrt bis zum gelungenen neuen Versuch. */
  | { art: 'fehler'; module: string[] };

/**
 * Darf gedruckt werden? Nur wenn jede Quelle `daten`, `nicht-genutzt` oder `nicht-gewaehlt` trägt (Spec „Vollständig
 * oder gar nicht“). „Kein Zugriff“ geht dem Fehler vor: der Grund gilt auch nach einem neuen
 * Versuch (wie `schlechtesterZustand` in `api/abrufZustand.ts`).
 */
export function berichtZustand(roh: EinsatzberichtRoh): BerichtZustand {
  const module = (art: 'kein-zugriff' | 'fehler') => {
    const namen: string[] = [];
    for (const q of QUELLEN) {
      if (roh.quellen[q.schluessel].zustand !== art) continue;
      const name = modulLabel(q.modul);
      if (!namen.includes(name)) namen.push(name);
    }
    return namen;
  };
  const ohneZugriff = module('kein-zugriff');
  if (ohneZugriff.length > 0) return { art: 'kein-zugriff', module: ohneZugriff };
  const gescheitert = module('fehler');
  if (gescheitert.length > 0) return { art: 'fehler', module: gescheitert };
  return { art: 'bereit' };
}
