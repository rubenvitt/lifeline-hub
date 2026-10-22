import { describe, expect, it, vi } from 'vitest';
import type { Nachforderung } from '../api/types';
import {
  boardGruppe,
  boardSpalten,
  istKuerzlichEingetroffen,
  istOffen,
  istUeberfaellig,
  kartenZeiten,
  offenText,
  stufenText,
  vergleicheImBoard,
  vorgabeStufe,
  zaehleNachforderungen,
  zaehleUeberfaellig,
} from './nachforderungStufen';

const nf = (over: Partial<Nachforderung> = {}): Nachforderung => ({
  id: 1,
  einsatz_id: 1,
  art: 'RTW',
  bezeichnung: 'RTW',
  anzahl: 1,
  adressat_kategorie: 'leitstelle',
  adressat_bezeichnung: null,
  begruendung: null,
  prioritaet: 'normal',
  status: 'angefordert',
  zugesagt_at: null,
  unterwegs_at: null,
  eingetroffen_at: null,
  abgelehnt_at: null,
  abgelehnt_grund: null,
  angefordert_at: '2026-06-12 09:00:00',
  etb_nachforderung_id: null,
  erstellt_von_id: 1,
  erstellt_at: '2026-06-12 09:00:00',
  erstellt_von_name: null,
  ist_offen: true,
  material_ids: [],
  einheit_ids: [],
  zusage_rufnamen: [],
  ...over,
});

const JETZT = Date.UTC(2026, 5, 12, 22, 0);

describe('zaehleNachforderungen (LLH-1078)', () => {
  it('offen ist die Summe der drei offenen Stufen; eingetroffen und abgelehnt zählen nicht', () => {
    const ohne = { eintreffen_erwartet_at: null };
    const z = zaehleNachforderungen(
      [
        { status: 'angefordert', ...ohne },
        { status: 'angefordert', ...ohne },
        { status: 'zugesagt', ...ohne },
        { status: 'unterwegs', ...ohne },
        { status: 'eingetroffen', ...ohne },
        { status: 'abgelehnt', ...ohne },
        { status: 'zurueckgezogen', ...ohne },
      ],
      JETZT,
    );
    expect(z).toEqual({ offen: 4, angefordert: 2, zugesagt: 1, unterwegs: 1, ueberfaellig: 0 });
    expect(offenText(z)).toBe('4 offen · 1 unterwegs');
    expect(stufenText(z)).toBe('2 angefordert · 1 zugesagt · 1 unterwegs');
  });

  it('überfällig zählt die offenen mit verstrichenem Eintreffen (LLH-1145)', () => {
    const z = zaehleNachforderungen(
      [
        { status: 'zugesagt', eintreffen_erwartet_at: '2026-06-12 21:59:00' },
        { status: 'unterwegs', eintreffen_erwartet_at: '2026-06-12 22:00:00' },
        { status: 'eingetroffen', eintreffen_erwartet_at: '2026-06-12 20:00:00' },
      ],
      JETZT,
    );
    expect(z.ueberfaellig).toBe(1);
  });
});

