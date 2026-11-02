import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router';
import type { BetreuungUebersicht, Betreuungsstelle, ModulFreigaben } from '../api/types';
import { benutzerFixture, freigabenFixture } from '../test/fixtures';
import { meHandler, server } from '../test/server';
import { richtwerteAntwort } from '../test/unterkunftRichtwerte';
import { renderMitProviders, setzeOnline } from '../test/utils';
import UnterkunftPlanenPage, {
  ENTSPRICHT_KAPAZITAET,
  KEINE_PLAETZE,
  NUR_AUS_FLAECHE,
  OHNE_NETZ,
  kapazitaetGesperrt,
} from './UnterkunftPlanenPage';

/** „Unterkunft planen“ an der Betreuungsstelle (LLH-1520, Spec `unterkunftsrechner`). */

describe('kapazitaetGesperrt', () => {
  const frei = {
    weg: 'raeume' as const,
    plaetze: 50,
    kapazitaet: 40,
    darfSchreiben: true,
    rechteGrund: 'nur Einsatzleitung',
    ohneNetz: false,
  };
  it('frei, wenn Plätze aus Räumen, Fläche oder Zelten von der Kapazität abweichen', () => {
    expect(kapazitaetGesperrt(frei)).toBeNull();
    expect(kapazitaetGesperrt({ ...frei, kapazitaet: null })).toBeNull();
  });
  it('nennt den Grund in wenigen Wörtern', () => {
    expect(kapazitaetGesperrt({ ...frei, weg: 'personen' })).toBe(NUR_AUS_FLAECHE);
    expect(kapazitaetGesperrt({ ...frei, darfSchreiben: false })).toBe('nur Einsatzleitung');
    expect(kapazitaetGesperrt({ ...frei, ohneNetz: true })).toBe(OHNE_NETZ);
    expect(kapazitaetGesperrt({ ...frei, plaetze: 0 })).toBe(KEINE_PLAETZE);
    expect(kapazitaetGesperrt({ ...frei, kapazitaet: 50 })).toBe(ENTSPRICHT_KAPAZITAET);
  });
});

const TURNHALLE: Betreuungsstelle = {
  id: 8,
  einsatz_id: 1,
  bezeichnung: 'Turnhalle Ost',
  art: 'notunterkunft',
  status: 'in_betrieb',
  angelegt_at: '2026-09-23 08:00:00',
  kapazitaet_personen: 40,
} as Betreuungsstelle;

interface Aufbau {
  rolle?: string;
  freigaben?: ModulFreigaben;
  einsatzWerte?: Record<string, number>;
}

function stelleBereit(a: Aufbau = {}) {
  const patches: unknown[] = [];
  const nachforderungen: unknown[] = [];
  let stelle = { ...TURNHALLE };
  server.use(
    meHandler(benutzerFixture({ id: 1, anzeigename: 'Leitung' })),
    http.get('/api/einsaetze/1', () =>
      HttpResponse.json({
        id: 1,
        bezeichnung: 'Hochwasser Weser',
        status: 'aktiv',
        meine_rolle: a.rolle ?? 'einsatzleitung',
        org_id: 1,
      }),
    ),
    http.get('/api/einsaetze/1/modul-freigaben', () =>
      HttpResponse.json(a.freigaben ?? freigabenFixture()),
    ),
    http.get('/api/einsaetze/1/betreuung', () =>
      HttpResponse.json({ stellen: [stelle], namentlich: [] } satisfies BetreuungUebersicht),
    ),
    http.get('/api/einsaetze/1/unterkunft-richtwerte', () =>
      HttpResponse.json(richtwerteAntwort({}, a.einsatzWerte)),
    ),
    http.patch('/api/einsaetze/1/betreuung/stellen/8', async ({ request }) => {
      const body = (await request.json()) as { kapazitaet_personen: number };
      patches.push(body);
      stelle = { ...stelle, ...body };
      return HttpResponse.json(stelle);
    }),
    http.post('/api/einsaetze/1/nachforderungen', async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      nachforderungen.push(body);
      return HttpResponse.json({ id: nachforderungen.length, ...body }, { status: 201 });
    }),
  );
  return { patches, nachforderungen };
}

function rendern() {
  return renderMitProviders(
    <Routes>
      <Route
        path="/einsaetze/:id/betreuung/:stelleId/unterkunft"
        element={<UnterkunftPlanenPage />}
      />
    </Routes>,
    { route: '/einsaetze/1/betreuung/8/unterkunft' },
  );
}

