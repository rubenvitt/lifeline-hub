import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { HilfeSeitenleisteProvider, useHilfeSeitenleiste } from './HilfeSeitenleisteProvider';

vi.mock('../auth/AuthContext', () => ({
  useAuthOptional: () => ({ benutzer: { id: 1 }, geraet: null }),
}));
// Der Hilfe-Chunk lädt nicht (ohne Netz und ohne Service-Worker-Kopie).
vi.mock('./HilfeSeitenleiste', () => {
  throw new Error('Chunk nicht ladbar');
});

function Knopf() {
  const { oeffneHilfe } = useHilfeSeitenleiste();
  return <button onClick={() => oeffneHilfe?.()}>auf</button>;
}

describe('HilfeSeitenleisteProvider, Hilfe-Chunk fehlt', () => {
  it('zeigt einen Hinweis mit dem Weg zur vollen Hilfe', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <MemoryRouter initialEntries={['/einsaetze']}>
        <HilfeSeitenleisteProvider>
          <Knopf />
        </HilfeSeitenleisteProvider>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText('auf'));
    expect(await screen.findByText('Hilfe ist gerade nicht verfügbar.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Alle Kapitel' })).toHaveAttribute('href', '/hilfe');
  });
});
