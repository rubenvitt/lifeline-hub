import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import type { Material } from '../api/types';
import MaterialFormModal from './MaterialFormModal';

/**
 * LFH-346/A6 — die Materialmaske auf `ErfassungsModal`. Geprüft wird nur, was an
 * DIESER Maske verdrahtet ist; die Mechanik der Hülle beweist
 * `components/Erfassung.test.tsx`, die Übernahmefelder einmalig
 * `FahrzeugFormModal.test.tsx`.
 */

const material: Material = {
  id: 3,
  bezeichnung: 'Wolldecke',
  kategorie: 'Betreuung',
  bestandsnummer: 'INV-7',
  traegerorganisation: 'DRK Musterstadt',
  standort: 'Lagerhalle 2',
  bemerkung: null,
  dienststatus: 'in_dienst',
  angelegt_at: '2026-05-26 10:00:00',
};

function handler() {
  server.use(
    http.post('/api/material', () => HttpResponse.json({ ...material, id: 9 })),
    http.patch('/api/material/3', () => HttpResponse.json(material)),
  );
}

function Harness({ bestand, onClose }: { bestand?: Material | null; onClose?: () => void }) {
  const [offen, setOffen] = useState(true);
  const [aktuell, setAktuell] = useState<Material | null>(bestand ?? null);
  return (
    <>
      <button type="button" onClick={() => { setAktuell(null); setOffen(true); }}>
        Wieder öffnen
      </button>
      <MaterialFormModal
        offen={offen}
        material={aktuell}
        kategorien={['Betreuung']}
        onClose={() => { setOffen(false); onClose?.(); }}
      />
    </>
  );
}

describe('MaterialFormModal — Hülle (LFH-346/A6)', () => {
  it('trägt keine antd-Fusszeile — der Absende-Knopf liegt im Formular', async () => {
    handler();
    renderMitProviders(<Harness />);
    const knopf = await screen.findByRole('button', { name: 'Speichern' });

    expect(document.querySelector('.ant-modal-footer')).toBeNull();
    expect(knopf.closest('form')).not.toBeNull();
  });

  it('setzt den Fokus beim Öffnen ins Bezeichnungsfeld', async () => {
    handler();
    renderMitProviders(<Harness />);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Bezeichnung')));
  });

  it('Anlegen: der Serienweg steht — Material wird am Stück erfasst', async () => {
    handler();
    renderMitProviders(<Harness />);
    await screen.findByLabelText('Bezeichnung');
    expect(screen.getByRole('button', { name: 'Speichern und nächste' })).toBeInTheDocument();
  });

  it('Bearbeiten: KEIN Serienweg — „Speichern und nächste" wäre ein toter Knopf', async () => {
    handler();
    renderMitProviders(<Harness bestand={material} />);
    await screen.findByLabelText('Bezeichnung');
    expect(screen.queryByRole('button', { name: 'Speichern und nächste' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Speichern' })).toBeInTheDocument();
  });

  it('bleibt beim Serien-Speichern offen und leert die Bezeichnung', async () => {
    // Ein im `onSuccess` der Mutation stehengebliebenes `onClose()` schlösse den Dialog
    // auch im Serienlauf; jsdom hält den schliessenden Dialog samt Feldern im Baum, der
    // Beleg ist deshalb der NICHT gerufene Schliess-Callback.
    handler();
    const geschlossen = vi.fn();
    const nutzer = userEvent.setup();
    renderMitProviders(<Harness onClose={geschlossen} />);

    await nutzer.type(await screen.findByLabelText('Bezeichnung'), 'Wolldecke');
    await nutzer.click(screen.getByRole('button', { name: 'Speichern und nächste' }));

    await waitFor(() => expect(screen.getByLabelText('Bezeichnung')).toHaveValue(''));
    expect(geschlossen).not.toHaveBeenCalled();
  });

  it('nach erfolgreichem Bearbeiten startet das nächste Anlegen leer', async () => {
    handler();
    const nutzer = userEvent.setup();
    renderMitProviders(<Harness bestand={material} />);
    expect(await screen.findByLabelText('Bezeichnung')).toHaveValue('Wolldecke');

    await nutzer.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(screen.getByLabelText('Bezeichnung')).toHaveValue(''));

    await nutzer.click(screen.getByRole('button', { name: 'Wieder öffnen' }));
    expect(screen.getByLabelText('Bezeichnung')).toHaveValue('');
    expect(screen.getByLabelText('Bestandsnummer')).toHaveValue('');
  });
});
