import dayjs from 'dayjs';
import type { EtbBaustein, EinsatzAnzeige, EtbTyp, MeldeWeg } from '../api/types';

const TOKEN = () => /\{([a-z0-9_]+)\}/g;

export interface BausteinFelder {
  typ: EtbTyp;
  inhalt: string;
  meldeweg?: MeldeWeg;
  veranlassung?: string;
}

/** Metadaten eines vorkonfigurierten (automatisch befüllten) Platzhalters. */
export interface AutoPlatzhalter {
  /** Name innerhalb der geschweiften Klammern, z. B. `uhrzeit` für `{uhrzeit}`. */
  name: string;
  /** Kurzbeschreibung des automatisch eingesetzten Werts (für die Admin-UI). */
  beschreibung: string;
  /** Liefert den aktuellen Wert oder null/undefined, wenn er für den Einsatz fehlt. */
  wert: (einsatz: EinsatzAnzeige) => string | null | undefined;
}

/**
 * Vorkonfigurierte Platzhalter, die beim Einsetzen automatisch aus Datum/Uhrzeit
 * bzw. dem Einsatz befüllt werden. Single Source of Truth für Engine UND Admin-UI.
 */
export const AUTO_PLATZHALTER: AutoPlatzhalter[] = [
  { name: 'datum', beschreibung: 'Aktuelles Datum (TT.MM.JJJJ)', wert: () => dayjs().format('DD.MM.YYYY') },
  { name: 'uhrzeit', beschreibung: 'Aktuelle Uhrzeit (HH:MM)', wert: () => dayjs().format('HH:mm') },
  { name: 'einsatzort', beschreibung: 'Einsatzort', wert: (e) => e.einsatzort },
  { name: 'stichwort', beschreibung: 'Stichwort', wert: (e) => e.stichwort },
  { name: 'einsatz', beschreibung: 'Einsatzbezeichnung', wert: (e) => e.bezeichnung },
  { name: 'einsatznr', beschreibung: 'Leitstellen-Nummer', wert: (e) => e.leitstellen_nr },
];

const AUTO_MAP = new Map(AUTO_PLATZHALTER.map((p) => [p.name, p.wert]));

/** Liefert für jeden Auto-Whitelist-Platzhalter den Wert, oder undefined wenn kein Auto-Platzhalter. */
function autoWert(name: string, einsatz: EinsatzAnzeige): string | null | undefined {
  const fn = AUTO_MAP.get(name);
  return fn ? fn(einsatz) : undefined;
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
export function ermittlePlatzhalter(baustein: EtbBaustein, einsatz: EinsatzAnzeige): string[] {
  return tokensVon(baustein.inhalt, baustein.veranlassung).filter((name) => {
    const auto = autoWert(name, einsatz);
    if (auto === undefined) return true; // manuell
    return istLeer(auto); // herabgestuft, wenn Auto-Wert fehlt
  });
}

function substituiere(
  text: string,
  einsatz: EinsatzAnzeige,
  manuelleWerte: Record<string, string>,
): string {
  return text.replace(TOKEN(), (_treffer, name: string) => {
    const auto = autoWert(name, einsatz);
    if (auto !== undefined && !istLeer(auto)) return auto as string;
    return manuelleWerte[name] ?? '';
  });
}

/** Substituiert Auto- + manuelle Platzhalter und liefert die zu setzenden Formularfelder. */
export function setzeBausteinEin(
  baustein: EtbBaustein,
  einsatz: EinsatzAnzeige,
  manuelleWerte: Record<string, string>,
): BausteinFelder {
  const felder: BausteinFelder = {
    typ: baustein.typ,
    inhalt: substituiere(baustein.inhalt, einsatz, manuelleWerte),
  };
  if (baustein.meldeweg) felder.meldeweg = baustein.meldeweg;
  if (baustein.veranlassung) {
    felder.veranlassung = substituiere(baustein.veranlassung, einsatz, manuelleWerte);
  }
  return felder;
}
