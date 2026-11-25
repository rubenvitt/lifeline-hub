import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportDateiname, speichereDatei } from './dateiSpeichern';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('exportDateiname', () => {
  it('nennt Inhalt, Einsatz und den lokalen Zeitpunkt auf die Minute', () => {
    const jetzt = new Date(2026, 9, 1, 7, 5, 59);
    expect(exportDateiname('personen', 42, 'csv', jetzt)).toBe(
      'personen-einsatz-42-2026-10-01-0705.csv',
    );
  });

  it('füllt einstellige Monate, Tage und Stunden auf', () => {
    expect(exportDateiname('tiere', 3, 'csv', new Date(2027, 0, 9, 23, 0))).toBe(
      'tiere-einsatz-3-2027-01-09-2300.csv',
    );
  });
});

describe('exportDateiname · Endung', () => {
  it('trägt die übergebene Endung', () => {
    expect(exportDateiname('lagekarte', 42, 'kmz', new Date(2026, 10, 24, 14, 5))).toBe(
      'lagekarte-einsatz-42-2026-11-24-1405.kmz',
    );
    expect(exportDateiname('lagebesprechung', 7, 'ics', new Date(2026, 10, 24, 14, 5))).toBe(
      'lagebesprechung-einsatz-7-2026-11-24-1405.ics',
    );
  });

  it('ohne Endung bleibt es csv', () => {
    expect(exportDateiname('schaeden', 1, undefined, new Date(2026, 10, 24, 14, 5))).toBe(
      'schaeden-einsatz-1-2026-11-24-1405.csv',
    );
  });
});

describe('speichereDatei', () => {
  it('bietet den Blob unter dem Dateinamen an und gibt die Object-URL danach frei', () => {
    vi.useFakeTimers();
    const erzeugt = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:export-1');
    const freigegeben = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const klick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      // Der Anker hängt beim Klick im Dokument — Firefox ignoriert einen losen.
      expect(document.body.contains(this)).toBe(true);
    });

    const blob = new Blob(['a;b\n'], { type: 'text/csv' });
    speichereDatei(blob, 'tiere-einsatz-1.csv');

    expect(erzeugt).toHaveBeenCalledWith(blob);
    expect(klick).toHaveBeenCalledTimes(1);
    const geklickt = klick.mock.contexts[0] as HTMLAnchorElement;
    expect(geklickt.download).toBe('tiere-einsatz-1.csv');
    expect(geklickt.getAttribute('href')).toBe('blob:export-1');
    expect(document.body.contains(geklickt)).toBe(false);
    // Nicht im selben Zug: ein sofortiges `revokeObjectURL` bricht den Download in manchen
    // Engines ab, bevor er die Bytes gelesen hat.
    expect(freigegeben).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(freigegeben).toHaveBeenCalledWith('blob:export-1');
  });
});
