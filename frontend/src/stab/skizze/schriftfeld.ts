import type { Schriftfeld } from '../../api/fernmeldeskizzeVertrag';
import { RASTER } from '../fernmeldeskizzeLayout';
import { schaetzeTextbreite } from '../skizzenZeichen';

/**
 * Schriftfeld der Fernmeldeskizze (LFH-893 D13, Spec „Schriftfeld“): Inhalt und Satz, rein. Das
 * Bild setzt es unten rechts in die Skizze (`SkizzenElemente.tsx`, `SchriftfeldBild`), damit es
 * mit der `viewBox` auf jede Seite skaliert; bearbeitet wird es im Eigenschaftspaneel.
 *
 * Leere Angaben stehen als „—“, nie erfunden; fehlen die Daten der Skizze, steht „nicht
 * geladen“. Der Herausgeber hat die Vorgabe „Bezeichnung des Einsatzes“ (D3).
 */

export const VS_NFD = 'VS – Nur für den Dienstgebrauch';
const LEER = '—';
const NICHT_GELADEN = 'nicht geladen';

export function schriftfeldTitel(einsatzbezeichnung: string): string {
  return `Taktische Fernmeldeskizze für den Einsatz ‚${einsatzbezeichnung}‘`;
}

export interface SchriftfeldZeile {
  etikett: string;
  wert: string;
}

export interface SchriftfeldAngaben {
  titel: string;
  /** Ausgeschriebener VS-Vermerk; `null` = keiner. */
  vermerk: string | null;
  zeilen: SchriftfeldZeile[];
}

/**
 * @param dtg wandelt einen Zeitstempel des Servers in die taktische DTG der Anzeigezone
 *   (`taktischeDtgVoll` mit den Konventionen des Einsatzes).
 */
export function schriftfeldAngaben(
  sf: Schriftfeld | null,
  einsatzbezeichnung: string,
  stand: string | null,
  dtg: (zeit: string) => string,
): SchriftfeldAngaben {
  const herausgeber = sf?.herausgeber?.trim() || einsatzbezeichnung;
  if (!sf) {
    return {
      titel: schriftfeldTitel(einsatzbezeichnung),
      vermerk: null,
      zeilen: [
        { etikett: 'Herausgeber', wert: herausgeber },
        { etikett: 'Gültig ab', wert: NICHT_GELADEN },
        { etikett: 'gez.', wert: NICHT_GELADEN },
        { etikett: 'Stand', wert: NICHT_GELADEN },
      ],
    };
  }
  const gez = [sf.gez_name?.trim() || null, sf.gez_at ? dtg(sf.gez_at) : null].filter(Boolean);
  return {
    titel: schriftfeldTitel(einsatzbezeichnung),
    vermerk: sf.vs_vermerk === 'vs_nfd' ? VS_NFD : null,
    zeilen: [
      { etikett: 'Herausgeber', wert: herausgeber },
      { etikett: 'Gültig ab', wert: sf.gueltig_ab ? dtg(sf.gueltig_ab) : LEER },
      { etikett: 'gez.', wert: gez.length > 0 ? gez.join(' ') : LEER },
      { etikett: 'Stand', wert: stand ? dtg(stand) : LEER },
    ],
  };
}

// ── Satz ───────────────────────────────────────────────────────────────────────────────────

export const SCHRIFTFELD_BREITE = 42 * RASTER;
export const SCHRIFTFELD_POLSTER = RASTER;
export const SCHRIFTFELD_TITEL_SCHRIFT = 12;
export const SCHRIFTFELD_SCHRIFT = 11;
export const SCHRIFTFELD_ZEILE = 16;
/** Breite der Etikett-Spalte. */
export const SCHRIFTFELD_ETIKETT = 12 * RASTER;

/** Bricht an Wortgrenzen um; ein Wort, das allein zu lang ist, zeichenweise. Kürzt nie. */
export function umbrich(text: string, schrift: number, breite: number): string[] {
  const passt = (t: string) => schaetzeTextbreite(t, schrift) <= breite;
  const zeilen: string[] = [];
  let zeile = '';
  for (const wort of text.split(/\s+/).filter(Boolean)) {
    const kandidat = zeile ? `${zeile} ${wort}` : wort;
    if (passt(kandidat)) {
      zeile = kandidat;
      continue;
    }
    if (zeile) zeilen.push(zeile);
    let rest = wort;
    while (!passt(rest)) {
      let n = [...rest].length - 1;
      while (n > 1 && !passt([...rest].slice(0, n).join(''))) n -= 1;
      zeilen.push([...rest].slice(0, n).join(''));
      rest = [...rest].slice(n).join('');
    }
    zeile = rest;
  }
  zeilen.push(zeile);
  return zeilen;
}

export interface SatzZeile {
  /** Linker Rand des Textes, relativ zum Block. */
  x: number;
  /** Grundlinie relativ zum Block. */
  y: number;
  text: string;
  schrift: number;
  fett: boolean;
}

export interface SchriftfeldBlock {
  breite: number;
  hoehe: number;
  zeilen: SatzZeile[];
  /** y der Trennlinien unter Titel bzw. Vermerk, relativ zum Block. */
  linien: number[];
}

/** Satz des Schriftfelds: Titel und Vermerk über die ganze Breite, darunter Etikett | Wert. */
export function schriftfeldBlock(a: SchriftfeldAngaben): SchriftfeldBlock {
  const innen = SCHRIFTFELD_BREITE - 2 * SCHRIFTFELD_POLSTER;
  const zeilen: SatzZeile[] = [];
  const linien: number[] = [];
  let y = SCHRIFTFELD_POLSTER;
  const setze = (texte: string[], x: number, schrift: number, fett: boolean) => {
    for (const text of texte) {
      zeilen.push({ x, y: y + schrift, text, schrift, fett });
      y += SCHRIFTFELD_ZEILE;
    }
  };
  setze(
    umbrich(a.titel, SCHRIFTFELD_TITEL_SCHRIFT, innen),
    SCHRIFTFELD_POLSTER,
    SCHRIFTFELD_TITEL_SCHRIFT,
    true,
  );
  if (a.vermerk) {
    setze(
      umbrich(a.vermerk, SCHRIFTFELD_SCHRIFT, innen),
      SCHRIFTFELD_POLSTER,
      SCHRIFTFELD_SCHRIFT,
      true,
    );
  }
  y += SCHRIFTFELD_POLSTER / 2;
  linien.push(y);
  y += SCHRIFTFELD_POLSTER / 2;
  const wertX = SCHRIFTFELD_POLSTER + SCHRIFTFELD_ETIKETT;
  const wertBreite = SCHRIFTFELD_BREITE - wertX - SCHRIFTFELD_POLSTER;
  for (const z of a.zeilen) {
    zeilen.push({
      x: SCHRIFTFELD_POLSTER,
      y: y + SCHRIFTFELD_SCHRIFT,
      text: z.etikett,
      schrift: SCHRIFTFELD_SCHRIFT,
      fett: false,
    });
    setze(umbrich(z.wert, SCHRIFTFELD_SCHRIFT, wertBreite), wertX, SCHRIFTFELD_SCHRIFT, false);
  }
  const hoehe = Math.ceil((y + SCHRIFTFELD_POLSTER) / RASTER) * RASTER;
  return { breite: SCHRIFTFELD_BREITE, hoehe, zeilen, linien };
}
