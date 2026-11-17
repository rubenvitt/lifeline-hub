import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router';
import { renderMitProviders } from '../test/utils';
import { freigabenFixture } from '../test/fixtures';
import type { EinsatzEinstellungen } from '../api/types';
import type { ModulEintrag } from './modulRegistry';
import DefaultModulRedirect from './DefaultModulRedirect';

/**
 * Ein nicht fertiges Modul im Ziel-Einsatz (LLH-1821): der Einsatzwechsel fällt still aufs
 * Standardmodul zurück. Eigene Datei, weil der Fall nur über einen Registry-Stub beobachtbar ist
 * (heute ist jedes Modul fertig) und `vi.mock` dateiweit hoistet; Muster wie
 * `command-palette/befehle.modulstatus.test.ts`. Gestubbt wird nur die Datentabelle.
 */
vi.mock('./modulRegistry', async (importOriginal) => {
  const echt = await importOriginal<typeof import('./modulRegistry')>();
  return {
    ...echt,
    modulRegistry: echt.modulRegistry.map((m: ModulEintrag) =>
      m.key === 'fahrzeuge' ? { ...m, status: 'wip' as const } : m,
    ),
  };
});

vi.mock('../api/einsaetze', () => ({ ladeEinstellungen: vi.fn(), ladeModulFreigaben: vi.fn() }));
import { ladeEinstellungen, ladeModulFreigaben } from '../api/einsaetze';

describe('DefaultModulRedirect — Modul im Ziel nicht fertig', () => {
  it('fällt still aufs Standardmodul zurück, obwohl der Server das Modul freigibt', async () => {
    vi.mocked(ladeEinstellungen).mockResolvedValue({
      standard_modul: 'etb',
      org_defaults: { org_id: 1 },
    } as EinsatzEinstellungen);
    vi.mocked(ladeModulFreigaben).mockResolvedValue(freigabenFixture());
    renderMitProviders(
      <Routes>
        <Route path="/einsaetze/:id" element={<DefaultModulRedirect />} />
        <Route path="/einsaetze/:id/etb" element={<div>ETB-Inhalt</div>} />
        <Route path="/einsaetze/:id/fahrzeuge" element={<div>Fahrzeuge-Inhalt</div>} />
      </Routes>,
      { route: '/einsaetze/8?modul=fahrzeuge' },
    );
    expect(await screen.findByText('ETB-Inhalt')).toBeInTheDocument();
    expect(screen.queryByText('Fahrzeuge-Inhalt')).not.toBeInTheDocument();
    // Vorbedingung: die Freigaben waren da, der Rückfall kam vom Status, nicht vom Laden.
    expect(ladeModulFreigaben).toHaveBeenCalledWith(8);
  });
});
