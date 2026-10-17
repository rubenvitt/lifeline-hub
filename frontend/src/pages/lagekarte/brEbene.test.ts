import { describe, expect, it } from 'vitest';
import { checkBrZugriff, BR_MODUL } from './brEbene';
import { freigabenFixture } from '../../test/fixtures';

const basis = {
  freigaben: freigabenFixture(),
  abgelehnt: false,
};

describe('checkBrZugriff (LLH-1107, Freigaben vom Server: LFH-669)', () => {
  it('die Registry kennt das Modul — sonst prüfte alles hier ins Leere', () => {
    expect(BR_MODUL?.key).toBe('bereitstellungsraeume');
  });
  it('frei, wenn das Modul sichtbar und nicht gesperrt ist', () => {
    expect(checkBrZugriff(basis)).toBe('frei');
  });
  it('ausgeblendet, solange die Freigaben offen sind oder das Modul im Einsatz versteckt ist', () => {
    expect(checkBrZugriff({ ...basis, freigaben: undefined })).toBe('ausgeblendet');
    expect(
      checkBrZugriff({
        ...basis,
        freigaben: freigabenFixture({ bereitstellungsraeume: { sichtbar: false, zugriff: false } }),
      }),
    ).toBe('ausgeblendet');
  });
  it('gesperrt, wenn der Server den Zugriff verweigert oder die Liste mit 403 kommt', () => {
    expect(
      checkBrZugriff({
        ...basis,
        freigaben: freigabenFixture({ bereitstellungsraeume: { zugriff: false } }),
      }),
    ).toBe('gesperrt');
    expect(checkBrZugriff({ ...basis, abgelehnt: true })).toBe('gesperrt');
  });
});
