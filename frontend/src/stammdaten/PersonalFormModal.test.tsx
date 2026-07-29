import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import type { Personal } from '../api/types';
import PersonalFormModal from './PersonalFormModal';

/**
 * LFH-332/B4 — die Stammdaten-Personalmaske als Hüllen-Pilot.
 *
 * Geprüft wird, was die Umstellung auf `ErfassungsModal` zusichert: Fokus im
 * ersten Feld, Enter sendet ab, Zurücksetzen auf BEIDEN Wegen. Was die Hülle
 * selbst schon beweist (`components/Erfassung.test.tsx`), wird hier nicht
 * nachgespielt — hier steht nur, was an DIESER Maske verdrahtet ist.
 *
 * Bewusst KEINE Behauptung über Höhen/Trefflächen: `renderMitProviders` nutzt
 * ein nacktes `ConfigProvider` ohne Theme, eine solche Zusicherung wäre wertlos.
 */

const person: Personal = {
  id: 5,
  name: 'Thomas Müller',
  personalnummer: 'P-42',
  traegerorganisation: 'DRK Musterstadt',
  telefon: '0170 1234567',
  staerke_position: 'fuehrer',
  benutzer_id: null,
  bemerkung: null,
  dienststatus: 'ausser_dienst',
  qualifikationen: [{ id: 1, label: 'Sanitäter' }],
  angelegt_at: '2026-05-26 09:00:00',
};

function handler(onPost: (body: unknown) => void = () => {}) {
  server.use(
    http.get('/api/qualifikationen', () => HttpResponse.json([{ id: 1, label: 'Sanitäter', aktiv: true }])),
    http.get('/api/benutzer', () => HttpResponse.json([])),
    http.post('/api/personal', async ({ request }) => {
      onPost(await request.json());
      return HttpResponse.json({ ...person, id: 9 });
    }),
    http.patch('/api/personal/5', async ({ request }) => {
      onPost(await request.json());
      return HttpResponse.json(person);
    }),
  );
}

/**
 * Eltern mit Offen-Zustand — nur so lässt sich „nach Abbrechen leer" überhaupt messen.
 * „Wieder öffnen" öffnet bewusst IMMER im Anlegen-Fall (`person=null`): das ist der
 * Weg, den `PersonalTab` nimmt, wenn nach einem Bearbeiten „Person anlegen" gedrückt
 * wird — und genau der Weg, den der entfernte `resetFields()`-Zweig früher abdeckte.
 */
function Harness({ bestand, onClose }: { bestand?: Personal | null; onClose?: () => void }) {
  const [offen, setOffen] = useState(true);
  const [person, setPerson] = useState<Personal | null>(bestand ?? null);
  return (
    <>
      <button type="button" onClick={() => { setPerson(null); setOffen(true); }}>
        Wieder öffnen
      </button>
      <PersonalFormModal
        offen={offen}
        person={person}
        vorschlaege={{ traegerorganisation: ['DRK Musterstadt'] }}
        onClose={() => { setOffen(false); onClose?.(); }}
      />
    </>
  );
}

describe('PersonalFormModal — Hülle (LFH-332/B4)', () => {
  it('setzt den Fokus beim Öffnen ins Namensfeld', async () => {
    handler();
    renderMitProviders(<Harness />);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Name')));
  });

  it('Enter im Namensfeld speichert und schliesst', async () => {
    const gesendet = vi.fn();
    const geschlossen = vi.fn();
    handler(gesendet);
    renderMitProviders(<Harness onClose={geschlossen} />);
    const nutzer = userEvent.setup();

    await nutzer.type(await screen.findByLabelText('Name'), 'Erika Mustermann{Enter}');

    await waitFor(() => expect(gesendet).toHaveBeenCalledTimes(1));
    expect(gesendet.mock.calls[0][0]).toMatchObject({ name: 'Erika Mustermann' });
    await waitFor(() => expect(geschlossen).toHaveBeenCalledTimes(1));
  });

  it('ist KEIN Serienmodus — „Speichern und nächste" gibt es hier nicht', async () => {
    // Die Maske dient auch dem Bearbeiten; eine Serie ergäbe dort keinen Sinn.
    handler();
    renderMitProviders(<Harness />);
    await screen.findByLabelText('Name');
    expect(screen.queryByRole('button', { name: 'Speichern und nächste' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Speichern' })).toBeInTheDocument();
  });

  it('Abbrechen leert die Felder — der zweite Aufruf startet leer', async () => {
    // Der Bestand setzte NUR im Erfolgsfall zurück. Genau diese Asymmetrie hebt die
    // Hülle auf; ohne sie stünde „Erika" beim nächsten Anlegen noch im Feld.
    handler();
    renderMitProviders(<Harness />);
    const nutzer = userEvent.setup();

    await nutzer.type(await screen.findByLabelText('Name'), 'Erika Mustermann');
    await nutzer.click(screen.getByRole('button', { name: 'Abbrechen' }));
    await nutzer.click(screen.getByRole('button', { name: 'Wieder öffnen' }));

    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue(''));
  });

  it('Bearbeiten: die Vorbelegung steht — sie ist kein Reset und bleibt erhalten', async () => {
    handler();
    renderMitProviders(<Harness bestand={person} />);
    expect(await screen.findByLabelText('Name')).toHaveValue('Thomas Müller');
    expect(screen.getByLabelText('Personalnummer')).toHaveValue('P-42');
    expect(screen.getByLabelText('Telefon')).toHaveValue('0170 1234567');
  });

  it('nach erfolgreichem Bearbeiten startet das nächste Anlegen leer', async () => {
    // Der Weg, den der entfernte `resetFields()`-Zweig abdeckte: Person speichern,
    // danach „Person anlegen". Trägt jetzt die Hülle — hier wird belegt, dass sie es tut.
    handler();
    renderMitProviders(<Harness bestand={person} />);
    const nutzer = userEvent.setup();

    await nutzer.click(await screen.findByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue(''));

    await nutzer.click(screen.getByRole('button', { name: 'Wieder öffnen' }));
    expect(screen.getByLabelText('Name')).toHaveValue('');
    expect(screen.getByLabelText('Personalnummer')).toHaveValue('');
  });
});
