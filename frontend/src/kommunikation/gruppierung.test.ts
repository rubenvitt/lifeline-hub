import { describe, it, expect } from 'vitest';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { faelligGruppe, GRUPPE_LABEL, GRUPPE_ORDNUNG } from './gruppierung';
import { mitProzessZone } from '../test/prozessZone';

dayjs.extend(utc);

/** UTC-Wirestring relativ zu jetzt (TZ-robust, kein hartkodiertes Datum). */
const wire = (tageDelta: number): string =>
  dayjs().utc().add(tageDelta, 'day').format('YYYY-MM-DD HH:mm:ss');

describe('faelligGruppe', () => {
  it('priorisiert das ueberfaellig-Flag vor der Frist', () => {
    expect(faelligGruppe(wire(5), true)).toBe('ueberfaellig');
  });

  it('ordnet eine Frist von heute in heute ein', () => {
    expect(faelligGruppe(wire(0), false)).toBe('heute');
  });

  it('ordnet eine künftige Frist in spaeter ein', () => {
    expect(faelligGruppe(wire(2), false)).toBe('spaeter');
  });

  it('ordnet einen Eintrag ohne Frist in ohne_frist ein', () => {
    expect(faelligGruppe(null, false)).toBe('ohne_frist');
    expect(faelligGruppe(undefined)).toBe('ohne_frist');
  });

  it('behandelt eine vergangene Frist ohne Flag als ueberfaellig', () => {
    expect(faelligGruppe(wire(-2), false)).toBe('ueberfaellig');
  });
});

describe('GRUPPE_LABEL / GRUPPE_ORDNUNG', () => {
  it('hat Labels für alle Gruppen', () => {
    expect(GRUPPE_LABEL).toEqual({
      ueberfaellig: 'Überfällig',
      heute: 'Heute fällig',
      spaeter: 'Später',
      ohne_frist: 'Ohne Frist',
    });
  });
  it('sortiert ueberfaellig < heute < spaeter < ohne_frist', () => {
    expect(GRUPPE_ORDNUNG).toEqual(['ueberfaellig', 'heute', 'spaeter', 'ohne_frist']);
  });
});

/** LFH-692 (Spec `zeiteingabe`, Szenario „Frist heute“): der Kalendertag der Anzeigezone zählt. */
describe('faelligGruppe — Tag der Anzeigezone (LFH-692)', () => {
  mitProzessZone('UTC');
  const JETZT = dayjs.utc('2026-07-14 23:30:00'); // Berlin: 15.07. 01:30

  it('Frist 15.07. 08:00 Berliner Zeit ist in Berlin „heute“', () => {
    expect(faelligGruppe('2026-07-15 06:00:00', false, 'Europe/Berlin', JETZT)).toBe('heute');
  });

  it('Frist 14.07. 23:00 Berliner Zeit ist dort schon gestern → überfällig', () => {
    expect(faelligGruppe('2026-07-14 21:00:00', false, 'Europe/Berlin', JETZT)).toBe(
      'ueberfaellig',
    );
  });

  it('ohne Anzeigezone gilt der Tag des Browsers (hier UTC: 15.07. ist morgen)', () => {
    expect(faelligGruppe('2026-07-15 06:00:00', false, null, JETZT)).toBe('spaeter');
  });
});
