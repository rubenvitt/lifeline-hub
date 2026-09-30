import { describe, expect, it } from 'vitest';
import { ApiError } from '../../api/client';
import type { ModulZaehler } from '../../api/types';
import {
  auftraegeNotiz,
  auftragsStand,
  meldungenNotiz,
  meldungsStand,
  type ZaehlerAbfrage,
} from './fuehrungsZahlen';

const daten = (data: ModulZaehler): ZaehlerAbfrage => ({
  data,
  error: null,
  isError: false,
  isPending: false,
});

describe('Handlungsmengen aus dem Modulzähler (LFH-550)', () => {
  it('liest Aufträge und Meldungen aus der Serverantwort, zählt nichts selbst', () => {
    const q = daten({
      auftraege: { offen: 5, in_arbeit: 2, ueberfaellig: 1 },
      meldungen: { offen: 3, ungesehen: 1, bestaetigung_ueberfaellig: 2 },
    });
    expect(auftragsStand(q)).toEqual({
      zustand: 'daten',
      zahl: { offen: 5, in_arbeit: 2, ueberfaellig: 1 },
    });
    expect(meldungsStand(q)).toEqual({
      zustand: 'daten',
      zahl: { offen: 3, ungesehen: 1, bestaetigung_ueberfaellig: 2 },
    });
  });

  it('ein fehlendes Modul ist „gesperrt“, nie 0', () => {
    const q = daten({ auftraege: { offen: 0, in_arbeit: 0, ueberfaellig: 0 } });
    expect(meldungsStand(q)).toEqual({ zustand: 'gesperrt' });
    expect(auftragsStand(q).zustand).toBe('daten');
  });

  it('lädt oder scheitert der Zähler, gibt es keinen Wert', () => {
    const laedt: ZaehlerAbfrage = { data: undefined, error: null, isError: false, isPending: true };
    expect(auftragsStand(laedt)).toEqual({ zustand: 'laden' });
    const kaputt: ZaehlerAbfrage = {
      data: undefined,
      error: new ApiError(500, 'x'),
      isError: true,
      isPending: false,
    };
    expect(meldungsStand(kaputt)).toEqual({ zustand: 'fehler' });
  });

  it('ein 403 auf den Zähler selbst ist ebenfalls „gesperrt“', () => {
    const q: ZaehlerAbfrage = {
      data: undefined,
      error: new ApiError(403, 'x'),
      isError: true,
      isPending: false,
    };
    expect(auftragsStand(q)).toEqual({ zustand: 'gesperrt' });
  });

  it('Notizen: „davon überfällig“ und „Bestätigung überfällig“', () => {
    expect(auftraegeNotiz({ offen: 5, in_arbeit: 2, ueberfaellig: 1 })).toBe('1 überfällig');
    expect(auftraegeNotiz({ offen: 5, in_arbeit: 2, ueberfaellig: 0 })).toBe('keiner überfällig');
    expect(meldungenNotiz({ offen: 3, ungesehen: 1, bestaetigung_ueberfaellig: 0 })).toBe('1 neu');
    expect(meldungenNotiz({ offen: 3, ungesehen: 0, bestaetigung_ueberfaellig: 2 })).toBe(
      '0 neu · 2 Bestätigung überfällig',
    );
  });
});
