import type { ReactElement } from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { offeneRueckfrage } from '../../test/rueckfrage';
import { renderMitProviders, neuerQueryClient } from '../../test/utils';
import { server } from '../../test/server';
import { renderSvg } from '@einsatzzeichen/core';
import { fachobjektZeichen } from '../../zeichen/fachobjektZeichen';
import Inspector from './Inspector';
import { KACHEL_SVG_OPTIONEN } from './markerIcons';
import type { KarteMarker } from './marker';
import type { AuswahlRoh } from './leistenDaten';
import { EinsatzAnzeigeProvider } from '../../anzeige/AnzeigeKonventionenContext';
import type { EinsatzEinstellungen } from '../../api/types';
import { freigabenFixture } from '../../test/fixtures';

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

  // Bewusst mit gesetztem `tz`: bei leerem Select wäre der Accessible Name auch dann sauber, wenn
  // die Beschriftung das Feld umschlösse.
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

  // „Im Fach-Modul öffnen" + „Verortung löschen" brauchen nebeneinander rund 300 px, der Innenraum
  // hat ~278 px, und `overflowY: 'auto'` der Karte zieht `overflow-x` mit — der zweite Knopf würde
  // abgeschnitten. Geprüft wird die Struktur, die den Überlauf unmöglich macht.
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

    // `size="middle"`: der rote Knopf steht nicht bündig unter einem neutralen.
    expect(loeschen.closest('.ant-space')).toHaveClass(
      'ant-space-vertical',
      'ant-space-gap-row-middle',
    );
    expect(loeschen).toHaveClass('ant-btn-block');
    // Der Anker ist inline — ohne `display: block` bliebe die Zeile schmal.
    expect(modulLink).toHaveStyle({ display: 'block' });
    expect(modulLink.querySelector('.ant-btn')).toHaveClass('ant-btn-block');
  });

  // Ohne Schreibrecht bleibt eine Aktion — deshalb kein Dreipunkt-Menü und kein direkter Knopf.
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
    // Die Kürzung rechnet der Browser (`-webkit-line-clamp`); belegbar ist in jsdom nur, dass sie
    // konfiguriert ist.
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
 * Der Inspector im Paneel „Ausgewählt": Symbol-Kachel, Mono-Unterzeile, Datenraster mit
 * Augenbrauen, nur Felder mit Datenquelle.
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
    // Status und „Seit" einer Einheit: ohne Status steht das auch so da, kein erfundener Wert.
    expect(raster).toHaveTextContent('Status');
    expect(raster).toHaveTextContent('ohne Status');
    expect(raster).toHaveTextContent('Seit');
    // Ohne Rückmeldungen (lädt, 403, Historie) kein Block „Letzte Meldung".
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
    // Zeit nach der Anzeigekonvention des Paneels (`formatZeitKurz`), wie „Disponiert" im Raster.
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

  it('LFH-888: gesperrtes Zielmodul — „Im Fachmodul öffnen" gesperrt mit Grund, ohne Link', async () => {
    server.use(
      http.get('/api/einsaetze/1/modul-freigaben', () =>
        HttpResponse.json(freigabenFixture({ personal: { zugriff: false } })),
      ),
    );
    renderMitProviders(
      <Inspector
        einsatzId={1}
        marker={{ ...einheitMarker, schluessel: 'fuehrung-3', typ: 'fuehrung', id: 3 }}
        darfSchreiben={false}
        onSchliessen={() => {}}
        onVerortungLoeschen={() => {}}
      />,
    );
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: 'Im Fachmodul öffnen' })).toBeNull(),
    );
    const knopf = screen.getByRole('button', { name: 'Im Fachmodul öffnen' });
    expect(knopf).toBeDisabled();
    expect(knopf).toHaveAttribute('title', 'Keine Berechtigung');
  });

  it('LFH-888: gesperrtes ETB — „ETB ↗" an der Einheit gesperrt mit Grund', async () => {
    server.use(
      http.get('/api/einsaetze/1/modul-freigaben', () =>
        HttpResponse.json(freigabenFixture({ etb: { zugriff: false } })),
      ),
    );
    renderMitProviders(
      <Inspector
        einsatzId={1}
        marker={einheitMarker}
        darfSchreiben={false}
        onSchliessen={() => {}}
        onVerortungLoeschen={() => {}}
      />,
    );
    const name = `Einsatztagebuch zu ${einheitMarker.label}`;
    await waitFor(() => expect(screen.queryByRole('link', { name })).toBeNull());
    const knopf = screen.getByRole('button', { name });
    expect(knopf).toBeDisabled();
    expect(knopf).toHaveAttribute('title', 'Keine Berechtigung');
    // Der Fachmodul-Sprung (Einheiten frei) bleibt ein Link.
    expect(screen.getByRole('link', { name: 'Im Fachmodul öffnen' })).toBeInTheDocument();
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

  // Der Marker stammt aus `personenMarker`: das Label trägt Registriernummer und Sichtung, der
  // Inspector liest keine Personenliste — ein Name kann nirgends herkommen.
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

/**
 * „Verortung löschen" ist nicht überall gleich destruktiv: ein Abschnitt steht nur mit Fläche auf
 * der Karte, sein Löschen schickt `flaeche_geojson: null` — unumkehrbar, also Rückfrage. Ein Punkt
 * lässt sich neu setzen, also keine. Deshalb als Paar getestet.
 */
describe('Inspector „Verortung löschen" — Rückfrage nur, wo sie unumkehrbar ist (LFH-710)', () => {
  beforeEach(() => {
    server.use(
      http.get('/api/einsaetze/:id/ort-vorschau', () =>
        HttpResponse.json({ peilung: null, ortsname: null }),
      ),
    );
  });

  const abschnitt = {
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
          [8, 50],
        ],
      ],
    },
  } as KarteMarker;

  function mit(m: KarteMarker) {
    const onVerortungLoeschen = vi.fn<(m: KarteMarker) => void>();
    renderMitProviders(
      <Inspector
        einsatzId={1}
        marker={m}
        darfSchreiben
        onSchliessen={() => {}}
        onVerortungLoeschen={onVerortungLoeschen}
      />,
    );
    return onVerortungLoeschen;
  }

  it('Abschnitt mit Fläche: erst die Rückfrage mit rotem OK, dann genau ein Löschen', async () => {
    const onVerortungLoeschen = mit(abschnitt);
    await userEvent.click(screen.getByRole('button', { name: 'Verortung löschen' }));

    const rueckfrage = await offeneRueckfrage();
    expect(onVerortungLoeschen).not.toHaveBeenCalled();
    expect(rueckfrage).toHaveTextContent('Fläche von „EA Nord“ löschen?');
    const ok = within(rueckfrage).getByRole('button', { name: 'Löschen' });
    expect(ok).toHaveClass('ant-btn-dangerous');

    await userEvent.click(within(rueckfrage).getByRole('button', { name: 'Abbrechen' }));
    expect(onVerortungLoeschen).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Verortung löschen' }));
    await userEvent.click(
      within(await offeneRueckfrage()).getByRole('button', { name: 'Löschen' }),
    );
    expect(onVerortungLoeschen).toHaveBeenCalledTimes(1);
    expect(onVerortungLoeschen).toHaveBeenCalledWith(abschnitt);
  });

  it('Punktverortung (UHS): löscht sofort, ohne Rückfrage', async () => {
    const onVerortungLoeschen = mit({ ...marker });
    await userEvent.click(screen.getByRole('button', { name: 'Verortung löschen' }));
    expect(onVerortungLoeschen).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.ant-popconfirm')).toBeNull();
  });
});

