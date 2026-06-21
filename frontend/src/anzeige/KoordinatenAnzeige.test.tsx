import { afterEach, describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../test/server';
import { render } from '@testing-library/react';
import { renderMitProviders } from '../test/utils';
import KoordinatenAnzeige from './KoordinatenAnzeige';
import { leereOrtCache } from './ortCache';

// Isolation: idb-OrtCache zwischen Tests leeren (kein State-Leak in/aus anderen Testdateien)
afterEach(() => leereOrtCache());

describe('KoordinatenAnzeige', () => {
  it('zeigt ohne einsatzId nur die Koordinate (kein Provider nötig)', () => {
    render(<KoordinatenAnzeige lat={51.5} lon={10.25} />);
    expect(screen.getByText('51.50000, 10.25000')).toBeInTheDocument();
    expect(screen.queryByText(/von|·|ermittelt/)).not.toBeInTheDocument();
  });

  it('zeigt mit einsatzId Koordinate + Ort-Zeile', async () => {
    server.use(
      http.get('/api/einsaetze/1/ort-vorschau', () =>
        HttpResponse.json({
          peilung: { distanz_m: 1200, richtung: 'NO', bezug_label: 'Einsatzort' },
          ortsname: 'Hauptstr. 5, Musterstadt',
        }),
      ),
    );
    renderMitProviders(<KoordinatenAnzeige lat={51.5} lon={10.25} einsatzId={1} />);
    expect(screen.getByText('51.50000, 10.25000')).toBeInTheDocument();
    expect(await screen.findByText(/Hauptstr\. 5, Musterstadt · 1[.,]20 km NO von Einsatzort/)).toBeInTheDocument();
  });
});
