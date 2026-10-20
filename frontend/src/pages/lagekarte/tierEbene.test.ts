import { describe, expect, it } from 'vitest';
import { checkTierZugriff, TIER_MODUL } from './tierEbene';
import { freigabenFixture } from '../../test/fixtures';

const basis = {
  freigaben: freigabenFixture(),
  abgelehnt: false,
};

describe('checkTierZugriff (LLH-1123)', () => {
  it('die Registry kennt das Modul — sonst prüfte alles hier ins Leere', () => {
    expect(TIER_MODUL?.key).toBe('tiere');
  });
  it('frei, wenn das Modul sichtbar und nicht gesperrt ist', () => {
    expect(checkTierZugriff(basis)).toBe('frei');
  });
  it('ausgeblendet, solange die Freigaben offen sind oder das Modul im Einsatz versteckt ist', () => {
    expect(checkTierZugriff({ ...basis, freigaben: undefined })).toBe('ausgeblendet');
    expect(
      checkTierZugriff({
        ...basis,
        freigaben: freigabenFixture({ tiere: { sichtbar: false, zugriff: false } }),
      }),
    ).toBe('ausgeblendet');
  });
  it('gesperrt, wenn der Server den Zugriff verweigert oder die Liste mit 403 kommt', () => {
    expect(
      checkTierZugriff({ ...basis, freigaben: freigabenFixture({ tiere: { zugriff: false } }) }),
    ).toBe('gesperrt');
    expect(checkTierZugriff({ ...basis, abgelehnt: true })).toBe('gesperrt');
  });
});
