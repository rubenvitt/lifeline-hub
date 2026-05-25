import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { renderMitProviders } from '../test/utils';
import DefaultModulRedirect from './DefaultModulRedirect';

describe('DefaultModulRedirect', () => {
  it('leitet ohne Modul auf das ETB-Fallback um', () => {
    renderMitProviders(
      <Routes>
        <Route path="/einsaetze/:id" element={<DefaultModulRedirect />} />
        <Route path="/einsaetze/:id/etb" element={<div>ETB-Inhalt</div>} />
      </Routes>,
      { route: '/einsaetze/7' },
    );
    expect(screen.getByText('ETB-Inhalt')).toBeInTheDocument();
  });
});
