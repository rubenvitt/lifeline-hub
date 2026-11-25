import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router';
import { meHandler, server } from '../test/server';
import { neuerQueryClient, renderMitProviders } from '../test/utils';
import { einsatzKeys } from '../api/queryKeys';
import { EinsatzAnzeigeProvider } from '../anzeige/AnzeigeKonventionenContext';
import { benutzerFixture, freigabenFixture } from '../test/fixtures';
import type { EinsatzberichtRoh } from '../druck/einsatzbericht/abruf';
import type { LageberichtQuelle } from '../druck/einsatzbericht/verdichtung';
import { etbEintrag, lagebericht, person, rohBericht } from '../druck/einsatzbericht/testdaten';
import EinsatzakteDruckPage from './EinsatzakteDruckPage';

/**
 * Einsatzakte (LLH-1835, Spec `einsatzakte`): ein Druckstück aus sechs Kapiteln, vollständig oder
 * gar nicht, Betroffene mit Namen über den protokollierten Abruf, nur freigegebene Dokumente.
 */

const E = 5;
const kraft = benutzerFixture({ system_rolle: 'keiner', org_rolle: 'keine' });

function wert<T>(roh: EinsatzberichtRoh, k: keyof EinsatzberichtRoh['quellen']): T {
  const q = roh.quellen[k];
  if (q.zustand !== 'daten') throw new Error(`Testdaten ${k}`);
  return q.daten as T;
}

const befehl = (teil: Record<string, unknown>) => ({
  id: 11,
  einsatz_id: E,
  titel: 'Befehl Brandabschnitt',
  vorlage: 'befehl_lad',
  status: 'freigegeben',
  version: 1,
  vorgaenger_id: null,
  zeitstand: '2026-03-29T00:30:00',
  freigegeben_at: '2026-03-29T00:31:00',
  abschnitte: [{ schluessel: 'lage', text: 'Halle 3 brennt.' }],
  verteiler: [],
  ...teil,
});

