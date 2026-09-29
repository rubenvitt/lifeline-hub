import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Die Anmelde-Animation darf den Absende-Knopf nicht überholen (LFH-345, M18): wer schnell tippt
 * und Enter drückt, trifft sonst einen halb durchsichtigen Knopf.
 *
 * Geprüft wird die CSS-Quelle, nicht ein gerechneter Stil: jsdom rechnet kein Layout und führt
 * keine Animationen aus.
 */
const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'LoginPage.css'), 'utf8');

/**
 * Schneidet den Regelkörper eines Selektors heraus (erste Fundstelle); `''`, wenn es die Regel
 * nicht gibt.
 *
 * Die Abwesenheit ist ein gültiger Zustand: eine Zeile ohne eigenen Versatz fällt auf die
 * gemeinsame Regel zurück. Deshalb summiert {@link sichtbarNach} über mehrere Selektoren.
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

  // Die schärfere Fassung: die Staffelung ist weg, nicht klein. Die Abwesenheit einer Versatz-Regel
  // je Zeile lässt sich nicht durch einen niedrigen Wert vortäuschen.
  it('gibt weder Feldern noch Absende-Knopf einen eigenen Versatz', () => {
    expect(verzoegerungAus(regelOderLeer('.login-karte .ant-form-item:nth-of-type(1)'))).toBe(0);
    expect(verzoegerungAus(regelOderLeer('.login-karte .ant-form-item:nth-of-type(2)'))).toBe(0);
    expect(verzoegerungAus(regelOderLeer('.login-karte .login-absenden'))).toBe(0);
  });

  // Gegenaussage: entstaffelt, nicht abgeschafft — ein CSS ohne `animation` erfüllte alle Schranken
  // oben.
  it('behaelt eine Eingangsanimation ueberhaupt', () => {
    expect(dauerAus(regel(GEMEINSAM))).toBeGreaterThan(0);
    expect(dauerAus(regel('.login-karte {'))).toBeGreaterThan(0);
  });

  // Die Rücksicht auf reduzierte Bewegung darf beim Entstaffeln nicht verlorengehen.
  it('haelt die Ausnahme fuer reduzierte Bewegung', () => {
    expect(css).toContain('prefers-reduced-motion');
  });
});