describe('Board-Gruppen (LLH-1078)', () => {
  it('eingetroffen innerhalb von 12 h steht vorn, älter gesammelt, ohne Zeitpunkt vorn', () => {
    const frisch = nf({ status: 'eingetroffen', eingetroffen_at: '2026-06-12 10:00:00' });
    const alt = nf({ status: 'eingetroffen', eingetroffen_at: '2026-06-12 09:59:00' });
    const ohne = nf({ status: 'eingetroffen' });
    expect(istKuerzlichEingetroffen(frisch, JETZT)).toBe(true);
    expect(boardGruppe(frisch, JETZT)).toBe('eingetroffen');
    expect(boardGruppe(alt, JETZT)).toBe('eingetroffen-aelter');
    expect(boardGruppe(ohne, JETZT)).toBe('eingetroffen');
    expect(boardGruppe(nf({ status: 'unterwegs' }), JETZT)).toBe('unterwegs');
  });

  it('Spalten in fester Folge; offene nach Priorität, dann die am längsten wartende zuerst', () => {
    const liste = [
      nf({ id: 1, angefordert_at: '2026-06-12 09:00:00' }),
      nf({ id: 2, angefordert_at: '2026-06-12 08:00:00' }),
      nf({ id: 3, prioritaet: 'sofort', angefordert_at: '2026-06-12 09:30:00' }),
      nf({ id: 4, status: 'unterwegs' }),
      nf({ id: 5, status: 'eingetroffen', eingetroffen_at: '2026-06-12 12:00:00' }),
      nf({ id: 6, status: 'eingetroffen', eingetroffen_at: '2026-06-12 20:00:00' }),
      nf({ id: 7, status: 'eingetroffen', eingetroffen_at: '2026-06-12 01:00:00' }),
      nf({ id: 8, status: 'abgelehnt', abgelehnt_at: '2026-06-12 09:10:00' }),
      nf({ id: 10, status: 'zurueckgezogen', zurueckgezogen_at: '2026-06-12 09:20:00' }),
      nf({ id: 11, status: 'zurueckgezogen', zurueckgezogen_at: '2026-06-12 11:00:00' }),
    ].sort(vergleicheImBoard);
    const spalten = boardSpalten(liste, (n) => boardGruppe(n, JETZT));
    expect(spalten.map((s) => s.stufe)).toEqual([
      'angefordert',
      'zugesagt',
      'unterwegs',
      'eingetroffen',
      'abgelehnt',
      'zurueckgezogen',
    ]);
    const ids = (i: number) => spalten[i].karten.map((n) => n.id);
    expect(ids(0)).toEqual([3, 2, 1]);
    expect(ids(1)).toEqual([]);
    expect(ids(2)).toEqual([4]);
    expect(ids(3)).toEqual([6, 5]);
    expect(spalten[3].aeltere.map((n) => n.id)).toEqual([7]);
    expect(ids(4)).toEqual([8]);
    // Zurückgezogen (LLH-1097 D8): eigene Spalte, jüngster Abschluss zuerst.
    expect(ids(5)).toEqual([11, 10]);
  });

  it('eine gehaltene Gruppe ordnet die Karte in ihre alte Spalte', () => {
    const n = nf({ id: 9, status: 'zugesagt' });
    const spalten = boardSpalten([n], () => 'angefordert');
    expect(spalten[0].karten.map((k) => k.id)).toEqual([9]);
    expect(spalten[1].karten).toEqual([]);
  });

  it('Vorgabe am Handy: die erste offene Stufe mit Karten, sonst Angefordert', () => {
    const mitUnterwegs = boardSpalten([nf({ status: 'unterwegs' })], (n) => n.status);
    expect(vorgabeStufe(mitUnterwegs)).toBe('unterwegs');
    const nurAbgeschlossen = boardSpalten([nf({ status: 'abgelehnt' })], (n) => n.status);
    expect(vorgabeStufe(nurAbgeschlossen)).toBe('angefordert');
  });
});

describe('kartenZeiten (LLH-1078, Einhängepunkt LLH-1097)', () => {
  it('nur vorhandene Zeitpunkte, angefordert mit Person', () => {
    const zeiten = kartenZeiten(
      nf({ erstellt_von_name: 'Erika', zugesagt_at: '2026-06-12 09:10:00' }),
      (z) => z.slice(11, 16),
    );
    expect(zeiten.map((z) => z.text)).toEqual(['Angefordert: 09:00 · Erika', 'Zugesagt: 09:10']);
    expect(zeiten.every((z) => z.ton === undefined)).toBe(true);
  });

  it('die Bedarfszeit steht nach der Anforderung (LLH-1089)', () => {
    const zeiten = kartenZeiten(
      nf({ benoetigt_bis: '2026-06-12 13:30:00', zugesagt_at: '2026-06-12 09:10:00' }),
      (z) => z.slice(11, 16),
    );
    expect(zeiten.map((z) => z.text)).toEqual([
      'Angefordert: 09:00',
      'Benötigt bis: 13:30',
      'Zugesagt: 09:10',
    ]);
  });
});

