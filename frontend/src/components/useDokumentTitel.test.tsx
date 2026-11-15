import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dokumentTitel, useDokumentTitel } from './useDokumentTitel';

describe('dokumentTitel', () => {
  it('verbindet die Teile mit „ · “ und hängt die Marke an', () => {
    expect(dokumentTitel(['ETB', 'Starkregen Nord'])).toBe('ETB · Starkregen Nord · lifeline-hub');
  });

  it('lässt leere Teile weg', () => {
    // Solange der Einsatz lädt, fehlt sein Name; ein „ETB ·  · lifeline-hub“ hieße nichts.
    expect(dokumentTitel(['ETB', undefined, null, ' '])).toBe('ETB · lifeline-hub');
    expect(dokumentTitel([])).toBe('lifeline-hub');
  });

  it('stellt die Zahl der unbearbeiteten Meldungen voran, 0 nicht (LLH-1062)', () => {
    expect(dokumentTitel(['Lagekarte', 'Starkregen Nord'], 3)).toBe(
      '(3) Lagekarte · Starkregen Nord · lifeline-hub',
    );
    expect(dokumentTitel(['Lagekarte'], 0)).toBe('Lagekarte · lifeline-hub');
    expect(dokumentTitel(['Lagekarte'])).toBe('Lagekarte · lifeline-hub');
  });
});

describe('dokumentTitel · Übung (LLH-1725, Spec `seiten-orientierung`)', () => {
  it('stellt „ÜBUNG · “ vor alles, auch vor die Zahl', () => {
    expect(dokumentTitel(['ETB', 'Starkregen Nord'], undefined, { uebung: true })).toBe(
      'ÜBUNG · ETB · Starkregen Nord · lifeline-hub',
    );
    expect(dokumentTitel(['ETB', 'Starkregen Nord'], 3, { uebung: true })).toBe(
      'ÜBUNG · (3) ETB · Starkregen Nord · lifeline-hub',
    );
  });

  it('ohne Übung bleibt der Titel unverändert', () => {
    expect(dokumentTitel(['ETB', 'Starkregen Nord'], 3, { uebung: false })).toBe(
      '(3) ETB · Starkregen Nord · lifeline-hub',
    );
  });
});

describe('useDokumentTitel', () => {
  beforeEach(() => {
    document.title = 'lifeline-hub';
  });
  afterEach(() => {
    document.title = '';
  });

  it('setzt den Titel und folgt neuen Teilen', () => {
    const { rerender } = renderHook(({ teile }) => useDokumentTitel(teile), {
      initialProps: { teile: ['ETB'] as (string | undefined)[] },
    });
    expect(document.title).toBe('ETB · lifeline-hub');
    rerender({ teile: ['ETB', 'Starkregen Nord'] });
    expect(document.title).toBe('ETB · Starkregen Nord · lifeline-hub');
  });

  it('stellt beim Abbau den vorigen Titel wieder her', () => {
    document.title = 'Einsätze · lifeline-hub';
    const { unmount } = renderHook(() => useDokumentTitel(['Profil']));
    expect(document.title).toBe('Profil · lifeline-hub');
    unmount();
    expect(document.title).toBe('Einsätze · lifeline-hub');
  });
});
