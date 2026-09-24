import { screen } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { Auftrag } from '../api/types';
import { datensatzAbfrage } from '../command-palette/datensatzAbfrage';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import AuftragVorschau from './AuftragVorschau';

type Empfaenger = Auftrag['empfaenger'][number];

const empfaenger = (over: Partial<Empfaenger> = {}): Empfaenger => ({
  id: 1,
  auftrag_id: 31,
  empfaenger_typ: 'funktion',
  abschnitt_id: null,
  einheit_id: null,
  person_id: null,
  fahrzeug_id: null,
  funktion_text: 'EA Nord',
  extern_kategorie: null,
  extern_bezeichnung: null,
  snap_anzeige: 'EA Nord',
  quittiert_at: null,
  quittiert_von_id: null,
  ...over,
});

const auftrag = (over: Partial<Auftrag> = {}): Auftrag => ({
  id: 31,
  einsatz_id: 5,
  lfd_nr: 9,
  auftrag_text: 'Deich sichern',
  absicht: 'Überflutung verhindern',
  lage: null,
  ort: null,
  zeit: null,
  mittel: null,
  verbindung: null,
  sicherheit: null,
  prioritaet: 'sofort',
  richtung: 'intern',
  frist_at: null,
  erteilt_at: '2026-06-11 09:00:00',
  in_arbeit_at: null,
  vollzugsmeldung: null,
  abgenommen_at: null,
  abgenommen_von_id: null,
  etb_anordnung_id: 5,
  quell_etb_eintrag_id: 77,
  erstellt_von_id: 1,
  erstellt_at: '2026-06-11 09:00:00',
  vollzug_status: 'offen',
  vollzogen_at: null,
  vollzogen_von_id: null,
  empfaenger_anzahl: 2,
  quittiert_anzahl: 1,
  ist_ueberfaellig: false,
  bearbeitungsstatus: 'offen',
  empfaenger: [
    empfaenger(),
    empfaenger({ id: 2, snap_anzeige: 'EA Süd', quittiert_at: '2026-06-11 09:02:00' }),
  ],
  ...over,
});

function auftraegeHandler(antwort: Auftrag[], zaehler?: { n: number }) {
  server.use(
    http.get('/api/einsaetze/5/auftraege', () => {
      if (zaehler) zaehler.n += 1;
      return HttpResponse.json(antwort);
    }),
  );
}

describe('AuftragVorschau (LFH-664)', () => {
  it('zeigt Nummer, Status mit Wort, Priorität, Auftragstext und den Empfängerstand', async () => {
    auftraegeHandler([auftrag({ id: 30, lfd_nr: 8, auftrag_text: 'Anderer Auftrag' }), auftrag()]);
    renderMitProviders(<AuftragVorschau einsatzId={5} id={31} />);

    expect(await screen.findByText('Deich sichern')).toBeInTheDocument();
    expect(screen.queryByText('Anderer Auftrag')).not.toBeInTheDocument();
    expect(screen.getByText('#9')).toBeInTheDocument();
    expect(screen.getByText('Offen')).toBeInTheDocument();
    expect(screen.getByText('Sofort')).toBeInTheDocument();
    expect(screen.getByText('2 Empfänger · 1/2 quittiert')).toBeInTheDocument();
    expect(screen.getByText('EA Süd ✓')).toBeInTheDocument();
    // Der offene Empfänger bleibt mit Namen stehen — nur der Knopf dazu fehlt.
    expect(screen.getByText('Quittung offen:')).toBeInTheDocument();
    expect(screen.getByText('EA Nord')).toBeInTheDocument();
    // Das Befehlsschema steht wie auf der Seite hinter „Befehlsdetails".
    expect(screen.getByText('Befehlsdetails')).toBeInTheDocument();
  });

  it('führt den Rückverweis auf den Quell-ETB-Eintrag als Link', async () => {
    auftraegeHandler([auftrag()]);
    renderMitProviders(<AuftragVorschau einsatzId={5} id={31} />);

    const link = await screen.findByRole('link', { name: '↗ ETB-Eintrag' });
    expect(link).toHaveAttribute('href', '/einsaetze/5/etb?eintrag=77');
  });

  it('zeigt an einem abgenommenen Auftrag Vollzug und Abnahme — wie die Abgeschlossen-Ansicht', async () => {
    auftraegeHandler([
      auftrag({
        bearbeitungsstatus: 'abgenommen',
        vollzug_status: 'vollzogen',
        vollzogen_at: '2026-06-11 10:00:00',
        abgenommen_at: '2026-06-11 10:30:00',
        vollzugsmeldung: 'Sandsäcke verlegt',
      }),
    ]);
    renderMitProviders(<AuftragVorschau einsatzId={5} id={31} />);

    expect(await screen.findByText(/Vollzogen am:/)).toBeInTheDocument();
    expect(screen.getByText(/Abgenommen am:/)).toBeInTheDocument();
    expect(screen.getByText(/Vollzugsvermerk: Sandsäcke verlegt/)).toBeInTheDocument();
  });

  it.each([
    ['offen', 'offen'],
    ['in_arbeit', 'in_arbeit'],
    ['vollzogen', 'vollzogen'],
  ] as const)('trägt im Status %s keine Aktion', async (bearbeitungsstatus, vollzug_status) => {
    auftraegeHandler([auftrag({ bearbeitungsstatus, vollzug_status })]);
    renderMitProviders(<AuftragVorschau einsatzId={5} id={31} />);

    await screen.findByText('Deich sichern');
    expect(screen.queryByRole('button', { name: /quittieren/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'In Bearbeitung' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Vollzug melden' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Abnehmen' })).not.toBeInTheDocument();
    expect(screen.queryAllByRole('combobox')).toHaveLength(0);
  });

  it('sagt, dass der Auftrag nicht mehr vorhanden ist', async () => {
    auftraegeHandler([auftrag({ id: 30, auftrag_text: 'Anderer Auftrag' })]);
    renderMitProviders(<AuftragVorschau einsatzId={5} id={31} />);

    expect(await screen.findByText('Der Auftrag ist nicht mehr vorhanden.')).toBeInTheDocument();
    expect(screen.queryByText('Anderer Auftrag')).not.toBeInTheDocument();
  });

  it('liest aus dem warmen Listenfach der Palette, ohne neu abzurufen', () => {
    const zaehler = { n: 0 };
    auftraegeHandler([], zaehler);
    const client = new QueryClient();
    const abfrage = datensatzAbfrage.auftraege(5);
    client.setQueryData(abfrage.queryKey, [auftrag()]);

    renderMitProviders(<AuftragVorschau einsatzId={5} id={31} />, { client });

    // Synchron: stünde der Inhalt erst nach einem Abruf da, fände `getBy` ihn hier nicht.
    expect(screen.getByText('Deich sichern')).toBeInTheDocument();
    expect(client.isFetching({ queryKey: abfrage.queryKey, exact: true })).toBe(0);
    expect(zaehler.n).toBe(0);
  });
});
