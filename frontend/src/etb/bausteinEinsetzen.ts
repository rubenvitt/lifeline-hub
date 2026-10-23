import { serverJetzt } from '../offline/serveruhr';
import { DEFAULT_KONVENTIONEN, type AnzeigeKonventionen } from '../anzeige/format';
import { datum, uhrzeit } from '../anzeige/zeitDarstellung';
import type { EtbBaustein, EinsatzAnzeige, EtbTyp, MeldeWeg } from '../api/types';

const TOKEN = () => /\{([a-z0-9_]+)\}/g;

export interface BausteinFelder {
  typ: EtbTyp;
  inhalt: string;
  meldeweg?: MeldeWeg;
  veranlassung?: string;
}

/** Metadaten eines vorkonfigurierten (automatisch befüllten) Platzhalters. */
interface AutoPlatzhalter {
  /** Name innerhalb der geschweiften Klammern, z. B. `uhrzeit` für `{uhrzeit}`. */
  name: string;
  /** Kurzbeschreibung des automatisch eingesetzten Werts (für die Admin-UI). */
  beschreibung: string;
  /**
   * Liefert den aktuellen Wert oder null/undefined, wenn er für den Einsatz fehlt. `konv` sind die
   * Anzeigekonventionen (Zone, `null` = Browserzone, und Darstellung): Datum und Uhrzeit landen im
   * ETB-Text und stehen in derselben Zone (LFH-692) und Schreibweise (LLH-1061) wie jede andere
   * Zeit dort.
   */
  wert: (einsatz: EinsatzAnzeige, konv: AnzeigeKonventionen) => string | null | undefined;
}

/**
 * Vorkonfigurierte Platzhalter, die beim Einsetzen automatisch aus Datum/Uhrzeit
 * bzw. dem Einsatz befüllt werden. Single Source of Truth für Engine UND Admin-UI. Datum und
 * Uhrzeit nach der Serveruhr, wie die Ereigniszeit desselben Eintrags (LFH-895).
 */
export const AUTO_PLATZHALTER: AutoPlatzhalter[] = [
  {
    name: 'datum',
    beschreibung: 'Aktuelles Datum (taktisch 10okt26, sonst 10.10.26)',
    wert: (_e, konv) => datum(serverJetzt(), konv),
  },
  {
    name: 'uhrzeit',
    beschreibung: 'Aktuelle Uhrzeit (taktisch 1430, sonst 14:30)',
    wert: (_e, konv) => uhrzeit(serverJetzt(), konv),
  },
  { name: 'einsatzort', beschreibung: 'Einsatzort', wert: (e) => e.einsatzort },
  { name: 'stichwort', beschreibung: 'Stichwort', wert: (e) => e.stichwort },
  { name: 'einsatz', beschreibung: 'Einsatzbezeichnung', wert: (e) => e.bezeichnung },
  { name: 'einsatznr', beschreibung: 'Leitstellen-Nummer', wert: (e) => e.leitstellen_nr },
];

const AUTO_MAP = new Map(AUTO_PLATZHALTER.map((p) => [p.name, p.wert]));

/** Liefert für jeden Auto-Whitelist-Platzhalter den Wert, oder undefined wenn kein Auto-Platzhalter. */
function autoWert(
  name: string,
  einsatz: EinsatzAnzeige,
  konv: AnzeigeKonventionen,
): string | null | undefined {
  const fn = AUTO_MAP.get(name);
  return fn ? fn(einsatz, konv) : undefined;
}

function istLeer(wert: string | null | undefined): boolean {
  return wert === null || wert === undefined || wert === '';
}

function tokensVon(...texte: (string | null | undefined)[]): string[] {
  const namen: string[] = [];
  for (const text of texte) {
    if (!text) continue;
    for (const m of text.matchAll(TOKEN())) {
      if (!namen.includes(m[1])) namen.push(m[1]);
    }
  }
  return namen;
}

/**
 * Manuelle Platzhalter (eindeutig, in Vorkommens-Reihenfolge): alle Tokens, die
 * KEINE Auto-Platzhalter sind ODER deren Auto-Wert leer/null ist (Herabstufung).
 */
export function ermittlePlatzhalter(
  baustein: EtbBaustein,
  einsatz: EinsatzAnzeige,
  konv: AnzeigeKonventionen = DEFAULT_KONVENTIONEN,
): string[] {
  return tokensVon(baustein.inhalt, baustein.veranlassung).filter((name) => {
    const auto = autoWert(name, einsatz, konv);
    if (auto === undefined) return true; // manuell
    return istLeer(auto); // herabgestuft, wenn Auto-Wert fehlt
  });
}

function substituiere(
  text: string,
  einsatz: EinsatzAnzeige,
  manuelleWerte: Record<string, string>,
  konv: AnzeigeKonventionen,
): string {
  return text.replace(TOKEN(), (_treffer, name: string) => {
    const auto = autoWert(name, einsatz, konv);
    if (auto !== undefined && !istLeer(auto)) return auto as string;
    return manuelleWerte[name] ?? '';
  });
}

/** Substituiert Auto- + manuelle Platzhalter und liefert die zu setzenden Formularfelder. */
export function setzeBausteinEin(
  baustein: EtbBaustein,
  einsatz: EinsatzAnzeige,
  manuelleWerte: Record<string, string>,
  konv: AnzeigeKonventionen = DEFAULT_KONVENTIONEN,
): BausteinFelder {
  const felder: BausteinFelder = {
    typ: baustein.typ,
    inhalt: substituiere(baustein.inhalt, einsatz, manuelleWerte, konv),
  };
  if (baustein.meldeweg) felder.meldeweg = baustein.meldeweg;
  if (baustein.veranlassung) {
    felder.veranlassung = substituiere(baustein.veranlassung, einsatz, manuelleWerte, konv);
  }
  return felder;
}
