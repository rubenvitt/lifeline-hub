import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BenachrichtigungAnzeige, BenachrichtigungEreignis } from '../api/types';
import { DEFAULT_KONVENTIONEN } from '../anzeige/format';
import { zeitKurz } from '../anzeige/zeitDarstellung';
import { useAuth } from '../auth/AuthContext';
import { BENACHRICHTIGUNG_WINDOW_EVENT } from '../live/benachrichtigungListener';
import {
  queueLeerenFuerTests,
  schreibaktionEinreihen,
  schreibaktionenLaden,
} from '../offline/queue';
import { useOfflineSync } from '../offline/useOfflineSync';
import { benutzerFixture } from '../test/fixtures';
import { meHandler, server } from '../test/server';
import { renderMitProviders, setzeOnline } from '../test/utils';
import { setzeViewportBreite, VIEWPORT_STANDARD } from '../test/viewport';
import EingaengeKnopf from './EingaengeKnopf';
import { EINGAENGE_OEFFNEN_EVENT, eingaengeZahlText } from './eingaenge';

/**
 * Knopf „Eingänge“ mit Verlauf (LLH-1143, design.md D6): Zahl der ungelesenen Eingänge, Gruppen
 * „Neu“ und „Früher“, Sprung zum Objekt, „Alle gelesen“, Abgleich bei jedem Ereignis.
 */

function eintrag(id: number, teil: Partial<BenachrichtigungAnzeige> = {}): BenachrichtigungAnzeige {
  return {
    id,
    einsatz_id: 1,
    art: 'auftrag_erteilt',
    stufe: 'hinweis',
    bezug_typ: 'auftrag',
    bezug_id: id,
    erstellt_at: '2026-10-22 12:05:00',
    titel: 'Neuer Auftrag',
    detail: `Auftrag #${id}`,
    pfad: `/einsaetze/1/auftraege?auftrag=${id}`,
    ...teil,
  };
}

/** Der Server mit diesem Verlauf; Abrufe, Quittungen und „gelesen“ zählen mit. */
function serverMit(verlauf: { eintraege: BenachrichtigungAnzeige[]; ungelesen: number }) {
  const zaehler = { abrufe: 0, quittiert: [] as number[], gelesen: [] as number[] };
  server.use(
    http.get('/api/einsaetze/:id/benachrichtigungen', () => {
      zaehler.abrufe++;
      return HttpResponse.json(verlauf);
    }),
    http.post('/api/benachrichtigungen/:id/quittieren', ({ params }) => {
      zaehler.quittiert.push(Number(params.id));
      return new HttpResponse(null, { status: 204 });
    }),
    http.post('/api/einsaetze/:id/benachrichtigungen/gelesen', async ({ request }) => {
      zaehler.gelesen.push(((await request.json()) as { bis_id: number }).bis_id);
      return new HttpResponse(null, { status: 204 });
    }),
  );
  return zaehler;
}

function Ort() {
  const l = useLocation();
  return <output data-testid="route">{`${l.pathname}${l.search}`}</output>;
}

const BENUTZER = 31;

/** Der globale Abgleich der Offline-Queue, wie ihn der Rahmen der App für die Person hält. */
function Abgleich() {
  const { benutzer } = useAuth();
  useOfflineSync(benutzer?.id);
  return benutzer ? <output data-testid="angemeldet" /> : null;
}

function rendern() {
  return renderMitProviders(
    <Routes>
      <Route
        path="*"
        element={
          <>
            <EingaengeKnopf einsatzId={1} />
            <Ort />
            <Abgleich />
          </>
        }
      />
    </Routes>,
    { route: '/einsaetze/1/lagekarte' },
  );
}

beforeEach(async () => {
  setzeViewportBreite(1366);
  server.use(meHandler(benutzerFixture({ id: BENUTZER })));
  await queueLeerenFuerTests();
});
afterEach(() => {
  setzeViewportBreite(VIEWPORT_STANDARD);
  setzeOnline(true);
});

