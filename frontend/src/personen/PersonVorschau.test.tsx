import { http, HttpResponse } from 'msw';
import { screen, within } from '@testing-library/react';
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
  aktuelle_sichtung_at: '2026-05-27 09:10:00',
  zustand: 'Verdacht auf Hüftfraktur',
  aufenthalt: {
    uhs_id: 3,
    uhs_bezeichnung: 'Turnhalle',
    platz_id: 7,
    platz_bezeichnung: 'Behandlungsplatz 2',
    seit: '2026-05-27 09:20:00',
  },
  aktueller_verbleib: null,
  aktuelle_uhs_id: null,
  aktueller_platz_id: null,
  sichtungen: [],
  notizen: [],
  verbleib: [],
  abgleiche: [],
} as unknown as PersonDetail;

/**
 * Die Vorschau ist der gemeinsame Inhalt von Drawer und Palette; geprüft wird, was an BEIDEN
 * Orten stehen muss.
 */
describe('PersonVorschau', () => {
  it('zeigt oben die Patientenfragen, darunter Personendaten und Verlauf (LLH-1137)', async () => {
    server.use(http.get('/api/einsaetze/1/personen/10', () => HttpResponse.json(detail)));
    const { container } = renderMitProviders(<PersonVorschau einsatzId={1} personId={10} />);
    const kopf = await screen.findByRole('region', { name: 'Patientenkopf' });
    // Sichtung, Zustand / Verdacht und Aufenthalt aus dem Patientenkopf in der Lesefassung.
    expect(within(kopf).getByText(/SK I · akut/)).toBeInTheDocument();
    expect(within(kopf).getByText('Verdacht auf Hüftfraktur')).toBeInTheDocument();
    expect(kopf.querySelector('[data-lfh="aufenthalt"]')?.textContent).toMatch(
      /^Turnhalle · Behandlungsplatz 2 · seit /,
    );
    expect(within(kopf).queryAllByRole('button')).toHaveLength(0);
    // Ein Vorsatz „SK: “ verdoppelte das Etikett (LFH-944).
    expect(screen.queryByText(/SK: /)).not.toBeInTheDocument();
    expect(screen.getByText('Mustermann')).toBeInTheDocument();
    expect(screen.getByText('Brücke')).toBeInTheDocument();
    expect(screen.getByText(/^Verlauf/)).toBeInTheDocument();
    // Datenraster statt Descriptions, leere Angaben in EINER Zeile.
    expect(container.querySelector('.ant-descriptions')).toBeNull();
    expect(container.querySelector('[data-lfh="ohne-angabe"]')?.textContent).toBe(
      'Ohne Angabe: Geburtsdatum, Herkunft / Adresse, Melder / Kontakt, Notiz',
    );
    expect(screen.queryByText('—')).toBeNull();
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
