import { useLayoutEffect, useState, useSyncExternalStore } from 'react';

/**
 * Die Höhe dessen, was am oberen Fensterrand klebt (LFH-952, `frontend/AGENTS.md`, Rahmen):
 * ab `md` die Kopfleiste, unter `md` die Betriebszeile, solange sie eine Verbindungsstörung
 * meldet. Herleitung: `openspec/changes/lfh-952-app-rahmen-stehen-bleiben/design.md`, D2.
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
 * Stil des klebenden Rahmens selbst: an der Fensterkante, auf {@link RAHMEN_EBENE}. Nur der Rahmen
 * (Kopf ab `md`, Betriebszeile unter `md` im Störungsfall) trägt ihn; alles andere hängt sich mit
 * `var(--lfh-rahmen-oben)` darunter.
 */
export const RAHMEN_KLEBT = { position: 'sticky', top: 0, zIndex: RAHMEN_EBENE } as const;

/** antds Hüllen mit eigenem Scrollbereich, in denen der Dokument-Rahmen nicht gilt. */
const EIGENER_SCROLLBEREICH = '.ant-drawer-body, .ant-modal-wrap';

const anteile = new Map<symbol, number>();
const hoerer = new Set<() => void>();
let summe = 0;

function neuRechnen(): void {
  let neu = 0;
  for (const wert of anteile.values()) neu += wert;
  document.documentElement.style.setProperty(RAHMEN_OBEN_VAR, `${neu}px`);
  if (neu === summe) return;
  summe = neu;
  for (const h of hoerer) h();
}

function abonniere(h: () => void): () => void {
  hoerer.add(h);
  return () => hoerer.delete(h);
}

/** Die aktuelle Summe in px — rein lesend, für Aufrufer außerhalb von React. */
export function leseRahmenOben(): number {
  return summe;
}

/** Die Summe in px; rendert neu, sobald sie sich ändert. */
export function useRahmenOben(): number {
  return useSyncExternalStore(abonniere, leseRahmenOben, leseRahmenOben);
}

/**
 * Meldet ein Element als klebende Quelle, solange `aktiv` gilt; das Ergebnis ist der Callback-Ref
 * dafür. Callback-Ref statt `useRef`: tauscht React das Element (der Rahmen hängt nach einem
 * Fehlerausstieg neu ein), beobachtet der Effekt das neue — mit einem `RefObject` in den
 * Abhängigkeiten bliebe er am alten hängen (dieselbe Falle wie `einsatz/fussFokusabstand.ts`).
 *
 * Die erste Messung läuft in `useLayoutEffect`, also vor dem ersten Bild: sonst säße ein stehender
 * Tabellenkopf ein Bild lang unter dem Kopf. Danach hält ein `ResizeObserver` den Wert (Umbruch,
 * Dichtewechsel).
 */
export function useRahmenObenQuelle<T extends HTMLElement>(aktiv: boolean): (el: T | null) => void {
  const [el, setEl] = useState<T | null>(null);
  useLayoutEffect(() => {
    if (!aktiv || !el) return;
    const schluessel = Symbol('rahmen-oben');
    const messen = () => {
      anteile.set(schluessel, el.offsetHeight);
      neuRechnen();
    };
    messen();
    const beobachter = new ResizeObserver(messen);
    beobachter.observe(el);
    return () => {
      beobachter.disconnect();
      anteile.delete(schluessel);
      neuRechnen();
    };
  }, [el, aktiv]);
  return setEl;
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
