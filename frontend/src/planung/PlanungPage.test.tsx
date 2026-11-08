import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { Planung, PlanungPosten } from '../api/types';
import { meHandler, server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { adminFixture } from '../test/fixtures';
import { waehle } from '../test/auswahlListe';
import { waehleMenueEintrag } from '../test/menue';
import { setzeViewportBreite } from '../test/viewport';
import { planungPfad } from '../routing/deeplinks';
import PlanungPage from './PlanungPage';

/** Planungsseite der Vorplanung (LLH-1586, Spec `vorplanung`). */

const posten = (
  p: Partial<PlanungPosten> & { id: number; bezeichnung: string },
): PlanungPosten => ({
  art: 'einheit',
  sortier: p.id * 10,
  nicht_verfuegbar: false,
  ...p,
});

function planung(ueber: Partial<Planung> = {}): Planung {
  return {
    kopf: {
      id: 5,
      version: 3,
      bezeichnung: 'Stadtfest',
      einsatzart: 'sanitaetsdienst',
      ort: 'Marktplatz',
      von: '2027-06-12 06:00:00',
      bis: '2027-06-12 20:00:00',
      grenzwerte: {
        max_dienst_minuten: 720,
        max_dienst_eigen: false,
        min_ruhe_minuten: 480,
        min_ruhe_eigen: false,
      },
      loeschung_at: '2027-09-10 20:00:00',
      angelegt_at: '2027-05-01 10:00:00',
    },
    posten: [
      posten({ id: 1, bezeichnung: 'RTW 1', schichtlaenge_minuten: 240, soll_anzahl: 2 }),
      posten({ id: 2, bezeichnung: 'UHS Bühne', art: 'uhs', uhs_typ: 'behandlungsplatz' }),
    ],
    bloecke: [
      {
        id: 11,
        posten_id: 2,
        von: '2027-06-12 08:00:00',
        bis: '2027-06-12 12:00:00',
        befunde: [],
        offene_anforderungen: [],
        offene_plaetze: 1,
        personen: [
          {
            art: 'helfer',
            helfer_id: 9,
            name: 'Bea Helfer',
            befunde: [],
            im_einsatz: false,
            qualifikationen: [],
          },
        ],
        personen_anzahl: 1,
        soll_anzahl: 2,
        version: 1,
      },
    ],
    helfer: [{ id: 9, name: 'Bea Helfer', organisation: 'DLRG', qualifikationen: [] }],
    kennzahlen: { soll: 2, ist: 1, offen: 1, konflikte: 0 },
    ...ueber,
  };
}

function Adresse() {
  const l = useLocation();
  return <div data-testid="adresse">{`${l.pathname}${l.search}`}</div>;
}

function setup(p: Planung = planung(), route = planungPfad(5)) {
  server.use(
    meHandler(adminFixture()),
    http.get('/api/planungen/5', () => HttpResponse.json(p)),
    http.get('/api/personal', () => HttpResponse.json([])),
    http.get('/api/qualifikationen', () => HttpResponse.json([])),
  );
  return renderMitProviders(
    <>
      <Adresse />
      <Routes>
        <Route path="/planungen" element={<div>Liste der Planungen</div>} />
        <Route path="/planungen/:planungId" element={<PlanungPage />} />
      </Routes>
    </>,
    { route, datenRouter: true },
  );
}

describe('PlanungPage (LLH-1586)', () => {
  it('zeigt Kopf, Kennzahlen und die drei Reiter; der Reiter steht in der Adresse', async () => {
    setup();
    expect(await screen.findByRole('heading', { level: 1, name: 'Stadtfest' })).toBeInTheDocument();
    expect(screen.getByText('Soll 2 · Ist 1 · Offen 1 · Konflikte 0')).toBeInTheDocument();
    expect(screen.getByText('Marktplatz')).toBeInTheDocument();
    expect(screen.getByText('12 h (Vorgabe)')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Plan' })).toHaveAttribute('aria-selected', 'true');
    await userEvent.click(screen.getByRole('tab', { name: 'Posten · 2' }));
    expect(screen.getByTestId('adresse')).toHaveTextContent('/planungen/5?reiter=posten');
    expect(await screen.findByText('UHS · Behandlungsplatz')).toBeInTheDocument();
  });

  it('Kopf bearbeiten schickt die Version und nur das Geänderte, danach gilt der neueste Stand', async () => {
    let body: unknown;
    let stand = planung();
    setup();
    server.use(
      http.get('/api/planungen/5', () => HttpResponse.json(stand)),
      http.patch('/api/planungen/5', async ({ request }) => {
        body = await request.json();
        const antwort = planung({ kopf: { ...planung().kopf, version: 4, ort: 'Rathaus' } });
        // Gleich danach ändert jemand anderes die Bezeichnung: die Antwort ist schon überholt.
        stand = planung({ kopf: { ...antwort.kopf, version: 5, bezeichnung: 'Stadtfest Süd' } });
        return HttpResponse.json(antwort);
      }),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Planung bearbeiten' }));
    const ort = screen.getByLabelText('Ort');
    await userEvent.clear(ort);
    await userEvent.type(ort, 'Rathaus');
    await userEvent.type(screen.getByLabelText('Höchstens im Dienst'), '10 h');
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() =>
      expect(body).toEqual({ version: 3, ort: 'Rathaus', max_dienst_minuten: 600 }),
    );
    expect(await screen.findByText('Rathaus')).toBeInTheDocument();
    expect((await screen.findAllByText('Stadtfest Süd')).length).toBeGreaterThan(0);
  });

  it('Posten nach unten schickt die ganze Reihenfolge', async () => {
    let body: unknown;
    setup(planung(), planungPfad(5, 'posten'));
    server.use(
      http.put('/api/planungen/5/posten/reihenfolge', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(planung());
      }),
    );
    await screen.findByText('RTW 1');
    await waehleMenueEintrag(
      screen.getByRole('button', { name: 'Aktionen zu RTW 1' }),
      'Nach unten',
    );
    await waitFor(() => expect(body).toEqual({ posten_ids: [2, 1] }));
  });

  it('Posten mit eingeteilten Personen löschen nennt die Blöcke und löscht sie mit', async () => {
    let url = '';
    setup(planung(), planungPfad(5, 'posten'));
    server.use(
      http.delete('/api/planungen/5/posten/2', ({ request }) => {
        url = request.url;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await screen.findByText('UHS Bühne');
    await waehleMenueEintrag(
      screen.getByRole('button', { name: 'Aktionen zu UHS Bühne' }),
      'Löschen',
    );
    const dialog = await screen.findByRole('dialog', { name: 'UHS Bühne löschen?' });
    expect(within(dialog).getByText('Sein Block wird mitgelöscht.')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Posten löschen' }));
    await waitFor(() => expect(url).toContain('mit_bloecken=true'));
  });

  it('Posten aus einer Einheitenvorlage übernimmt den Namen und schickt die Vorlage', async () => {
    let body: unknown;
    setup(planung(), planungPfad(5, 'posten'));
    server.use(
      http.get('/api/einheit-vorlagen', () =>
        HttpResponse.json([
          {
            id: 40,
            name: 'SEG Nord',
            soll: { fuehrer: 1, unterfuehrer: 1, mannschaft: 4 },
            fahrzeuge: [],
          },
        ]),
      ),
      http.post('/api/planungen/5/posten', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(planung(), { status: 201 });
      }),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Posten anlegen' }));
    await waehle('Herkunft', 'Einheitenvorlage');
    await waehle('Einheitenvorlage', 'SEG Nord');
    expect(screen.getByLabelText('Bezeichnung')).toHaveValue('SEG Nord');
    expect(screen.getByPlaceholderText('6 (Vorgabe)')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Schichtlänge'), '6 h');
    const dialog = screen.getByRole('dialog', { name: 'Posten anlegen' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Posten anlegen' }));
    await waitFor(() =>
      expect(body).toEqual({
        bezeichnung: 'SEG Nord',
        art: 'einheit',
        einheit_vorlage_id: 40,
        schichtlaenge_minuten: 360,
      }),
    );
  });

  it('Helfer anlegen schickt Name und Organisation', async () => {
    let body: unknown;
    setup(planung(), planungPfad(5, 'helfer'));
    server.use(
      http.post('/api/planungen/5/helfer', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: 10, name: 'Carl', qualifikationen: [] }, { status: 201 });
      }),
    );
    expect(await screen.findByText('DLRG')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Helfer anlegen' }));
    const dialog = await screen.findByRole('dialog', { name: 'Helfer anlegen' });
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Carl');
    await userEvent.type(within(dialog).getByLabelText('Organisation'), 'THW');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Helfer anlegen' }));
    await waitFor(() => expect(body).toEqual({ name: 'Carl', organisation: 'THW' }));
  });

  it('Helfer in Serie: die Organisation bleibt auf Wunsch stehen', async () => {
    const bodies: unknown[] = [];
    setup(planung(), planungPfad(5, 'helfer'));
    server.use(
      http.post('/api/planungen/5/helfer', async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ id: 10, name: 'Carl', qualifikationen: [] }, { status: 201 });
      }),
    );
    expect(await screen.findByText('DLRG')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Helfer anlegen' }));
    const dialog = await screen.findByRole('dialog', { name: 'Helfer anlegen' });
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Werte behalten' }));
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Carl');
    await userEvent.type(within(dialog).getByLabelText('Organisation'), 'THW');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern und nächste' }));
    await waitFor(() => expect(within(dialog).getByLabelText('Name')).toHaveValue(''));
    expect(within(dialog).getByLabelText('Organisation')).toHaveValue('THW');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Dora');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern und nächste' }));
    await waitFor(() =>
      expect(bodies).toEqual([
        { name: 'Carl', organisation: 'THW' },
        { name: 'Dora', organisation: 'THW' },
      ]),
    );
  });

  it('Schichten erzeugen ohne Länge nennt die Schichtlänge des Postens und schickt posten_id', async () => {
    let body: unknown;
    setup();
    server.use(
      http.post('/api/planungen/5/erzeugen', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(planung());
      }),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Schichten erzeugen' }));
    const dialog = await screen.findByRole('dialog', { name: 'Schichten erzeugen' });
    await waehle('Posten', 'RTW 1');
    expect(within(dialog).getByPlaceholderText('4 h (Vorgabe)')).toBeInTheDocument();
    await userEvent.type(within(dialog).getByPlaceholderText('Beginn'), '12.06.27 08:00');
    await userEvent.type(within(dialog).getByPlaceholderText('Ende'), '12.06.27 16:00');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Schichten erzeugen' }));
    await waitFor(() =>
      expect(body).toEqual({
        posten_id: 1,
        von: '2027-06-12 06:00:00',
        bis: '2027-06-12 14:00:00',
      }),
    );
  });

  it('Schichten erzeugen: der Längenfehler fällt weg, sobald der Posten eine Länge vorgibt', async () => {
    setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Schichten erzeugen' }));
    const dialog = await screen.findByRole('dialog', { name: 'Schichten erzeugen' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Schichten erzeugen' }));
    expect(await within(dialog).findByText('Bitte eine Länge angeben')).toBeInTheDocument();
    await waehle('Posten', 'RTW 1');
    await waitFor(() => expect(within(dialog).queryByText('Bitte eine Länge angeben')).toBeNull());
  });

  it('Handy: Liste mit allen Blöcken je Posten', async () => {
    setzeViewportBreite(390);
    setup();
    const liste = await screen.findByRole('region', { name: 'Schichtplan je Posten' });
    const bloecke = within(liste).getAllByRole('button');
    expect(bloecke).toHaveLength(1);
    expect(bloecke[0]).toHaveAccessibleName(/UHS Bühne .*Bea Helfer, 1 offen/);
  });

  it('Planung löschen fragt einmal nach und führt zur Liste', async () => {
    setup();
    server.use(http.delete('/api/planungen/5', () => new HttpResponse(null, { status: 204 })));
    await waehleMenueEintrag(
      await screen.findByRole('button', { name: 'Aktionen zu Stadtfest' }),
      'Planung löschen',
    );
    const dialog = await screen.findByRole('dialog', { name: 'Stadtfest löschen?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Planung löschen' }));
    expect(await screen.findByText('Liste der Planungen')).toBeInTheDocument();
  });

  it('eine fremde oder gelöschte Planung (404) sagt, dass es sie nicht gibt', async () => {
    setup();
    server.use(
      http.get('/api/planungen/5', () =>
        HttpResponse.json({ fehler: 'nicht gefunden' }, { status: 404 }),
      ),
    );
    expect(await screen.findByText('Diese Planung gibt es nicht')).toBeInTheDocument();
  });
});
