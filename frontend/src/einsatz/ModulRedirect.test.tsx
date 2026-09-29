import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router';
import { renderMitProviders } from '../test/utils';
import ModulRedirect from './ModulRedirect';

describe('ModulRedirect', () => {
  it('leitet von einer Leaf-Route absolut auf die Geschwister-Route um', async () => {
    renderMitProviders(
      <Routes>
        <Route path="/einsaetze/:id">
          <Route path="gefahrenzonen" element={<ModulRedirect to="lagekarte" />} />
          <Route path="lagekarte" element={<div>Lagekarte-Inhalt</div>} />
        </Route>
      </Routes>,
      { route: '/einsaetze/7/gefahrenzonen' },
    );
    expect(await screen.findByText('Lagekarte-Inhalt')).toBeInTheDocument();
  });

  it('leitet bei ungültiger Einsatz-ID auf die Einsatzliste statt in einen NaN-Pfad (LFH-438)', async () => {
    renderMitProviders(
      <Routes>
        <Route path="/einsaetze" element={<div>Einsatzliste</div>} />
        <Route path="/einsaetze/:id">
          <Route path="gefahrenzonen" element={<ModulRedirect to="lagekarte" />} />
          <Route path="lagekarte" element={<div>Lagekarte-Inhalt</div>} />
        </Route>
      </Routes>,
      { route: '/einsaetze/abc/gefahrenzonen' },
    );
    expect(await screen.findByText('Einsatzliste')).toBeInTheDocument();
    expect(screen.queryByText('Lagekarte-Inhalt')).not.toBeInTheDocument();
  });
});
