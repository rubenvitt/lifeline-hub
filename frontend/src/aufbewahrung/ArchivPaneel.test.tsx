import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import ArchivPaneel, { archivDateiname } from './ArchivPaneel';

vi.mock('../components/dateiSpeichern', () => ({ speichereDatei: vi.fn() }));
import { speichereDatei } from '../components/dateiSpeichern';

/** Archiv der Archivakte (LLH-1494). */

const ARCHIV = {
  archiviert_at: '2026-11-12 08:00:00',
  block: 2,
  bloecke: 2,
  gueltig_bis: null,
  groesse: 4096,
  fingerabdruecke: ['ab12:cd34:ef56:7890', '1111:2222:3333:4444'],
};

describe('ArchivPaneel (LLH-1494)', () => {
  it('lädt den Block und speichert ihn unter dem Namen des Servers', async () => {
    server.use(
      http.get(
        '/api/aufbewahrung/einsaetze/7/archiv',
        () => new HttpResponse(new Uint8Array([1, 2, 3]), { status: 200 }),
      ),
    );
    renderMitProviders(<ArchivPaneel einsatzId={7} kennung="E-2026-0007" archiv={ARCHIV} />);
    expect(screen.getByText('wie der Einsatz')).toBeInTheDocument();
    expect(screen.getByText('ab12:cd34:ef56:7890, 1111:2222:3333:4444')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Herunterladen' }));
    await waitFor(() =>
      expect(vi.mocked(speichereDatei)).toHaveBeenCalledWith(
        expect.any(Blob),
        'einsatz-E-2026-0007-block-2.sqlite.age',
      ),
    );
  });

  it('nennt eine Ablehnung am Paneel', async () => {
    server.use(
      http.get('/api/aufbewahrung/einsaetze/7/archiv', () =>
        HttpResponse.json({ error: 'Kein Archiv.' }, { status: 404 }),
      ),
    );
    renderMitProviders(<ArchivPaneel einsatzId={7} kennung="E-2026-0007" archiv={ARCHIV} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Herunterladen' }));
    expect(await screen.findByText('Nicht geladen')).toBeInTheDocument();
  });

  it('ersetzt im Dateinamen, was der Server ersetzt', () => {
    expect(archivDateiname('#12', 1)).toBe('einsatz-_12-block-1.sqlite.age');
  });
});
