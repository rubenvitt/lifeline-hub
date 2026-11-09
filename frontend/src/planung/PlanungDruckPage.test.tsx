import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { Planung, PlanungBlock } from '../api/types';
import { meHandler, server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { adminFixture } from '../test/fixtures';
import { planungDruckPfad } from '../routing/deeplinks';
import PlanungDruckPage from './PlanungDruckPage';

/**
 * Druckansicht einer Planung (LLH-1593, Teil C von LLH-1557): dieselben Blätter wie im Einsatz,
 * der Druckkopf nennt die Planung. Inhalt und Umbruch der Blätter selbst prüfen
 * `abloesung/schichtplan/ausgabe/SchichtplanBlaetter.test.tsx` und `e2e/schichtplan-druck.spec.ts`.
 */

const block = (b: Partial<PlanungBlock> & { id: number; posten_id: number | null }) =>
  ({
    von: '2027-06-12 08:00:00',
    bis: '2027-06-12 12:00:00',
    befunde: [],
    offene_anforderungen: [],
    offene_plaetze: 0,
    personen: [],
    personen_anzahl: 0,
    soll_anzahl: null,
    version: 1,
    ...b,
  }) satisfies PlanungBlock;

const BEA: PlanungBlock['personen'][number] = {
  art: 'helfer',
  helfer_id: 9,
  name: 'Bea Helfer',
  befunde: [],
  im_einsatz: false,
  qualifikationen: [],
};

const PLANUNG: Planung = {
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
    { id: 2, bezeichnung: 'UHS Bühne', art: 'uhs', sortier: 10, nicht_verfuegbar: false },
    { id: 1, bezeichnung: 'RTW 1', art: 'einheit', sortier: 20, nicht_verfuegbar: false },
  ],
  bloecke: [
    block({
      id: 11,
      posten_id: 2,
      soll_anzahl: 2,
      offene_plaetze: 1,
      personen: [BEA],
      personen_anzahl: 1,
    }),
    block({ id: 12, posten_id: 1, von: '2027-06-12 12:30:00', bis: '2027-06-12 16:30:00' }),
    block({
      id: 13,
      posten_id: null,
      von: '2027-06-12 12:00:00',
      bis: '2027-06-12 12:30:00',
      personen: [BEA],
      personen_anzahl: 1,
    }),
  ],
  helfer: [{ id: 9, name: 'Bea Helfer', organisation: 'DLRG', qualifikationen: [] }],
  programmpunkte: [],
  kennzahlen: { soll: 2, ist: 1, offen: 1, konflikte: 0 },
};

function Adresse() {
  const l = useLocation();
  return <div data-testid="adresse">{`${l.pathname}${l.search}`}</div>;
}

function setup(route = planungDruckPfad(5)) {
  server.use(
    meHandler(adminFixture()),
    http.get('/api/organisation', () => HttpResponse.json({ id: 1, name: 'DRK Musterstadt' })),
    http.get('/api/planungen/5', () => HttpResponse.json(PLANUNG)),
    http.get('/api/qualifikationen', () => HttpResponse.json([])),
  );
  return renderMitProviders(
    <>
      <Adresse />
      <Routes>
        <Route path="/planungen/:planungId" element={<div>Planungsseite</div>} />
        <Route path="/planungen/:planungId/druck" element={<PlanungDruckPage />} />
      </Routes>
    </>,
    { route, datenRouter: true },
  );
}

const blaetter = () =>
  document.querySelectorAll('[data-lfh="druckwurzel"] [data-lfh="druck-kapitel"]');

describe('PlanungDruckPage (LLH-1593)', () => {
  it('Aushang je Posten in der Reihenfolge der Planung, ohne Pause, der Kopf nennt die Planung', async () => {
    setup();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Drucken / als PDF' })).toBeEnabled(),
    );
    const titel = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(titel).toEqual(['Aushang – UHS Bühne', 'Aushang – RTW 1']);
    expect(blaetter()).toHaveLength(2);
    const erstes = blaetter()[0] as HTMLElement;
    expect(within(erstes).getByText('Planung')).toBeInTheDocument();
    expect(within(erstes).getByText('Stadtfest')).toBeInTheDocument();
    expect(within(erstes).queryByText('Einsatz')).not.toBeInTheDocument();
    expect(within(erstes).getByText('Bea Helfer (DLRG)')).toBeInTheDocument();
    expect(within(erstes).getByText('1 offen')).toBeInTheDocument();
  });

  it('Zettel je Person mit der Pause, Auswahl in der Adresse', async () => {
    setup(planungDruckPfad(5, { sicht: 'person' }));
    expect(
      await screen.findByRole('heading', { level: 2, name: /Schichtzettel – Bea Helfer/ }),
    ).toBeInTheDocument();
    const zettel = blaetter()[0] as HTMLElement;
    expect(within(zettel).getByText('Pause')).toBeInTheDocument();
    expect(within(zettel).getByText('UHS Bühne')).toBeInTheDocument();
    // Die Pause zählt nicht: eine Schicht zu 4 h.
    expect(within(zettel).getByText('1 Schicht, 4 h')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('radio', { name: 'Je Posten' }));
    expect(screen.getByTestId('adresse')).toHaveTextContent(/^\/planungen\/5\/druck$/);
  });

  it('eine fremde oder gelöschte Planung (404) sagt, dass es sie nicht gibt', async () => {
    setup();
    server.use(
      http.get('/api/planungen/5', () =>
        HttpResponse.json({ fehler: 'nicht gefunden' }, { status: 404 }),
      ),
    );
    expect(await screen.findByText('Diese Planung gibt es nicht')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Drucken / als PDF' })).not.toBeInTheDocument();
  });
});
