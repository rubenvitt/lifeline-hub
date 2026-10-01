import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderMitProviders } from '../test/utils';
import { ladeModulFreigaben } from '../api/einsaetze';
import { ApiError } from '../api/client';
import { stabFreigabeAnzeige, useStabFreigabe } from './useStabFreigabe';
import { freigabenFixture } from '../test/fixtures';

vi.mock('../api/einsaetze', () => ({ ladeModulFreigaben: vi.fn() }));

const SEITE = { titel: 'Informationstelefon', mitArtikel: 'das Informationstelefon' };

function Probe() {
  const f = useStabFreigabe(1);
  return <>{stabFreigabeAnzeige(f, SEITE, 1) ?? <p>Inhalt der Seite</p>}</>;
}

/**
 * Die Freigabe der Stab-Unterseiten (LFH-548/554) ist fail-closed: Inhalt nur bei `frei`. Die
 * Seiten-Integration prüft `FunkplanPage.test.tsx`; hier die vier Zustände und der Wortlaut je
 * Seite.
 */
describe('useStabFreigabe', () => {
  it('zeigt den Inhalt erst, wenn der Stab frei ist', async () => {
    vi.mocked(ladeModulFreigaben).mockResolvedValue(freigabenFixture());
    renderMitProviders(<Probe />);
    expect(await screen.findByText('Inhalt der Seite')).toBeInTheDocument();
  });

  it('nennt die Seite in der Sackgasse, wenn der Stab ausgeblendet ist', async () => {
    vi.mocked(ladeModulFreigaben).mockResolvedValue(
      freigabenFixture({ stab: { sichtbar: false } }),
    );
    renderMitProviders(<Probe />);
    expect(await screen.findByText('Informationstelefon nicht verfügbar')).toBeInTheDocument();
    expect(screen.getByText(/das Informationstelefon gehört dazu/)).toBeInTheDocument();
    expect(screen.queryByText('Inhalt der Seite')).toBeNull();
  });

  it('zeigt bei einem gescheiterten Abruf einen Fehler statt des Inhalts', async () => {
    vi.mocked(ladeModulFreigaben).mockRejectedValue(new ApiError(500, 'kaputt'));
    renderMitProviders(<Probe />);
    expect(
      await screen.findByText(/nicht ermittelbar — das Informationstelefon bleibt verborgen/),
    ).toBeInTheDocument();
    expect(screen.queryByText('Inhalt der Seite')).toBeNull();
  });
});
