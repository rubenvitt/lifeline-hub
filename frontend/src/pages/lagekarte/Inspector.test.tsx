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

describe('Inspector Kennzahlen (LFH-146)', () => {
  beforeEach(() => {
    server.use(
      http.get('/api/einsaetze/:id/ort-vorschau', () => HttpResponse.json({ peilung: null, ortsname: null })),
    );
  });

  const abschnittMarker = {
    schluessel: 'abschnitt-3',
    typ: 'abschnitt',
    id: 3,
    lat: 50.005,
    lon: 8.005,
    label: 'EA Nord',
    farbe: '#722ed1',
    geometrie: {
      type: 'Polygon',
      coordinates: [[[8, 50], [8.02, 50], [8.02, 50.02], [8, 50.02], [8, 50]]],
    },
  } as KarteMarker;

  it('zeigt Fläche und Umfang für einen Abschnitt-Marker mit Geometrie', () => {
    renderMitProviders(
      <Inspector einsatzId={1} marker={abschnittMarker} darfSchreiben={false}
        onSchliessen={() => {}} onVerortungLoeschen={() => {}} />,
    );
    expect(screen.getByText('Fläche')).toBeInTheDocument();
    expect(screen.getByText('Umfang')).toBeInTheDocument();
    expect(screen.getByText(/\d.*(m²|ha|km²)/)).toBeInTheDocument();
  });

  it('zeigt keine Fläche für einen Punkt-Marker ohne Geometrie', () => {
    renderMitProviders(inspector()); // uhs-Marker ohne geometrie
    expect(screen.queryByText('Fläche')).not.toBeInTheDocument();
  });
});

describe('Inspector Symbol-Auswahl — Beschriftung (LFH-328)', () => {
  beforeEach(() => {
    server.use(
      http.get('/api/einsaetze/:id/ort-vorschau', () => HttpResponse.json({ peilung: null, ortsname: null })),
    );
  });

  // Bewusst MIT gesetztem `tz`: bei leerem Select wäre der Accessible Name auch dann sauber,
  // wenn die Beschriftung das Feld umschlösse — der gewählte Wert ist der Prüfstein.
  const einheitMarker = {
    schluessel: 'einheit-4', typ: 'einheit', id: 4, lat: 50.1, lon: 8.1, label: '1. Zug', farbe: '#1677ff',
    tz: { fachaufgabe: 'rettungswesen', organisation: 'feuerwehr' },
  } as KarteMarker;

  it('der sichtbare Beschriftungstext ist der Accessible Name der Selects', () => {
    renderMitProviders(
      <Inspector einsatzId={1} marker={einheitMarker} darfSchreiben
        onSchliessen={() => {}} onVerortungLoeschen={() => {}} onSymbolAendern={() => {}} />,
    );
    expect(screen.getByRole('combobox', { name: 'Fachaufgabe' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Organisation (Override)' })).toBeInTheDocument();
    // Der gewählte Wert steht sichtbar, aber nicht im Namen.
    expect(screen.getByText('Rettungswesen/Sanität')).toBeInTheDocument();
  });
});

describe('Inspector Typ-Tag (LFH-276)', () => {
  beforeEach(() => {
    server.use(
      http.get('/api/einsaetze/:id/ort-vorschau', () => HttpResponse.json({ peilung: null, ortsname: null })),
    );
  });

  it('zeigt für einen Personal-Marker den Typ-Tag „Personal" (nicht „Führungskraft")', () => {
    const fuehrungMarker = {
      schluessel: 'fuehrung-7', typ: 'fuehrung', id: 7, lat: 50.2, lon: 8.5, label: 'Zugführer', farbe: '#1677ff',
    } as KarteMarker;
    renderMitProviders(
      <Inspector einsatzId={1} marker={fuehrungMarker} darfSchreiben={false}
        onSchliessen={() => {}} onVerortungLoeschen={() => {}} />,
    );
    expect(screen.getByText('Personal')).toBeInTheDocument();
    expect(screen.queryByText('Führungskraft')).not.toBeInTheDocument();
  });
});
