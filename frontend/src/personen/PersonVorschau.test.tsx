import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import PersonVorschau from './PersonVorschau';
import type { PersonDetail } from '../api/types';

const detail = {
  id: 10,
  einsatz_id: 1,
  registrier_nr: 1,
  status: 'erfasst',
  name: 'Mustermann',
  vorname: 'Max',
  geschlecht: 'maennlich',
  geburtsdatum: null,
  alter_geschaetzt: 40,
  herkunft_adresse: null,
  antreff_ort: 'Brücke',
  melder_kontakt: null,
  notiz: null,
  erfasst_at: '2026-05-27 09:00:00',
  erfasst_von: 1,
  geaendert_at: '2026-05-27 09:00:00',
  geaendert_von: 1,
  storniert_at: null,
  aktuelle_sichtung: 'sk1',
  aktuelle_sichtung_at: null,
  aktueller_verbleib: null,
  aktuelle_uhs_id: null,
  aktueller_platz_id: null,
  sichtungen: [],
  notizen: [],
  verbleib: [],
  abgleiche: [],
} as unknown as PersonDetail;

/**
 * Die Vorschau ist der gemeinsame Inhalt von `PersonDetailDrawer` und der Palette (LFH-645).
 * Geprüft wird, was an BEIDEN Orten stehen muss: Stammdaten, Sichtung und der Verlauf.
 */
describe('PersonVorschau', () => {
  it('zeigt Stammdaten, Sichtung und Verlauf einer Person', async () => {
    server.use(http.get('/api/einsaetze/1/personen/10', () => HttpResponse.json(detail)));
    renderMitProviders(<PersonVorschau einsatzId={1} personId={10} />);
    expect(await screen.findByText('Mustermann')).toBeInTheDocument();
    expect(screen.getByText('Brücke')).toBeInTheDocument();
    expect(screen.getByText(/SK: /)).toBeInTheDocument();
    expect(screen.getByText(/Medizinischer Verlauf/)).toBeInTheDocument();
  });

  it('nennt einen Ladefehler, statt leer zu bleiben', async () => {
    server.use(
      http.get('/api/einsaetze/1/personen/10', () =>
        HttpResponse.json({ error: 'kaputt' }, { status: 500 }),
      ),
    );
    renderMitProviders(<PersonVorschau einsatzId={1} personId={10} />);
    expect(await screen.findByText('Person konnte nicht geladen werden')).toBeInTheDocument();
  });
});
