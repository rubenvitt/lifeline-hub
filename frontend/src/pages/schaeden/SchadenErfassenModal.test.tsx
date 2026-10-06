import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/server';
import { renderMitProviders } from '../../test/utils';
import SchadenErfassenModal from './SchadenErfassenModal';

function oeffne() {
  server.use(
    http.get('/api/einsaetze/1/personen', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/personal', () => HttpResponse.json([])),
  );
  renderMitProviders(
    <SchadenErfassenModal
      open
      onClose={vi.fn()}
      einsatzId={1}
      orgId={1}
      orgName="Eigene Organisation"
    />,
  );
}

describe('SchadenErfassenModal — Eingabegrenzen (LFH-937)', () => {
  it('zeigt „6.400 / 8.000“ an der Beschreibung; eine längere bleibt ganz stehen und sperrt', async () => {
    oeffne();
    const beschreibung = await screen.findByLabelText('Beschreibung');
    fireEvent.change(beschreibung, { target: { value: 'b'.repeat(6_399) } });
    expect(screen.queryByText(/\/ 8\.000/)).toBeNull();
    fireEvent.change(beschreibung, { target: { value: 'b'.repeat(6_400) } });
    expect(screen.getByText('6.400 / 8.000')).toBeInTheDocument();
    fireEvent.change(beschreibung, { target: { value: 'b'.repeat(8_001) } });
    expect(beschreibung).toHaveValue('b'.repeat(8_001));
    await userEvent.click(screen.getByRole('button', { name: 'Anlegen' }));
    expect(
      await screen.findByText('Beschreibung darf höchstens 8.000 Zeichen lang sein'),
    ).toBeInTheDocument();
  });

  it('begrenzt den Ort auf 500 Zeichen', async () => {
    oeffne();
    expect(await screen.findByLabelText('Ort')).toHaveAttribute('maxlength', '500');
  });
});
