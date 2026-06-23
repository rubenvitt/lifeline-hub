import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import { server } from '../../test/server';
import { renderMitProviders } from '../../test/utils';
import type { UhsDetail } from '../../api/types';
import BewegungenTab from './BewegungenTab';

const uhs = {
  einsatz_id: 1,
  plaetze: [],
  belegungen: [
    { id: 1, person_id: 10, art: 'eintritt', platz_id: null, notiz: null, zeitpunkt_at: '2026-06-23 10:00:00' },
  ],
} as unknown as UhsDetail;

describe('BewegungenTab (LFH-25)', () => {
  it('verlinkt die Person der Belegung auf ihre Detailseite', async () => {
    server.use(
      http.get('/api/einsaetze/1/personen', () =>
        HttpResponse.json([{ id: 10, registrier_nr: 7, name: 'Müller' }]),
      ),
    );
    renderMitProviders(<BewegungenTab uhs={uhs} />, { route: '/einsaetze/1/unfallhilfsstellen/3' });
    const link = await screen.findByRole('link', { name: /Müller/ });
    expect(link).toHaveAttribute('href', '/einsaetze/1/personen/10');
  });
});
