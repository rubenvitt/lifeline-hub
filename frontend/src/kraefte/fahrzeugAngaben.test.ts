import { describe, expect, it } from 'vitest';
import type { EinsatzFahrzeug } from '../api/types';
import { angabenVon, buildAngabenPatch, hasFehlerIn } from './fahrzeugAngaben';

const zeile = {
  id: 10,
  funkrufname: 'Florian Nachbarstdt 44/1',
  fahrzeugtyp: null,
  kennzeichen: 'NB-FW 441',
  traegerorganisation: 'FF Nachbarstadt',
  opta: null,
} as unknown as EinsatzFahrzeug;

describe('Angaben eines Ad-hoc-Fahrzeugs (LLH-1073, design.md D7)', () => {
  it('sendet nur, was sich gegenüber der Vorbelegung geändert hat', () => {
    expect(
      buildAngabenPatch(zeile, {
        ...angabenVon(zeile),
        funkrufname: 'Florian Nachbarstadt 44/1',
        fahrzeugtyp: 'HLF 20',
      }),
    ).toEqual({ funkrufname: 'Florian Nachbarstadt 44/1', fahrzeugtyp: 'HLF 20' });
  });

  it('ein geleertes Feld geht als null, ein unberührtes gar nicht', () => {
    expect(buildAngabenPatch(zeile, { ...angabenVon(zeile), traegerorganisation: '   ' })).toEqual({
      traegerorganisation: null,
    });
    expect(buildAngabenPatch(zeile, { ...angabenVon(zeile), kennzeichen: undefined })).toEqual({
      kennzeichen: null,
    });
  });

  it('ohne Änderung, auch mit Leerraum drumherum, ein leeres Patch', () => {
    expect(buildAngabenPatch(zeile, angabenVon(zeile))).toEqual({});
    expect(
      buildAngabenPatch(zeile, { ...angabenVon(zeile), funkrufname: ' Florian Nachbarstdt 44/1 ' }),
    ).toEqual({});
  });

  it('erkennt einen Prüffehler im Klappteil', () => {
    expect(hasFehlerIn(['kennzeichen', 'opta'], ['opta'])).toBe(true);
    expect(hasFehlerIn(['kennzeichen', 'opta'], ['funkrufname'])).toBe(false);
  });
});
