import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { alsBackendZeit } from '../anzeige/zeitEingabe';
import { DEFAULT_KONVENTIONEN, formatZeitKurz } from '../anzeige/format';
import type { LagebesprechungStand } from '../api/types';
import { serverJetzt, serveruhrVergessenFuerTests } from '../offline/serveruhr';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import TerminPaneel from './TerminPaneel';

dayjs.extend(utc);

/**
 * Nur `Date` steht still (`toFake`): `userEvent`, MSW und antds Animationen laufen auf echten
 * Timern weiter (Muster `LagebesprechungModal.test.tsx`).
 */
const JETZT = new Date('2026-09-13T10:00:00Z');
const wireAb = (minuten: number) =>
  dayjs(JETZT).add(minuten, 'minute').utc().format('YYYY-MM-DD HH:mm:ss');

const stand = (over: Partial<LagebesprechungStand> = {}): LagebesprechungStand => ({
  anzahl_lagebesprechungen: 2,
  ...over,
});

let gesendet: Record<string, unknown>[];
let putAntwort: () => Response;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(JETZT);
  // Ohne gemessenen Versatz gilt die (stehende) Geräteuhr — `serverJetzt()` ist dann JETZT.
  serveruhrVergessenFuerTests();
  gesendet = [];
  putAntwort = () => HttpResponse.json(stand());
  server.use(
    http.put('/api/einsaetze/1/lagebesprechung/termin', async ({ request }) => {
      gesendet.push((await request.json()) as Record<string, unknown>);
      return putAntwort();
    }),
  );
});
afterEach(() => {
  vi.useRealTimers();
  serveruhrVergessenFuerTests();
});

function zeige(daten: LagebesprechungStand | undefined = stand(), darfSchreiben = true) {
  renderMitProviders(
    <TerminPaneel einsatzId={1} stand={daten} zustand="daten" darfSchreiben={darfSchreiben} />,
  );
  return screen.getByRole('region', { name: 'Termin' });
}

/** Die Kennzahl „Nächste Lagebesprechung“ über ihre Augenbraue. */
function terminKennzahl(paneel: HTMLElement): HTMLElement {
  const zelle = [...paneel.querySelectorAll<HTMLElement>('[data-lfh="kennzahl"]')].find((k) =>
    k.textContent?.startsWith('Nächste Lagebesprechung'),
  );
  if (!zelle) throw new Error('Kennzahl „Nächste Lagebesprechung“ nicht gefunden');
  return zelle;
}
const notiz = (kennzahl: HTMLElement) =>
  kennzahl.querySelector<HTMLElement>('[data-lfh="kennzahl-notiz"]')!;
const wert = (kennzahl: HTMLElement) =>
  kennzahl.querySelector<HTMLElement>('[data-lfh="kennzahl-wert"]')!;

const SCHNELLWAHL = ['+30 min', '+1 h', '+2 h'] as const;

