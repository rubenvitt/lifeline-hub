import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, Route, Routes } from 'react-router';
import VerlassenRueckfrage from './VerlassenRueckfrage';
import { renderMitProviders } from '../test/utils';

function Seite({
  ungespeichert,
  speichern,
}: {
  ungespeichert: boolean;
  speichern?: () => Promise<void>;
}) {
  return (
    <Routes>
      <Route
        path="/formular"
        element={
          <>
            <VerlassenRueckfrage ungespeichert={ungespeichert} speichern={speichern} />
            <input aria-label="Feld" defaultValue="" />
            <Link to="/anderswo">Weg</Link>
            <Link to="/formular?reiter=2">Gleicher Pfad</Link>
          </>
        }
      />
      <Route path="/anderswo" element={<div>ANDERSWO</div>} />
    </Routes>
  );
}

describe('VerlassenRueckfrage (LFH-979)', () => {
  it('hält einen Pfadwechsel bei ungespeicherten Änderungen an; „Bleiben" erhält die Eingabe', async () => {
    const user = userEvent.setup();
    renderMitProviders(<Seite ungespeichert />, { route: '/formular', datenRouter: true });
    await user.type(screen.getByLabelText('Feld'), 'Kennzeichen');
    await user.click(screen.getByRole('link', { name: 'Weg' }));

    const dialog = await screen.findByRole('dialog', { name: 'Ungespeicherte Änderungen' });
    expect(dialog).toHaveTextContent('gehen beim Verlassen verloren');
    // Ohne `speichern` gibt es nur zwei Wege (Formularseiten, design.md D3).
    expect(screen.queryByRole('button', { name: /Speichern und weiter/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Bleiben' }));
    expect(screen.queryByText('ANDERSWO')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Feld')).toHaveValue('Kennzeichen');
  });

  it('„Verwerfen" führt den Wechsel aus', async () => {
    const user = userEvent.setup();
    renderMitProviders(<Seite ungespeichert />, { route: '/formular', datenRouter: true });
    await user.click(screen.getByRole('link', { name: 'Weg' }));
    await user.click(await screen.findByRole('button', { name: 'Verwerfen' }));
    expect(await screen.findByText('ANDERSWO')).toBeInTheDocument();
  });

  it('lässt ohne ungespeicherte Änderung und bei gleichem Pfad durch', async () => {
    const user = userEvent.setup();
    const { rerender } = renderMitProviders(<Seite ungespeichert />, {
      route: '/formular',
      datenRouter: true,
    });
    await user.click(screen.getByRole('link', { name: 'Gleicher Pfad' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    rerender(<Seite ungespeichert={false} />);
    await user.click(screen.getByRole('link', { name: 'Weg' }));
    expect(await screen.findByText('ANDERSWO')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  /**
   * Fällt der Merker, während die Rückfrage offen steht, läuft der angehaltene Wechsel weiter.
   * Das trägt auch das Abmelden und das Sitzungsende (`useSitzungsWache` navigiert zu `/login`):
   * auf den Admin-Seiten hängt `aktiv` am Benutzer, mit ihm fällt der Merker, und die Umleitung
   * kommt ohne Klick durch. In den Einsatz-Einstellungen hängt das Recht an der Einsatzrolle;
   * dort bleibt die Rückfrage stehen, und „Verwerfen" führt zur Anmeldung.
   */
  it('holt den angehaltenen Wechsel nach, sobald nichts mehr ungespeichert ist', async () => {
    const user = userEvent.setup();
    const { rerender } = renderMitProviders(<Seite ungespeichert />, {
      route: '/formular',
      datenRouter: true,
    });
    await user.click(screen.getByRole('link', { name: 'Weg' }));
    await screen.findByRole('dialog', { name: 'Ungespeicherte Änderungen' });

    rerender(<Seite ungespeichert={false} />);
    expect(await screen.findByText('ANDERSWO')).toBeInTheDocument();
  });

  it('bietet „Speichern und weiter" nur mit `speichern` an', async () => {
    const user = userEvent.setup();
    const speichern = vi.fn(async () => {});
    renderMitProviders(<Seite ungespeichert speichern={speichern} />, {
      route: '/formular',
      datenRouter: true,
    });
    await user.click(screen.getByRole('link', { name: 'Weg' }));
    await user.click(await screen.findByRole('button', { name: /Speichern und weiter/ }));
    expect(speichern).toHaveBeenCalledOnce();
  });
});
