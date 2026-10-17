import dayjs from 'dayjs';
import { describe, expect, it } from 'vitest';
import { mitProzessZone } from '../test/prozessZone';
import { filterMerkmale } from './filterMerkmale';

describe('filterMerkmale (LLH-1071)', () => {
  mitProzessZone('UTC');
  const bezug = { jetzt: dayjs.utc('2026-10-17 12:45:37'), zone: 'Europe/Berlin' };
  const optionen = {
    bezug,
    typWort: (t: string) => (t === 'meldung' ? 'Meldung' : t),
    einheitName: (id: number) => (id === 3 ? 'ELW 1' : undefined),
  };

  it('nennt die Merkmale kurz in fester Folge', () => {
    expect(
      filterMerkmale(
        {
          typ: 'meldung',
          von: '2026-10-17 11:45:00',
          q: 'Deich',
          einheit_id: 3,
          ohne_system: true,
        },
        optionen,
      ),
    ).toEqual(['Meldung', 'seit 1345', '„Deich“', 'Einheit ELW 1', 'ohne System']);
  });

  it('nennt eine unbekannte Einheit ohne Kennung', () => {
    expect(filterMerkmale({ einheit_id: 9 }, optionen)).toEqual(['eine Einheit']);
  });

  it('liefert ohne Filter nichts', () => {
    expect(filterMerkmale({}, optionen)).toEqual([]);
  });
});
