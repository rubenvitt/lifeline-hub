import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { entferneUntereLeiste, meldeUntereLeiste } from '../components/untereLeiste';
import Eingangsband, { bandUnten } from './Eingangsband';

/**
 * Das Eingangsband weicht unteren Leisten aus (LLH-1424, Spec `benachrichtigungen`, „Das
 * Eingangsband verdeckt keine untere Leiste“). jsdom rechnet kein Layout: die Kästen sind hier
 * gesetzt, geprüft wird die Kopplung von Anmeldung, Messung und Abstand. Den Nachweis ohne
 * Überdeckung im Browser führt `e2e/eingangsband-ausweichen.spec.ts`.
 */

describe('bandUnten', () => {
  it('am Rand hält das Band die sichere Fläche frei', () => {
    expect(bandUnten(16, 16)).toBe('max(16px, calc(16px + env(safe-area-inset-bottom, 0px)))');
  });

  it('über einer Leiste steht es im gerechneten Abstand', () => {
    expect(bandUnten(16, 136)).toBe('max(136px, calc(16px + env(safe-area-inset-bottom, 0px)))');
  });
});

describe('Eingangsband', () => {
  const leiste = document.createElement('div');

  beforeEach(() => {
    Object.defineProperty(document.documentElement, 'clientHeight', {
      configurable: true,
      value: 900,
    });
    // Band rechts, 130 hoch; Leiste über die volle Breite am Fuß, 120 hoch.
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      const k =
        this === leiste
          ? { top: 780, bottom: 900, left: 0, right: 1366, height: 120 }
          : this.getAttribute('data-lfh') === 'eingangsband'
            ? { top: 0, bottom: 130, left: 966, right: 1350, height: 130 }
            : {};
      return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, ...k } as DOMRect;
    });
  });

  afterEach(() => {
    entferneUntereLeiste(leiste);
    vi.restoreAllMocks();
    // Zurück auf jsdoms Getter am Prototyp.
    delete (document.documentElement as { clientHeight?: number }).clientHeight;
  });

  function band() {
    return render(
      <Eingangsband
        titel="Neue Meldung"
        aktion={{ text: 'Öffnen', beiKlick: () => {} }}
        beiSchliessen={() => {}}
      >
        Inhalt
      </Eingangsband>,
    );
  }

  it('rückt über eine angemeldete untere Leiste und kehrt zurück, wenn sie geht', () => {
    band();
    const abstand = () =>
      Number(screen.getByRole('region', { name: 'Neue Eingänge' }).dataset.abstandUnten);
    const rand = abstand();
    expect(rand).toBeGreaterThan(0);
    act(() => meldeUntereLeiste(leiste));
    // Über der Oberkante der Leiste (900 − 780) plus Rand.
    expect(abstand()).toBe(120 + rand);
    act(() => entferneUntereLeiste(leiste));
    expect(abstand()).toBe(rand);
  });
});
