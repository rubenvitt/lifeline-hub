import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  bandAbstand,
  entferneUntereLeiste,
  meldeUntereLeiste,
  untereLeisten,
  useUntereLeisten,
} from './untereLeiste';

/**
 * Untere Leisten und das Ausweichen des Eingangsbands (LLH-1424). Geprüft werden Anmeldung und
 * Rechnung; ob der Browser damit wirklich freihält, belegt `e2e/eingangsband-ausweichen.spec.ts`.
 */

const gemeldet: HTMLElement[] = [];

function melde() {
  const el = document.createElement('div');
  gemeldet.push(el);
  meldeUntereLeiste(el);
  return el;
}

afterEach(() => {
  for (const el of gemeldet.splice(0)) entferneUntereLeiste(el);
});

describe('Anmeldung', () => {
  it('führt angemeldete Leisten, doppelt Gemeldetes einmal, und vergisst Abgemeldetes', () => {
    expect(untereLeisten()).toEqual([]);
    const a = melde();
    meldeUntereLeiste(a);
    const b = melde();
    expect(untereLeisten()).toEqual([a, b]);
    entferneUntereLeiste(a);
    expect(untereLeisten()).toEqual([b]);
  });

  it('der Hook folgt An- und Abmelden', () => {
    function Anzeige() {
      return <output>{useUntereLeisten().length}</output>;
    }
    render(<Anzeige />);
    expect(screen.getByRole('status')).toHaveTextContent('0');
    let a: HTMLElement;
    act(() => {
      a = melde();
    });
    expect(screen.getByRole('status')).toHaveTextContent('1');
    act(() => entferneUntereLeiste(a));
    expect(screen.getByRole('status')).toHaveTextContent('0');
  });
});

describe('bandAbstand', () => {
  // Fenster 900 hoch, Band 130 hoch rechts (966–1350), Rand 16: am Rand belegt es 754–884.
  const grund = {
    fenster: 900,
    rand: 16,
    band: { hoehe: 130, left: 966, right: 1350 },
  };
  const leiste = (top: number, bottom: number, left = 0, right = 1366) => ({
    top,
    bottom,
    left,
    right,
  });

  it('ohne Leiste steht das Band am Rand', () => {
    expect(bandAbstand({ ...grund, leisten: [] })).toBe(16);
  });

  it('über einer klebenden Leiste steht es um deren Höhe plus Rand darüber', () => {
    expect(bandAbstand({ ...grund, leisten: [leiste(780, 900)] })).toBe(136);
  });

  it('über einer nicht klebenden Leiste (kurze Seite) richtet es sich nach ihrer Oberkante', () => {
    // Leeres ETB: die Erfassung steht mitten im Fenster und reicht in die Zone des Bands.
    expect(bandAbstand({ ...grund, leisten: [leiste(501, 780)] })).toBe(415);
  });

  it('eine Leiste über der Zone des Bands lässt es am Rand', () => {
    expect(bandAbstand({ ...grund, leisten: [leiste(300, 600)] })).toBe(16);
  });

  it('eine Leiste neben dem Band (waagerecht frei) lässt es am Rand', () => {
    expect(bandAbstand({ ...grund, leisten: [leiste(780, 900, 0, 900)] })).toBe(16);
  });

  it('eine Leiste ohne Fläche zählt nicht', () => {
    expect(bandAbstand({ ...grund, leisten: [leiste(0, 0, 0, 0)] })).toBe(16);
  });

  it('über zwei gestapelten Leisten landet es über der oberen', () => {
    // Untere Leiste 820–900, darüber eine weitere 700–800: nach dem ersten Rücken schnitte das
    // Band die zweite.
    expect(bandAbstand({ ...grund, leisten: [leiste(700, 800), leiste(820, 900)] })).toBe(216);
  });
});
