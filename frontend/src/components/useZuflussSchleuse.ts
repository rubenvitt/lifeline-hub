import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type Key,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import type { Wartend } from './organigramm/baumSchleuse';

/**
 * Die Zeilenschleuse des Zuflusses (LFH-1020, Spec `datensicht-zufluss`), herausgelöst aus der
 * `Datensicht`, damit `ListeDetail` dieselbe trägt (Change `oxgob5gk-auftraege-befehle-angleichen`,
 * design.md D8). Keine zweite Logik: Datensicht und ListeDetail rufen beide diese Hooks.
 *
 * Zwei Hooks, weil die Datensicht `nachBenutzeraktion` schon in ihren Sortier- und Filtersettern
 * braucht, die gezeigten Zeilen aber erst danach kennt: {@link useZuflussSteuerung} trägt Zustand
 * und Benutzeraktion, {@link useZuflussSchleuse} Einfrieren und Bedingungen.
 */

/**
 * Drei Zustände statt `readonly Key[] | null`: eine Zeile, die von SELBST wegrutscht, ist der
 * verbotene Sprung; eine Neuordnung, die der Benutzer angestoßen hat (Sortierklick, Suche, Filter,
 * Banner), muss sofort sichtbar sein. `'neu'` ist ein AUFTRAG, neu einzufrieren, den der
 * Layout-Effekt mit der neu geordneten Folge erfüllt. Das Einfrieren beim Fokuseintritt geschieht
 * SYNCHRON im Handler.
 *
 * Im Zustand `gefroren` hält `folge` die Schlüsselreihenfolge beim Fokuseintritt; gerendert wird
 * diese FOLGE, der Inhalt kommt frisch aus den Daten. `gruppeVon` friert auch die
 * GRUPPENZUGEHÖRIGKEIT ein: sonst hinge ein Live-Statuswechsel die Karte unter einen anderen
 * Gruppenkopf um.
 */
export type ZuflussStand<T> =
  | { art: 'offen' }
  | { art: 'neu' }
  | {
      art: 'gefroren';
      folge: readonly Key[];
      gruppeVon: ReadonlyMap<Key, string>;
      /** Im Baum die gezeigten Wurzelzeilen MIT ihren Kindern (LFH-1020); flach `null`. */
      gerippe: readonly T[] | null;
    };

export interface ZuflussSteuerung<T> {
  stand: ZuflussStand<T>;
  setStand: (neu: ZuflussStand<T> | ((vorher: ZuflussStand<T>) => ZuflussStand<T>)) => void;
  /** Eine Benutzeraktion ordnet neu: aus `gefroren` wird der Auftrag `neu`, aus `offen` nichts. */
  nachBenutzeraktion: () => void;
}

/** Wortlaut des Sammelbanners (Spec `datensicht-zufluss`); ohne Wartendes `null`. */
export function bannerText(w: Omit<Wartend, 'entfallen'>): string | null {
  const teile = [
    w.neu === 1 ? '1 neuer Eintrag' : w.neu > 1 ? `${w.neu} neue Einträge` : null,
    w.umgehaengt > 0 ? `${w.umgehaengt} umgehängt` : null,
    w.umsortiert > 0 ? `${w.umsortiert} umsortiert` : null,
  ].filter((t): t is string => t !== null);
  return teile.length > 0 ? `${teile.join(' · ')} — anzeigen` : null;
}

/**
 * Die flache Folge hinter der Schleuse: gehaltene Folge, Inhalt frisch. Entfallene Schlüssel fallen
 * sofort weg; die Schleuse hält nur Zuwachs zurück.
 */
export function flachZufluss<T>(
  gefroren: readonly Key[],
  zeilen: readonly T[],
  schluessel: (zeile: T) => Key,
): { zeilen: readonly T[]; banner: string | null } {
  const nachSchluessel = new Map(zeilen.map((z) => [schluessel(z), z]));
  const gefrorenMenge = new Set(gefroren);
  const neu = zeilen.filter((z) => !gefrorenMenge.has(schluessel(z))).length;
  return {
    zeilen: gefroren.map((k) => nachSchluessel.get(k)).filter((z): z is T => z !== undefined),
    banner: bannerText({ neu, umgehaengt: 0, umsortiert: 0 }),
  };
}