describe('TerminPaneel · Zustand des Termins', () => {
  it('Termin in 25 min: taktische Zeit groß, Notiz „in 25 min“, neutral', () => {
    const p = zeige(stand({ naechste_lagebesprechung_at: wireAb(25) }));
    const k = terminKennzahl(p);
    expect(wert(k)).toHaveTextContent(formatZeitKurz(wireAb(25), DEFAULT_KONVENTIONEN));
    expect(notiz(k)).toHaveTextContent('in 25 min');
    expect(k).toHaveAttribute('data-ton', 'neutral');
  });

  it('seit 5,5 min verstrichen: „seit 5 min überfällig“ im Ton achtung, nie alarm', () => {
    const p = zeige(
      stand({
        naechste_lagebesprechung_at: dayjs(JETZT)
          .subtract(5.5 * 60, 'second')
          .utc()
          .format('YYYY-MM-DD HH:mm:ss'),
      }),
    );
    const k = terminKennzahl(p);
    expect(notiz(k)).toHaveTextContent('seit 5 min überfällig');
    expect(k).toHaveAttribute('data-ton', 'achtung');
  });

  it('ohne Termin: „—“ und „kein Termin“, der Knopf „kein Termin“ ist gesperrt', () => {
    const p = zeige(stand());
    const k = terminKennzahl(p);
    expect(wert(k)).toHaveTextContent('—');
    expect(notiz(k)).toHaveTextContent('kein Termin');
    expect(within(p).getByRole('button', { name: 'kein Termin' })).toBeDisabled();
    // Gegenfall: die Schnellwahl bleibt bedienbar — gesperrt ist nur das Löschen.
    expect(within(p).getByRole('button', { name: '+1 h' })).toBeEnabled();
  });

  it('nennt die Zahl der abgeschlossenen Besprechungen', () => {
    const p = zeige(stand({ anzahl_lagebesprechungen: 4 }));
    const band = within(p).getByRole('group', { name: 'Termin der nächsten Lagebesprechung' });
    expect(band).toHaveTextContent('Abgeschlossen');
    expect(band).toHaveTextContent('4');
  });
});

describe('TerminPaneel · Termin setzen', () => {
  it('„+1 h“ setzt den Termin ab der Serverzeit per PUT', async () => {
    const p = zeige();
    const erwartet = alsBackendZeit(serverJetzt().add(60, 'minute'));
    expect(erwartet).toBe(wireAb(60));
    await userEvent.click(within(p).getByRole('button', { name: '+1 h' }));
    await waitFor(() => expect(gesendet).toHaveLength(1));
    expect(gesendet[0]).toEqual({ naechste_at: erwartet });
  });

  it('„kein Termin“ sendet naechste_at: null', async () => {
    const p = zeige(stand({ naechste_lagebesprechung_at: wireAb(45) }));
    await userEvent.click(within(p).getByRole('button', { name: 'kein Termin' }));
    await waitFor(() => expect(gesendet).toHaveLength(1));
    expect(gesendet[0]).toEqual({ naechste_at: null });
  });

  it('ohne Schreibrecht ist jede Bedienung gesperrt, der Termin bleibt lesbar', () => {
    const p = zeige(stand({ naechste_lagebesprechung_at: wireAb(45) }), false);
    expect(notiz(terminKennzahl(p))).toHaveTextContent('in 45 min');
    for (const name of [...SCHNELLWAHL, 'kein Termin']) {
      expect(within(p).getByRole('button', { name })).toBeDisabled();
    }
    expect(within(p).getByLabelText('Termin wählen')).toBeDisabled();
  });

  it('mit Schreibrecht ist die Bedienung frei (Gegenfall)', () => {
    const p = zeige(stand({ naechste_lagebesprechung_at: wireAb(45) }));
    for (const name of [...SCHNELLWAHL, 'kein Termin']) {
      expect(within(p).getByRole('button', { name })).toBeEnabled();
    }
    expect(within(p).getByLabelText('Termin wählen')).toBeEnabled();
  });

  it('ohne Stand ist die Bedienung gesperrt — es gäbe nichts zu vergleichen', () => {
    renderMitProviders(
      <TerminPaneel einsatzId={1} stand={undefined} zustand="laden" darfSchreiben />,
    );
    const p = screen.getByRole('region', { name: 'Termin' });
    for (const name of [...SCHNELLWAHL, 'kein Termin']) {
      expect(within(p).getByRole('button', { name })).toBeDisabled();
    }
  });

  it('ein abgelehnter PUT steht als „Termin nicht gesetzt“ im Paneel', async () => {
    putAntwort = () => HttpResponse.json({ error: 'kaputt' }, { status: 500 });
    const p = zeige();
    await userEvent.click(within(p).getByRole('button', { name: '+30 min' }));
    expect(await within(p).findByText('Termin nicht gesetzt')).toBeInTheDocument();
    expect(gesendet).toEqual([{ naechste_at: wireAb(30) }]);
  });
});
