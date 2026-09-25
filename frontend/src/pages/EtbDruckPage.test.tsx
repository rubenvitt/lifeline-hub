import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router';
import { server } from '../test/server';
import { neuerQueryClient, renderMitProviders } from '../test/utils';
import { einsatzKeys } from '../api/queryKeys';
import { EinsatzAnzeigeProvider } from '../anzeige/AnzeigeKonventionenContext';
import EtbDruckPage from './EtbDruckPage';

/**
 * ETB-Druckansicht (LFH-22, design.md D5): die Papierform des Einsatztagebuchs. Geprüft
 * werden die Zusicherungen, die ein Ausdruck als Beweisunterlage tragen muss —
 * Vollständigkeit, Ordnung nach Nummer, Nachträge, Berichtigungen in beiden Richtungen,
 * Zeiten in der Org-Zone — und dass ein unvollständiger Stand nicht druckbar ist.
 */

const EINSATZ = {
  id: 7,
  bezeichnung: 'Hochwasser Nord',
  einsatznummer_intern: 'E-2026-0007',
  status: 'aktiv',
  meine_rolle: 'einsatzleitung',
};

function eintrag(lfd_nr: number, over: Record<string, unknown> = {}) {
  return {
    id: lfd_nr * 10,
    lfd_nr,
    typ: 'meldung',
    inhalt: `Inhalt ${lfd_nr}`,
    von: null,
    an: null,
    meldeweg: null,
    veranlassung: null,
    erfasser_id: 1,
    erfasser_name: 'Admin',
    ereigniszeit: '2026-09-25 06:00:00',
    received_at: '2026-09-25 06:00:10',
    erfasst_lokal_at: null,
    berichtigt_eintrag_id: null,
    folgeauftraege: [],
    ...over,
  };
}

/** Liste des Tagebuchs wie der Server: `typ` filtert, Cursor wird bedient. */
function tagebuch(alle: ReturnType<typeof eintrag>[]) {
  server.use(
    http.get('/api/einsaetze/7/etb', ({ request }) => {
      const url = new URL(request.url);
      const typ = url.searchParams.get('typ');
      const vor = Number(url.searchParams.get('before_lfd_nr') ?? Infinity);
      return HttpResponse.json(
        alle
          .filter((e) => (typ ? e.typ === typ : true) && e.lfd_nr < vor)
          .sort((a, b) => b.lfd_nr - a.lfd_nr),
      );
    }),
  );
}

function rendere(suche = '') {
  server.use(
    http.get('/api/einsaetze/7', () => HttpResponse.json(EINSATZ)),
    http.get('/api/einsaetze/7/einstellungen', () =>
      HttpResponse.json({ einsatz_id: 7, zeitzone: 'Europe/Berlin', org_defaults: { org_id: 1 } }),
    ),
    http.get('/api/einsaetze/7/einheiten', () => HttpResponse.json([{ id: 3, name: '1. Zug' }])),
  );
  const client = neuerQueryClient();
  client.setQueryData(einsatzKeys.einstellungen(7), {
    einsatz_id: 7,
    zeitzone: 'Europe/Berlin',
    org_defaults: { org_id: 1 },
  });
  return renderMitProviders(
    <EinsatzAnzeigeProvider einsatzId={7}>
      <Routes>
        <Route path="/einsaetze/:id/etb/druck" element={<EtbDruckPage />} />
        <Route path="/einsaetze/:id/etb" element={<div>ETB-SEITE</div>} />
      </Routes>
    </EinsatzAnzeigeProvider>,
    { route: `/einsaetze/7/etb/druck${suche}`, client },
  );
}

/** Zeilen der Drucktabelle als Nummernfolge. */
function nummern(): number[] {
  return Array.from(document.querySelectorAll('[data-lfh="etb-druck-tabelle"] tbody tr')).map(
    (tr) => Number(tr.querySelector('td')!.textContent),
  );
}

function zeileNr(nr: number): HTMLElement {
  const tr = Array.from(
    document.querySelectorAll<HTMLElement>('[data-lfh="etb-druck-tabelle"] tbody tr'),
  ).find((z) => z.querySelector('td')!.textContent === String(nr));
  if (!tr) throw new Error(`keine Zeile Nr. ${nr}`);
  return tr;
}

async function fertig() {
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Drucken / als PDF' })).toBeEnabled(),
  );
}