/** Bedient jede Quelle der Akte; zählt die Aufrufe je Pfad. */
function quellen(freigaben = freigabenFixture()) {
  const roh = rohBericht();
  const aufrufe = new Map<string, number>();
  const zaehle = (pfad: string) => aufrufe.set(pfad, (aufrufe.get(pfad) ?? 0) + 1);
  const json = (pfad: string, antwort: () => unknown) =>
    http.get(`/api/incidents/${E}${pfad}`, () => {
      zaehle(pfad);
      return HttpResponse.json(antwort() as never);
    });
  const mitBeendeten = (
    pfad: string,
    k: keyof EinsatzberichtRoh['quellen'],
    param: string,
    kBeendet: keyof EinsatzberichtRoh['quellen'],
  ) =>
    http.get(`/api/incidents/${E}${pfad}`, ({ request }) => {
      zaehle(pfad);
      const beendet = new URL(request.url).searchParams.has(param);
      return HttpResponse.json(wert(roh, beendet ? kBeendet : k));
    });
  const etbEntscheidungen = wert<{ eintraege: unknown[] }>(roh, 'etbEntscheidungen').eintraege;
  const berichte = [
    lagebericht({ id: 1, titel: 'Erstlage' }),
    lagebericht({ id: 2, titel: 'Lage im Entwurf', status: 'entwurf', freigegeben_at: null }),
  ];
  server.use(
    meHandler(kraft),
    json('', () => wert(roh, 'einsatz')),
    json('/module-access', () => freigaben),
    json('/command-post', () => wert(roh, 'fuehrungsstelle')),
    json('/members', () => wert(roh, 'mitglieder')),
    json('/briefings', () => wert(roh, 'lagebesprechungen')),
    mitBeendeten('/units', 'einheiten', 'aufgeloeste', 'einheitenAufgeloest'),
    json('/units/timeline', () => wert(roh, 'einheitenPerioden')),
    // Die Anlage „Personal je Kopf“ steht in der Akte immer; sie braucht Namen.
    http.get(`/api/incidents/${E}/personnel`, ({ request }) =>
      HttpResponse.json(
        new URL(request.url).searchParams.has('entlassene')
          ? []
          : wert<{ id: number }[]>(roh, 'personal').map((k, i) => ({ ...k, name: `Kraft ${i}` })),
      ),
    ),
    json('/personnel/timeline', () => wert(roh, 'personalPerioden')),
    json('/vehicles', () => wert(roh, 'fahrzeuge')),
    json('/situation-reports', () => berichte),
    http.get(`/api/incidents/${E}/situation-reports/:lid`, ({ params }) => {
      zaehle(`/lageberichte/${String(params.lid)}`);
      return HttpResponse.json(berichte.find((b) => b.id === Number(params.lid)));
    }),
    http.get(`/api/incidents/${E}/situation-reports/:lid/enclosures`, () => HttpResponse.json([])),
    json('/persons', () => wert(roh, 'personen')),
    json('/persons/whereabouts-details', () => wert(roh, 'personenVerbleibAngaben')),
    json('/persons/print', () => [person()]),
    json('/uhs', () => []),
    mitBeendeten('/material', 'material', 'entlassene', 'materialEntlassen'),
    json('/damages', () => wert(roh, 'schaeden')),
    json('/evacuation', () => wert(roh, 'evakuierung')),
    json('/care', () => wert(roh, 'betreuung')),
    json('/catering', () => wert(roh, 'verpflegung')),
    json('/etb/counts', () => wert(roh, 'etbZaehler')),
    http.get(`/api/incidents/${E}/etb`, ({ request }) => {
      zaehle('/etb');
      const typ = new URL(request.url).searchParams.get('typ');
      return HttpResponse.json(
        typ === 'entscheidung'
          ? etbEntscheidungen
          : [etbEintrag({ id: 200, lfd_nr: 1, typ: 'meldung', inhalt: 'Erstmeldung Halle 3' })],
      );
    }),
    json('/tasks', () => [
      {
        id: 1,
        lfd_nr: 3,
        auftrag_text: 'Riegelstellung aufbauen',
        bearbeitungsstatus: 'aufgehoben',
        erteilt_at: '2026-03-29T00:20:00',
        aufgehoben_at: '2026-03-29T00:25:00',
        empfaenger: [{ snap_anzeige: 'Zug 1' }],
      },
    ]),
    json('/orders', () => [
      befehl({}),
      befehl({ id: 12, titel: 'Befehl Entwurf', status: 'entwurf' }),
    ]),
    http.get(`/api/incidents/${E}/orders/:bid`, ({ params }) => {
      zaehle(`/befehle/${String(params.bid)}`);
      return HttpResponse.json(befehl({ id: Number(params.bid) }));
    }),
    http.get(`/api/incidents/${E}/orders/:bid/enclosures`, () => HttpResponse.json([])),
  );
  return { aufrufe, lageQuelle: wert<LageberichtQuelle>(roh, 'lageberichte') };
}

function rendere() {
  const client = neuerQueryClient();
  client.setQueryData(einsatzKeys.einstellungen(E), {
    einsatz_id: E,
    zeitzone: 'Europe/Berlin',
    org_defaults: { org_id: 1 },
  });
  return renderMitProviders(
    <EinsatzAnzeigeProvider einsatzId={E}>
      <Routes>
        <Route path="/einsaetze/:id/einsatzdaten/akte" element={<EinsatzakteDruckPage />} />
      </Routes>
    </EinsatzAnzeigeProvider>,
    { route: `/einsaetze/${E}/einsatzdaten/akte`, client },
  );
}

const druckKnopf = () => screen.queryByRole('button', { name: 'Drucken / als PDF' });
const kapitel = () =>
  Array.from(document.querySelectorAll<HTMLElement>('[data-lfh="druck-kapitel"]'));

