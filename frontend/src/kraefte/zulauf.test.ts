import { describe, expect, it } from 'vitest';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { zulaufBand, type ZulaufQuelle } from './zulauf';

dayjs.extend(utc);

/** 14:00 UTC — vor jedem Eintreffen der Fälle, außer wo ein Test es anders setzt. */
const JETZT = dayjs.utc('2026-06-12 14:00:00').valueOf();
/** Uhrzeit wie am Schirm, hier ohne Zone: die Zone prüft `formatUhrzeitMitTag` selbst. */
const zeit = (utcStr: string) => dayjs.utc(utcStr).format('HH:mm');

function nf(teil: Partial<ZulaufQuelle>): ZulaufQuelle {
  return {
    art: 'RTW',
    anzahl: 2,
    status: 'zugesagt',
    eintreffen_erwartet_at: undefined,
    einheit_ids: [],
    ...teil,
  };
}

describe('zulaufBand (LLH-1384, Spec `kraeftebaum`, „Zulauf aus Nachforderungen“)', () => {
  it('2× RTW zugesagt mit Eintreffen 15:30 → „+2 RTW, Eintreffen 15:30“', () => {
    const z = zulaufBand([nf({ eintreffen_erwartet_at: '2026-06-12 15:30:00' })], JETZT, zeit);
    expect(z).not.toBeNull();
    expect(z!.wert).toBe(2);
    expect(z!.notiz).toBe('+2 RTW, Eintreffen 15:30');
    expect(z!.ton).toBe('neutral');
  });

  it('eingetroffene, abgelehnte und zurückgezogene zählen nicht zum Zulauf', () => {
    expect(
      zulaufBand(
        [
          nf({ status: 'eingetroffen', eintreffen_erwartet_at: '2026-06-12 15:30:00' }),
          nf({ status: 'abgelehnt' }),
          nf({ status: 'zurueckgezogen', eintreffen_erwartet_at: '2026-06-12 15:30:00' }),
        ],
        JETZT,
        zeit,
      ),
    ).toBeNull();
  });

  it('unterwegs trägt das Wort, angefordert steht ohne Plus und zählt nicht in die Zahl', () => {
    const z = zulaufBand(
      [
        nf({ art: 'NEF', anzahl: 1, status: 'angefordert' }),
        nf({
          art: 'GW-San',
          anzahl: 1,
          status: 'unterwegs',
          eintreffen_erwartet_at: '2026-06-12 16:10:00',
        }),
        nf({ eintreffen_erwartet_at: '2026-06-12 15:30:00' }),
      ],
      JETZT,
      zeit,
    );
    expect(z!.wert).toBe(3);
    expect(z!.notiz).toBe(
      '+2 RTW, Eintreffen 15:30 · +1 GW-San unterwegs, Eintreffen 16:10 · 1 NEF angefordert',
    );
  });

  it('nur angefordert: Zahl 0, der Bedarf steht in der Notiz', () => {
    const z = zulaufBand([nf({ status: 'angefordert', anzahl: 3 })], JETZT, zeit);
    expect(z!.wert).toBe(0);
    expect(z!.notiz).toBe('3 RTW angefordert');
  });

  it('gleiche Art und gleiches Eintreffen fassen zusammen, verschiedenes Eintreffen nicht', () => {
    const z = zulaufBand(
      [
        nf({ anzahl: 1, eintreffen_erwartet_at: '2026-06-12 15:30:00' }),
        nf({ art: ' RTW ', anzahl: 1, eintreffen_erwartet_at: '2026-06-12 15:30:20' }),
        nf({ anzahl: 1, eintreffen_erwartet_at: '2026-06-12 16:00:00' }),
        nf({ anzahl: 1 }),
      ],
      JETZT,
      zeit,
    );
    expect(z!.wert).toBe(4);
    expect(z!.notiz).toBe('+2 RTW, Eintreffen 15:30 · +1 RTW, Eintreffen 16:00 · +1 RTW');
  });

  it('ohne Anzahl zählt eine Nachforderung als 1, übernommene Einheiten gehen ab', () => {
    const z = zulaufBand(
      [
        nf({ art: 'KTW', anzahl: null }),
        // Rückweg „eingetroffen → unterwegs“ nach der Übernahme einer Einheit: die steht schon im
        // Raster (LLH-1383) und darf nicht zusätzlich als Zulauf zählen.
        nf({ status: 'unterwegs', anzahl: 2, einheit_ids: [7] }),
        nf({ art: 'ELW', status: 'unterwegs', anzahl: 1, einheit_ids: [8] }),
      ],
      JETZT,
      zeit,
    );
    expect(z!.wert).toBe(2);
    expect(z!.notiz).toBe('+1 RTW unterwegs · +1 KTW');
  });

  it('verstrichenes Eintreffen: Wort „überfällig“ und Ton achtung, ohne Alarm', () => {
    const z = zulaufBand([nf({ eintreffen_erwartet_at: '2026-06-12 13:30:00' })], JETZT, zeit);
    expect(z!.notiz).toBe('+2 RTW, Eintreffen 13:30 überfällig');
    expect(z!.ton).toBe('achtung');
  });

  it('leere Liste: keine Kennzahl', () => {
    expect(zulaufBand([], JETZT, zeit)).toBeNull();
  });
});
