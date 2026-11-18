import { describe, expect, it } from 'vitest';
import type { Auftrag } from '../../api/types';
import { auftragsZeilen } from './auftragsZeilen';

function auftrag(teil: Partial<Auftrag>): Auftrag {
  return {
    id: 1,
    lfd_nr: 1,
    auftrag_text: 'Erkunden',
    bearbeitungsstatus: 'offen',
    erteilt_at: '2026-03-28 10:00:00',
    empfaenger: [],
    ...teil,
  } as Auftrag;
}

describe('auftragsZeilen', () => {
  it('ordnet nach Nummer, ohne Nummer hinten, und behält aufgehobene', () => {
    const zeilen = auftragsZeilen([
      auftrag({
        id: 3,
        lfd_nr: 7,
        bearbeitungsstatus: 'aufgehoben',
        aufgehoben_at: '2026-03-28 12:00:00',
      }),
      auftrag({ id: 2, lfd_nr: null, erteilt_at: '2026-03-28 09:00:00' }),
      auftrag({
        id: 1,
        lfd_nr: 2,
        bearbeitungsstatus: 'abgenommen',
        vollzogen_at: '2026-03-28 11:00:00',
        abgenommen_at: '2026-03-28 11:30:00',
        empfaenger: [{ snap_anzeige: 'Zug 1' }, { snap_anzeige: 'S2' }] as Auftrag['empfaenger'],
      }),
    ]);
    expect(zeilen.map((z) => [z.nummer, z.status, z.abschlussAt, z.empfaenger])).toEqual([
      ['#2', 'Abgenommen', '2026-03-28 11:30:00', 'Zug 1, S2'],
      ['#7', 'Aufgehoben', '2026-03-28 12:00:00', ''],
      ['–', 'Offen', null, ''],
    ]);
  });
});
