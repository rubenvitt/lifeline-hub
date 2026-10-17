import { describe, expect, it } from 'vitest';
import type { GeraetAnzeige } from '../api/types';
import { geraetDarf } from './geraetSicht';

const ANSICHTEN: GeraetAnzeige['ansicht'][] = [
  'uhs-tablet',
  'uhs-laptop',
  'lagemonitor',
  'betreuungsstelle',
  'bereitstellungsraum',
  'einsatzabschnitt',
  'verpflegung',
];

const geraet = (ansicht: GeraetAnzeige['ansicht']): GeraetAnzeige => ({
  ansicht,
  bezeichnung: 'Tablet',
  einsatz_id: 1,
  kopplung_id: 1,
  laeuft_ab_at: '2026-10-17T00:00:00Z',
  stelle_id: 4,
});

describe('geraetDarf', () => {
  it('eine Person darf alles', () => {
    expect(geraetDarf(null, 'br-eintreffen')).toBe(true);
    expect(geraetDarf(null, 'br-verwalten')).toBe(true);
    expect(geraetDarf(null, 'br-abrufen')).toBe(true);
  });

  describe('br-abrufen (LLH-1085): abrufen ist eine Entscheidung der Führung', () => {
    it.each(ANSICHTEN)('Ansicht %s ruft nicht ab', (ansicht) => {
      expect(geraetDarf(geraet(ansicht), 'br-abrufen')).toBe(false);
    });
  });

  describe('br-eintreffen (LLH-1075, design.md D14)', () => {
    it.each(ANSICHTEN)('Ansicht %s', (ansicht) => {
      expect(geraetDarf(geraet(ansicht), 'br-eintreffen')).toBe(ansicht === 'bereitstellungsraum');
    });

    it('der Bereitstellungsraum verwaltet trotzdem keine Räume', () => {
      expect(geraetDarf(geraet('bereitstellungsraum'), 'br-verwalten')).toBe(false);
    });
  });
});
