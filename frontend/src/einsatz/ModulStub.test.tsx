import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import ModulStub from './ModulStub';
import type { ModulEintrag } from './modulRegistry';

/**
 * Der Stub wird gegen eine EIGENE Fixture geprüft: `ModulStub` nimmt sein Modul als Prop,
 * die Registry ist an seiner Darstellung nicht beteiligt (LFH-541).
 */
const wipModul: ModulEintrag = {
  key: 'wip-probe',
  kategorie: 'fuehrung',
  label: 'WIP-Probe',
  icon: () => null,
  route: 'wip-probe',
  status: 'wip',
  beschreibung: 'Platzhalter-Beschreibung für den Stellvertreter-Test.',
};

/** Sonde für den aktuellen Pfad — beweist die echte Navigation statt eines Mock-Aufrufs. */
function PfadAnzeige() {
  return <span data-testid="pfad">{useLocation().pathname}</span>;
}

function rendern() {
  return renderMitProviders(
    <Routes>
      <Route
        path="/einsaetze/:id/wip-probe"
        element={
          <>
            <ModulStub modul={wipModul} />
            <PfadAnzeige />
          </>
        }
      />
      <Route path="/einsaetze/:id/*" element={<PfadAnzeige />} />
    </Routes>,
    { route: '/einsaetze/7/wip-probe' },
  );
}

describe('ModulStub', () => {
  it('rendert Label und Beschreibung des Moduls mit WIP-Marker', () => {
    renderMitProviders(<ModulStub modul={wipModul} />);
    const kopf = document.querySelector('[data-lfh="platzhalter-titel"]');
    expect(kopf).toHaveTextContent('WIP-Probe');
    expect(kopf?.querySelector('[data-ikone="baustelle"]')).not.toBeNull();
    expect(screen.getByText(wipModul.beschreibung!)).toBeInTheDocument();
  });

  it('bietet ohne Einsatz-Kontext keinen Rückweg an', () => {
    renderMitProviders(<ModulStub modul={wipModul} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('führt über den Rückweg auf das konfigurierte Standardmodul (LFH-328)', async () => {
    server.use(
      http.get('/api/einsaetze/7/einstellungen', () =>
        HttpResponse.json({ einsatz_id: 7, standard_modul: 'einheiten' }),
      ),
    );
    rendern();
    await userEvent.click(await screen.findByRole('button', { name: 'Einheiten öffnen' }));
    expect(screen.getByTestId('pfad')).toHaveTextContent('/einsaetze/7/einheiten');
  });

  /**
   * Ein Standardmodul, das sich NICHT auf eine bedienbare Route auflösen lässt, darf den
   * Rückweg nicht in eine Sackgasse schicken.
   *
   * Bewusst NICHTS gemockt: `wip-probe` ist für die echte Registry unbekannt und fällt auf
   * dieselbe Kante wie ein unfertiges Modul. Ein Registry-Mock wäre wirkungslos:
   * `aufloeseStandardModul` liest den Register als Default-Argument aus dem eigenen Modul-Scope,
   * und `vi.mock` erreicht diesen Default nicht. Die Statusachse selbst prüft
   * `modulRegistry.test.ts`, dort mit dem Register als Argument.
   */
  it('fällt bei nicht auflösbarem Standardmodul auf den Überblick zurück (LFH-328, Neuentwurf)', async () => {
    server.use(
      http.get('/api/einsaetze/7/einstellungen', () =>
        HttpResponse.json({ einsatz_id: 7, standard_modul: 'wip-probe' }),
      ),
    );
    rendern();
    await userEvent.click(await screen.findByRole('button', { name: 'Überblick öffnen' }));
    expect(screen.getByTestId('pfad')).toHaveTextContent('/einsaetze/7/ueberblick');
  });
});
