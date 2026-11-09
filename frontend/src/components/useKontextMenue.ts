/**
 * Auslöser des Kontextmenüs (LLH-1596, Spec `datensatz-aktionsmenue`,
 * `openspec/changes/archive/2026-11-08-om9oxxiq-kontextmenue-baustein/design.md` D1–D4).
 *
 * EINE Mechanik für Rechtsklick, langen Druck und die Tasten Kontextmenü / Umschalt+F10. Der Hook
 * zeigt kein Menü; er meldet `onOeffnen(schluessel, oeffnung)`, und der Aufrufer rendert das Menü
 * (Datensatz: `KontextMenue`, Skizze: `PunktankerMenue`). Liefert `onOeffnen` `false` (keine
 * Einträge), bleibt das Browsermenü.
 *
 * Ein Hook je Fläche, nicht je Zeile: `ausloeser(schluessel)` gibt die Handler für ein Element.
 * Eine Liste mit 200 Zeilen hält so EINEN Langdruck-Zustand und EINEN Nachklick-Riegel.
 *
 * Neue eigene `onContextMenu`-Mechaniken verhindert `kontextMenue.guard.test.ts`.
 */
import {
  useCallback,
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { NACHLAUF_MS, erzeugeNachklickRiegel, type NachklickRiegel } from './nachklickRiegel';

/** Ab dieser Dauer öffnet ein Druck ohne Bewegung das Kontextmenü (Touch, Stift). */
export const LANGDRUCK_MS = 550;
/** Bewegt sich der Finger weiter, ist es Wischen oder Ziehen, kein langer Druck. */
export const LANGDRUCK_WEG = 8;
/** So lange nach der Taste verwirft der Hook das `contextmenu`, das der Browser nachschiebt. */
export const TASTEN_NACHLAUF_MS = 500;

export interface KontextAnker {
  x: number;
  y: number;
}

export interface KontextOeffnung {
  /** Fensterkoordinaten: Zeigerpunkt oder (Tastatur) der Anker aus `tastaturAnker`. */
  anker: KontextAnker;
  ursprung: 'zeiger' | 'tastatur';
  /** Das Element, an dem die Handler hängen (der Datensatz). */
  element: HTMLElement | SVGElement;
  /** Wohin der Fokus beim Schließen ohne Wahl zurückgeht. */
  vorherFokus: Element | null;
}

export interface KontextMenueOptionen<S> {
  /** Menü öffnen. `false` ⇒ keine Einträge: kein Menü, das Browsermenü bleibt. */
  onOeffnen: (schluessel: S, oeffnung: KontextOeffnung) => boolean;
  /**
   * Hat der Datensatz überhaupt Einträge? Gefragt beim Aufsetzen des Fingers, bevor der Druck
   * Markieren und Systemblase sperrt: ohne Einträge bleiben beide und das Browsermenü (D2).
   * Fehlt die Prüfung, entscheidet erst `onOeffnen`.
   */
  kannOeffnen?: (schluessel: S) => boolean;
  /**
   * Anker bei der Tastatur. Vorgabe: untere linke Ecke des Elements (das Menü klappt unter die
   * Zeile, ohne sie zu verdecken).
   */
  tastaturAnker?: (element: HTMLElement | SVGElement) => KontextAnker;
  /**
   * Öffnet ein langer Druck (Touch, Stift) das Menü? Vorgabe `true`. `false` lässt am Touchgerät
   * das Markieren und das Systemmenü, auch das native `contextmenu`, das Android beim Halten
   * schickt; Rechtsklick mit der Maus und die Tasten öffnen weiter. Das Einsatztagebuch setzt
   * `false`, dort wird Text am Tablet markiert (LLH-1597, Spec `datensatz-aktionsmenue`).
   */
  langerDruck?: boolean;
}

export interface KontextHandler<E extends Element = Element> {
  onContextMenu: (e: ReactMouseEvent<E>) => void;
  onPointerDown: (e: ReactPointerEvent<E>) => void;
  onPointerMove: (e: ReactPointerEvent<E>) => void;
  onPointerUp: (e: ReactPointerEvent<E>) => void;
  onPointerCancel: (e: ReactPointerEvent<E>) => void;
  onKeyDown: (e: ReactKeyboardEvent<E>) => void;
}

/** Kontextmenü-Taste oder Umschalt+F10 (geteilt mit der Skizze, `fernmeldewesen/skizze/bedienung.ts`). */
export function istKontextTaste(e: { key: string; shiftKey: boolean }): boolean {
  return e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey);
}

