import { describe, expect, it } from 'vitest';
import type { KanalMitStelle } from '../api/types';
import { empfaengerVorschlag } from './empfaengerVorschlag';

const kanal = (id: number, stelle: string, stelleId = id): KanalMitStelle => ({
  agency_id: stelleId,
  agency_name: stelle,
  channel: { id, externe_stelle_id: stelleId, channel: 'email', address: `s${id}@example.org` },
});

describe('empfaengerVorschlag', () => {
  it('trifft ohne Groß/Klein und Leerraum', () => {
    const k = [kanal(1, 'leitstelle nord')];
    expect(empfaengerVorschlag(k, ['Leitstelle  Nord'])).toEqual(new Set([1]));
  });

  it('trifft nur den ganzen Namen, nicht einen Teil', () => {
    const k = [kanal(1, 'Leitstelle Nord')];
    expect(empfaengerVorschlag(k, ['Nord']).size).toBe(0);
  });

  it('wählt alle Adressen einer getroffenen Stelle', () => {
    const k = [kanal(1, 'ILS', 7), kanal(2, 'ILS', 7), kanal(3, 'Andere', 8)];
    expect(empfaengerVorschlag(k, ['ils'])).toEqual(new Set([1, 2]));
  });

  it('ignoriert leere Namen', () => {
    expect(empfaengerVorschlag([kanal(1, 'ILS')], ['', '  ']).size).toBe(0);
  });
});
