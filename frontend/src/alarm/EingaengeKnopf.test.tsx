import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BenachrichtigungAnzeige, BenachrichtigungEreignis } from '../api/types';
import { DEFAULT_KONVENTIONEN } from '../anzeige/format';
import { zeitKurz } from '../anzeige/zeitDarstellung';
import { BENACHRICHTIGUNG_WINDOW_EVENT } from '../live/benachrichtigungListener';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { setzeViewportBreite, VIEWPORT_STANDARD } from '../test/viewport';
import EingaengeKnopf from './EingaengeKnopf';
import { EINGAENGE_OEFFNEN_EVENT, eingaengeZahlText } from './eingaenge';
import { istStumm, setzeStumm, vergesseStummStand } from './eingaengeStumm';

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

function rendern() {
  return renderMitProviders(
    <Routes>
      <Route
        path="*"
        element={
          <>
            <EingaengeKnopf einsatzId={1} />
            <Ort />
          </>
        }
      />
    </Routes>,
    { route: '/einsaetze/1/lagekarte' },
  );
}

beforeEach(() => {
  setzeViewportBreite(1366);
  setzeStumm('meldung', false);
  setzeStumm('gefahr', false);
});
afterEach(() => setzeViewportBreite(VIEWPORT_STANDARD));

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

  it('„Stumm“ klappt die Schalter dieses Geräts auf: nur Eingänge, kein Alarm (LLH-1421)', async () => {
    serverMit({ eintraege: [eintrag(1)], ungelesen: 1 });
    rendern();
    await userEvent.click(await screen.findByRole('button', { name: 'Eingänge, 1 ungelesen' }));
    const paneel = await screen.findByRole('region', { name: 'Eingänge' });
    const knopf = within(paneel).getByRole('button', { name: 'Stumm' });
    expect(knopf).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(knopf);
    const liste = within(paneel).getByRole('region', { name: 'Stumm auf diesem Gerät' });
    expect(within(liste).queryByRole('switch', { name: /Sofortmeldung/ })).toBeNull();
    expect(within(liste).queryByRole('switch', { name: /Neuer Einsatz/ })).toBeNull();
    expect(within(liste).queryByRole('switch', { name: /Unwetter/ })).toBeNull();

    const meldung = within(liste).getByRole('switch', {
      name: 'Stumm: Neue Meldung und Lagemeldung',
    });
    expect(meldung).not.toBeChecked();
    await userEvent.click(meldung);
    expect(meldung).toBeChecked();
    expect(istStumm('meldung')).toBe(true);
    // Der Stand liegt im Gerät und überlebt ein Neuladen.
    vergesseStummStand();
    expect(istStumm('meldung')).toBe(true);
    // Der Kopf nennt, wie viele Arten stumm sind; die Zahl der Eingänge bleibt.
    expect(within(paneel).getByRole('button', { name: 'Stumm · 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Eingänge, 1 ungelesen' })).toBeInTheDocument();
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
