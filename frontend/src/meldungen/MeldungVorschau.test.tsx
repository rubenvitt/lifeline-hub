import { screen } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { Meldung } from '../api/types';
import { datensatzAbfrage } from '../command-palette/datensatzAbfrage';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import MeldungVorschau from './MeldungVorschau';

const meldung = (over: Partial<Meldung> = {}): Meldung => ({
  id: 21,
  einsatz_id: 5,
  lfd_nr: 4,
  absender: 'Florian Nord 1',
  empfaenger: 'ELW 1',
  meldeweg: 'funk',
  inhalt: 'Deich instabil',
  meldungsart: 'sofortmeldung',
  prioritaet: 'dringend',
  richtung: 'intern',
  status: 'gesichtet',
  bearbeiter_id: null,
  bearbeiter_name: null,
  lagerelevant: false,
  ereigniszeit: '2026-06-12 09:00:00',
  eingang_at: '2026-06-12 09:05:00',
  etb_meldung_id: 7,
  auftrag_id: null,
  erfasst_von_id: 1,
  erstellt_at: '2026-06-12 09:05:00',
  lage_meldung_id: null,
  ist_offen: true,
  erledigt_at: null,
  bestaetigung_pflicht: false,
  bestaetigung_frist_at: null,
  eskaliert: false,
  bestaetigt_at: null,
  bestaetigt_von_id: null,
  bestaetigt_von_name: null,
  ist_bestaetigt: false,
  ist_ueberfaellig: false,
  ...over,
});

function meldungenHandler(antwort: Meldung[], zaehler?: { n: number }) {
  server.use(
    http.get('/api/einsaetze/5/meldungen', () => {
      if (zaehler) zaehler.n += 1;
      return HttpResponse.json(antwort);
    }),
  );
}

describe('MeldungVorschau (LFH-664)', () => {
  it('zeigt Nummer, Status mit Wort, Priorität, Absender → Empfänger, Inhalt und Bestätigung', async () => {
    meldungenHandler([
      meldung({ id: 20, lfd_nr: 3, inhalt: 'Andere Meldung' }),
      meldung({
        bestaetigung_pflicht: true,
        ist_bestaetigt: true,
        bestaetigt_von_name: 'Vitt',
        bestaetigt_at: '2026-06-12 09:06:00',
      }),
    ]);
    renderMitProviders(<MeldungVorschau einsatzId={5} id={21} />);

    expect(await screen.findByText('Deich instabil')).toBeInTheDocument();
    expect(screen.queryByText('Andere Meldung')).not.toBeInTheDocument();
    expect(screen.getByText('#4')).toBeInTheDocument();
    expect(screen.getByText('Gesichtet')).toBeInTheDocument();
    expect(screen.getByText('Dringend')).toBeInTheDocument();
    expect(screen.getByText('Florian Nord 1')).toBeInTheDocument();
    expect(screen.getByText('→ ELW 1')).toBeInTheDocument();
    expect(screen.getByText(/Quittiert von Vitt/)).toBeInTheDocument();
  });

  it('zeigt an einer erledigten Meldung, wann sie erledigt wurde — wie die Abgeschlossen-Ansicht', async () => {
    meldungenHandler([
      meldung({ status: 'erledigt', ist_offen: false, erledigt_at: '2026-06-12 10:00:00' }),
    ]);
    renderMitProviders(<MeldungVorschau einsatzId={5} id={21} />);

    expect(await screen.findByText(/Erledigt:/)).toBeInTheDocument();
  });

  /**
   * Der schlimmste Fall aus `MeldungKarte.test.tsx`: neu, bestätigungspflichtig, nicht
   * lagerelevant, ohne Auftrag — auf der Seite stehen hier alle Aktionen. Die Vorschau liest.
   */
  it('trägt keine Aktion, auch nicht an einer neuen bestätigungspflichtigen Meldung', async () => {
    meldungenHandler([
      meldung({
        status: 'neu',
        bestaetigung_pflicht: true,
        ist_bestaetigt: false,
        bestaetigung_frist_at: '2026-06-12 09:15:00',
      }),
    ]);
    renderMitProviders(<MeldungVorschau einsatzId={5} id={21} />);

    await screen.findByText('Deich instabil');
    // Der Bestätigungsstand steht da — nur der Knopf dazu nicht.
    expect(screen.getByText(/Bestätigung offen bis/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Bestätigen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sichten' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Aktionen zu Meldung/ })).not.toBeInTheDocument();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryAllByRole('combobox')).toHaveLength(0);
  });

  it('führt den Verweis auf den Auftrag als Link', async () => {
    meldungenHandler([meldung({ auftrag_id: 33 })]);
    renderMitProviders(<MeldungVorschau einsatzId={5} id={21} />);

    const link = await screen.findByRole('link', { name: '↗ Auftrag' });
    expect(link).toHaveAttribute('href', '/einsaetze/5/auftraege?auftrag=33');
  });

  it('sagt, dass die Meldung nicht mehr vorhanden ist', async () => {
    meldungenHandler([meldung({ id: 20, inhalt: 'Andere Meldung' })]);
    renderMitProviders(<MeldungVorschau einsatzId={5} id={21} />);

    expect(await screen.findByText('Die Meldung ist nicht mehr vorhanden.')).toBeInTheDocument();
    expect(screen.queryByText('Andere Meldung')).not.toBeInTheDocument();
  });

  it('liest aus dem warmen Listenfach der Palette, ohne neu abzurufen', () => {
    const zaehler = { n: 0 };
    meldungenHandler([], zaehler);
    const client = new QueryClient();
    const abfrage = datensatzAbfrage.meldungen(5);
    client.setQueryData(abfrage.queryKey, [meldung()]);

    renderMitProviders(<MeldungVorschau einsatzId={5} id={21} />, { client });

    // Synchron: stünde der Inhalt erst nach einem Abruf da, fände `getBy` ihn hier nicht.
    expect(screen.getByText('Deich instabil')).toBeInTheDocument();
    expect(client.isFetching({ queryKey: abfrage.queryKey, exact: true })).toBe(0);
    expect(zaehler.n).toBe(0);
  });
});
