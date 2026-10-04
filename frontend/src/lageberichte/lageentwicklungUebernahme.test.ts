import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { listeEtb, type EtbAbfrage } from '../api/etb';
import { einsatzKeys } from '../api/queryKeys';
import { ladeStab } from '../api/stab';
import type { EtbEintragAnzeige, Stab } from '../api/types';
import { freigabenFixture } from '../test/fixtures';
import { LAGEENTWICKLUNG_QUELLE } from './lageentwicklungUebernahme';

vi.mock('../api/etb', () => ({ listeEtb: vi.fn() }));
vi.mock('../api/stab', () => ({ ladeStab: vi.fn() }));

/** Freitext mit Namen Dritter: darf nie im Lagevortrag landen. */
const FREITEXT = ['Herr Schmidt', 'Erika Muster', 'Familie Müller', 'Hauptstraße 5'];

const eintrag = (
  lfd_nr: number,
  typ: EtbEintragAnzeige['typ'],
  over: Partial<EtbEintragAnzeige> = {},
): EtbEintragAnzeige =>
  ({
    id: lfd_nr * 10,
    lfd_nr,
    typ,
    ereigniszeit: `2026-10-04 09:${String(lfd_nr).padStart(2, '0')}:00`,
    received_at: `2026-10-04 09:${String(lfd_nr).padStart(2, '0')}:00`,
    inhalt: 'Anruf von Herr Schmidt',
    von: 'Erika Muster',
    an: 'Familie Müller',
    veranlassung: 'Hauptstraße 5',
    ...over,
  }) as EtbEintragAnzeige;

/** Serverordnung: `lfd_nr` absteigend. Nr. 42 ist der Eintrag der Lagebesprechung. */
const ETB = [
  eintrag(50, 'meldung'),
  eintrag(49, 'entscheidung'),
  // Ein freigegebener Lagevortrag: zitierte sich sonst selbst.
  eintrag(48, 'lage', { lagebericht_id: 7 }),
  eintrag(47, 'system'),
  // Nachgetragen: Ereigniszeit VOR der Lagebesprechung, trotzdem neu.
  eintrag(46, 'meldung', { ereigniszeit: '2026-10-04 08:00:00' }),
  eintrag(45, 'anordnung'),
  eintrag(44, 'berichtigung'),
  eintrag(43, 'lage'),
  eintrag(42, 'entscheidung'),
  eintrag(41, 'meldung'),
  eintrag(40, 'entscheidung'),
];

const STAB = {
  anzahl_lagebesprechungen: 3,
  besetzung: [],
  letzte_lagebesprechung: {
    id: 3,
    lfd_nr: 3,
    einsatz_id: 1,
    abgehalten_at: '2026-10-04 09:42:00',
    entschluss: 'Herr Schmidt evakuieren',
    erfasst_at: '2026-10-04 09:42:00',
    erfasst_von_id: 1,
    etb_eintrag_id: 420,
  },
  naechste_lagebesprechung_at: null,
} as unknown as Stab;

/** Liefert Seiten aus `alle` wie der Server: unterhalb des Cursors, höchstens `limit`. */
function serverAus(alle: EtbEintragAnzeige[]) {
  vi.mocked(listeEtb).mockImplementation(async (_id: number, p: EtbAbfrage = {}) =>
    alle.filter((e) => p.before_lfd_nr == null || e.lfd_nr < p.before_lfd_nr).slice(0, p.limit),
  );
}

const dtg = (iso: string) => `DTG(${iso})`;

function erzeuge(freigaben = freigabenFixture(), qc = new QueryClient()) {
  return LAGEENTWICKLUNG_QUELLE.erzeuge({ qc, einsatzId: 1, freigaben, dtg });
}

beforeEach(() => {
  vi.mocked(listeEtb).mockReset();
  serverAus(ETB);
  vi.mocked(ladeStab).mockReset().mockResolvedValue(STAB);
});

