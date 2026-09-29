import { useCallback, useState } from 'react';

/**
 * Ein-/Ausblenden der rechten Kartenleiste. Per Vorgabe offen, auf jeder Breite ausblendbar (am
 * Fükw blieben nach Rail, Modulpanel und Leiste sonst nur ~800 px Karte). Eine Anzeigevorliebe je
 * Gerät, kein Teil der Kartenansicht: im Konfig-Bag von `useKartenAnsicht` machte jedes Klappen die
 * geteilte Ansicht schmutzig. Deshalb `localStorage`.
 *
 * Gemerkt wird je Breitenklasse (ab `lg` getrennt von darunter): ab `lg` steht die Leiste neben der
 * Karte, darunter unter ihr — ein Ausblenden am Fükw soll das Tablet nicht mit ausblenden.
 */
type LeistenKlasse = 'breit' | 'schmal';

export const LEISTE_SPEICHER_SCHLUESSEL: Record<LeistenKlasse, string> = {
  breit: 'lfh:lagekarte:leiste-offen:ab-lg',
  schmal: 'lfh:lagekarte:leiste-offen:unter-lg',
};

/**
 * Vorrangregel, rein und exportiert. `erzwungen` gewinnt immer: eine Auswahl auf der Karte bräuchte
 * sonst einen Ort, und ein Platzier-Modus trägt seinen einzigen „Abbrechen"-Knopf in der Leiste.
 * Danach die gemerkte Wahl, sonst die Vorgabe: offen, außer auf dem Handschirm (< `md`).
 */
export function leisteSichtbar(args: {
  gemerkt: boolean | null;
  breit: boolean;
  istSchmal: boolean;
  erzwungen: boolean;
}): boolean {
  const { gemerkt, breit, istSchmal, erzwungen } = args;
  return erzwungen || (gemerkt ?? (breit || !istSchmal));
}

function lesen(klasse: LeistenKlasse): boolean | null {
  try {
    const wert = localStorage.getItem(LEISTE_SPEICHER_SCHLUESSEL[klasse]);
    return wert === '1' ? true : wert === '0' ? false : null;
  } catch {
    return null;
  }
}

/**
 * Wahl der aktuellen Breitenklasse. Beide Plätze werden beim Einhängen gelesen und je Render nach
 * der Klasse gewählt: `abBreite('lg')` meldet im ersten Render „breit", solange die Breite
 * unbekannt ist. Das Einhängen schreibt nichts, sonst würde die Vorgabe zur Wahl.
 *
 * `merke` ist das eigene Umschalten und wird gespeichert. `zeige` öffnet nur für die Sitzung, für
 * eine Handlung, die die Leiste braucht (Stift über der Karte) — gespeichert, öffnete ein
 * Stiftklick die Leiste am Handschirm nach jedem Neuladen. `verberge` ist das Gegenstück (unter
 * `lg` schließt die Wahl eines Zeichenwerkzeugs die Leiste). Das nächste `merke` löst beide ab.
 */
export function useLeistenWahl(breit: boolean) {
  const [plaetze, setPlaetze] = useState<Record<LeistenKlasse, boolean | null>>(() => ({
    breit: lesen('breit'),
    schmal: lesen('schmal'),
  }));
  // Nur für diese Sitzung, `null` = keine: `zeige` setzt `true`, `verberge` setzt `false`.
  const [vorlaeufig, setVorlaeufig] = useState<Record<LeistenKlasse, boolean | null>>({
    breit: null,
    schmal: null,
  });
  const klasse: LeistenKlasse = breit ? 'breit' : 'schmal';
  const merke = useCallback(
    (offen: boolean) => {
      setVorlaeufig((alt) => (alt[klasse] === null ? alt : { ...alt, [klasse]: null }));
      setPlaetze((alt) => (alt[klasse] === offen ? alt : { ...alt, [klasse]: offen }));
      try {
        localStorage.setItem(LEISTE_SPEICHER_SCHLUESSEL[klasse], offen ? '1' : '0');
      } catch {
        // Kein Speicher (privates Fenster): die Wahl gilt dann nur bis zum Neuladen.
      }
    },
    [klasse],
  );
  const vorlaeufigSetzen = useCallback(
    (offen: boolean) =>
      setVorlaeufig((alt) => (alt[klasse] === offen ? alt : { ...alt, [klasse]: offen })),
    [klasse],
  );
  const zeige = useCallback(() => vorlaeufigSetzen(true), [vorlaeufigSetzen]);
  const verberge = useCallback(() => vorlaeufigSetzen(false), [vorlaeufigSetzen]);
  return { wahl: vorlaeufig[klasse] ?? plaetze[klasse], merke, zeige, verberge };
}
