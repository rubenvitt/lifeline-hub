import { useCallback, useState } from 'react';

/**
 * Ein-/Ausblenden der rechten Kartenleiste (LFH-715).
 *
 * Die Leiste ist per Vorgabe offen (Neuentwurf S5), lässt sich aber auf jeder Breite ausblenden.
 * Am Fükw mit 1366 px blieben nach Rail (60), Modulpanel (208) und Leiste (300) sonst nur rund
 * 797 px Karte. Die Wahl ist eine Anzeigevorliebe je Gerät und kein Teil der Kartenansicht: im
 * Konfig-Bag von `useKartenAnsicht` machte jedes Klappen die geteilte Ansicht schmutzig (Lehre
 * aus dem C9-Branch). Deshalb `localStorage`, Muster wie `SnapshotLeiste`/`KlappPaneel`.
 *
 * Gemerkt wird **je Breitenklasse**, `lg` und darüber getrennt von darunter. Ab `lg` steht die
 * Leiste rechts neben der Karte, darunter liegt sie unter ihr — ein Ausblenden am Fükw soll das
 * Tablet nicht mit ausblenden.
 */
type LeistenKlasse = 'breit' | 'schmal';

export const LEISTE_SPEICHER_SCHLUESSEL: Record<LeistenKlasse, string> = {
  breit: 'lfh:lagekarte:leiste-offen:ab-lg',
  schmal: 'lfh:lagekarte:leiste-offen:unter-lg',
};

/**
 * Vorrangregel, rein und exportiert, damit sie ohne Rendern prüfbar ist.
 *
 * `erzwungen` gewinnt immer: eine Auswahl auf der Karte hätte sonst keinen Ort, an dem sie
 * erscheint, und ein Platzier-Modus trägt seinen einzigen „Abbrechen"-Knopf in der Leiste.
 * Danach die gemerkte Wahl, sonst die Vorgabe: ab `lg` offen, darunter offen bis auf den
 * Handschirm (< `md`), dessen Karte neben einer 300-px-Leiste nichts mehr trüge.
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
 * Wahl der aktuellen Breitenklasse. Beide Plätze werden beim Einhängen gelesen und je Render
 * nach der aktuellen Klasse gewählt: `abBreite('lg')` meldet im ersten Render „breit", solange
 * die Breite unbekannt ist — ein einzelner, beim Einhängen gefüllter Zustand läse auf dem
 * Handschirm den `lg`-Platz. Das Einhängen schreibt nichts, sonst würde die Vorgabe zur Wahl.
 *
 * Zwei Wege, die Leiste zu öffnen: `merke` ist das eigene Umschalten und wird gespeichert.
 * `zeige` öffnet sie nur für diese Sitzung, für eine Handlung, die die Leiste braucht (der
 * Stift über der Karte öffnet das Paneel „Zeichnen"). Gespeichert, machte ein einziger
 * Stiftklick die Leiste am Handschirm nach jedem Neuladen wieder auf. `verberge` ist das
 * Gegenstück für eine Handlung, die die Karte braucht: unter `lg` schließt die Wahl eines
 * Zeichenwerkzeugs die Leiste (LFH-713), ohne die Vorgabe „offen" des Tablets zu überschreiben.
 * Das nächste `merke` löst beide ab.
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