describe('Lageentwicklung (LFH-873, Zählbild)', () => {
  it('beginnt mit dem Stand', async () => {
    expect((await erzeuge()).startsWith('**Stand:** DTG(')).toBe(true);
  });

  it('zählt je Typ seit dem Eintrag der Lagebesprechung, ohne System und Lagevorträge', async () => {
    const text = await erzeuge();
    expect(text).toContain(
      '**Neu im ETB seit der Lagebesprechung Nr. 3 (DTG(2026-10-04 09:42:00))**\n' +
        '- Meldungen: 2\n' +
        '- Anordnungen: 1\n' +
        '- Entscheidungen: 1\n' +
        '- Lagemeldungen: 1\n' +
        '- Berichtigungen: 1\n',
    );
    expect(text).not.toContain('Systemeinträge');
  });

  it('nennt die neuen Entscheidungen mit Nummer und Zeit, ohne Wortlaut', async () => {
    const text = await erzeuge();
    expect(text).toContain('**Entscheidungen**\n- Nr. 49 · DTG(2026-10-04 09:49:00)\n');
    expect(text).not.toContain('Nr. 42 ');
    expect(text).not.toContain('Nr. 40 ');
  });

  it('übernimmt keinen Freitext aus dem ETB oder dem Entschluss', async () => {
    const text = await erzeuge();
    for (const f of FREITEXT) expect(text).not.toContain(f);
  });

  it('sagt „seit Einsatzbeginn“ ohne abgehaltene Lagebesprechung', async () => {
    vi.mocked(ladeStab).mockResolvedValue({ ...STAB, letzte_lagebesprechung: null });
    const text = await erzeuge();
    expect(text.split('\n')[2]).toBe('**Neu im ETB seit Einsatzbeginn**');
    // Ohne Grenze zählt alles außer System und Lagevorträgen.
    expect(text).toContain('- Meldungen: 3\n');
    expect(text).toContain('- Entscheidungen: 3\n');
  });

  it('sagt „keine“, wenn seit der Lagebesprechung nichts dazukam', async () => {
    serverAus(ETB.filter((e) => e.lfd_nr <= 42));
    const text = await erzeuge();
    expect(text).toContain('- keine neuen Einträge\n');
    expect(text).toContain('**Entscheidungen**\n- keine\n');
  });

  it('zeigt höchstens 20 Entscheidungen, die neuesten zuerst', async () => {
    serverAus([...Array.from({ length: 25 }, (_, i) => eintrag(100 - i, 'entscheidung')), ...ETB]);
    const text = await erzeuge();
    expect(text).toContain('- Entscheidungen: 26\n');
    expect(text).toContain('**Entscheidungen**\n- Nr. 100 · ');
    expect(text).toContain('- Nr. 81 · ');
    expect(text).not.toContain('- Nr. 80 · ');
    expect(text).toContain('- und 6 weitere\n');
  });

  it('holt Seiten zu 500 nur bis zur Grenze', async () => {
    const viele = Array.from({ length: 1200 }, (_, i) => eintrag(1200 - i, 'meldung'));
    const stab = (lfd: number) =>
      ({
        ...STAB,
        letzte_lagebesprechung: { ...STAB.letzte_lagebesprechung!, etb_eintrag_id: lfd * 10 },
      }) as Stab;

    serverAus(viele);
    vi.mocked(ladeStab).mockResolvedValue(stab(1000));
    expect(await erzeuge()).toContain('- Meldungen: 200\n');
    expect(listeEtb).toHaveBeenCalledTimes(1);
    expect(vi.mocked(listeEtb).mock.calls[0][1]).toMatchObject({ limit: 500 });

    vi.mocked(listeEtb).mockClear();
    vi.mocked(ladeStab).mockResolvedValue(stab(600));
    expect(await erzeuge()).toContain('- Meldungen: 600\n');
    expect(listeEtb).toHaveBeenCalledTimes(2);
    expect(vi.mocked(listeEtb).mock.calls[1][1]).toMatchObject({ before_lfd_nr: 701 });
  });

  it('ETB gescheitert: „— (nicht geladen)“, nie 0', async () => {
    vi.mocked(listeEtb).mockRejectedValue(new Error('500'));
    const text = await erzeuge();
    expect(text).toContain('- — (nicht geladen)');
    expect(text).not.toContain(': 0');
  });

  it('Stab gescheitert: keine Grenze, also keine Zahl', async () => {
    vi.mocked(ladeStab).mockRejectedValue(new Error('500'));
    const text = await erzeuge();
    expect(text).toContain(
      '**Neu im ETB seit der letzten Lagebesprechung**\n- — (nicht geladen)\n',
    );
    expect(listeEtb).not.toHaveBeenCalled();
  });

  it('der Stand ist der älteste Abruf, nicht der Klick', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    const alt = Date.now() - 10 * 60_000;
    qc.setQueryData(einsatzKeys.stab(1), STAB, { updatedAt: alt });
    const text = await erzeuge(freigabenFixture(), qc);
    expect(text.split('\n')[0]).toBe(`**Stand:** DTG(${new Date(alt).toISOString()})`);
  });

  describe('verfuegbar', () => {
    it('braucht ETB und Stab', () => {
      expect(LAGEENTWICKLUNG_QUELLE.verfuegbar(freigabenFixture())).toEqual({ frei: true });
      expect(
        LAGEENTWICKLUNG_QUELLE.verfuegbar(freigabenFixture({ stab: { sichtbar: false } })),
      ).toEqual({ frei: false, grund: 'Stab nicht freigegeben' });
      expect(
        LAGEENTWICKLUNG_QUELLE.verfuegbar(
          freigabenFixture({ etb: { zugriff: false }, stab: { sichtbar: false } }),
        ),
      ).toEqual({ frei: false, grund: 'ETB und Stab nicht freigegeben' });
    });
  });
});