describe('EinsatzakteDruckPage', () => {
  it('druckt sechs Kapitel mit eigenem Druckkopf in einer Druckwurzel', async () => {
    const { aufrufe } = quellen();
    rendere();
    await waitFor(() => expect(druckKnopf()).toBeEnabled());
    expect(document.querySelectorAll('[data-lfh="druckwurzel"]')).toHaveLength(1);
    expect(
      kapitel().map((k) => within(k).getAllByRole('heading', { level: 2 })[0]?.textContent ?? ''),
    ).toEqual([
      'Einsatzbericht',
      'Einsatztagebuch',
      'Betroffene',
      'Aufträge',
      'Einsatzbefehle',
      'Lageberichte',
    ]);
    for (const k of kapitel()) expect(k.querySelector('[data-lfh="druckkopf"]')).not.toBeNull();
    // Betroffene mit Namen, genau ein protokollierter Abruf.
    expect(kapitel()[2]).toHaveTextContent('Quastenflosser');
    expect(aufrufe.get('/persons/print')).toBe(1);
    // Volles ETB, Auftragsliste mit aufgehobenem Auftrag.
    expect(kapitel()[1]).toHaveTextContent('Erstmeldung Halle 3');
    expect(kapitel()[3]).toHaveTextContent('Riegelstellung aufbauen');
    expect(kapitel()[3]).toHaveTextContent('Aufgehoben');
  });

  it('nimmt nur freigegebene Befehle und Lageberichte auf', async () => {
    const { aufrufe } = quellen();
    rendere();
    await waitFor(() => expect(druckKnopf()).toBeEnabled());
    expect(kapitel()[4]).toHaveTextContent('Befehl Brandabschnitt');
    expect(kapitel()[4]).not.toHaveTextContent('Befehl Entwurf');
    expect(aufrufe.get('/befehle/12')).toBeUndefined();
    expect(kapitel()[5]).toHaveTextContent('Erstlage');
    expect(kapitel()[5]).not.toHaveTextContent('Lage im Entwurf');
  });

  it('bietet das ZIP als Download-Link an', async () => {
    quellen();
    rendere();
    await waitFor(() => expect(druckKnopf()).toBeEnabled());
    const zip = screen.getByRole('link', { name: 'Anhänge und Tabellen (ZIP)' });
    expect(zip).toHaveAttribute('href', `/api/incidents/${E}/case-file/attachments.zip`);
    expect(zip).toHaveAttribute('download');
  });

  it('gesperrtes Modul: Sackgasse, kein Abruf der Betroffenen, kein Drucken, kein ZIP', async () => {
    const { aufrufe } = quellen(freigabenFixture({ personen: { zugriff: false } }));
    rendere();
    expect(await screen.findByText('Kein Zugriff: Betroffene')).toBeInTheDocument();
    expect(druckKnopf()).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Anhänge und Tabellen (ZIP)' })).toBeNull();
    expect(aufrufe.get('/persons/print')).toBeUndefined();
  });

  it('ausgeblendetes Modul: Kapitel „nicht genutzt“, Akte druckbar', async () => {
    const { aufrufe } = quellen(
      freigabenFixture({ auftraege: { sichtbar: false, zugriff: false } }),
    );
    rendere();
    await waitFor(() => expect(druckKnopf()).toBeEnabled());
    expect(kapitel()[3]).toHaveTextContent('nicht genutzt');
    expect(kapitel()[4]).toHaveTextContent('nicht genutzt');
    expect(aufrufe.get('/auftraege')).toBeUndefined();
  });

  it('scheitert ein Kapitel, ist Drucken gesperrt und das Kapitel genannt', async () => {
    quellen();
    server.use(
      http.get(`/api/incidents/${E}/tasks`, () =>
        HttpResponse.json({ error: 'kaputt' }, { status: 422 }),
      ),
    );
    rendere();
    expect(await screen.findByText('Nicht geladen: Aufträge/Befehle')).toBeInTheDocument();
    expect(druckKnopf()).toBeDisabled();
  });
});