const EINGABE = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

function istElement(ziel: EventTarget | null): ziel is Element {
  return ziel instanceof Element;
}

/** Ziel in einem Eingabefeld: dort gehören Kopieren und Einfügen dem Browser. */
function inEingabe(ziel: EventTarget | null): boolean {
  return istElement(ziel) && ziel.closest(EINGABE) != null;
}

/**
 * Bleibt das Browsermenü (D2)? Auf einem Link („In neuem Tab öffnen“), in einem Eingabefeld und
 * auf markiertem Text, der das Ziel enthält.
 */
export function browsermenueBleibt(ziel: EventTarget | null): boolean {
  if (!istElement(ziel)) return false;
  if (ziel.closest('a[href]') != null || inEingabe(ziel)) return true;
  const markierung = typeof window.getSelection === 'function' ? window.getSelection() : null;
  if (markierung == null || markierung.isCollapsed) return false;
  // Über die Bereiche statt `containsNode`: jsdom rechnet `containsNode` falsch, und mehrere
  // Bereiche (Firefox) deckt die Schleife ab.
  for (let i = 0; i < markierung.rangeCount; i++) {
    if (markierung.getRangeAt(i).intersectsNode(ziel)) return true;
  }
  return false;
}

/**
 * Kommt das Ereignis aus dem eigenen DOM-Teilbaum? React lässt Ereignisse aus Portalen (offenes
 * ⋮-Menü, Auswahlliste, Rückfrage) durch den Komponentenbaum aufsteigen; sie gehören nicht dem
 * Datensatz (wie der Riegel des Zeilenklicks in `Datensicht`).
 */
function ausEigenemBaum(e: { currentTarget: EventTarget; target: EventTarget }): boolean {
  const huelle = e.currentTarget as Node;
  return e.target instanceof Node && huelle.contains(e.target);
}

const GESCHLUCKT_NACH_STIFT = ['mousedown', 'mouseup', 'click', 'contextmenu'] as const;

function untenLinks(element: HTMLElement | SVGElement): KontextAnker {
  const r = element.getBoundingClientRect();
  return { x: r.left, y: r.bottom };
}

interface LangerDruck {
  timer: number;
  x: number;
  y: number;
  pointerId: number;
  element: HTMLElement | SVGElement;
}

/**
 * Markiert das gedrückte Element während eines Touchdrucks. Die Regel dazu steht in `index.css`
 * (`user-select` und `-webkit-touch-callout` aus): sonst markiert iOS nach rund 500 ms Text oder
 * zeigt seine Blase, bevor der Zeitgeber feuert (D3).
 */
export const DRUCK_ATTRIBUT = 'data-kontext-druck';

