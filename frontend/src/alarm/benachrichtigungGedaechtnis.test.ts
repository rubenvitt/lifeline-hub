import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AUSGEBLENDET_SCHLUESSEL,
  ausgeblendetRaeumen,
  blendeAus,
  istAusgeblendet,
  vergissAusgeblendet,
} from './benachrichtigungGedaechtnis';

/** Spec `benachrichtigungen`, „Ausblenden quittiert nicht“ (LLH-1736, design.md D4). */
describe('Gedächtnis „ausgeblendet“', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('merkt sich eine ausgeblendete Benachrichtigung', () => {
    blendeAus(40);
    expect(istAusgeblendet(40)).toBe(true);
    expect(istAusgeblendet(41)).toBe(false);
  });

  it('übersteht ein Neuladen des Tabs über sessionStorage', async () => {
    blendeAus(40);
    vi.resetModules();
    const frisch = await import('./benachrichtigungGedaechtnis');
    expect(frisch.istAusgeblendet(40)).toBe(true);
  });

  it('vergisst sie, sobald sie quittiert ist', async () => {
    blendeAus(40);
    vergissAusgeblendet(40);
    expect(istAusgeblendet(40)).toBe(false);
    vi.resetModules();
    const frisch = await import('./benachrichtigungGedaechtnis');
    expect(frisch.istAusgeblendet(40)).toBe(false);
  });

  it('räumt beim Ausgang Gedächtnis und Speicher', () => {
    blendeAus(40);
    ausgeblendetRaeumen();
    expect(istAusgeblendet(40)).toBe(false);
    expect(sessionStorage.getItem(AUSGEBLENDET_SCHLUESSEL)).toBeNull();
  });

  it('arbeitet ohne Speicher weiter, wenn er wirft', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('gesperrt', 'SecurityError');
    });
    expect(() => blendeAus(40)).not.toThrow();
    expect(istAusgeblendet(40)).toBe(true);
  });

  it('liest einen kaputten Speicherwert als leer', async () => {
    sessionStorage.setItem(AUSGEBLENDET_SCHLUESSEL, '{kaputt');
    vi.resetModules();
    const frisch = await import('./benachrichtigungGedaechtnis');
    expect(frisch.istAusgeblendet(40)).toBe(false);
  });
});
