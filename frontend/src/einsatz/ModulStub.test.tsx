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
 * LFH-541: Der Stub wird gegen eine EIGENE Fixture geprüft, nicht mehr gegen den
 * `stab`-Eintrag der echten Registry.
 *
 * `stab` war bis LFH-46 das einzige `wip`-Modul und diente dieser Datei als Stellvertreter.
 * Mit seiner Freischaltung (ST4) gibt es im Bestand keines mehr — ein Test, der am letzten
 * unfertigen Modul hängt, prüft ab dann entweder nichts oder die falsche Sache. Die Fixture
 * ist zugleich ehrlicher: `ModulStub` nimmt sein Modul als **Prop**, die Registry ist für
 * seine Darstellung gar nicht beteiligt.
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
    expect(screen.getByText(/🚧 WIP-Probe/)).toBeInTheDocument();
    expect(screen.getByText(/🚧/)).toBeInTheDocument();
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
   * Rückweg nicht in die Sackgasse schicken, aus der er herausführen soll.
   *
   * Hier wird bewusst NICHTS gemockt: `wip-probe` ist für die echte Registry ein unbekannter
   * Schlüssel, und `aufloeseStandardModul` fällt dafür auf dieselbe Kante wie für ein
   * bekanntes, unfertiges Modul. Ein Registry-Stub wäre hier gemessen WIRKUNGSLOS —
   * `aufloeseStandardModul` liest seinen Register als Default-Argument aus dem eigenen
   * Modul-Scope, und `ModulStub` übergibt keinen; ein `vi.mock` des Registry-Exports
   * erreicht diesen Default nicht.
   *
   * Die Statusachse selbst („bekannt, aber nicht fertig") prüft deshalb
   * `modulRegistry.test.ts` — dort nimmt die Funktion den Register als Argument, samt
   * Gegenprobe auf ein fertiges Modul.
   */
  it('fällt bei nicht auflösbarem Standardmodul auf das Lage-Dashboard zurück (LFH-328)', async () => {
    server.use(
      http.get('/api/einsaetze/7/einstellungen', () =>
        HttpResponse.json({ einsatz_id: 7, standard_modul: 'wip-probe' }),
      ),
    );
    rendern();
    await userEvent.click(await screen.findByRole('button', { name: 'Dashboard öffnen' }));
    expect(screen.getByTestId('pfad')).toHaveTextContent('/einsaetze/7/lage-dashboard');
  });
});
