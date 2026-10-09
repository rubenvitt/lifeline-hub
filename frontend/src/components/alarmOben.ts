import { useLayoutEffect, useState } from 'react';
import { abonniereRahmenOben, leseRahmenOben } from './rahmenOben';

/**
 * Oberkante der stehenden Alarme (LFH-1112, `frontend/AGENTS.md`, Rahmen; Spec
 * `einsatztauglichkeit-layout`): unter der untersten SICHTBAREN Bedienkante, also unter
 * Kommandoleiste und Seitenkopf, solange er im Bild ist. Rollt der Seitenkopf weg, rücken die
 * Alarme bis unter den klebenden Rahmen nach. Vorher lagen sie oben rechts über den Aktionen
 * beider Leisten.
 *
 * GEMESSEN wie `rahmenOben.ts`: Kopf und Seitenkopf brechen um und wachsen mit der
 * Dichte-Staffel. Jede Quelle meldet sich per Callback-Ref; die Kante steht als CSS-Variable
 * {@link ALARM_OBEN_VAR} am `<html>`. `index.css` reicht sie an antds `--notification-top`
 * weiter, die Oberkante der Benachrichtigungen (antd schreibt sie nur inline, wenn `top`
 * konfiguriert ist; deshalb trägt `AntApp` kein `top`).
 */
export const ALARM_OBEN_VAR = '--lfh-alarm-oben';

/** Luft zwischen Bedienkante und Alarm in px. */
export const ALARM_ABSTAND = 8;

/**
 * Die Kante aus den Unterkanten der Quellen im Fenster und der Höhe des klebenden Rahmens.
 * Eine weggerollte Quelle liegt über dem Fenster (negativ) und zählt nicht.
 */
export function alarmOben(unterkanten: readonly number[], rahmenOben: number): number {
  return Math.round(Math.max(0, rahmenOben, ...unterkanten)) + ALARM_ABSTAND;
}

const quellen = new Set<HTMLElement>();
let beobachter: ResizeObserver | null = null;
let abmelden: (() => void) | null = null;
let geplant = 0;

function schreiben(): void {
  geplant = 0;
  const unterkanten = [...quellen].map((el) => el.getBoundingClientRect().bottom);
  document.documentElement.style.setProperty(
    ALARM_OBEN_VAR,
    `${alarmOben(unterkanten, leseRahmenOben())}px`,
  );
}

/** Höchstens einmal je Bild: der Hörer hängt am Rollen. */
function planen(): void {
  if (geplant) return;
  geplant = requestAnimationFrame(schreiben);
}

function anmelden(el: HTMLElement): void {
  quellen.add(el);
  if (!beobachter) {
    beobachter = new ResizeObserver(planen);
    window.addEventListener('scroll', planen, { passive: true });
    window.addEventListener('resize', planen);
    abmelden = abonniereRahmenOben(planen);
  }
  beobachter.observe(el);
  // Vor dem ersten Bild: ein Alarm, der mit der Seite kommt, steht sonst ein Bild lang oben.
  schreiben();
}

function abmeldenQuelle(el: HTMLElement): void {
  quellen.delete(el);
  beobachter?.unobserve(el);
  if (quellen.size > 0) {
    planen();
    return;
  }
  beobachter?.disconnect();
  beobachter = null;
  window.removeEventListener('scroll', planen);
  window.removeEventListener('resize', planen);
  abmelden?.();
  abmelden = null;
  if (geplant) cancelAnimationFrame(geplant);
  geplant = 0;
  document.documentElement.style.removeProperty(ALARM_OBEN_VAR);
}

/**
 * Meldet ein Element als Bedienkante für die Alarme; das Ergebnis ist der Callback-Ref dafür
 * (Callback-Ref aus demselben Grund wie `useRahmenObenQuelle`: React kann das Element tauschen).
 */
export function useAlarmKante<T extends HTMLElement>(): (el: T | null) => void {
  const [el, setEl] = useState<T | null>(null);
  useLayoutEffect(() => {
    if (!el) return;
    anmelden(el);
    return () => abmeldenQuelle(el);
  }, [el]);
  return setEl;
}
