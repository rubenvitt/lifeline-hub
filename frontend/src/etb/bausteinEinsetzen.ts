import dayjs from 'dayjs';
import type { EtbBaustein, EinsatzAnzeige, EtbTyp, MeldeWeg } from '../api/types';

const TOKEN = () => /\{([a-z0-9_]+)\}/g;

export interface BausteinFelder {
  typ: EtbTyp;
  inhalt: string;
  meldeweg?: MeldeWeg;
  veranlassung?: string;
}

/** Liefert für jeden Auto-Whitelist-Platzhalter den Wert, oder null wenn nicht auflösbar. */
function autoWert(name: string, einsatz: EinsatzAnzeige): string | null | undefined {
  switch (name) {
    case 'datum':
      return dayjs().format('DD.MM.YYYY');
    case 'uhrzeit':
      return dayjs().format('HH:mm');
    case 'einsatzort':
      return einsatz.einsatzort;
    case 'stichwort':
      return einsatz.stichwort;
    case 'einsatz':
      return einsatz.bezeichnung;
    case 'einsatznr':
      return einsatz.leitstellen_nr;
    default:
      return undefined; // kein Auto-Platzhalter
  }
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