async function halleEintragen(laenge: string, breite: string) {
  const raum = await screen.findByRole('group', { name: 'Raum 1' });
  await userEvent.type(within(raum).getByRole('spinbutton', { name: 'Länge Raum 1 (m)' }), laenge);
  await userEvent.type(within(raum).getByRole('spinbutton', { name: 'Breite Raum 1 (m)' }), breite);
}

describe('UnterkunftPlanenPage', () => {
  afterEach(() => setzeOnline(true));

  it('rechnet aus Räumen und übernimmt die Plätze als Kapazität der Stelle', async () => {
    const { patches } = stelleBereit();
    rendern();
    expect(await screen.findByRole('heading', { name: /Unterkunft planen/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Kapazität übernehmen' })).toBeDisabled();
    expect(screen.getByText(KEINE_PLAETZE)).toBeInTheDocument();

    await halleEintragen('20', '10');
    const knopf = await screen.findByRole('button', { name: 'Kapazität übernehmen · 50 Plätze' });
    await userEvent.click(knopf);
    await waitFor(() => expect(patches).toEqual([{ kapazitaet_personen: 50 }]));
    expect(await screen.findByText(ENTSPRICHT_KAPAZITAET)).toBeInTheDocument();
  });

  it('rechnet mit dem Wert des Einsatzes: 5 m² je Person ergibt 40 Plätze, gleich der Kapazität', async () => {
    stelleBereit({ einsatzWerte: { flaeche_je_person_m2: 5 } });
    rendern();
    await halleEintragen('20', '10');
    expect(await screen.findByText(ENTSPRICHT_KAPAZITAET)).toBeInTheDocument();
  });

  it('legt die vorausgewählten Posten als Nachforderungen mit Bezug zur Stelle an', async () => {
    const { nachforderungen } = stelleBereit();
    rendern();
    await halleEintragen('20', '10');
    await userEvent.click(await screen.findByRole('button', { name: 'Nachforderungen anlegen' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nachforderungen für Turnhalle Ost' });
    await userEvent.click(
      within(dialog).getByRole('button', { name: '4 Nachforderungen anlegen' }),
    );
    await waitFor(() => expect(nachforderungen).toHaveLength(4));
    expect(nachforderungen).toEqual([
      expect.objectContaining({ art: 'Feldbetten', anzahl: 50, betreuungsstelle_id: 8 }),
      expect.objectContaining({ art: 'Decken', anzahl: 100, betreuungsstelle_id: 8 }),
      expect.objectContaining({ art: 'Mobile Toiletten', anzahl: 3, betreuungsstelle_id: 8 }),
      expect.objectContaining({ art: 'Waschplätze', anzahl: 10, betreuungsstelle_id: 8 }),
    ]);
    expect(
      await screen.findByText('4 Nachforderungen für Turnhalle Ost angelegt'),
    ).toBeInTheDocument();
  });

  it('ohne Freigabe des Moduls Nachforderungen und ohne Schreibrecht: gesperrt mit Grund', async () => {
    stelleBereit({
      rolle: 'helfer',
      freigaben: freigabenFixture({ nachforderungen: { zugriff: false } }),
    });
    rendern();
    await halleEintragen('20', '10');
    expect(await screen.findByRole('button', { name: 'Nachforderungen anlegen' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Kapazität übernehmen' })).toBeDisabled();
  });

  it('ohne Netz: gerechnet wird weiter, übernehmen und anlegen sind gesperrt', async () => {
    stelleBereit();
    rendern();
    await halleEintragen('20', '10');
    await screen.findByRole('button', { name: 'Kapazität übernehmen · 50 Plätze' });
    setzeOnline(false);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Kapazität übernehmen' })).toBeDisabled(),
    );
    expect(screen.getAllByText(OHNE_NETZ).length).toBe(2);
    expect(screen.getByRole('button', { name: 'Nachforderungen anlegen' })).toBeDisabled();
  });

  it('Reiter Richtwerte zeigt die wirksamen Werte mit Herkunft', async () => {
    stelleBereit({ einsatzWerte: { flaeche_je_person_m2: 5 } });
    rendern();
    await userEvent.click(await screen.findByRole('tab', { name: 'Richtwerte' }));
    const zeile = document.querySelector('[data-schluessel="flaeche_je_person_m2"]')!;
    expect(zeile).toHaveTextContent('5 m²');
    expect(zeile).toHaveTextContent('Einsatz · 4 m² (Vorgabe)');
  });
});
