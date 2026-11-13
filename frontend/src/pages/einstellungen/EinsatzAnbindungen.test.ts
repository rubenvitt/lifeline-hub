import { describe, expect, it } from 'vitest';
import type { AnbindungFreigabe } from '../../api/types';
import { freigabeZustand } from './EinsatzAnbindungen';

const anbindung = (extra: Partial<AnbindungFreigabe> = {}): AnbindungFreigabe => ({
  zugang_id: 'z-1',
  name: 'FüKW Monitor',
  scopes: ['lage:read'],
  zustand: 'aktiv',
  freigegeben: false,
  anderer_einsatz: false,
  ruht: false,
  ...extra,
});
const zeit = (wert: string) => wert.slice(11, 16);

describe('freigabeZustand (LLH-1638)', () => {
  it('nennt die drei Zustände der Freigabe', () => {
    expect(freigabeZustand(anbindung(), zeit)).toBe('nicht freigegeben');
    expect(freigabeZustand(anbindung({ freigegeben: true }), zeit)).toBe('liest diesen Einsatz');
    expect(freigabeZustand(anbindung({ anderer_einsatz: true }), zeit)).toBe(
      'liest einen anderen Einsatz',
    );
  });

  it('nennt eine ruhende Freigabe mit dem Grund, statt „liest“ zu behaupten', () => {
    expect(freigabeZustand(anbindung({ freigegeben: true, ruht: true }), zeit)).toBe(
      'Freigabe ruht: Instanz meldet sich bei einem Hub',
    );
  });

  it('hängt den wartenden Schlüssel und den letzten Abruf an', () => {
    expect(freigabeZustand(anbindung({ freigegeben: true, zustand: 'wartet' }), zeit)).toBe(
      'liest diesen Einsatz · wartet auf Schlüssel',
    );
    expect(
      freigabeZustand(
        anbindung({ freigegeben: true, zuletzt_genutzt_at: '2026-11-12 19:02:11' }),
        zeit,
      ),
    ).toBe('liest diesen Einsatz · zuletzt 19:02');
  });
});
