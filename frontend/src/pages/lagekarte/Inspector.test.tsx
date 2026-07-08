import type { ReactElement } from 'react';
import { screen } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { renderMitProviders, neuerQueryClient } from '../../test/utils';
import { server } from '../../test/server';
import Inspector from './Inspector';
import type { KarteMarker } from './marker';
import { EinsatzAnzeigeProvider } from '../../anzeige/AnzeigeKonventionenContext';
import type { EinsatzEinstellungen } from '../../api/types';

const marker = {
  schluessel: 'uhs-1',
  typ: 'uhs',
  id: 1,
  lat: 51.1,
  lon: 4.1,
  label: 'UHS Nord',
  farbe: '#f00',
} as KarteMarker;

function inspector(): ReactElement {
  return (
    <Inspector
      einsatzId={1}
      marker={marker}
      darfSchreiben={false}
      onSchliessen={() => {}}
      onVerortungLoeschen={() => {}}
    />
  );
}

/** Einstellungen mit gewünschtem Koordinatenformat (Rest Default). */
function einstellungen(format: EinsatzEinstellungen['koordinatenformat']): EinsatzEinstellungen {
  return {
    einsatz_id: 1, standard_modul: null, basemap_modus: null, karten_zoom_start: null,
    fachebenen_sichtbar: null, zeitzone: null, zeitformat: null, einheiten: null,
    koordinatenformat: format, etb_nummer_praefix: null, etb_nummer_start: null, meldung_nummer_praefix: null, meldung_nummer_start: null, auftrag_nummer_praefix: null, auftrag_nummer_start: null, meldung_bestaetigung_frist_min: null, auftrag_quittierung_frist_min: null, auto_etb_eintraege: null, etb_nummer_eingefroren: false, meldung_nummer_eingefroren: false, auftrag_nummer_eingefroren: false, retention_dauer_tage: null, geaendert_at: null, geaendert_von: null,
    org_defaults: { org_id: 1 },
  };
}

describe('Inspector Koordinatenanzeige', () => {
  beforeEach(() => {
    server.use(
      http.get('/api/einsaetze/:id/ort-vorschau', () => HttpResponse.json({ peilung: null, ortsname: null })),
    );
  });

  it('zeigt ohne Provider die dezimale WGS84-Koordinate (Alt-Verhalten)', () => {
    renderMitProviders(inspector());
    expect(screen.getByText('51.10000, 4.10000')).toBeInTheDocument();
  });

  it('zeigt unter MGRS-Konvention die MGRS-Koordinate', () => {
    // Cache vorbelegen → Provider liest die Konvention ohne Netzwerk.
    const client = neuerQueryClient();
    client.setQueryData(['einsatz-einstellungen', 1], einstellungen('mgrs'));
    renderMitProviders(
      <EinsatzAnzeigeProvider einsatzId={1}>{inspector()}</EinsatzAnzeigeProvider>,
      { client },
    );
    expect(screen.getByText('31U ES 77019 61520')).toBeInTheDocument();
  });
});
