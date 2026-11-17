import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearStartlisteAusgeblendet,
  isStartlisteAusgeblendet,
  saveStartlisteAusgeblendet,
} from './startlisteSpeicher';

/** Ausblenden der Startliste je Browser (LLH-1815, design.md D4). */
describe('startlisteSpeicher (LLH-1815)', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('merkt das Ausblenden je Einsatz unter `startliste-ausgeblendet:<einsatz>`', () => {
    expect(isStartlisteAusgeblendet(7)).toBe(false);
    expect(saveStartlisteAusgeblendet(7)).toBe(true);
    expect(localStorage.getItem('startliste-ausgeblendet:7')).toBe('1');
    expect(isStartlisteAusgeblendet(7)).toBe(true);
    expect(isStartlisteAusgeblendet(8)).toBe(false);
  });

  it('räumt jeden Einsatz und lässt fremde Schlüssel stehen', () => {
    saveStartlisteAusgeblendet(7);
    saveStartlisteAusgeblendet(8);
    localStorage.setItem('lfh:spalten:personen', 'name');
    clearStartlisteAusgeblendet();
    expect(isStartlisteAusgeblendet(7)).toBe(false);
    expect(isStartlisteAusgeblendet(8)).toBe(false);
    expect(localStorage.getItem('lfh:spalten:personen')).toBe('name');
  });

  it('ohne Speicher: nichts ausgeblendet, Schreiben meldet falsch, nichts wirft', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('gesperrt', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('voll', 'QuotaExceededError');
    });
    expect(isStartlisteAusgeblendet(7)).toBe(false);
    expect(saveStartlisteAusgeblendet(7)).toBe(false);
    expect(() => clearStartlisteAusgeblendet()).not.toThrow();
  });
});
