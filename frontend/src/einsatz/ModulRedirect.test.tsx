import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router-dom';
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
});