describe('EtbDruckPage', () => {
  it('ordnet aufsteigend nach laufender Nummer, anders als die Zeitachse', async () => {
    server.use(
      http.get('/api/einsaetze/7/etb', () =>
        HttpResponse.json([eintrag(3), eintrag(1), eintrag(2)]),
      ),
    );
    rendere();
    await fertig();
    expect(nummern()).toEqual([1, 2, 3]);
  });

  it('trägt genau eine Druckwurzel mit dem am Bildschirm sichtbaren Druckkopf darin', async () => {
    tagebuch([eintrag(1), eintrag(2), eintrag(3)]);
    rendere();
    await fertig();
    const wurzeln = document.querySelectorAll<HTMLElement>('[data-lfh="druckwurzel"]');
    expect(wurzeln).toHaveLength(1);
    const kopf = wurzeln[0].querySelector<HTMLElement>('[data-lfh="druckkopf"]');
    expect(kopf).not.toBeNull();
    expect(kopf).not.toHaveClass('druckkopf--nur-druck');
    expect(wurzeln[0]).toContainElement(
      document.querySelector<HTMLElement>('[data-lfh="etb-druck-tabelle"]'),
    );
  });

  it('nennt im Kopf Zahl, Stand mit höchster Nummer und „vollständiges Tagebuch"', async () => {
    tagebuch([eintrag(1), eintrag(2), eintrag(3)]);
    rendere();
    await fertig();
    const kopf = within(document.querySelector<HTMLElement>('[data-lfh="druckkopf"]')!);
    expect(kopf.getByText(/^3\sEinträge$/)).toBeInTheDocument();
    expect(kopf.getByText(/bis Nr\. 3$/)).toBeInTheDocument();
    expect(kopf.getByText('vollständiges Tagebuch')).toBeInTheDocument();
    expect(kopf.getByText('Hochwasser Nord (E-2026-0007)')).toBeInTheDocument();
  });

  it('nennt die Auswahl aus der Adresse im Kopf, mit Einheitenname statt Kennung', async () => {
    tagebuch([eintrag(1)]);
    rendere('?typ=meldung&einheit_id=3');
    await fertig();
    const kopf = within(document.querySelector<HTMLElement>('[data-lfh="druckkopf"]')!);
    expect(await kopf.findByText('Typ: Meldung · betrifft 1. Zug')).toBeInTheDocument();
  });

  it('setzt einen Nachtrag an seine Nummer, mit Ereigniszeit und „nachgetragen um"', async () => {
    tagebuch([
      eintrag(11),
      // 07:15Z = 09:15 MESZ, erfasst 08:40Z = 10:40 MESZ.
      eintrag(12, { ereigniszeit: '2026-09-25 07:15:00', received_at: '2026-09-25 08:40:00' }),
      eintrag(13),
    ]);
    rendere();
    await fertig();
    expect(nummern()).toEqual([11, 12, 13]);
    const zeile = within(zeileNr(12));
    expect(zeile.getByText('25.09.2026 09:15')).toBeInTheDocument();
    expect(zeile.getByText('nachgetragen um 10:40')).toBeInTheDocument();
    // Gegenaussage: ein pünktlich erfasster Eintrag trägt keinen Nachtrag.
    expect(within(zeileNr(11)).queryByText(/nachgetragen/)).toBeNull();
  });

  it('zeigt Zeiten in der Org-Zone, nicht in UTC', async () => {
    tagebuch([eintrag(1, { ereigniszeit: '2026-09-25 06:00:00' })]);
    rendere();
    await fertig();
    expect(within(zeileNr(1)).getByText('25.09.2026 08:00')).toBeInTheDocument();
  });

  it('zeigt Berichtigungen in beiden Richtungen', async () => {
    tagebuch([eintrag(7), eintrag(20, { typ: 'berichtigung', berichtigt_eintrag_id: 70 })]);
    rendere();
    await fertig();
    expect(within(zeileNr(7)).getByText('berichtigt durch Nr. 20')).toBeInTheDocument();
    expect(within(zeileNr(20)).getByText('berichtigt Nr. 7')).toBeInTheDocument();
  });

  it('nennt „berichtigt durch" auch, wenn die Berichtigung nicht zur Auswahl gehört', async () => {
    tagebuch([eintrag(7), eintrag(20, { typ: 'berichtigung', berichtigt_eintrag_id: 70 })]);
    rendere('?typ=meldung');
    await fertig();
    expect(nummern()).toEqual([7]);
    expect(within(zeileNr(7)).getByText('berichtigt durch Nr. 20')).toBeInTheDocument();
  });

  it('sagt es in Worten, wenn der Grundeintrag einer Berichtigung außerhalb der Auswahl liegt', async () => {
    tagebuch([eintrag(7), eintrag(20, { typ: 'berichtigung', berichtigt_eintrag_id: 70 })]);
    rendere('?typ=berichtigung');
    await fertig();
    expect(nummern()).toEqual([20]);
    expect(
      within(zeileNr(20)).getByText('berichtigt einen Eintrag außerhalb dieser Auswahl'),
    ).toBeInTheDocument();
  });

  it('sperrt Drucken, solange geladen wird, und nennt den Fortschritt', async () => {
    let freigeben!: () => void;
    const tor = new Promise<void>((r) => (freigeben = r));
    server.use(
      http.get('/api/einsaetze/7/etb', async () => {
        await tor;
        return HttpResponse.json([eintrag(1)]);
      }),
    );
    rendere();
    expect(await screen.findByText(/Einträge geladen/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Drucken / als PDF' })).toBeDisabled();
    freigeben();
    await fertig();
  });

  it('sperrt Drucken nach einem Fehler und bietet „Erneut laden" an', async () => {
    let scheitern = true;
    server.use(
      http.get('/api/einsaetze/7/etb', () =>
        scheitern
          ? HttpResponse.json({ error: 'Interner Serverfehler' }, { status: 500 })
          : HttpResponse.json([eintrag(1)]),
      ),
    );
    rendere();
    const erneut = await screen.findByRole('button', { name: 'Erneut laden' });
    expect(screen.getByRole('button', { name: 'Drucken / als PDF' })).toBeDisabled();
    expect(nummern()).toEqual([]);
    scheitern = false;
    await userEvent.click(erneut);
    await fertig();
    expect(nummern()).toEqual([1]);
  });

  it('bleibt bei leerer Auswahl druckbar und sagt es', async () => {
    tagebuch([]);
    rendere('?q=nichts');
    await fertig();
    expect(screen.getByText('Keine Einträge in dieser Auswahl')).toBeInTheDocument();
  });

  it('zeigt ohne Lesezugriff keine Einträge und bietet kein Drucken an', async () => {
    server.use(
      http.get('/api/einsaetze/7/etb', () =>
        HttpResponse.json({ error: 'Modul gesperrt' }, { status: 403 }),
      ),
    );
    rendere();
    expect(await screen.findByText(/Kein Zugriff auf das Einsatztagebuch/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Drucken / als PDF' })).toBeNull();
    expect(nummern()).toEqual([]);
  });
});
