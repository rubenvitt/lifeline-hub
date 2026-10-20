import { useCallback, useState } from 'react';
import { sicherLesen, sicherSchreiben } from '../../lib/sichererSpeicher';
import { baumKlappLesen, type BaumKnoten } from './leistenDaten';

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
 * sonst einen Ort (ab `lg` auch die Leistenmodi, deren Bedienung dort in der Leiste steht).
 *
 * Unter `lg` gibt ein laufender Kartenmodus die Karte frei (LFH-765): bei 390 px halbierte die offene
 * Leiste die Karte, und der Fuß deckte den Rest. Abgeleitet aus dem Modus, nicht beim Start gesetzt —
 * so gilt es für jeden Startweg (auch `?platzieren=` und Messen), und nach dem Modus fällt die Regel
 * weg und es gilt wieder, was vorher galt (Entscheidung des Auftraggebers, 29.09.2026). Im Modus
 * zählt nur die vorläufige Wahl `imModus` („Leiste einblenden" für Koordinate oder Mittelpunkt).
 *
 * Danach die gemerkte Wahl, sonst die Vorgabe: offen, außer auf dem Handschirm (< `md`).
 */
export function leisteSichtbar(args: {
  gemerkt: boolean | null;
  breit: boolean;
  istSchmal: boolean;
  erzwungen: boolean;
  modusAktiv: boolean;
  imModus: boolean | null;
}): boolean {
  const { gemerkt, breit, istSchmal, erzwungen, modusAktiv, imModus } = args;
  if (erzwungen) return true;
  if (!breit && modusAktiv) return imModus ?? false;
  return gemerkt ?? (breit || !istSchmal);
}

function lesen(klasse: LeistenKlasse): boolean | null {
  const wert = sicherLesen(LEISTE_SPEICHER_SCHLUESSEL[klasse]);
  return wert === '1' ? true : wert === '0' ? false : null;
}

/**
 * Wahl der aktuellen Breitenklasse. Beide Plätze werden beim Einhängen gelesen und je Render nach
 * der Klasse gewählt: `abBreite('lg')` meldet im ersten Render „breit", solange die Breite
 * unbekannt ist. Das Einhängen schreibt nichts, sonst würde die Vorgabe zur Wahl.
 *
 * `merke` ist das eigene Umschalten und wird gespeichert. `zeige` öffnet nur für die Sitzung, für
 * eine Handlung, die die Leiste braucht (Stift über der Karte) — gespeichert, öffnete ein
 * Stiftklick die Leiste am Handschirm nach jedem Neuladen. Das nächste `merke` löst es ab.
 *
 * `umschalteImModus` ist das Umschalten während eines Kartenmodus unter `lg` (LFH-765): es gilt nur
 * bis zum Modusende und wird nie gespeichert — ein kurzes Einblenden für die Koordinateneingabe
 * soll die Leiste am Handschirm nicht dauerhaft öffnen. Zurückgesetzt wird beim Wechsel von
 * `modusAktiv`, im Render statt per Effekt (React: State bei Prop-Wechsel anpassen).
 */
export function useLeistenWahl(breit: boolean, modusAktiv = false) {
  const [plaetze, setPlaetze] = useState<Record<LeistenKlasse, boolean | null>>(() => ({
    breit: lesen('breit'),
    schmal: lesen('schmal'),
  }));
  // Nur für diese Sitzung, `null` = keine: `zeige` setzt `true`.
  const [vorlaeufig, setVorlaeufig] = useState<Record<LeistenKlasse, boolean | null>>({
    breit: null,
    schmal: null,
  });
  const [imModus, setImModus] = useState<boolean | null>(null);
  const [modusVorher, setModusVorher] = useState(modusAktiv);
  if (modusVorher !== modusAktiv) {
    setModusVorher(modusAktiv);
    setImModus(null);
  }
  const klasse: LeistenKlasse = breit ? 'breit' : 'schmal';
  const merke = useCallback(
    (offen: boolean) => {
      setVorlaeufig((alt) => (alt[klasse] === null ? alt : { ...alt, [klasse]: null }));
      setPlaetze((alt) => (alt[klasse] === offen ? alt : { ...alt, [klasse]: offen }));
      // Kein Speicher (privates Fenster): die Wahl gilt dann nur bis zum Neuladen.
      sicherSchreiben(LEISTE_SPEICHER_SCHLUESSEL[klasse], offen ? '1' : '0');
    },
    [klasse],
  );
  const zeige = useCallback(
    () => setVorlaeufig((alt) => (alt[klasse] === true ? alt : { ...alt, [klasse]: true })),
    [klasse],
  );
  return {
    wahl: vorlaeufig[klasse] ?? plaetze[klasse],
    imModus,
    merke,
    zeige,
    umschalteImModus: setImModus,
  };
}

/** Die Ansichten der Leiste, getragen von der Segmentleiste über ihrem Inhalt. */
export type LeistenAnsicht = 'ebenen' | 'objekte';

export const LEISTEN_ANSICHT_SCHLUESSEL = 'lfh:lagekarte:leiste-ansicht';

/** Gespeicherte Ansicht lesen — ohne oder mit unbekanntem Eintrag gilt „Ebenen“. */
export function leistenAnsichtLesen(roh: string | null): LeistenAnsicht {
  return roh === 'objekte' ? 'objekte' : 'ebenen';
}

/**
 * Zuletzt gewählte Ansicht der Leiste, je Gerät gemerkt (nicht je Breitenklasse: wer am Tablet die
 * Objekte bearbeitet, will sie nach dem Drehen nicht neu suchen). Das Einhängen schreibt nichts.
 * `wechsle` ist das eigene Umschalten und ein Wechsel, den eine Handlung auslöst (Zeichnen, `?ort=`);
 * beides gilt danach als die gemerkte Ansicht.
 */
export function useLeistenAnsicht() {
  const [ansicht, setAnsicht] = useState<LeistenAnsicht>(() =>
    leistenAnsichtLesen(sicherLesen(LEISTEN_ANSICHT_SCHLUESSEL)),
  );
  const wechsle = useCallback((neu: LeistenAnsicht) => {
    setAnsicht(neu);
    sicherSchreiben(LEISTEN_ANSICHT_SCHLUESSEL, neu);
  }, []);
  return { ansicht, wechsle };
}

export const BAUM_KLAPP_SCHLUESSEL = 'lfh:lagekarte:ebenen-gruppen';

/** Offen/zu je Knoten des Ebenenbaums, je Gerät gemerkt (Muster `usePaneelZustand`). */
export function useBaumKlapp() {
  const [offen, setOffen] = useState<Record<BaumKnoten, boolean>>(() =>
    baumKlappLesen(sicherLesen(BAUM_KLAPP_SCHLUESSEL)),
  );
  const setze = useCallback((knoten: BaumKnoten, wert: boolean) => {
    setOffen((alt) => {
      if (alt[knoten] === wert) return alt;
      const neu = { ...alt, [knoten]: wert };
      sicherSchreiben(BAUM_KLAPP_SCHLUESSEL, JSON.stringify(neu));
      return neu;
    });
  }, []);
  return { offen, setze };
}
