import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { server } from '../test/server';
import { freigabenFixture } from '../test/fixtures';
import { neuerQueryClient } from '../test/utils';
import { useWasBrennt, ZAEHLER_TAKT_MS } from './useWasBrennt';

dayjs.extend(utc);

const BASIS = '/api/einsaetze/1';
const JETZT = dayjs.utc('2026-11-16 14:00:00');

const zaehler = {
  meldungen: {
    offen: 1,
    ungesehen: 1,
    bestaetigung_ueberfaellig: 0,
    sofort_offen: 0,
    dringend_offen: 0,
  },
  auftraege: { offen: 0, in_arbeit: 0, ueberfaellig: 0 },
  erinnerungen: { faellig: 0 },
  nachforderungen: { offen: 0, angefordert: 0, zugesagt: 0, unterwegs: 0, ueberfaellig: 0 },
};

const einheit = (id: number, name: string) => ({
  id,
  name,
  abschnitt_id: null,
  ueber_einheit_id: null,
  soll: null,
  status: null,
});

/** Rückmeldung der Einheit 10, fällig um `faellig`. */
const rueckmeldung = (faellig: string) => ({
  einheiten: [
    {
      bezug_id: 10,
      meldung_id: 1,
      lfd_nr: 1,
      ereigniszeit: '2026-11-16 12:00:00',
      inhalt: 'x',
      meldeweg: 'funk',
      faellig_at: faellig,
    },
  ],
  abschnitte: [],
});

function handler(over: { rueckmeldungen?: () => Response; personen?: unknown[] } = {}) {
  server.use(
    http.get(`${BASIS}/module-access`, () => HttpResponse.json(freigabenFixture())),
    http.get(`${BASIS}/module-counts`, () => HttpResponse.json(zaehler)),
    http.get(`${BASIS}/persons`, () => HttpResponse.json(over.personen ?? [])),
    http.get(`${BASIS}/abschnitte`, () =>
      HttpResponse.json([
        {
          id: 5,
          einsatz_id: 1,
          name: 'UHS Turnhalle',
          sortier: 1,
          sprechgruppen: [],
          ueber_abschnitt_id: null,
          lagezustand: 'kritisch',
        },
      ]),
    ),
    http.get(`${BASIS}/einheiten`, () => HttpResponse.json([einheit(10, 'Logistiktrupp')])),
    http.get(`${BASIS}/personal`, () => HttpResponse.json([])),
    http.get(`${BASIS}/fahrzeuge`, () => HttpResponse.json([])),
    http.get(`${BASIS}/material`, () => HttpResponse.json([])),
    http.get(
      `${BASIS}/reports/check-ins`,
      over.rueckmeldungen ?? (() => HttpResponse.json(rueckmeldung('2026-11-16 13:13:00'))),
    ),
  );
}

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={neuerQueryClient()}>{children}</QueryClientProvider>;
}

