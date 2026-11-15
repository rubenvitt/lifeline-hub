import { useLayoutEffect, useState, useSyncExternalStore } from 'react';

/**
 * Die Höhe dessen, was am oberen Fensterrand klebt (LFH-952, `frontend/AGENTS.md`, Rahmen): der
 * Kopf in jeder Breite (LLH-1728), darüber unter `md` die Betriebszeile, solange sie eine
 * Verbindungsstörung meldet, darunter in einer Übung das Übungsband. Herleitung: D2 in
 * `openspec/changes/archive/2026-10-06-lfh-952-app-rahmen-stehen-bleiben/design.md` und D2 in
 * `openspec/changes/ejt520so-handy-kopfleiste-fixiert/design.md` (Ränge).
 *
 * GEMESSEN, nicht aus Tokens gerechnet: der Kopf bricht auf schmalen Schirmen um (LFH-460) und
 * wächst mit der Dichte-Staffel. Jede Quelle meldet ihre Höhe, die Summe steht
 *  - als CSS-Variable {@link RAHMEN_OBEN_VAR} am `<html>` (für `top` und `scroll-padding`),
 *  - als Zahl über {@link useRahmenOben} (für rc-tables `offsetHeader`, das keine CSS liest).
 *
 * Ohne klebendes Element ist sie 0. Jedes Element, das selbst oben klebt, hängt sich darunter
 * (Guard `rahmenOben.guard.test.ts`).
 */
export const RAHMEN_OBEN_VAR = '--lfh-rahmen-oben';

/**
 * Stapelebene des klebenden Rahmens: über dem Inhalt samt angepinnter ETB-Leiste (20) und den
 * stehenden Tabellenköpfen, unter antds Overlays (Dropdown, Drawer, Modal ab 1000).
 */
export const RAHMEN_EBENE = 100;

/**
 * Stil des klebenden Rahmens selbst: auf {@link RAHMEN_EBENE}, `top` aus dem Stapel
 * ({@link useRahmenObenStapel}). Nur der Rahmen (Betriebszeile, Kopf, Übungsband) trägt ihn;
 * alles andere hängt sich mit `var(--lfh-rahmen-oben)` darunter.
 */
export const RAHMEN_KLEBT = { position: 'sticky', top: 0, zIndex: RAHMEN_EBENE } as const;

/**
 * Die Ränge der klebenden Quellen, von oben nach unten (LLH-1728, design.md D2). Eine Quelle klebt
 * unter allen mit kleinerem Rang; ihre Reihenfolge im DOM muss dazu passen. Gleiche Ränge stapeln
 * sich nicht gegeneinander.
 */
export const RAHMEN_RANG = { betriebszeile: 0, kopf: 1, uebungsband: 2 } as const;

export type RahmenRang = (typeof RAHMEN_RANG)[keyof typeof RAHMEN_RANG];

/** antds Hüllen mit eigenem Scrollbereich, in denen der Dokument-Rahmen nicht gilt. */
const EIGENER_SCROLLBEREICH = '.ant-drawer-body, .ant-modal-wrap';

const anteile = new Map<symbol, { hoehe: number; rang: RahmenRang }>();
const hoerer = new Set<() => void>();
let summe = 0;

/**
 * Schreibt die Summe und benachrichtigt, sobald sich ein Anteil geändert hat: auch wenn die Summe
 * gleich bleibt, kann sich das `oben` eines Rangs verschieben (eine Quelle wächst, eine andere
 * schrumpft).
 */
function neuRechnen(): void {
  let neu = 0;
  for (const { hoehe } of anteile.values()) neu += hoehe;
  document.documentElement.style.setProperty(RAHMEN_OBEN_VAR, `${neu}px`);
  summe = neu;
  for (const h of hoerer) h();
}

/** Die Summe der Quellen mit kleinerem Rang: das `top` einer Quelle dieses Rangs. */
function summeUeber(rang: RahmenRang): number {
  let oben = 0;
  for (const anteil of anteile.values()) if (anteil.rang < rang) oben += anteil.hoehe;
  return oben;
}

/** Hört auf Änderungen der Summe, außerhalb von React (`alarmOben.ts`). */
export function abonniereRahmenOben(h: () => void): () => void {
  hoerer.add(h);
  return () => hoerer.delete(h);
}

/** Die aktuelle Summe in px — rein lesend, für Aufrufer außerhalb von React. */
export function leseRahmenOben(): number {
  return summe;
}

/** Die Summe in px; rendert neu, sobald sie sich ändert. */
export function useRahmenOben(): number {
  return useSyncExternalStore(abonniereRahmenOben, leseRahmenOben, leseRahmenOben);
}

