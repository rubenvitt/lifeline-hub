/**
 * LLH-1770: Während der Dialog „Sitzung beendet“ steht, hält die Rückfrage keinen Wechsel an.
 * Sonst hielte sie den Weg zur Anmeldeseite (Frist, „Abmelden“) unsichtbar unter der Abdeckung
 * fest, und die Anmeldeseite verlöre den Grund.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, Route, Routes } from 'react-router';
import VerlassenRueckfrage from './VerlassenRueckfrage';
import { renderMitProviders } from '../test/utils';
import { sitzungEntsperren, sitzungSperren } from '../auth/sitzungsSperre';

// Die Sperre steht genau so lange wie die Unterbrechung im AuthProvider.
afterEach(() => sitzungEntsperren('beendet'));

function Seite() {
  return (
    <Routes>
      <Route
        path="/formular"
        element={
          <>
            <VerlassenRueckfrage ungespeichert />
            <Link to="/login">Zur Anmeldung</Link>
          </>
        }
      />
      <Route path="/login" element={<div>ANMELDUNG</div>} />
    </Routes>
  );
}

describe('VerlassenRueckfrage bei unterbrochener Sitzung (LLH-1770)', () => {
  it('lässt den Wechsel ohne Rückfrage durch', async () => {
    sitzungSperren();
    renderMitProviders(<Seite />, { route: '/formular', datenRouter: true });
    await userEvent.click(screen.getByRole('link', { name: 'Zur Anmeldung' }));
    expect(await screen.findByText('ANMELDUNG')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Ungespeicherte Änderungen' })).toBeNull();
  });

  it('ohne Unterbrechung fragt sie wie bisher', async () => {
    renderMitProviders(<Seite />, { route: '/formular', datenRouter: true });
    await userEvent.click(screen.getByRole('link', { name: 'Zur Anmeldung' }));
    expect(
      await screen.findByRole('dialog', { name: 'Ungespeicherte Änderungen' }),
    ).toBeInTheDocument();
  });
});