describe('Knopf „Eingänge“ (LLH-1143)', () => {
  it('nennt die Zahl der ungelesenen Eingänge sichtbar und im Namen', async () => {
    serverMit({ eintraege: [eintrag(2), eintrag(1)], ungelesen: 2 });
    rendern();
    const knopf = await screen.findByRole('button', { name: 'Eingänge, 2 ungelesen' });
    expect(knopf).toHaveTextContent('2');
  });

  it('ohne Ungelesene: „keine ungelesen“, keine Zahl', async () => {
    serverMit({ eintraege: [], ungelesen: 0 });
    rendern();
    const knopf = await screen.findByRole('button', { name: 'Eingänge, keine ungelesen' });
    expect(knopf).not.toHaveTextContent(/\d/);
  });

  it('kürzt große Zahlen auf „99+“', () => {
    expect(eingaengeZahlText(0)).toBe('');
    expect(eingaengeZahlText(7)).toBe('7');
    expect(eingaengeZahlText(99)).toBe('99');
    expect(eingaengeZahlText(120)).toBe('99+');
  });

  it('Paneel: Gruppen „Neu“ und „Früher“, Stilles und Gelesenes unter „Früher“', async () => {
    serverMit({
      eintraege: [
        eintrag(3, { titel: 'Neue Gefahr', art: 'gefahr', detail: undefined }),
        eintrag(2, { stufe: 'still', titel: 'Neuer Lagebericht', quittiert_at: 'x' }),
        eintrag(1, { quittiert_at: '2026-10-22 12:06:00' }),
      ],
      ungelesen: 1,
    });
    rendern();
    await userEvent.click(await screen.findByRole('button', { name: 'Eingänge, 1 ungelesen' }));
    const paneel = await screen.findByRole('region', { name: 'Eingänge' });
    const neu = within(paneel).getByRole('list', { name: 'Neu' });
    const frueher = within(paneel).getByRole('list', { name: 'Früher' });
    expect(within(neu).getAllByRole('listitem')).toHaveLength(1);
    expect(within(neu).getByText('Neue Gefahr')).toBeInTheDocument();
    expect(within(frueher).getAllByRole('listitem')).toHaveLength(2);
    expect(within(frueher).getByText('Neuer Lagebericht')).toBeInTheDocument();
    // Taktische Zeit (heute „1405“, sonst mit Tag).
    expect(
      within(neu).getByText(zeitKurz('2026-10-22 12:05:00', DEFAULT_KONVENTIONEN)),
    ).toBeInTheDocument();
  });

  it('ein Eintrag springt zum Objekt und quittiert ihn', async () => {
    const zaehler = serverMit({ eintraege: [eintrag(5)], ungelesen: 1 });
    rendern();
    await userEvent.click(await screen.findByRole('button', { name: 'Eingänge, 1 ungelesen' }));
    const paneel = await screen.findByRole('region', { name: 'Eingänge' });
    await userEvent.click(within(paneel).getByRole('link', { name: /Neuer Auftrag/ }));
    expect(screen.getByTestId('route')).toHaveTextContent('/einsaetze/1/auftraege?auftrag=5');
    await waitFor(() => expect(zaehler.quittiert).toEqual([5]));
  });

  it('„Alle gelesen“ schickt die jüngste Kennung; ohne Ungelesene gesperrt', async () => {
    const zaehler = serverMit({ eintraege: [eintrag(9), eintrag(4)], ungelesen: 2 });
    rendern();
    await userEvent.click(await screen.findByRole('button', { name: 'Eingänge, 2 ungelesen' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Alle gelesen' }));
    await waitFor(() => expect(zaehler.gelesen).toEqual([9]));
  });

  it('„Alle gelesen“ ist gesperrt, wenn nichts ungelesen ist', async () => {
    serverMit({ eintraege: [eintrag(9, { quittiert_at: 'x' })], ungelesen: 0 });
    rendern();
    await userEvent.click(await screen.findByRole('button', { name: 'Eingänge, keine ungelesen' }));
    expect(await screen.findByRole('button', { name: 'Alle gelesen' })).toBeDisabled();
  });

  it('gleicht bei einem Ereignis dieses Einsatzes ab, bei einem fremden nicht', async () => {
    const zaehler = serverMit({ eintraege: [], ungelesen: 0 });
    rendern();
    await screen.findByRole('button', { name: 'Eingänge, keine ungelesen' });
    const vorher = zaehler.abrufe;
    const senden = (einsatz_id: number) =>
      act(() => {
        const detail: BenachrichtigungEreignis = {
          einsatz_id,
          benachrichtigung_id: 77,
          art: 'gefahr',
          stufe: 'hinweis',
          bezug_typ: 'gefahrengebiet',
          bezug_id: 1,
          quittiert: false,
        };
        window.dispatchEvent(new CustomEvent(BENACHRICHTIGUNG_WINDOW_EVENT, { detail }));
      });
    senden(2);
    await new Promise((r) => setTimeout(r, 400));
    expect(zaehler.abrufe).toBe(vorher);
    senden(1);
    await waitFor(() => expect(zaehler.abrufe).toBe(vorher + 1));
  });

  it('öffnet sich auf Bitte des Eingangsbands', async () => {
    serverMit({ eintraege: [eintrag(1)], ungelesen: 1 });
    rendern();
    await screen.findByRole('button', { name: 'Eingänge, 1 ungelesen' });
    act(() => {
      window.dispatchEvent(new CustomEvent(EINGAENGE_OEFFNEN_EVENT, { detail: { einsatzId: 1 } }));
    });
    expect(await screen.findByRole('region', { name: 'Eingänge' })).toBeInTheDocument();
  });

  it('bündelt der Kopf (Handschirm): kein eigener Knopf, der Verlauf als Blatt von unten', async () => {
    setzeViewportBreite(390);
    const zaehler = serverMit({ eintraege: [eintrag(1)], ungelesen: 1 });
    rendern();
    await waitFor(() => expect(zaehler.abrufe).toBeGreaterThan(0));
    // Zahl und Eintrag trägt die gebündelte Alarmzentrale (`AlarmZentrale.test.tsx`).
    expect(screen.queryByRole('button', { name: /^Eingänge, / })).not.toBeInTheDocument();
    act(() => {
      window.dispatchEvent(new CustomEvent(EINGAENGE_OEFFNEN_EVENT, { detail: { einsatzId: 1 } }));
    });
    const blatt = await screen.findByRole('dialog');
    expect(within(blatt).getByRole('region', { name: 'Eingänge' })).toBeInTheDocument();
  });
});

/**
 * Ohne Netz (LLH-1422, Spec `benachrichtigungen`, „Verlauf ohne Netz“): der Verlauf bleibt aus dem
 * Speicher lesbar, der Stand trägt „offline“; „Alle gelesen“ wird vorgemerkt, die Zahl fällt
 * sofort, gesendet wird nach der Rückkehr. Geladen wird online, dann fällt das Netz weg.
 */
describe('Eingänge ohne Netz (LLH-1422)', () => {
  async function oeffnenOhneNetz(name: string) {
    await screen.findByTestId('angemeldet');
    await userEvent.click(await screen.findByRole('button', { name }));
    const paneel = await screen.findByRole('region', { name: 'Eingänge' });
    setzeOnline(false);
    return paneel;
  }

  it('der Verlauf bleibt lesbar, der Stand trägt „offline“', async () => {
    serverMit({ eintraege: [eintrag(9), eintrag(4, { quittiert_at: 'x' })], ungelesen: 1 });
    rendern();
    const paneel = await oeffnenOhneNetz('Eingänge, 1 ungelesen');
    expect(await within(paneel).findByText(/^Stand \d{4} · offline$/)).toBeInTheDocument();
    expect(within(paneel).getByRole('list', { name: 'Neu' })).toHaveTextContent('Auftrag #9');
    expect(within(paneel).getByRole('list', { name: 'Früher' })).toHaveTextContent('Auftrag #4');
  });

  it('mit Netz steht kein Stand im Paneel', async () => {
    serverMit({ eintraege: [eintrag(9)], ungelesen: 1 });
    rendern();
    await userEvent.click(await screen.findByRole('button', { name: 'Eingänge, 1 ungelesen' }));
    const paneel = await screen.findByRole('region', { name: 'Eingänge' });
    expect(within(paneel).queryByText(/^Stand /)).toBeNull();
  });

  it('„Alle gelesen“: vorgemerkt, Zahl sofort weg, nach der Rückkehr genau einmal gesendet', async () => {
    const zaehler = serverMit({
      eintraege: [eintrag(9), eintrag(5, { stufe: 'alarm' }), eintrag(4)],
      ungelesen: 2,
    });
    rendern();
    const paneel = await oeffnenOhneNetz('Eingänge, 2 ungelesen');
    await userEvent.click(within(paneel).getByRole('button', { name: 'Alle gelesen' }));

    expect(await within(paneel).findByText('Offline vorgemerkt')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Eingänge, keine ungelesen' })).toBeInTheDocument();
    // Der Alarm bleibt unter „Neu“, wie online.
    const neu = within(paneel).getByRole('list', { name: 'Neu' });
    expect(within(neu).getAllByRole('listitem')).toHaveLength(1);
    // Das Ladezeichen klingt in jsdom nicht aus, es bleibt im Namen.
    expect(within(paneel).getByRole('button', { name: /Alle gelesen$/ })).toBeDisabled();
    expect(zaehler.gelesen).toEqual([]);
    expect((await schreibaktionenLaden(BENUTZER, 1)).map((z) => z.aktion)).toEqual([
      { art: 'eingaenge_gelesen', daten: { bis_id: 9 } },
    ]);

    setzeOnline(true);
    await waitFor(() => expect(zaehler.gelesen).toEqual([9]));
    await waitFor(() => expect(within(paneel).queryByText('Offline vorgemerkt')).toBeNull());
    expect(await schreibaktionenLaden(BENUTZER, 1)).toEqual([]);
  });

  it('ein Abruf vor dem Senden zeigt das Vorgemerkte weiter als gelesen', async () => {
    // Die Rückkehr des Netzes ruft den Verlauf ab, bevor der Abgleich gesendet hat: die Zahl
    // springt nicht zurück. Das Senden scheitert hier an der Leitung, die Zeile bleibt stehen.
    await schreibaktionEinreihen(BENUTZER, 1, {
      art: 'eingaenge_gelesen',
      daten: { bis_id: 9 },
    });
    serverMit({ eintraege: [eintrag(10), eintrag(9), eintrag(4)], ungelesen: 3 });
    server.use(
      http.post('/api/einsaetze/:id/benachrichtigungen/gelesen', () => HttpResponse.error()),
    );
    rendern();
    await screen.findByTestId('angemeldet');
    act(() => {
      const detail: BenachrichtigungEreignis = {
        einsatz_id: 1,
        benachrichtigung_id: 10,
        art: 'auftrag_erteilt',
        stufe: 'hinweis',
        bezug_typ: 'auftrag',
        bezug_id: 10,
        quittiert: false,
      };
      window.dispatchEvent(new CustomEvent(BENACHRICHTIGUNG_WINDOW_EVENT, { detail }));
    });
    // Nur der jüngere Eingang ist ungelesen; 9 und 4 sind vorgemerkt gelesen.
    expect(
      await screen.findByRole('button', { name: 'Eingänge, 1 ungelesen' }),
    ).toBeInTheDocument();
  });
});