/**
 * Meldet ein Element als klebende Quelle, solange `aktiv` gilt; das Ergebnis ist der Callback-Ref
 * dafür. Callback-Ref statt `useRef`: tauscht React das Element (der Rahmen hängt nach einem
 * Fehlerausstieg neu ein), beobachtet der Effekt das neue — mit einem `RefObject` in den
 * Abhängigkeiten bliebe er am alten hängen (dieselbe Falle wie `einsatz/fussFokusabstand.ts`).
 *
 * Die erste Messung läuft in `useLayoutEffect`, also vor dem ersten Bild: sonst säße ein stehender
 * Tabellenkopf ein Bild lang unter dem Kopf. Danach hält ein `ResizeObserver` den Wert (Umbruch,
 * Dichtewechsel), geschrieben im nächsten Bild.
 */
export function useRahmenObenQuelle<T extends HTMLElement>(
  aktiv: boolean,
  eigenerSchluessel?: symbol,
  rang: RahmenRang = RAHMEN_RANG.betriebszeile,
): (el: T | null) => void {
  const [el, setEl] = useState<T | null>(null);
  useLayoutEffect(() => {
    if (!aktiv || !el) return;
    const schluessel = eigenerSchluessel ?? Symbol('rahmen-oben');
    const messen = () => {
      const alt = anteile.get(schluessel);
      const hoehe = el.offsetHeight;
      if (alt && alt.hoehe === hoehe && alt.rang === rang) return;
      anteile.set(schluessel, { hoehe, rang });
      neuRechnen();
    };
    messen();
    // Nicht im ResizeObserver schreiben: die Variable verändert sofort, was an ihr hängt (die Höhe
    // der IconRail, `calc(100dvh - var(--lfh-rahmen-oben))`), und Vorfahren, die der Fensterrahmen
    // beobachtet, wüchsen noch in derselben Auslieferungsrunde. Beim Live-Wechsel der Dichte
    // meldete der Browser dann „ResizeObserver loop completed with undelivered notifications“
    // (LLH-1335, `e2e/uhs-hoehe.spec.ts`). Ein Bild später, wie `FensterRahmen` und `alarmOben`.
    let geplant = 0;
    const beobachter = new ResizeObserver(() => {
      if (geplant) return;
      geplant = requestAnimationFrame(() => {
        geplant = 0;
        messen();
      });
    });
    beobachter.observe(el);
    return () => {
      beobachter.disconnect();
      if (geplant) cancelAnimationFrame(geplant);
      anteile.delete(schluessel);
      neuRechnen();
    };
  }, [el, aktiv, eigenerSchluessel, rang]);
  return setEl;
}

/**
 * Eine klebende Quelle im Stapel (LLH-1728, design.md D2): Betriebszeile, Kopf, Übungsband. Sie
 * meldet ihre Höhe (`ref`), und `oben` ist die Summe der Quellen mit kleinerem Rang, also ihr
 * `top`. Keine Rückkopplung: weder die eigene Höhe noch die der Quellen darunter verschiebt es.
 * Vorher galt „Summe ohne mich“ (LLH-1725, D4); das trug nur, solange genau eine Quelle unter den
 * übrigen hing.
 */
export function useRahmenObenStapel<T extends HTMLElement>(
  aktiv: boolean,
  rang: RahmenRang,
): { ref: (el: T | null) => void; oben: number } {
  const [schluessel] = useState(() => Symbol('rahmen-oben-stapel'));
  const ref = useRahmenObenQuelle<T>(aktiv, schluessel, rang);
  const oben = useSyncExternalStore(
    abonniereRahmenOben,
    () => summeUeber(rang),
    () => 0,
  );
  return { ref, oben };
}

/**
 * Wie {@link useRahmenOben}, aber 0, wenn das Element in einem eigenen Scrollbereich steht (Drawer,
 * Modal): dort rollt nicht das Dokument, und kein Rahmen klebt über der Tabelle. `element` muss
 * stabil sein (`useCallback`); geprüft wird beim Einhängen im Layout-Effekt, also vor dem ersten
 * Bild. Eine Tabelle wandert nicht zwischen Dokument und Drawer.
 */
export function useRahmenObenFuer(element: () => HTMLElement | null | undefined): number {
  const rahmenOben = useRahmenOben();
  const [eigenerBereich, setEigenerBereich] = useState(false);
  useLayoutEffect(() => {
    setEigenerBereich(element()?.closest(EIGENER_SCROLLBEREICH) != null);
  }, [element]);
  return eigenerBereich ? 0 : rahmenOben;
}