export function useKontextMenue<S>(
  optionen: KontextMenueOptionen<S>,
): <E extends Element = Element>(schluessel: S) => KontextHandler<E> {
  // Ref: die Fabrik bleibt stabil, auch wenn der Aufrufer je Render neue Rückrufe reicht.
  const optionenRef = useRef(optionen);
  useEffect(() => {
    optionenRef.current = optionen;
  });

  const druck = useRef<LangerDruck | null>(null);
  /** Zeigerart des letzten `pointerdown` am Datensatz (nur ohne langen Druck gebraucht). */
  const letzterZeiger = useRef<string | null>(null);
  /** Läuft gerade ein Touchdruck oder hat er eben das Menü geöffnet? Dann kein natives Menü. */
  const touchAktiv = useRef(false);
  const tasteZeit = useRef(-Infinity);
  const riegel = useRef<NachklickRiegel | null>(null);
  /**
   * Riegel für einen Zeiger ohne Touch-Ereignisse (Stift unter Windows): der Touch-Riegel sieht
   * kein `touchstart` und bliebe stumpf. `bis` steht bis zum Abheben auf Unendlich.
   */
  const stiftRiegel = useRef<{ bis: number } | null>(null);

  useEffect(() => {
    // Der Riegel (LFH-776 D3) hängt vor jedem Dropdown am `window` und schluckt nach einem langen
    // Druck die Ereignisse des Abhebens. Scharf erst, wenn dieser Hook wirklich öffnet.
    const r = erzeugeNachklickRiegel(document.documentElement);
    riegel.current = r;

    // Das `contextmenu`, das der Browser auf die Taste hin nachschiebt (Windows beim `keyup`),
    // trifft das fokussierte Element, und das steht dann schon im Menü (Portal), nicht im
    // Datensatz. Darum am `window` in der Capture-Phase, vor rc-trigger, das das Menü sonst
    // schlösse (D4). Der Hörer hängt seit dem Einhängen, also vor jedem Menü.
    const tasteNachlauf = (e: Event) => {
      if (performance.now() - tasteZeit.current > TASTEN_NACHLAUF_MS) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    const stiftNachlauf = (e: Event) => {
      const st = stiftRiegel.current;
      if (st == null) return;
      if (performance.now() > st.bis) {
        stiftRiegel.current = null;
        return;
      }
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    // Ein neuer Zeiger nach dem Abheben ist eine neue Absicht (wie `touchstart` im Touch-Riegel).
    const neuerZeiger = () => {
      const st = stiftRiegel.current;
      if (st != null && st.bis !== Infinity) stiftRiegel.current = null;
    };
    window.addEventListener('contextmenu', tasteNachlauf, true);
    window.addEventListener('pointerdown', neuerZeiger, true);
    for (const t of GESCHLUCKT_NACH_STIFT) window.addEventListener(t, stiftNachlauf, true);
    return () => {
      r.abbauen();
      riegel.current = null;
      window.removeEventListener('contextmenu', tasteNachlauf, true);
      window.removeEventListener('pointerdown', neuerZeiger, true);
      for (const t of GESCHLUCKT_NACH_STIFT) window.removeEventListener(t, stiftNachlauf, true);
    };
  }, []);

  const loesen = useCallback(() => {
    const d = druck.current;
    if (!d) return;
    window.clearTimeout(d.timer);
    d.element.removeAttribute(DRUCK_ATTRIBUT);
    druck.current = null;
  }, []);

  useEffect(() => loesen, [loesen]);

  /** Ende eines Drucks: Zeitgeber und Sperre weg, Stift-Riegel läuft ab jetzt nur noch nach. */
  const druckEnde = useCallback(() => {
    loesen();
    touchAktiv.current = false;
    const st = stiftRiegel.current;
    if (st != null && st.bis === Infinity) {
      stiftRiegel.current = { bis: performance.now() + NACHLAUF_MS };
    }
  }, [loesen]);

  useEffect(() => {
    // Rückfall am `window`: ein Stift hat keine implizite Pointer-Capture, und nach dem langen
    // Druck liegt das Menü (Portal) unter der Spitze; sein `pointerup` erreicht den Datensatz
    // dann nicht. Ohne diesen Hörer bliebe der Stift-Riegel scharf und schluckte jeden Klick.
    const abgehoben = () => {
      if (druck.current != null || touchAktiv.current || stiftRiegel.current?.bis === Infinity) {
        druckEnde();
      }
    };
    window.addEventListener('pointerup', abgehoben, true);
    window.addEventListener('pointercancel', abgehoben, true);
    return () => {
      window.removeEventListener('pointerup', abgehoben, true);
      window.removeEventListener('pointercancel', abgehoben, true);
    };
  }, [druckEnde]);

  return useCallback(
    <E extends Element = Element>(schluessel: S): KontextHandler<E> => {
      const oeffne = (
        element: HTMLElement | SVGElement,
        anker: KontextAnker,
        ursprung: KontextOeffnung['ursprung'],
      ) =>
        optionenRef.current.onOeffnen(schluessel, {
          anker,
          ursprung,
          element,
          vorherFokus: document.activeElement,
        });

      return {
        onContextMenu: (e) => {
          if (!ausEigenemBaum(e)) return;
          // Ohne langen Druck ist ein `contextmenu` nach Finger oder Stift das Halten des Systems,
          // kein Rechtsklick: es bleibt beim Systemmenü (Markieren, Kopieren).
          if (
            optionenRef.current.langerDruck === false &&
            (letzterZeiger.current === 'touch' || letzterZeiger.current === 'pen')
          ) {
            return;
          }
          if (touchAktiv.current) {
            // Android-Chrome meldet den langen Druck selbst; der eigene Zeitgeber öffnet (D3).
            e.preventDefault();
            e.stopPropagation();
            return;
          }
          if (browsermenueBleibt(e.target)) return;
          const element = e.currentTarget as unknown as HTMLElement | SVGElement;
          if (!oeffne(element, { x: e.clientX, y: e.clientY }, 'zeiger')) return;
          e.preventDefault();
          e.stopPropagation();
        },

        onPointerDown: (e) => {
          letzterZeiger.current = e.pointerType;
          if (optionenRef.current.langerDruck === false) return;
          if (e.pointerType === 'mouse' || !ausEigenemBaum(e)) return;
          loesen();
          if (browsermenueBleibt(e.target)) return;
          if (optionenRef.current.kannOeffnen?.(schluessel) === false) return;
          const element = e.currentTarget as unknown as HTMLElement | SVGElement;
          element.setAttribute(DRUCK_ATTRIBUT, '');
          const x = e.clientX;
          const y = e.clientY;
          touchAktiv.current = true;
          const timer = window.setTimeout(() => {
            const d = druck.current;
            if (d?.timer !== timer) return;
            // Der Druck bleibt bis zum Abheben „aktiv“: das native Menü kommt oft erst danach.
            druck.current = { ...d, timer: -1 };
            if (!oeffne(element, { x, y }, 'zeiger')) {
              // Doch keine Einträge: Markieren und Browsermenü wieder frei (D2).
              druckEnde();
              return;
            }
            // Ohne Finger (Stift ohne Touch-Ereignisse) bleibt der Touch-Riegel stumpf; dann
            // schluckt der eigene die Ereignisse des Abhebens.
            if (riegel.current?.quelleFuerKontextmenue() !== 'touch') {
              stiftRiegel.current = { bis: Infinity };
            }
          }, LANGDRUCK_MS);
          druck.current = { timer, x, y, pointerId: e.pointerId, element };
        },

        onPointerMove: (e) => {
          const d = druck.current;
          if (!d || d.timer === -1 || e.pointerId !== d.pointerId) return;
          if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > LANGDRUCK_WEG) druckEnde();
        },

        onPointerUp: () => {
          if (druck.current) druckEnde();
        },

        onPointerCancel: () => {
          if (druck.current) druckEnde();
        },

        onKeyDown: (e) => {
          if (!istKontextTaste(e) || inEingabe(e.target) || !ausEigenemBaum(e)) return;
          const element = e.currentTarget as unknown as HTMLElement | SVGElement;
          const anker = (optionenRef.current.tastaturAnker ?? untenLinks)(element);
          if (!oeffne(element, anker, 'tastatur')) return;
          tasteZeit.current = performance.now();
          e.preventDefault();
          e.stopPropagation();
        },
      };
    },
    [loesen, druckEnde],
  );
}
