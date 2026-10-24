import { describe, expect, it } from 'vitest';
import type { Nachforderung, NachforderungStatus } from '../api/types';
import {
  EINHEITEN_VERKNUEPFT,
  einheitenGruppen,
  kannAbschliessen,
  kannZuruecknehmen,
  ruecknahmeSperre,
} from './nurVorwaerts';

type Bezug = Pick<Nachforderung, 'status' | 'einheit_ids' | 'material_ids'>;
const n = (status: NachforderungStatus, over: Partial<Bezug> = {}): Bezug => ({
  status,
  einheit_ids: [],
  material_ids: [],
  ...over,
});

/**
 * LLH-1395: die Karte spiegelt die Prüfung „nur vorwärts“ des Servers (LLH-1387 design.md D5,
 * `routes/nachforderung.rs`, `status`/`ablehnen`/`zurueckziehen`), damit kein Knopf in eine 422
 * führt.
 */
describe('nur vorwärts (LLH-1387 D5)', () => {
  it('ohne verknüpfte Einheit: Rücknahme, Ablehnen und Zurückziehen offen', () => {
    for (const s of ['zugesagt', 'unterwegs'] as const) {
      expect(kannZuruecknehmen(n(s))).toBe(true);
      expect(kannAbschliessen(n(s))).toBe(true);
    }
    expect(kannZuruecknehmen(n('eingetroffen'))).toBe(true);
  });

  it('mit verknüpfter Einheit: keine Rücknahme, kein Ablehnen, kein Zurückziehen', () => {
    for (const s of ['zugesagt', 'unterwegs', 'eingetroffen'] as const) {
      expect(kannZuruecknehmen(n(s, { einheit_ids: [11] }))).toBe(false);
      expect(kannAbschliessen(n(s, { einheit_ids: [11] }))).toBe(false);
    }
  });

  it('übernommenes Material sperrt die Rücknahme aus „eingetroffen“ (LLH-1226 D9)', () => {
    expect(kannZuruecknehmen(n('eingetroffen', { material_ids: [7] }))).toBe(false);
  });

  it('vom Anfang der Kette und aus den Abschlüssen führt keine Rücknahme', () => {
    for (const s of ['angefordert', 'abgelehnt', 'zurueckgezogen'] as const) {
      expect(kannZuruecknehmen(n(s))).toBe(false);
    }
  });

  it('nennt den Grund einer gesperrten Rücknahme', () => {
    expect(ruecknahmeSperre(n('unterwegs'))).toBeNull();
    expect(ruecknahmeSperre(n('unterwegs', { einheit_ids: [11] }))).toBe('Einheiten verknüpft');
    expect(ruecknahmeSperre(n('eingetroffen', { material_ids: [7] }))).toBe('Material übernommen');
  });

  it('der Grund ist kurz genug für den Menüeintrag', () => {
    expect(EINHEITEN_VERKNUEPFT).toBe('Einheiten verknüpft');
  });
});

/**
 * Vor dem Eintreffen der Nachforderung kommt ein Verweis nur aus der Buchung am Raum (LLH-1387
 * D4). Danach nennt der Server die am Raum verknüpften Einheiten (`einheit_ids_am_raum`,
 * LLH-1445); alle übrigen sind übernommen.
 */
describe('einheitenGruppen', () => {
  type Einleitung = Pick<Nachforderung, 'status' | 'einheit_ids' | 'einheit_ids_am_raum'>;
  const g = (
    status: NachforderungStatus,
    einheit_ids: number[],
    einheit_ids_am_raum: number[] = [],
  ): Einleitung => ({ status, einheit_ids, einheit_ids_am_raum });

  it('zugesagt und unterwegs: alle „am Raum eingetroffen“', () => {
    for (const status of ['zugesagt', 'unterwegs'] as const) {
      expect(einheitenGruppen(g(status, [11, 12]))).toEqual([
        { einleitung: 'Am Raum eingetroffen', ids: [11, 12] },
      ]);
    }
  });

  it('eingetroffen ohne Verknüpfung am Raum: alle „Als Einheit übernommen“', () => {
    expect(einheitenGruppen(g('eingetroffen', [11, 12]))).toEqual([
      { einleitung: 'Als Einheit übernommen', ids: [11, 12] },
    ]);
  });

  it('eingetroffen mit beiden Wegen: zuerst am Raum, dann übernommen, je in Folge', () => {
    expect(einheitenGruppen(g('eingetroffen', [11, 12, 13], [12]))).toEqual([
      { einleitung: 'Am Raum eingetroffen', ids: [12] },
      { einleitung: 'Als Einheit übernommen', ids: [11, 13] },
    ]);
  });

  it('ohne Einheiten keine Gruppe', () => {
    expect(einheitenGruppen(g('eingetroffen', []))).toEqual([]);
  });
});
