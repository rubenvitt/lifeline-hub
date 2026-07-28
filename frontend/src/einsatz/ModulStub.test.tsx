import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import ModulStub from './ModulStub';
import { modulRegistry } from './modulRegistry';

const stab = modulRegistry.find((m) => m.key === 'stab')!;

/** Sonde für den aktuellen Pfad — beweist die echte Navigation statt eines Mock-Aufrufs. */
function PfadAnzeige() {
  return <span data-testid="pfad">{useLocation().pathname}</span>;
}

function rendern() {
  return renderMitProviders(
    <Routes>
      <Route
        path="/einsaetze/:id/stab"
        element={
          <>
            <ModulStub modul={stab} />
            <PfadAnzeige />
          </>
        }
      />
      <Route path="/einsaetze/:id/*" element={<PfadAnzeige />} />
    </Routes>,
    { route: '/einsaetze/7/stab' },
  );
}

describe('ModulStub', () => {
  it('rendert Label und Beschreibung des Moduls mit WIP-Marker', () => {
    renderMitProviders(<ModulStub modul={stab} />);
    expect(screen.getByText(/🚧 Stab/)).toBeInTheDocument();
    expect(screen.getByText(/🚧/)).toBeInTheDocument();
    expect(screen.getByText(stab.beschreibung!)).toBeInTheDocument();
  });

  it('bietet ohne Einsatz-Kontext keinen Rückweg an', () => {
    renderMitProviders(<ModulStub modul={stab} />);
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

  // `stab` selbst ist `status: 'wip'` — `aufloeseStandardModul` darf darauf nicht springen,
  // sonst zeigte der Rückweg zurück auf die Sackgasse, aus der er herausführen soll.
  it('fällt bei nicht fertigem Standardmodul auf das Lage-Dashboard zurück (LFH-328)', async () => {
    server.use(
      http.get('/api/einsaetze/7/einstellungen', () =>
        HttpResponse.json({ einsatz_id: 7, standard_modul: 'stab' }),
      ),
    );
    rendern();
    await userEvent.click(await screen.findByRole('button', { name: 'Dashboard öffnen' }));
    expect(screen.getByTestId('pfad')).toHaveTextContent('/einsaetze/7/lage-dashboard');
  });
});