describe('useWasBrennt (LLH-1743)', () => {
  it('liest alle Quellen und urteilt Rückmeldungen gegen die Seitenuhr', async () => {
    handler({ personen: [{ id: 1, status: 'vermisst', aktuelle_sichtung: null }] });
    const { result } = renderHook(() => useWasBrennt(1, JETZT), { wrapper });
    await waitFor(() => expect(result.current.stand).toBe('vollstaendig'));
    expect(result.current.eintraege.map((e) => e.text)).toEqual([
      '1 vermisst',
      'kritisch: UHS Turnhalle',
      'Rückmeldung überfällig: Logistiktrupp · längste 47 min',
    ]);
    expect(result.current.eintraege[1].bezug).toEqual([5]);
  });

  it('beim Laden kein „vollständig“', () => {
    handler();
    const { result } = renderHook(() => useWasBrennt(1, JETZT), { wrapper });
    expect(result.current.stand).toBe('laedt');
    expect(result.current.eintraege).toEqual([]);
  });

  it('gescheiterte Rückmeldungen: unvollständig, kein Rückmeldungseintrag', async () => {
    handler({ rueckmeldungen: () => HttpResponse.json({}, { status: 500 }) });
    const { result } = renderHook(() => useWasBrennt(1, JETZT), { wrapper });
    await waitFor(() => expect(result.current.stand).toBe('unvollstaendig'));
    expect(result.current.fehlend).toEqual(['Rückmeldungen']);
    expect(result.current.eintraege.map((e) => e.art)).toEqual(['kritisch']);
  });

  it('eine Frist läuft ohne neue Daten ab: der nächste Tick bringt den Eintrag', async () => {
    handler({ rueckmeldungen: () => HttpResponse.json(rueckmeldung('2026-11-16 14:00:30')) });
    const { result, rerender } = renderHook(({ jetzt }) => useWasBrennt(1, jetzt), {
      wrapper,
      initialProps: { jetzt: JETZT },
    });
    await waitFor(() => expect(result.current.stand).toBe('vollstaendig'));
    expect(result.current.eintraege.map((e) => e.art)).toEqual(['kritisch']);
    rerender({ jetzt: JETZT.add(1, 'minute') });
    expect(result.current.eintraege.map((e) => e.art)).toEqual(['kritisch', 'rueckmeldung']);
  });

  it('ohne Modul Meldungen: keine Rückmeldung, kein unvollständiger Stand', async () => {
    handler();
    server.use(
      http.get(`${BASIS}/module-access`, () =>
        HttpResponse.json(freigabenFixture({ meldungen: { sichtbar: true, zugriff: false } })),
      ),
    );
    const { result } = renderHook(() => useWasBrennt(1, JETZT), { wrapper });
    await waitFor(() => expect(result.current.stand).toBe('vollstaendig'));
    expect(result.current.eintraege.map((e) => e.art)).toEqual(['kritisch']);
  });

  it('gesperrtes Material: Ausfall aus Personal und Fahrzeugen bleibt, wie im Meldebild (Review)', async () => {
    handler();
    server.use(
      http.get(`${BASIS}/module-access`, () =>
        HttpResponse.json(freigabenFixture({ material: { sichtbar: true, zugriff: false } })),
      ),
      http.get(`${BASIS}/einheiten`, () =>
        HttpResponse.json([{ ...einheit(10, 'Logistiktrupp'), status: null }]),
      ),
      http.get(`${BASIS}/fahrzeuge`, () =>
        HttpResponse.json([
          { id: 1, funkrufname: 'Florian 1', einheit_id: 10, status_kategorie: 'nicht_verfuegbar' },
          { id: 2, funkrufname: 'Florian 2', einheit_id: 10, status_kategorie: 'verfuegbar' },
        ]),
      ),
    );
    const { result } = renderHook(() => useWasBrennt(1, JETZT), { wrapper });
    await waitFor(() => expect(result.current.stand).toBe('vollstaendig'));
    expect(result.current.eintraege.map((e) => e.text)).toContain('Ausfall: Logistiktrupp');
  });

  it('Ausfall in der Folge der Einheitenliste, nicht in der Baumfolge (LLH-1929)', async () => {
    handler();
    server.use(
      http.get(`${BASIS}/einheiten`, () =>
        HttpResponse.json([
          { ...einheit(20, 'Sanitätszug'), sortier: 2 },
          { ...einheit(21, 'Betreuungsgruppe'), ueber_einheit_id: 20, sortier: 1 },
        ]),
      ),
      http.get(`${BASIS}/fahrzeuge`, () =>
        HttpResponse.json([
          { id: 1, funkrufname: 'Florian 1', einheit_id: 20, status_kategorie: 'nicht_verfuegbar' },
          { id: 2, funkrufname: 'Florian 2', einheit_id: 21, status_kategorie: 'nicht_verfuegbar' },
        ]),
      ),
    );
    const { result } = renderHook(() => useWasBrennt(1, JETZT), { wrapper });
    await waitFor(() => expect(result.current.stand).toBe('vollstaendig'));
    const ausfall = result.current.eintraege.find((e) => e.art === 'ausfall');
    expect(ausfall?.text).toBe('Ausfall: Betreuungsgruppe, Sanitätszug');
    expect(ausfall?.bezug).toEqual([21, 20]);
  });

  it('gesperrte Einheiten: kein Ausfall, kein unvollständiger Stand', async () => {
    handler();
    server.use(
      http.get(`${BASIS}/module-access`, () =>
        HttpResponse.json(freigabenFixture({ einheiten: { sichtbar: true, zugriff: false } })),
      ),
    );
    const { result } = renderHook(() => useWasBrennt(1, JETZT), { wrapper });
    await waitFor(() => expect(result.current.stand).toBe('vollstaendig'));
    expect(result.current.eintraege.map((e) => e.art)).not.toContain('ausfall');
  });

  it('holt den Modulzähler auch ohne neue Daten jede Minute (überfällige Nachforderung)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      handler();
      let abrufe = 0;
      server.use(
        http.get(`${BASIS}/module-counts`, () => {
          abrufe += 1;
          return HttpResponse.json({
            ...zaehler,
            nachforderungen: { ...zaehler.nachforderungen, ueberfaellig: abrufe > 1 ? 1 : 0 },
          });
        }),
      );
      const { result } = renderHook(() => useWasBrennt(1, JETZT), { wrapper });
      await waitFor(() => expect(result.current.stand).toBe('vollstaendig'));
      expect(result.current.eintraege.map((e) => e.art)).not.toContain('nachforderung');
      await vi.advanceTimersByTimeAsync(ZAEHLER_TAKT_MS);
      await waitFor(() =>
        expect(result.current.eintraege.map((e) => e.art)).toContain('nachforderung'),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
