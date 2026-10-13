import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderMitProviders } from '../test/utils';
import { ladeModulFreigaben } from '../api/einsaetze';
import { ApiError } from '../api/client';
import { modulFreigabeAnzeige, useModulFreigabe } from './useModulFreigabe';
import { freigabenFixture } from '../test/fixtures';

vi.mock('../api/einsaetze', () => ({ ladeModulFreigaben: vi.fn() }));

const SEITE = { titel: 'Kommunikationsplan', mitArtikel: 'der Kommunikationsplan' };

function Probe() {
  const f = useModulFreigabe(1, 'fernmeldewesen');
  return <>{modulFreigabeAnzeige(f, 'fernmeldewesen', SEITE, 1) ?? <p>Inhalt der Seite</p>}</>;
}

/**
 * Fail-closed-Freigabe einer Seite, deren Quellen das eigene Modul nicht prüfen (LLH-1180,
 * design.md D6): Inhalt nur bei `frei`, auch wenn der Rahmen bei gescheitertem Freigabeabruf
 * die Seite rendert.
 */
describe('useModulFreigabe', () => {
  it('zeigt den Inhalt, wenn das Fernmeldewesen frei ist, auch bei ausgeblendetem Stab', async () => {
    vi.mocked(ladeModulFreigaben).mockResolvedValue(
      freigabenFixture({ stab: { sichtbar: false } }),
    );
    renderMitProviders(<Probe />);
    expect(await screen.findByText('Inhalt der Seite')).toBeInTheDocument();
  });

  it('nennt das Modul in der Sackgasse, wenn das Fernmeldewesen gesperrt ist', async () => {
    vi.mocked(ladeModulFreigaben).mockResolvedValue(
      freigabenFixture({ fernmeldewesen: { zugriff: false } }),
    );
    renderMitProviders(<Probe />);
    expect(await screen.findByText('Kommunikationsplan nicht verfügbar')).toBeInTheDocument();
    expect(screen.getByText('Modul Fernmeldewesen nicht freigegeben')).toBeInTheDocument();
    expect(screen.queryByText('Inhalt der Seite')).toBeNull();
  });

  it('zeigt bei einem gescheiterten Abruf einen Fehler statt des Inhalts', async () => {
    vi.mocked(ladeModulFreigaben).mockRejectedValue(new ApiError(500, 'kaputt'));
    renderMitProviders(<Probe />);
    expect(
      await screen.findByText(
        'Freigabe des Moduls Fernmeldewesen nicht ermittelbar — der Kommunikationsplan bleibt verborgen',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('Inhalt der Seite')).toBeNull();
  });
});
