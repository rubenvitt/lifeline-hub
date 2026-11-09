import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import { adminFixture, benutzerFixture } from '../test/fixtures';
import { meHandler, server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { einsaetzePfad } from '../routing/deeplinks';
import NurMitPlanungsrecht from './NurMitPlanungsrecht';

/** Direkter Aufruf von /planungen ohne Recht zu planen (LLH-1586). */

function setup(benutzer: ReturnType<typeof benutzerFixture>) {
  server.use(meHandler(benutzer));
  return renderMitProviders(
    <Routes>
      <Route
        path="/planungen"
        element={
          <NurMitPlanungsrecht>
            <div>Planungen sichtbar</div>
          </NurMitPlanungsrecht>
        }
      />
      <Route path={einsaetzePfad()} element={<div>Einsätze</div>} />
    </Routes>,
    { route: '/planungen' },
  );
}

describe('NurMitPlanungsrecht (LLH-1586)', () => {
  it('mit Recht zu planen zeigt die Seite', async () => {
    setup(adminFixture());
    expect(await screen.findByText('Planungen sichtbar')).toBeInTheDocument();
  });

  it('ohne Recht geht es zu den Einsätzen', async () => {
    setup(benutzerFixture());
    expect(await screen.findByText('Einsätze')).toBeInTheDocument();
    expect(screen.queryByText('Planungen sichtbar')).toBeNull();
  });
});
