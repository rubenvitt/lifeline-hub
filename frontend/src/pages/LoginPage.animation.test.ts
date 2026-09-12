import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Die Anmelde-Animation darf den Absende-Knopf nicht überholen (LFH-345 · C10, Befund M18).
 *
 * Gemessen am 24.08.2026 stand der Anmelden-Knopf bei 0,46 s Versatz plus 0,6 s Dauer erst
 * nach **1,06 s** vollständig da — auf einem Einsatzgerät ist das die Zeit, in der jemand
 * ins Leere tippt. Die Karte kam 0,15 s später als der Hintergrund, die Felder gestaffelt
 * bei 0,3 und 0,38 s.
 *
 * Geprüft wird die CSS-QUELLE, nicht ein gerechneter Stil: jsdom rechnet kein Layout und
 * führt keine Animationen aus; `getComputedStyle` auf eine Keyframe-Animation liefert dort
 * nichts Belastbares. Der Text ist die Wahrheit, die im Browser ankommt.
 */
const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'LoginPage.css'), 'utf8');

/**
 * Schneidet den Regelkörper eines Selektors heraus (erste Fundstelle); `''`, wenn es die
 * Regel nicht gibt.
 *
 * Die Abwesenheit ist hier ein gültiger Zustand und kein Fehler: eine Zeile, die ihren
 * eigenen Versatz VERLOREN hat, fällt auf die gemeinsame Regel zurück — genau das ist das
 * Entstaffeln. Deshalb summiert {@link sichtbarNach} über mehrere Selektoren.
 */
function regelOderLeer(selektor: string): string {
  const start = css.indexOf(selektor);
  if (start < 0) return '';
  const auf = css.indexOf('{', start);
  const zu = css.indexOf('}', auf);
  return css.slice(auf + 1, zu);
}

/** Wie {@link regelOderLeer}, verlangt die Regel aber. */
function regel(selektor: string): string {
  const start = css.indexOf(selektor);
  expect(start, `Selektor nicht gefunden: ${selektor}`).toBeGreaterThanOrEqual(0);
  return regelOderLeer(selektor);
}

/** `0.6s` / `600ms` → Sekunden. */
function sekunden(wert: string): number {
  return wert.endsWith('ms') ? Number.parseFloat(wert) / 1000 : Number.parseFloat(wert);
}

/** Erste Zeitangabe in der `animation`-Kurzform (die Dauer steht dort immer zuerst). */
function dauerAus(koerper: string): number {
  const treffer = /animation:[^;]*?(\d*\.?\d+)(m?s)/.exec(koerper);
  return treffer ? sekunden(treffer[1] + treffer[2]) : 0;
}

function verzoegerungAus(koerper: string): number {
  const treffer = /animation-delay:\s*(\d*\.?\d+)(m?s)/.exec(koerper);
  return treffer ? sekunden(treffer[1] + treffer[2]) : 0;
}

/**
 * Wann ein Element vollständig da ist: Versatz plus Dauer. Sammelt beides über alle Regeln,
 * die den Selektor tragen — Dauer und Versatz stehen in `LoginPage.css` bewusst getrennt
 * (eine gemeinsame Regel für alle Zeilen, eine Versatz-Regel je Zeile).
 */
function sichtbarNach(selektoren: string[]): number {
  let dauer = 0;
  let versatz = 0;
  for (const s of selektoren) {
    const koerper = regelOderLeer(s);
    dauer = Math.max(dauer, dauerAus(koerper));
    versatz = Math.max(versatz, verzoegerungAus(koerper));
  }
  return dauer + versatz;
}

const GEMEINSAM = '.login-karte .ant-form-item,\n.login-karte .ant-btn';

describe('Anmelde-Animation (M18)', () => {
  it('zeigt den Anmelden-Knopf spaetestens 0,5 s nach dem Mount', () => {
    expect(sichtbarNach([GEMEINSAM, '.login-karte .login-absenden'])).toBeLessThanOrEqual(0.5);
  });

  it('laesst ihn nie spaeter erscheinen als die Felder, die er absendet', () => {
    const knopf = sichtbarNach([GEMEINSAM, '.login-karte .login-absenden']);
    const zweitesFeld = sichtbarNach([GEMEINSAM, '.login-karte .ant-form-item:nth-of-type(2)']);
    expect(knopf).toBeLessThanOrEqual(zweitesFeld);
  });

  it('laesst die Karte ohne Versatz aufziehen', () => {
    expect(verzoegerungAus(regel('.login-karte {'))).toBe(0);
  });

  // Die schaerfere Fassung derselben Aussage: die Staffelung ist nicht klein geworden,
  // sondern WEG. Eine eigene Versatz-Regel je Zeile ist genau das, was M18 beanstandet —
  // ihre Abwesenheit laesst sich nicht durch einen niedrigen Wert vortaeuschen.
  it('gibt weder Feldern noch Absende-Knopf einen eigenen Versatz', () => {
    expect(verzoegerungAus(regelOderLeer('.login-karte .ant-form-item:nth-of-type(1)'))).toBe(0);
    expect(verzoegerungAus(regelOderLeer('.login-karte .ant-form-item:nth-of-type(2)'))).toBe(0);
    expect(verzoegerungAus(regelOderLeer('.login-karte .login-absenden'))).toBe(0);
  });

  // Gegenaussage: die Animation ist ENTSTAFFELT, nicht abgeschafft — ein CSS ganz ohne
  // `animation` erfuellte alle Schranken oben und waere trotzdem eine andere Seite.
  it('behaelt eine Eingangsanimation ueberhaupt', () => {
    expect(dauerAus(regel(GEMEINSAM))).toBeGreaterThan(0);
    expect(dauerAus(regel('.login-karte {'))).toBeGreaterThan(0);
  });

  // Die Rücksicht auf reduzierte Bewegung darf beim Entstaffeln nicht verlorengehen.
  it('haelt die Ausnahme fuer reduzierte Bewegung', () => {
    expect(css).toContain('prefers-reduced-motion');
  });
});