describe('Zusage und überfällig (LLH-1097 D7/D8)', () => {
  const hhmm = (z: string) => z.slice(11, 16);

  it('zurückgezogen ist abgeschlossen', () => {
    expect(istOffen('zurueckgezogen')).toBe(false);
    expect(istOffen('zugesagt')).toBe(true);
  });

  it('überfällig: zugesagt oder unterwegs mit verstrichenem Eintreffen', () => {
    const eta = '2026-06-12 21:59:00';
    expect(istUeberfaellig(nf({ status: 'zugesagt', eintreffen_erwartet_at: eta }), JETZT)).toBe(
      true,
    );
    expect(istUeberfaellig(nf({ status: 'unterwegs', eintreffen_erwartet_at: eta }), JETZT)).toBe(
      true,
    );
    // Genau jetzt ist noch nicht verstrichen.
    expect(
      istUeberfaellig(
        nf({ status: 'zugesagt', eintreffen_erwartet_at: '2026-06-12 22:00:00' }),
        JETZT,
      ),
    ).toBe(false);
    expect(istUeberfaellig(nf({ status: 'zugesagt' }), JETZT)).toBe(false);
    for (const status of ['angefordert', 'eingetroffen', 'zurueckgezogen'] as const) {
      expect(istUeberfaellig(nf({ status, eintreffen_erwartet_at: eta }), JETZT)).toBe(false);
    }
    expect(
      zaehleUeberfaellig(
        [
          nf({ status: 'zugesagt', eintreffen_erwartet_at: eta }),
          nf({ status: 'unterwegs', eintreffen_erwartet_at: '2026-06-12 23:00:00' }),
          nf({ status: 'eingetroffen', eintreffen_erwartet_at: eta }),
        ],
        JETZT,
      ),
    ).toBe(1);
  });

  it('der Minutentakt macht eine Zusage überfällig', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.UTC(2026, 5, 12, 15, 29));
      const n = nf({ status: 'zugesagt', eintreffen_erwartet_at: '2026-06-12 15:30:00' });
      expect(istUeberfaellig(n, Date.now())).toBe(false);
      vi.advanceTimersByTime(2 * 60 * 1000);
      expect(istUeberfaellig(n, Date.now())).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('Zeitzeile „Eintreffen erwartet“ nach der Zusage, im Ton achtung, sobald verstrichen', () => {
    const n = nf({
      status: 'zugesagt',
      zugesagt_at: '2026-06-12 21:00:00',
      eintreffen_erwartet_at: '2026-06-12 21:30:00',
    });
    const zeiten = kartenZeiten(n, hhmm, JETZT);
    expect(zeiten.map((z) => z.text)).toEqual([
      'Angefordert: 09:00',
      'Zugesagt: 21:00',
      'Eintreffen erwartet: 21:30',
    ]);
    expect(zeiten[2].ton).toBe('achtung');
    // Ohne Takt (noch nicht verstrichen) ohne Ton.
    expect(kartenZeiten(n, hhmm)[2].ton).toBeUndefined();
  });

  it('nach der Bedarfszeit: „· nach Bedarfszeit“ im Ton achtung', () => {
    const zeiten = kartenZeiten(
      nf({
        status: 'unterwegs',
        benoetigt_bis: '2026-06-12 23:00:00',
        eintreffen_erwartet_at: '2026-06-12 23:30:00',
      }),
      hhmm,
      JETZT,
    );
    const erwartet = zeiten.find((z) => z.schluessel === 'erwartet')!;
    expect(erwartet.text).toBe('Eintreffen erwartet: 23:30 · nach Bedarfszeit');
    expect(erwartet.ton).toBe('achtung');
  });

  it('nach dem Eintreffen keine Zeile „Eintreffen erwartet“', () => {
    const zeiten = kartenZeiten(
      nf({
        status: 'eingetroffen',
        eintreffen_erwartet_at: '2026-06-12 21:30:00',
        eingetroffen_at: '2026-06-12 21:40:00',
      }),
      hhmm,
      JETZT,
    );
    expect(zeiten.map((z) => z.schluessel)).toEqual(['angefordert', 'eingetroffen']);
  });
});