describe('Inspector Symbolkachel (LFH-835)', () => {
  beforeEach(() => {
    server.use(
      http.get('/api/einsaetze/:id/ort-vorschau', () =>
        HttpResponse.json({ peilung: null, ortsname: null }),
      ),
    );
  });

  function kachelMit(tz: KarteMarker['tz'], typ: KarteMarker['typ'] = 'einheit') {
    renderMitProviders(
      <Inspector
        einsatzId={1}
        marker={{ ...marker, schluessel: `${typ}-7`, typ, id: 7, tz }}
        darfSchreiben={false}
        onSchliessen={() => {}}
        onVerortungLoeschen={() => {}}
      />,
    );
    return document.querySelector<HTMLElement>('[data-lfh="auswahl-kachel"]')!;
  }

  it('zeigt für ein Fachobjekt das Zeichen nach @einsatzzeichen', () => {
    const tz = { grundzeichen: 'taktische-formation', organisation: 'thw' } as const;
    const bild = kachelMit(tz).querySelector('img');
    expect(bild).not.toBeNull();
    const svg = decodeURIComponent(bild!.src.replace(/^data:image\/svg\+xml;charset=utf-8,/, ''));
    expect(svg).toBe(renderSvg(fachobjektZeichen(tz)!.drawing, KACHEL_SVG_OPTIONEN));
  });

  it('zeigt bei nicht darstellbarem Zeichen das Kürzel statt abzustürzen', () => {
    const kachel = kachelMit({ grundzeichen: 'gibt-es-nicht' as 'person' });
    expect(kachel.querySelector('img')).toBeNull();
    expect(kachel).toHaveTextContent('TZ');
  });
});
