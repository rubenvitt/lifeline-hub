import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Fremdebene } from '../../api/fremdebenen';
import { sicherLesen } from '../../lib/sichererSpeicher';
import {
  FREMDEBENEN_SICHT_SCHLUESSEL,
  fremdebeneTakt,
  leseAusgeblendet,
  schreibeAusgeblendet,
} from './useFremdebenen';

const URL_EBENE = { id: 5, source: 'url' } as Fremdebene;
const DATEI = { id: 4, source: 'datei' } as Fremdebene;

describe('Abruftakt einer Fremdebene (LLH-2099)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('holt eine sichtbare URL-Ebene im Minutentakt, solange der Tab sichtbar ist', () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    expect(fremdebeneTakt(URL_EBENE, true)).toBe(60_000);
    expect(fremdebeneTakt(URL_EBENE, false)).toBe(false);
    expect(fremdebeneTakt(DATEI, true)).toBe(false);
  });

  it('pausiert im verborgenen Tab', () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    expect(fremdebeneTakt(URL_EBENE, true)).toBe(false);
  });
});

describe('Sichtbarkeit je Arbeitsplatz (LLH-2099)', () => {
  afterEach(() => localStorage.clear());

  it('merkt die ausgeblendeten Ebenen je Einsatz; neue Ebenen sind sichtbar', () => {
    expect(leseAusgeblendet(3)).toEqual(new Set());
    schreibeAusgeblendet(3, new Set([5]));
    expect(sicherLesen(`${FREMDEBENEN_SICHT_SCHLUESSEL}:3`)).toBe('[5]');
    expect(leseAusgeblendet(3)).toEqual(new Set([5]));
    expect(leseAusgeblendet(4)).toEqual(new Set());
  });

  it('übersteht einen kaputten Eintrag', () => {
    localStorage.setItem(`${FREMDEBENEN_SICHT_SCHLUESSEL}:3`, 'kaputt');
    expect(leseAusgeblendet(3)).toEqual(new Set());
    localStorage.setItem(`${FREMDEBENEN_SICHT_SCHLUESSEL}:3`, '[5,"x",7]');
    expect(leseAusgeblendet(3)).toEqual(new Set([5, 7]));
  });
});
