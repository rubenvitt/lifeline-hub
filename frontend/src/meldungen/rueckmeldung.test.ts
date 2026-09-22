import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { describe, expect, it } from 'vitest';
import type { LetzteRueckmeldung, Rueckmeldungen } from '../api/types';
import {
  letzteImTeilbaum,
  ohneRueckmeldung,
  RUECKMELDUNG_ROLLE,
  rueckmeldungJeEinheit,
  rueckmeldungZustand,
} from './rueckmeldung';

dayjs.extend(utc);

function r(
  bezug_id: number,
  ereigniszeit: string,
  faellig_at: string,
  meldung_id = bezug_id * 10,
): LetzteRueckmeldung {
  return {
    bezug_id,
    meldung_id,
    lfd_nr: meldung_id,
    ereigniszeit,
    inhalt: `Meldung ${meldung_id}`,
    meldeweg: 'funk',
    faellig_at,
  };
}

const JETZT = dayjs.utc('2026-09-22 14:20:00');

describe('rueckmeldungZustand', () => {
  it('ohne Rückmeldung ist „keine"', () => {
    expect(rueckmeldungZustand(undefined, JETZT)).toBe('keine');
    expect(rueckmeldungZustand(null, JETZT)).toBe('keine');
  });

  it('vor der Fälligkeit aktuell, ab der Fälligkeit überfällig', () => {
    // Entwurfsdaten S6 bei Frist 60: 13:30 unauffällig, 13:15 gelb.
    expect(
      rueckmeldungZustand(r(1, '2026-09-22 13:30:00', '2026-09-22 14:30:00'), JETZT),
    ).toBe('aktuell');
    expect(
      rueckmeldungZustand(r(1, '2026-09-22 13:15:00', '2026-09-22 14:15:00'), JETZT),
    ).toBe('ueberfaellig');
    // Genau auf der Fälligkeit: überfällig (<=), wie ist_ueberfaellig im Backend.
    expect(
      rueckmeldungZustand(r(1, '2026-09-22 13:20:00', '2026-09-22 14:20:00'), JETZT),
    ).toBe('ueberfaellig');
  });

  it('liest die Wire-Zeit als UTC, nicht als Ortszeit', () => {
    // 14:30 UTC liegt nach 14:20 UTC — als Ortszeit gelesen (Berlin, +2) läge es davor.
    const jetztLokal = dayjs('2026-09-22T16:20:00+02:00');
    expect(
      rueckmeldungZustand(r(1, '2026-09-22 13:30:00', '2026-09-22 14:30:00'), jetztLokal),
    ).toBe('aktuell');
  });

  it('bildet die drei Zustände auf drei verschiedene Rollen ab', () => {
    expect(new Set(Object.values(RUECKMELDUNG_ROLLE)).size).toBe(3);
    expect(RUECKMELDUNG_ROLLE.keine).toBe('alarm');
    expect(RUECKMELDUNG_ROLLE.ueberfaellig).toBe('achtung');
  });
});

const DATEN: Rueckmeldungen = {
  frist_min: 60,
  einheiten: [
    r(1, '2026-09-22 14:11:00', '2026-09-22 15:11:00'),
    r(2, '2026-09-22 13:15:00', '2026-09-22 14:15:00'),
    r(3, '2026-09-22 14:18:00', '2026-09-22 15:18:00'),
  ],
  abschnitte: [r(100, '2026-09-22 14:14:00', '2026-09-22 15:14:00', 900)],
};

describe('letzteImTeilbaum', () => {
  it('nimmt die jüngste aus Abschnitts- UND Einheitsliste', () => {
    expect(letzteImTeilbaum(DATEN, new Set([100]), new Set([1, 2]))?.meldung_id).toBe(900);
    expect(letzteImTeilbaum(DATEN, new Set([100]), new Set([1, 3]))?.meldung_id).toBe(30);
  });

  it('ignoriert Bezüge außerhalb des Teilbaums', () => {
    expect(letzteImTeilbaum(DATEN, new Set(), new Set([2]))?.bezug_id).toBe(2);
    expect(letzteImTeilbaum(DATEN, new Set([7]), new Set([8]))).toBeNull();
    expect(letzteImTeilbaum(undefined, new Set([100]), new Set([1]))).toBeNull();
  });

  it('entscheidet Gleichstand über die höhere Meldungs-id', () => {
    const gleich: Rueckmeldungen = {
      frist_min: 60,
      einheiten: [r(1, '2026-09-22 14:00:00', 'x', 5), r(2, '2026-09-22 14:00:00', 'x', 6)],
      abschnitte: [],
    };
    expect(letzteImTeilbaum(gleich, new Set(), new Set([1, 2]))?.meldung_id).toBe(6);
  });
});

describe('ohneRueckmeldung', () => {
  it('zählt nur Einheiten ohne jeden Eintrag, nicht die überfälligen', () => {
    // 2 ist überfällig, hat aber zurückgemeldet; 4 und 5 haben nie.
    expect(ohneRueckmeldung([1, 2, 4, 5], DATEN)).toBe(2);
    expect(ohneRueckmeldung([1, 2], DATEN)).toBe(0);
  });

  it('rueckmeldungJeEinheit indexiert nach Einheit-id', () => {
    expect(rueckmeldungJeEinheit(DATEN).get(3)?.inhalt).toBe('Meldung 30');
    expect(rueckmeldungJeEinheit(null).size).toBe(0);
  });
});
