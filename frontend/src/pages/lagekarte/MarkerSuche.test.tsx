import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import MarkerSuche from './MarkerSuche';
import { suchbareMarker } from './objektsuche';
import { OBJEKTART } from './leistenDaten';
import type { KarteMarker, MarkerTyp } from './marker';

function marker(typ: MarkerTyp, id: number, label: string): KarteMarker {
  return { schluessel: `${typ}-${id}`, typ, id, lat: 50.1, lon: 8.6, label, farbe: '#333333' };
}

function zeige(props: Partial<React.ComponentProps<typeof MarkerSuche>> = {}) {
  const alle = {
    marker: [marker('uhs', 1, 'BHP Nord'), marker('schaden', 2, 'S-007')],
    onMarkerWaehlen: vi.fn(),
    ...props,
  };
  // MemoryRouter, weil der Leerzustand (`SeitenLeer`) `useNavigate` liest.
  render(
    <MemoryRouter>
      <MarkerSuche {...alle} />
    </MemoryRouter>,
  );
  return alle;
}

const suchfeld = () => screen.getByLabelText('Kartenobjekte suchen');

describe('MarkerSuche (LFH-716)', () => {
  it('zeigt Objektart und Trefferzahl in der Kopfzeile als EINEN Textknoten', () => {
    zeige({ marker: [marker('uhs', 1, 'BHP Nord'), marker('uhs', 2, 'BHP Süd')] });
    expect(screen.getByText(`${OBJEKTART.uhs} (2)`)).toBeInTheDocument();
  });

  it('setzt je Gruppe eine Überschrift unter dem Paneelkopf (h2 → h3) und benennt die Liste (LFH-470)', () => {
    zeige({
      marker: [
        marker('uhs', 1, 'BHP Nord'),
        marker('schaden', 2, 'S-007'),
        marker('uhs', 3, 'BHP Süd'),
      ],
    });
    const koepfe = screen.getAllByRole('heading');
    expect(koepfe.map((k) => k.textContent)).toEqual([
      `${OBJEKTART.uhs} (2)`,
      `${OBJEKTART.schaden} (1)`,
    ]);
    for (const kopf of koepfe) expect(kopf.tagName).toBe('H3');
    expect(screen.getByRole('list', { name: `${OBJEKTART.uhs} (2)` })).toBeVisible();
  });

  it('meldet den Schlüssel des angeklickten Eintrags', async () => {
    const props = zeige();
    await userEvent.click(screen.getByRole('button', { name: 'BHP Nord' }));
    expect(props.onMarkerWaehlen).toHaveBeenCalledWith('uhs-1');
  });

  it('grenzt über alle Objektarten ein', async () => {
    zeige({
      marker: [
        marker('einheit', 1, 'Florian Nord 1'),
        marker('schaden', 2, 'Keller Nordstraße'),
        marker('uhs', 3, 'UHS Süd'),
      ],
    });
    await userEvent.type(suchfeld(), 'nord');
    expect(screen.getByRole('button', { name: 'Florian Nord 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keller Nordstraße' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'UHS Süd' })).toBeNull();
  });

  it('trägt den Trefflächenboden am Eintrag (zwei Angaben: Höhe und Polsterung)', () => {
    zeige();
    const eintrag = screen.getByRole('button', { name: 'BHP Nord' });
    expect(eintrag.style.minHeight).not.toBe('');
    expect(eintrag.style.padding).not.toBe('');
  });

  it('bleibt trotz des Löschknopfes von `allowClear` eindeutig greifbar', async () => {
    zeige();
    await userEvent.type(suchfeld(), 'BHP');
    expect(suchfeld().tagName).toBe('INPUT');
    expect(suchfeld()).toHaveValue('BHP');
  });

  it('zeigt bei einer Suche ohne Treffer EINEN Leerzustand mit dem Suchbegriff', async () => {
    zeige();
    await userEvent.type(suchfeld(), 'Kranwagen');
    expect(screen.getByText('Kein Kartenobjekt zu „Kranwagen“')).toBeInTheDocument();
    // Sonst bliebe der Test grün, auch wenn leere Gruppen je einen eigenen Leerkasten behielten.
    expect(screen.queryByText('Keine Daten')).toBeNull();
    expect(screen.queryByRole('button', { name: 'BHP Nord' })).toBeNull();
  });

  it('zeigt ohne jeden Marker ebenfalls nur EINEN Leerzustand, ohne Suchbegriff', () => {
    zeige({ marker: [] });
    expect(screen.getByText('Nichts verortet')).toBeInTheDocument();
    expect(screen.queryByText('Keine Daten')).toBeNull();
  });

  it('behauptet im Fehlerfall gar keine Leere — auch nicht mit Suchbegriff', async () => {
    zeige({ marker: [], zaehlerUnbekannt: true });
    expect(screen.queryByText('Nichts verortet')).toBeNull();
    expect(screen.getByText(/nicht vollständig geladen/)).toBeInTheDocument();
    await userEvent.type(suchfeld(), 'Kranwagen');
    expect(screen.queryByText(/Kein Kartenobjekt zu/)).toBeNull();
    expect(screen.getByText(/nicht vollständig geladen/)).toBeInTheDocument();
  });

  it('behauptet bei Treffern keinen Leerzustand', () => {
    zeige();
    expect(screen.queryByText(/Kein Kartenobjekt/)).toBeNull();
    expect(screen.queryByText('Nichts verortet')).toBeNull();
  });

  it('setzt im Fehlerfall einen Gedankenstrich statt einer Zahl', () => {
    zeige({ marker: [marker('uhs', 1, 'BHP Nord')], zaehlerUnbekannt: true });
    expect(screen.getByText(`${OBJEKTART.uhs} (—)`)).toBeInTheDocument();
  });
});

