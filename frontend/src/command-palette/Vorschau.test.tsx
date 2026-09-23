import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { Vorschau } from './Vorschau';

describe('Vorschau (LFH-645)', () => {
  it('bildet art: person auf die Personenvorschau ab', async () => {
    server.use(
      http.get('/api/einsaetze/5/personen/11', () =>
        HttpResponse.json({
          id: 11,
          einsatz_id: 5,
          registrier_nr: 3,
          status: 'erfasst',
          name: 'Florian',
          vorname: null,
          storniert_at: null,
          aktuelle_sichtung: null,
          aktueller_verbleib: null,
          sichtungen: [],
          notizen: [],
          verbleib: [],
          abgleiche: [],
        }),
      ),
    );
    renderMitProviders(<Vorschau ziel={{ art: 'person', einsatzId: 5, id: 11 }} />);
    expect(await screen.findByText('Florian')).toBeInTheDocument();
  });
});
