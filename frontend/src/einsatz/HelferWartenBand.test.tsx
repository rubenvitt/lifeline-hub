import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import type { EinsatzAnzeige } from '../api/types';
import HelferWartenBand, { helferWartenText } from './HelferWartenBand';

const einsatz = (meine_rolle: string) => ({ id: 1, meine_rolle }) as EinsatzAnzeige;

const helfer = (id: number, state: string) => ({
  id,
  state,
  display_name: `Kraft ${id}`,
  created_at: '2026-11-25 08:00:00',
  expires_at: '2026-11-25 10:00:00',
  is_tracker: false,
  paused: false,
  person_requested: false,
});

/** Hinweis auf wartende Helfer im Einsatzkopf (Helfer-App, Spec „Oberfläche → Kopfzeile“). */
describe('HelferWartenBand (Helfer-App)', () => {
  it('zählt die wartenden Helfer und führt zum Bereich „Helfer“', async () => {
    server.use(
      http.get('/api/incidents/1/helpers', () =>
        HttpResponse.json({
          helpers: [helfer(1, 'unbestaetigt'), helfer(2, 'aktiv'), helfer(3, 'unbestaetigt')],
        }),
      ),
    );
    renderMitProviders(<HelferWartenBand einsatz={einsatz('einsatzleitung')} />);
    expect(await screen.findByText('2 Helfer warten auf Bestätigung')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ansehen' })).toHaveAttribute(
      'href',
      '/einsaetze/1/einstellungen/geraete#helfer',
    );
  });

  it('fragt ohne Einsatzleitung nichts ab', async () => {
    const abgerufen = vi.fn();
    server.use(
      http.get('/api/incidents/1/helpers', () => {
        abgerufen();
        return HttpResponse.json({ helpers: [helfer(1, 'unbestaetigt')] });
      }),
    );
    const { container } = renderMitProviders(<HelferWartenBand einsatz={einsatz('mitglied')} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(abgerufen).not.toHaveBeenCalled();
    expect(container.querySelector('[data-lfh="helfer-warten-band"]')).toBeNull();
  });

  it('schweigt ohne wartende Helfer', async () => {
    const abgerufen = vi.fn();
    server.use(
      http.get('/api/incidents/1/helpers', () => {
        abgerufen();
        return HttpResponse.json({ helpers: [helfer(2, 'aktiv')] });
      }),
    );
    const { container } = renderMitProviders(
      <HelferWartenBand einsatz={einsatz('einsatzleitung')} />,
    );
    await waitFor(() => expect(abgerufen).toHaveBeenCalled());
    expect(container.querySelector('[data-lfh="helfer-warten-band"]')).toBeNull();
  });

  it('spricht einen Helfer in der Einzahl an', () => {
    expect(helferWartenText(1)).toBe('1 Helfer wartet auf Bestätigung');
    expect(helferWartenText(3)).toBe('3 Helfer warten auf Bestätigung');
  });
});