/**
 * Dieselben Daten einmal mit und einmal ohne Modulrecht, durch dieselbe Quelle wie die Leiste —
 * kein Name aus gesperrten Modulen.
 */
describe('MarkerSuche — kein Name aus gesperrten Modulen (LFH-716)', () => {
  const verortet = [marker('uhs', 1, 'UHS Süd'), marker('betreuungsstelle', 2, 'Turnhalle Mitte')];
  const personen = [marker('person', 3, 'Müller, Anna')];

  it('mit Recht auf Betreuung und Betroffene: beide Namen sind auffindbar', async () => {
    zeige({
      marker: suchbareMarker({
        verortet,
        personen,
        personenZugriff: 'frei',
        personenEbeneAn: true,
        betreuungZugriff: 'frei',
      }),
    });
    expect(screen.getByRole('button', { name: 'Turnhalle Mitte' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Müller, Anna' })).toBeInTheDocument();
    await userEvent.type(suchfeld(), 'turnhalle');
    expect(screen.getByRole('button', { name: 'Turnhalle Mitte' })).toBeInTheDocument();
  });

  it('ohne Recht: weder als Eintrag noch als Treffer eines passenden Begriffs', async () => {
    zeige({
      marker: suchbareMarker({
        verortet,
        personen,
        personenZugriff: 'gesperrt',
        personenEbeneAn: true,
        betreuungZugriff: 'gesperrt',
      }),
    });
    expect(screen.queryByText('Turnhalle Mitte')).toBeNull();
    expect(screen.queryByText('Müller, Anna')).toBeNull();
    expect(screen.queryByText(`${OBJEKTART.betreuungsstelle} (1)`)).toBeNull();
    await userEvent.type(suchfeld(), 'turnhalle');
    expect(screen.queryByText('Turnhalle Mitte')).toBeNull();
    expect(screen.getByText('Kein Kartenobjekt zu „turnhalle“')).toBeInTheDocument();
  });
});
