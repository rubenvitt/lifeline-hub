import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { renderMitProviders } from '../test/utils';
import { server } from '../test/server';
import { datensatzAbfrage } from '../command-palette/datensatzAbfrage';
import type { LageberichtAnzeige } from '../api/types';
import LageberichtVorschau from './LageberichtVorschau';

const bericht = (o: Partial<LageberichtAnzeige> = {}): LageberichtAnzeige =>
  ({
    id: 11,
    einsatz_id: 5,
    titel: 'Lage 14 Uhr',
    vorlage: 'freitext',
    status: 'freigegeben',
    version: 3,
    ersteller_id: 2,
    ersteller_name: 'Anna Adler',
    erstellt_at: '2026-07-16 12:00:00',
    aktualisiert_at: '2026-07-16 12:30:00',
    zeitstand: '2026-07-16 12:30:00',
    freigegeben_at: '2026-07-16 12:45:00',
    freigegeben_von_id: 3,
    freigegeben_von_name: 'Bernd Berg',
    abschnitte: [{ schluessel: 'text', text: '# Kernaussage\n\nPegel steigt weiter.' }],
    ...o,
  }) as LageberichtAnzeige;

function liefereListe(liste: LageberichtAnzeige[]) {
  let abrufe = 0;
  server.use(
    http.get('/api/einsaetze/5/lageberichte', () => {
      abrufe += 1;
      return HttpResponse.json(liste);
    }),
  );
  return () => abrufe;
}

describe('LageberichtVorschau (LFH-664)', () => {
  it('zeigt Status mit Wort, Kopfangaben und den Berichtstext', async () => {
    liefereListe([bericht({ id: 4, titel: 'Anderer' }), bericht()]);
    renderMitProviders(<LageberichtVorschau einsatzId={5} id={11} />);

    expect(await screen.findByText('Freigegeben')).toBeInTheDocument();
    expect(screen.getByText('Freier Bericht')).toBeInTheDocument();
    expect(screen.getByText('v3')).toBeInTheDocument();
    expect(screen.getByText('Anna Adler')).toBeInTheDocument();
    expect(screen.getByText('Bernd Berg')).toBeInTheDocument();
    // Zeitstand und Freigabezeit in der taktischen DTG (Anzeigezone Europe/Berlin).
    expect(screen.getByText('161430JUL2026')).toBeInTheDocument();
    expect(screen.getByText('161445JUL2026')).toBeInTheDocument();
    // Der Titel ist schon Kopf der Palette und steht hier nicht noch einmal.
    expect(screen.queryByText('Lage 14 Uhr')).not.toBeInTheDocument();
    expect(screen.getByText('Pegel steigt weiter.')).toBeInTheDocument();
  });

  it('setzt die Abschnittstitel unter die Vorschau-Ebene, `#` im Text eine tiefer', async () => {
    liefereListe([bericht()]);
    renderMitProviders(<LageberichtVorschau einsatzId={5} id={11} />);

    expect(await screen.findByRole('heading', { level: 3, name: 'Bericht' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 4, name: 'Kernaussage' })).toBeInTheDocument();
  });

  it('zeigt einen leeren Abschnitt als „—" und einen Entwurf ohne Freigabe', async () => {
    liefereListe([
      bericht({
        vorlage: 'lagebericht',
        status: 'entwurf',
        freigegeben_at: null,
        freigegeben_von_id: null,
        freigegeben_von_name: null,
        abschnitte: [{ schluessel: 'auftrag', text: 'Deich halten.' }],
      }),
    ]);
    renderMitProviders(<LageberichtVorschau einsatzId={5} id={11} />);

    expect(await screen.findByText('Entwurf')).toBeInTheDocument();
    expect(screen.getByText('Deich halten.')).toBeInTheDocument();
    // Sieben Abschnitte in der Vorlage, einer befüllt — sechs Striche.
    expect(screen.getAllByText('—')).toHaveLength(6);
    expect(screen.queryByText('Freigegeben von')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('sagt, dass der Lagebericht nicht mehr vorhanden ist', async () => {
    liefereListe([bericht({ id: 4 })]);
    renderMitProviders(<LageberichtVorschau einsatzId={5} id={11} />);

    expect(
      await screen.findByText('Der Lagebericht ist nicht mehr vorhanden.'),
    ).toBeInTheDocument();
  });

  it('liest den geladenen Stand ohne Abruf', async () => {
    const abrufe = liefereListe([]);
    const client = new QueryClient();
    client.setQueryData(datensatzAbfrage.lageberichte(5).queryKey, [bericht()]);
    renderMitProviders(<LageberichtVorschau einsatzId={5} id={11} />, { client });

    expect(await screen.findByText('Pegel steigt weiter.')).toBeInTheDocument();
    expect(abrufe()).toBe(0);
  });
});
