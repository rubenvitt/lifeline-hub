import type { ReactElement } from 'react';
import { screen } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { renderMitProviders, neuerQueryClient } from '../../test/utils';
import { server } from '../../test/server';
import Inspector from './Inspector';
import type { KarteMarker } from './marker';
import type { AuswahlRoh } from './leistenDaten';
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
    einsatz_id: 1,
    standard_modul: null,
    basemap_modus: null,
    karten_zoom_start: null,
    fachebenen_sichtbar: null,
    zeitzone: null,
    zeitformat: null,
    einheiten: null,
    koordinatenformat: format,
    etb_nummer_praefix: null,
    etb_nummer_start: null,
    meldung_nummer_praefix: null,
    meldung_nummer_start: null,
    auftrag_nummer_praefix: null,
    auftrag_nummer_start: null,
    meldung_bestaetigung_frist_min: null,
    auftrag_quittierung_frist_min: null,
    auto_etb_eintraege: null,
    etb_nummer_eingefroren: false,
    meldung_nummer_eingefroren: false,
    auftrag_nummer_eingefroren: false,
    retention_dauer_tage: null,
    geaendert_at: null,
    geaendert_von: null,
    org_defaults: { org_id: 1 },
  };
}

describe('Inspector Koordinatenanzeige', () => {
  beforeEach(() => {
    server.use(
      http.get('/api/einsaetze/:id/ort-vorschau', () =>
        HttpResponse.json({ peilung: null, ortsname: null }),
      ),
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
      http.get('/api/einsaetze/:id/ort-vorschau', () =>
        HttpResponse.json({ peilung: null, ortsname: null }),
      ),
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
      coordinates: [
        [
          [8, 50],
          [8.02, 50],
          [8.02, 50.02],
          [8, 50.02],
          [8, 50],
        ],
      ],
    },
  } as KarteMarker;

  it('zeigt Fläche und Umfang für einen Abschnitt-Marker mit Geometrie', () => {
    renderMitProviders(
      <Inspector
        einsatzId={1}
        marker={abschnittMarker}
        darfSchreiben={false}
        onSchliessen={() => {}}
        onVerortungLoeschen={() => {}}
      />,
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
      http.get('/api/einsaetze/:id/ort-vorschau', () =>
        HttpResponse.json({ peilung: null, ortsname: null }),
      ),
    );
  });

  // Bewusst MIT gesetztem `tz`: bei leerem Select wäre der Accessible Name auch dann sauber,
  // wenn die Beschriftung das Feld umschlösse — der gewählte Wert ist der Prüfstein.
  const einheitMarker = {
    schluessel: 'einheit-4',
    typ: 'einheit',
    id: 4,
    lat: 50.1,
    lon: 8.1,
    label: '1. Zug',
    farbe: '#1677ff',
    tz: { fachaufgabe: 'rettungswesen', organisation: 'feuerwehr' },
  } as KarteMarker;

  it('der sichtbare Beschriftungstext ist der Accessible Name der Selects', () => {
    renderMitProviders(
      <Inspector
        einsatzId={1}
        marker={einheitMarker}
        darfSchreiben
        onSchliessen={() => {}}
        onVerortungLoeschen={() => {}}
        onSymbolAendern={() => {}}
      />,
    );
    expect(screen.getByRole('combobox', { name: 'Fachaufgabe' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Organisation (Override)' })).toBeInTheDocument();
    // Der gewählte Wert steht sichtbar, aber nicht im Namen.
    expect(screen.getByText('Rettungswesen/Sanität')).toBeInTheDocument();
  });
});

describe('Inspector Aktionsreihe — Überlauf in der 300-px-Karte', () => {
  beforeEach(() => {
    server.use(
      http.get('/api/einsaetze/:id/ort-vorschau', () =>
        HttpResponse.json({ peilung: null, ortsname: null }),
      ),
    );
  });

  const schadenMarker = {
    schluessel: 'schaden-2',
    typ: 'schaden',
    id: 2,
    lat: 52.0,
    lon: 9.9,
    label: 'S-002',
    farbe: '#faad14',
  } as KarteMarker;

  // Gemessen an der Vorlage: „Im Fach-Modul öffnen" + „Verortung löschen" tragen nebeneinander
  // rund 300 px Eigenbreite und passen damit in KEINER Dichtestufe in den ~278 px Innenraum
  // der Karte. `KartenDetailCard` setzt `overflowY: 'auto'`, was per CSS auch `overflow-x`
  // auf `auto` zieht — der zweite Knopf wird also abgeschnitten statt umzubrechen.
  // Ein Pixelbeleg ist in jsdom nicht baubar (kein Layout); geprüft wird die Struktur,
  // die den Überlauf unmöglich macht.
  it('stapelt die Aktionen senkrecht, jede über die volle Kartenbreite', () => {
    renderMitProviders(
      <Inspector
        einsatzId={1}
        marker={schadenMarker}
        darfSchreiben
        onSchliessen={() => {}}
        onVerortungLoeschen={() => {}}
      />,
    );
    const modulLink = screen.getByRole('link', { name: 'Im Fachmodul öffnen' });
    const loeschen = screen.getByRole('button', { name: 'Verortung löschen' });

    // `size="middle"` statt des Vorgabe-Abstands: der rote Knopf steht sonst 3–7 px unter
    // einem neutralen (CLAUDE.md, „Rot steht auch nicht bündig neben Neutralem").
    expect(loeschen.closest('.ant-space')).toHaveClass(
      'ant-space-vertical',
      'ant-space-gap-row-middle',
    );
    expect(loeschen).toHaveClass('ant-btn-block');
    // Der Anker ist inline — ohne eigenes `display: block` liefe `block` am Knopf darin
    // ins Leere und die Zeile bliebe schmal.
    expect(modulLink).toHaveStyle({ display: 'block' });
    expect(modulLink.querySelector('.ant-btn')).toHaveClass('ant-btn-block');
  });

  // Zweite Hälfte des Paares (LFH-366): ohne Schreibrecht bleibt EINE Aktion — genau deshalb
  // ist hier kein Dreipunkt-Menü richtig, und deshalb muss der direkte Knopf dann weg sein.
  it('ohne Schreibrecht bleibt allein der Modul-Link', () => {
    renderMitProviders(
      <Inspector
        einsatzId={1}
        marker={schadenMarker}
        darfSchreiben={false}
        onSchliessen={() => {}}
        onVerortungLoeschen={() => {}}
      />,
    );
    expect(screen.getByRole('link', { name: 'Im Fachmodul öffnen' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Verortung löschen' })).not.toBeInTheDocument();
  });

  it('kürzt die Ortsangabe, statt die Karte damit vollzuschreiben', async () => {
    server.use(
      http.get('/api/einsaetze/:id/ort-vorschau', () =>
        HttpResponse.json({
          peilung: { distanz_m: 20, richtung: 'O', bezug_label: 'S-1' },
          ortsname:
            'St. Michaelis, Bethelner Straße, Burgstemmen, Nordstemmen, Landkreis Hildesheim, Niedersachsen, 31171, Deutschland',
        }),
      ),
    );
    renderMitProviders(
      <Inspector
        einsatzId={1}
        marker={schadenMarker}
        darfSchreiben={false}
        onSchliessen={() => {}}
        onVerortungLoeschen={() => {}}
      />,
    );
    // Die Kürzung selbst rechnet der Browser (`-webkit-line-clamp`); jsdom meldet keine
    // Unterstützung und fällt auf den Messpfad zurück. Belegbar ist deshalb, DASS die
    // Kürzung konfiguriert ist — antd setzt die Klasse unabhängig vom Messweg.
    const zeile = await screen.findByText(/St\. Michaelis/);
    expect(zeile).toHaveClass('ant-typography-ellipsis');
  });
});

describe('Inspector Typ-Tag (LFH-276)', () => {
  beforeEach(() => {
    server.use(
      http.get('/api/einsaetze/:id/ort-vorschau', () =>
        HttpResponse.json({ peilung: null, ortsname: null }),
      ),
    );
  });

  it('zeigt für einen Personal-Marker den Typ-Tag „Personal" (nicht „Führungskraft")', () => {
    const fuehrungMarker = {
      schluessel: 'fuehrung-7',
      typ: 'fuehrung',
      id: 7,
      lat: 50.2,
      lon: 8.5,
      label: 'Zugführer',
      farbe: '#1677ff',
    } as KarteMarker;
    renderMitProviders(
      <Inspector
        einsatzId={1}
        marker={fuehrungMarker}
        darfSchreiben={false}
        onSchliessen={() => {}}
        onVerortungLoeschen={() => {}}
      />,
    );
    expect(screen.getByText('Personal')).toBeInTheDocument();
    expect(screen.queryByText('Führungskraft')).not.toBeInTheDocument();
  });
});

/**
 * Neuentwurf S5: der Inspector steht im Paneel „Ausgewählt" der rechten Leiste —
 * Symbol-Kachel, Mono-Unterzeile, Datenraster mit Augenbrauen, nur Felder mit Datenquelle.
 */
describe('Inspector im Paneel „Ausgewählt"', () => {
  const einheitMarker = {
    schluessel: 'einheit-1',
    typ: 'einheit',
    id: 1,
    lat: 51.1,
    lon: 4.1,
    label: 'Zug 1',
    farbe: '#555',
  } as KarteMarker;

  const roh = {
    einheiten: [
      {
        id: 1,
        name: 'Zug 1',
        typ_label: 'Zug',
        ist: { fuehrer: 1, unterfuehrer: 2, mannschaft: 9 },
        abschnitt_name: 'Nord',
        fuehrer_name: null,
        status: { quelle: 'ohne', verteilung: [] },
      },
    ],
    fahrzeuge: [],
    fuehrungskraefte: [],
    uhs: [],
    schaeden: [],
    abschnitte: [],
  } as never;

  beforeEach(() => {
    server.use(
      http.get('/api/einsaetze/:id/ort-vorschau', () =>
        HttpResponse.json({ peilung: null, ortsname: null }),
      ),
    );
  });

  it('zeigt Name, Unterzeile und das Datenraster aus den Rohdaten', () => {
    const { container } = renderMitProviders(
      <Inspector
        einsatzId={1}
        marker={einheitMarker}
        darfSchreiben={false}
        onSchliessen={() => {}}
        onVerortungLoeschen={() => {}}
        roh={roh}
      />,
    );
    expect(screen.getByRole('heading', { level: 3, name: 'Zug 1' })).toBeInTheDocument();
    expect(screen.getByText('Einheit · Zug')).toBeInTheDocument();
    const raster = container.querySelector('[data-lfh="auswahl-raster"]') as HTMLElement;
    expect(raster).toHaveTextContent('Stärke');
    expect(raster).toHaveTextContent('1/2/9//12');
    expect(raster).toHaveTextContent('Nord');
    // Status und „Seit" einer Einheit (LFH-609): ohne Status steht das auch so da, kein
    // erfundener Wert.
    expect(raster).toHaveTextContent('Status');
    expect(raster).toHaveTextContent('ohne Status');
    expect(raster).toHaveTextContent('Seit');
    // Ohne Rückmeldungen (lädt, 403, Historie) KEIN Block „Letzte Meldung" (LFH-610).
    expect(screen.queryByText(/Letzte Meldung/)).not.toBeInTheDocument();
    expect(container.querySelector('[data-lfh="auswahl-letzte-meldung"]')).toBeNull();
  });

  const rueckmeldung = (bezug_id: number) => ({
    bezug_id,
    meldung_id: 5,
    lfd_nr: 5,
    ereigniszeit: '2026-09-21 12:11:00',
    inhalt: 'Sickerstelle unverändert, Sandsackverbau hält.',
    meldeweg: 'funk' as const,
    faellig_at: '2026-09-21 13:11:00',
  });

  it('Einheit mit Rückmeldung: Block „Letzte Meldung" mit Text und „Zeit · Meldeweg" (LFH-610)', () => {
    const { container } = renderMitProviders(
      <Inspector
        einsatzId={1}
        marker={einheitMarker}
        darfSchreiben={false}
        onSchliessen={() => {}}
        onVerortungLoeschen={() => {}}
        roh={{
          ...(roh as AuswahlRoh),
          rueckmeldungen: { frist_min: 60, einheiten: [rueckmeldung(1)], abschnitte: [] },
        }}
      />,
    );
    const block = screen.getByRole('region', { name: 'Letzte Meldung' });
    expect(block).toHaveTextContent('Sickerstelle unverändert, Sandsackverbau hält.');
    // Zeit nach der Anzeigekonvention des Paneels (`formatZeitKurz`, taktisch `DDHHmm` bzw.
    // `HHmm`) — dieselbe wie „Disponiert" im Raster darüber.
    expect(block).toHaveTextContent(/\d{2}11 · Funk$/);
    // Neben dem Raster, nicht darin — das `dl` bleibt Feld-für-Feld.
    const raster = container.querySelector('[data-lfh="auswahl-raster"]') as HTMLElement;
    expect(raster).not.toContainElement(block);
  });

  it('Einheit ohne eigene Rückmeldung: kein Block, auch kein Platzhalter', () => {
    renderMitProviders(
      <Inspector
        einsatzId={1}
        marker={einheitMarker}
        darfSchreiben={false}
        onSchliessen={() => {}}
        onVerortungLoeschen={() => {}}
        roh={{
          ...(roh as AuswahlRoh),
          rueckmeldungen: { frist_min: 60, einheiten: [rueckmeldung(2)], abschnitte: [] },
        }}
      />,
    );
    expect(screen.queryByText(/Letzte Meldung/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Sickerstelle/)).not.toBeInTheDocument();
  });

  it('ohne Rohdaten kein Raster — nur Ort und Aktionen', () => {
    const { container } = renderMitProviders(
      <Inspector
        einsatzId={1}
        marker={einheitMarker}
        darfSchreiben={false}
        onSchliessen={() => {}}
        onVerortungLoeschen={() => {}}
      />,
    );
    expect(container.querySelector('[data-lfh="auswahl-raster"]')).toBeNull();
    expect(screen.getByText('Koordinate')).toBeInTheDocument();
  });

  it('der Deeplink trägt ↗ als Zeichen, der zugängliche Name bleibt die Handlung', () => {
    renderMitProviders(
      <Inspector
        einsatzId={1}
        marker={einheitMarker}
        darfSchreiben={false}
        onSchliessen={() => {}}
        onVerortungLoeschen={() => {}}
      />,
    );
    const link = screen.getByRole('link', { name: 'Im Fachmodul öffnen' });
    expect(link).toHaveTextContent('Im Fachmodul öffnen↗');
    expect(link.querySelector('.ant-btn')).toHaveClass('ant-btn-primary');
  });

  it('LFH-616: an der Einheit springt „ETB ↗" ins nach ihr gefilterte Tagebuch', () => {
    renderMitProviders(
      <Inspector
        einsatzId={1}
        marker={einheitMarker}
        darfSchreiben
        onSchliessen={() => {}}
        onVerortungLoeschen={() => {}}
      />,
    );
    const etb = screen.getByRole('link', {
      name: `Einsatztagebuch zu ${einheitMarker.label}`,
    });
    expect(etb).toHaveAttribute('href', `/einsaetze/1/etb?einheit_id=${einheitMarker.id}`);
    expect(etb).toHaveTextContent('ETB↗');
    // Sekundär: die Hauptaktion bleibt der Fachmodul-Sprung.
    expect(etb.querySelector('.ant-btn')).not.toHaveClass('ant-btn-primary');
    // Beide Sprünge stehen in EINER Zeile, der rote Knopf abgesetzt darunter.
    const zeile = etb.closest('[data-lfh="inspector-sprung"]');
    expect(zeile).toContainElement(screen.getByRole('link', { name: 'Im Fachmodul öffnen' }));
    expect(zeile).not.toContainElement(screen.getByRole('button', { name: 'Verortung löschen' }));
  });

  it('LFH-616: andere Marker bekommen keinen ETB-Sprung — der Filter kennt nur Einheiten', () => {
    renderMitProviders(
      <Inspector
        einsatzId={1}
        marker={{ ...einheitMarker, schluessel: 'schaden-1', typ: 'schaden' }}
        darfSchreiben
        onSchliessen={() => {}}
        onVerortungLoeschen={() => {}}
      />,
    );
    expect(screen.getByRole('link', { name: 'Im Fachmodul öffnen' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Einsatztagebuch/ })).not.toBeInTheDocument();
  });
});

describe('Inspector für Betroffene (LFH-648)', () => {
  beforeEach(() => {
    server.use(
      http.get('/api/einsaetze/:id/ort-vorschau', () =>
        HttpResponse.json({ peilung: null, ortsname: null }),
      ),
    );
  });

  // Der Marker stammt aus `personenMarker`: das Label trägt Registriernummer und Sichtung,
  // und der Inspector liest KEINE Personenliste — der Name kann also nirgends herkommen.
  const personMarker = {
    schluessel: 'person-11',
    typ: 'person',
    id: 11,
    lat: 50.05,
    lon: 8.55,
    label: 'R-042 · SK II',
    kurzzeichen: 'II',
    farbe: '#fadb14',
  } as KarteMarker;

  it('Titel ist „R-042 · SK II", die Unterzeile „Person", der Link die Detailseite', () => {
    renderMitProviders(
      <Inspector
        einsatzId={1}
        marker={personMarker}
        darfSchreiben={false}
        onSchliessen={() => {}}
        onVerortungLoeschen={() => {}}
      />,
    );
    expect(screen.getByText('R-042 · SK II')).toBeInTheDocument();
    expect(screen.getByText('Person')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Im Fachmodul öffnen' })).toHaveAttribute(
      'href',
      '/einsaetze/1/personen/11',
    );
  });

  it('mit Schreibrecht: „Verortung löschen" reicht den Personen-Marker durch', async () => {
    const geloescht: KarteMarker[] = [];
    renderMitProviders(
      <Inspector
        einsatzId={1}
        marker={personMarker}
        darfSchreiben
        onSchliessen={() => {}}
        onVerortungLoeschen={(m) => geloescht.push(m)}
      />,
    );
    screen.getByRole('button', { name: /Verortung löschen/ }).click();
    expect(geloescht.map((m) => m.schluessel)).toEqual(['person-11']);
  });
});