export function useZuflussSteuerung<T>(): ZuflussSteuerung<T> {
  const [stand, setStand] = useState<ZuflussStand<T>>({ art: 'offen' });
  const nachBenutzeraktion = useCallback(() => {
    setStand((vorher) => (vorher.art === 'offen' ? vorher : { art: 'neu' }));
  }, []);
  return { stand, setStand, nachBenutzeraktion };
}

/** Die Handler des Bereichs, den die Schleuse beobachtet (Sicht bzw. Liste). */
export interface ZuflussBereich {
  onFocus: () => void;
  onBlur: (e: ReactFocusEvent) => void;
  onPointerMove: (e: ReactPointerEvent) => void;
  onPointerLeave: (e: ReactPointerEvent) => void;
}

export function useZuflussSchleuse<T>(
  steuerung: ZuflussSteuerung<T>,
  args: {
    /** Die frisch geordneten Zeilen, wie sie ohne Schleuse stünden. */
    zeilen: readonly T[];
    schluessel: (zeile: T) => Key;
    /** `false` (Zufluss `'sofort'`): die Schleuse schließt nie. */
    aktiv: boolean;
    gruppeVon?: (zeile: T) => string;
    /** Im Baum hält der Stand auch die Zeilen samt Kindern (`gerippe`). */
    mitGerippe: boolean;
    wurzel: RefObject<HTMLElement | null>;
  },
): ZuflussBereich {
  const { stand: schleuse, setStand: setSchleuse } = steuerung;
  const { zeilen, schluessel, aktiv, gruppeVon, mitGerippe, wurzel } = args;

  /**
   * Der eingefrorene Stand, Folge UND Gruppenzugehörigkeit. Beide Einfrierstellen (`'neu'`-Auftrag
   * und {@link betreten}) gehen hierdurch, damit keine die Gruppen vergisst.
   */
  const standJetzt = useCallback(
    (): {
      folge: readonly Key[];
      gruppeVon: ReadonlyMap<Key, string>;
      gerippe: readonly T[] | null;
    } => ({
      folge: zeilen.map(schluessel),
      gruppeVon: new Map(
        gruppeVon ? zeilen.map((z) => [schluessel(z), gruppeVon(z)] as const) : [],
      ),
      gerippe: mitGerippe ? zeilen : null,
    }),
    [zeilen, schluessel, gruppeVon, mitGerippe],
  );

  /**
   * Erfüllt den `'neu'`-Auftrag mit `useLayoutEffect`: ein nachgelagerter Effekt ließe genau EINEN
   * Bildaufbau zwischen Benutzeraktion und erneutem Einfrieren, in dem ein Datenstand
   * durchrutschen könnte.
   */
  useLayoutEffect(() => {
    if (schleuse.art !== 'neu') return;
    setSchleuse({ art: 'gefroren', ...standJetzt() });
  }, [schleuse, setSchleuse, standJetzt]);

  /**
   * DIE LEERE LADEANSICHT FRIERT NICHT EIN: wer den Fokus vor der ersten Antwort ins Suchfeld setzt,
   * fröre eine LEERE Folge ein, und die erste Lieferung landete hinter dem Sammelbanner. Ohne
   * gerenderte Zeile kann nichts unter dem Cursor wegrutschen.
   *
   * Nicht auf `ladend` gaten: ein Query, der auf `[]` auflöst und per SSE nachbekommt, hat
   * `ladend === false` bei leerer Menge. `zeilen` ist die ehrliche Quelle. Der `'neu'`-Pfad braucht
   * die Bedingung nicht: `nachBenutzeraktion` ist aus `'offen'` ein No-op.
   *
   * Bleibt der Fokus nach dem Eintreffen in der Werkzeugzeile, ist die Schleuse offen, bis zum
   * nächsten Fokuseintritt (`focusin` bubbelt, der Sprung Suchfeld → Zeilenlink genügt). Ein
   * Einfrieren beim ersten Datenstand fröre ausgerechnet die erwartete Lieferung ein.
   */
  const schliessen = useCallback(() => {
    if (!aktiv) return;
    if (zeilen.length === 0) return;
    // SYNCHRON im Handler: die jetzt sichtbare Folge ist die richtige.
    setSchleuse((vorher) =>
      vorher.art === 'offen' ? { art: 'gefroren', ...standJetzt() } : vorher,
    );
  }, [aktiv, zeilen.length, setSchleuse, standJetzt]);

  /**
   * ZWEI BEDINGUNGEN, wie im Gerüst `HaengenderBaum` (LFH-1020, Spec `datensicht-zufluss`): Fokus
   * ODER ein Maus- bzw. Stiftzeiger über der Sicht schließt; offen erst, wenn keine mehr gilt. Wer
   * mit der Maus auf eine Zeile zielt, hat oft noch nicht geklickt.
   */
  const bedingung = useRef({ zeiger: false, fokus: false });
  const checkOffen = useCallback(() => {
    if (!bedingung.current.zeiger && !bedingung.current.fokus) setSchleuse({ art: 'offen' });
  }, [setSchleuse]);

  const betreten = useCallback(() => {
    bedingung.current.fokus = true;
    schliessen();
  }, [schliessen]);

  /**
   * ERST DIE BEWEGUNG ZÄHLT, nicht `pointerenter`: Chromium meldet das Betreten auch, wenn Inhalt
   * unter einem ruhenden Zeiger auftaucht. Baut sich eine Seite in Stufen auf (Stellen, dann
   * Abschnitte), hielte die Schleuse sonst die zweite Lieferung hinter dem Banner, obwohl niemand
   * zielt. Wer zielt, bewegt den Zeiger. Die Bewegung schließt auch, wenn die Sicht beim Betreten
   * noch leer war: die erste Lieferung steht dann schon da, die nächste rückt nicht mehr.
   *
   * Touch zählt nicht: ein Tipp betritt und verlässt die Sicht; nach dem Tipp hält der Fokus.
   */
  const offenJetzt = useRef(true);
  useLayoutEffect(() => {
    offenJetzt.current = schleuse.art === 'offen';
  });
  const zeigerBewegt = useCallback(
    (e: ReactPointerEvent) => {
      if (e.pointerType === 'touch') return;
      if (bedingung.current.zeiger && !offenJetzt.current) return;
      bedingung.current.zeiger = true;
      schliessen();
    },
    [schliessen],
  );
  const zeigerRaus = useCallback(
    (e: ReactPointerEvent) => {
      if (e.pointerType === 'touch') return;
      bedingung.current.zeiger = false;
      checkOffen();
    },
    [checkOffen],
  );

  /**
   * `focusout` feuert auch beim Sprung von der Titelzelle zum Aktionsknopf derselben Sicht; ohne
   * `contains`-Prüfung taute die Schleuse genau beim Bedienen auf.
   */
  const checkVerlassen = useCallback(
    (e: ReactFocusEvent) => {
      const ziel = e.relatedTarget;
      if (ziel != null && wurzel.current?.contains(ziel as Node)) return;
      /**
       * EIN ÜBERLAGERNDES MENÜ IST KEIN VERLASSEN. Menüs (Statuswahl, `weitere`) liegen in einem
       * PORTAL an `document.body`, und antds `autoFocus` schiebt den Fokus dorthin; ohne diesen Zweig
       * taute die Schleuse, während jemand das Menü offen hält.
       *
       * In jsdom bleibt der Fokus beim Öffnen auf dem Auslöser: ein Test, der nur ein Menü öffnet,
       * ist auch ohne diesen Zweig grün. Geprüft wird der Handler direkt, mit `relatedTarget` im
       * Portal. Erkennung über antds Overlay-Klassen, weil die Overlays keinem Knoten dieser Sicht
       * gehören. (Für den Zeiger gilt das von selbst: Reacts `pointerleave` folgt dem React-Baum,
       * das Portal unter der Zeile liegt darin.)
       */
      if (
        ziel instanceof Node &&
        (ziel as Element).closest?.('.ant-dropdown, .ant-select-dropdown, .ant-picker-dropdown')
      ) {
        return;
      }
      bedingung.current.fokus = false;
      checkOffen();
    },
    [checkOffen, wurzel],
  );

  return {
    onFocus: betreten,
    onBlur: checkVerlassen,
    onPointerMove: zeigerBewegt,
    onPointerLeave: zeigerRaus,
  };
}
