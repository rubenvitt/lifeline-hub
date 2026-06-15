import { describe, it, expect } from 'vitest';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { faelligGruppe, GRUPPE_LABEL, GRUPPE_ORDNUNG } from './gruppierung';

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
