import { describe, expect, it } from 'vitest';
import type { BelegungVerlaufEintrag, StandVerlaufEintrag } from '../api/types';
import {
  aktuellWort,
  belegungZeile,
  istNachgetragenMeldung,
  rueckfrageHinweis,
  ruecknahmeName,
  standZeile,
} from './verlauf';

/** Reine Hilfen des Meldeverlaufs (LFH-676). */

const STAND: StandVerlaufEintrag = {
  id: 7,
  evakuiert: 1320,
  erhebung: 'geschaetzt',
  zeitpunkt_at: '2026-09-23 10:30:00',
  erfasst_at: '2026-09-23 10:30:05',
  erfasst_von: 'Leitung',
  aktuell: true,
};

const BELEGUNG: BelegungVerlaufEintrag = {
  id: 9,
  belegt: 89,
  zeitpunkt_at: '2026-09-23 11:00:00',
  erfasst_at: '2026-09-23 11:00:00',
  erfasst_von: 'Leitung',
  aktuell: false,
  zurueckgenommen_at: '2026-09-23 11:12:00',
  zurueckgenommen_von: 'Stab S1',
};

// Tausendertrenner ist das schmale geschützte Leerzeichen aus `personenZahl` (U+202F).
describe('standZeile / belegungZeile', () => {
  it('führen beide Reihen auf dieselbe Zeilenform, der Text trägt Zahl und Erhebung', () => {
    const s = standZeile(STAND);
    expect(s.text).toBe('1\u202f320 evakuiert (geschätzt)');
    expect(s.anzahl).toBe(1320);
    expect(s.aktuell).toBe(true);
    expect(s.zurueckgenommen_at).toBeUndefined();

    const b = belegungZeile(BELEGUNG);
    expect(b.text).toBe('89 untergebracht');
    expect(b.zurueckgenommen_at).toBe('2026-09-23 11:12:00');
    expect(b.zurueckgenommen_von).toBe('Stab S1');
  });
});

describe('istNachgetragenMeldung — dieselbe Schwelle wie das ⧖ im ETB', () => {
  it('20 s zwischen Zeitpunkt und Erfassung ist KEINE Nachtragung', () => {
    expect(
      istNachgetragenMeldung({
        zeitpunkt_at: '2026-09-23 10:00:00',
        erfasst_at: '2026-09-23 10:00:20',
      }),
    ).toBe(false);
  });

  it('ab 60 s ist sie eine', () => {
    expect(
      istNachgetragenMeldung({
        zeitpunkt_at: '2026-09-23 10:00:00',
        erfasst_at: '2026-09-23 10:01:00',
      }),
    ).toBe(true);
    expect(
      istNachgetragenMeldung({
        zeitpunkt_at: '2026-09-23 10:30:00',
        erfasst_at: '2026-09-23 11:05:00',
      }),
    ).toBe(true);
  });
});

describe('Wortlaut', () => {
  it('die aktuelle Meldung heißt je Reihe anders', () => {
    expect(aktuellWort('bezirk')).toBe('aktueller Stand');
    expect(aktuellWort('stelle')).toBe('aktuelle Belegung');
  });

  it('der zugängliche Name des Auslösers trägt Anzahl und Uhrzeit (Zeilenkennung)', () => {
    expect(ruecknahmeName(standZeile(STAND), '1030')).toBe(
      'Meldung 1\u202f320 von 1030 zurücknehmen',
    );
  });

  it('die Rückfrage sagt, ob die Meldung den Stand trägt — ohne eine neue Zahl vorherzusagen', () => {
    expect(rueckfrageHinweis('bezirk', true)).toBe(
      'Das ist der aktuelle Stand. Er wird danach aus den übrigen Meldungen bestimmt.',
    );
    expect(rueckfrageHinweis('bezirk', false)).toBe(
      'Der aktuelle Stand ändert sich dadurch nicht.',
    );
    expect(rueckfrageHinweis('stelle', true)).toBe(
      'Das ist die aktuelle Belegung. Sie wird danach aus den übrigen Meldungen bestimmt.',
    );
    expect(rueckfrageHinweis('stelle', false)).toBe(
      'Die aktuelle Belegung ändert sich dadurch nicht.',
    );
  });
});
