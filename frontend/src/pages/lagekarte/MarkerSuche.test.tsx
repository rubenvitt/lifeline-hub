import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import MarkerSuche from './MarkerSuche';
import { objektEintraege, suchbareMarker, type ObjektEintrag } from './objektsuche';
import { OBJEKT_KLAPP_SCHLUESSEL } from './leistenWahl';
import type { KarteMarker, MarkerTyp } from './marker';

function marker(typ: MarkerTyp, id: number, label: string): KarteMarker {
  return { schluessel: `${typ}-${id}`, typ, id, lat: 50.1, lon: 8.6, label, farbe: '#333333' };
}

function eintrag(typ: MarkerTyp, id: number, label: string, verortet = true): ObjektEintrag {
  return {
    schluessel: typ === 'einsatzort' ? 'einsatzort' : `${typ}-${id}`,
    typ,
    id,
    label,
    verortet,
  };
}

function zeige(props: Partial<React.ComponentProps<typeof MarkerSuche>> = {}) {
  const alle = {
    eintraege: [eintrag('uhs', 1, 'BHP Nord'), eintrag('schaden', 2, 'S-007')],
    onMarkerWaehlen: vi.fn(),
    ...props,
  };
  // MemoryRouter, weil der Leerzustand (`SeitenLeer`) `useNavigate` liest.
  const r = render(
    <MemoryRouter>
      <MarkerSuche {...alle} />
    </MemoryRouter>,
  );
  return { ...alle, unmount: r.unmount };
}

const suchfeld = () => screen.getByLabelText('Kartenobjekte suchen');
const gruppenKopf = (name: RegExp) => screen.getByRole('button', { name });
const gruppenKoepfe = () =>
  screen
    .getAllByRole('heading', { level: 2 })
    .map((h) => h.textContent?.replace(/\s+/g, ' ').trim());

beforeEach(() => {
  localStorage.clear();
});

describe('MarkerSuche — eine Objektliste (LLH-1033)', () => {
  it('ordnet die Gruppen fest, zählt verortet/gesamt und hält sie ohne Begriff zu', () => {
    zeige({
      eintraege: [
        eintrag('schaden', 1, 'S-007'),
        eintrag('einheit', 2, 'Florian 1'),
        eintrag('einheit', 3, 'Florian 2', false),
        eintrag('uhs', 4, 'BHP Nord'),
      ],
    });
    expect(gruppenKoepfe()).toEqual(['Einheiten 1/2', 'UHS 1/1', 'Schäden 1/1']);
    for (const kopf of screen.getAllByRole('button', { expanded: false }))
      expect(kopf).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: 'Florian 1' })).toBeNull();
  });

  it('Arten, die nur verortet in der Liste stehen, zählen ohne „/gesamt“', () => {
    zeige({ eintraege: [eintrag('person', 1, 'Müller, Anna'), eintrag('lagemeldung', 2, 'LM 1')] });
    expect(gruppenKoepfe()).toEqual(['Lagemeldungen 1', 'Betroffene 1']);
  });

  it('merkt den Klappzustand je Gerät, ohne Begriff', async () => {
    const erst = zeige();
    await userEvent.click(gruppenKopf(/^UHS/));
    expect(screen.getByRole('button', { name: 'BHP Nord' })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(OBJEKT_KLAPP_SCHLUESSEL) ?? '{}')).toEqual({
      uhs: true,
    });
    erst.unmount();
    zeige();
    expect(screen.getByRole('button', { name: 'BHP Nord' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'S-007' })).toBeNull();
  });

  it('der Einsatzort ist die erste Zeile, kein Gruppenkopf', () => {
    zeige({
      eintraege: [eintrag('uhs', 1, 'BHP Nord'), eintrag('einsatzort', 0, 'Hauptstraße 1')],
    });
    const zeile = screen.getByRole('button', { name: /^Einsatzort/ });
    expect(zeile).toHaveTextContent('Hauptstraße 1');
    expect(gruppenKoepfe()).toEqual(['UHS 1/1']);
    expect(
      zeile.compareDocumentPosition(gruppenKopf(/^UHS/)) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('meldet den Schlüssel einer verorteten Zeile', async () => {
    const props = zeige();
    await userEvent.click(gruppenKopf(/^UHS/));
    await userEvent.click(screen.getByRole('button', { name: 'BHP Nord' }));
    expect(props.onMarkerWaehlen).toHaveBeenCalledWith('uhs-1');
  });

  it('eine nicht verortete Zeile ist kein Auswahlziel und sagt ohne Aktion „nicht verortet“', async () => {
    zeige({ eintraege: [eintrag('uhs', 1, 'BHP Süd', false)] });
    await userEvent.click(gruppenKopf(/^UHS/));
    expect(screen.queryByRole('button', { name: 'BHP Süd' })).toBeNull();
    expect(screen.getByText('BHP Süd')).toBeInTheDocument();
    expect(screen.getByText('nicht verortet')).toBeInTheDocument();
  });

  it('ein Abschnitt ohne Fläche ist wählbar und trägt daneben seine Aktion', async () => {
    const props = zeige({
      eintraege: [eintrag('abschnitt', 5, 'EA Süd', false)],
      zeilenAktion: () => <button type="button">Fläche zeichnen</button>,
    });
    await userEvent.click(gruppenKopf(/^Abschnitte/));
    await userEvent.click(screen.getByRole('button', { name: 'EA Süd' }));
    expect(props.onMarkerWaehlen).toHaveBeenCalledWith('abschnitt-5');
    expect(screen.getByRole('button', { name: 'Fläche zeichnen' })).toBeInTheDocument();
  });

  it('trägt den Trefflächenboden an der Zeile (Höhe und Polsterung)', async () => {
    zeige();
    await userEvent.click(gruppenKopf(/^UHS/));
    const zeile = screen.getByRole('button', { name: 'BHP Nord' });
    expect(zeile.style.minHeight).not.toBe('');
    expect(zeile.style.padding).not.toBe('');
  });
});

describe('MarkerSuche — Suche', () => {
  it('grenzt über alle Arten ein und öffnet die Gruppen mit Treffern', async () => {
    zeige({
      eintraege: [
        eintrag('einheit', 1, 'Florian Nord 1'),
        eintrag('schaden', 2, 'Keller Nordstraße'),
        eintrag('uhs', 3, 'UHS Süd'),
      ],
    });
    await userEvent.type(suchfeld(), 'nord');
    expect(screen.getByRole('button', { name: 'Florian Nord 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keller Nordstraße' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'UHS Süd' })).toBeNull();
    // Der Begriff schreibt den gemerkten Klappzustand nicht.
    expect(localStorage.getItem(OBJEKT_KLAPP_SCHLUESSEL)).toBeNull();
  });

  it('findet über den Gruppennamen und ordnet nach Trefferzahl', async () => {
    zeige({
      eintraege: [
        eintrag('einheit', 1, 'Florian 1'),
        eintrag('fahrzeug', 2, 'Florian 1/44-1'),
        eintrag('fahrzeug', 3, 'Florian 1/10-1'),
      ],
    });
    await userEvent.type(suchfeld(), 'florian');
    expect(gruppenKoepfe()).toEqual(['Fahrzeuge 2/2', 'Einheiten 1/1']);
    await userEvent.clear(suchfeld());
    await userEvent.type(suchfeld(), 'fahrzeuge');
    expect(gruppenKoepfe()).toEqual(['Fahrzeuge 2/2']);
  });

  it('nach dem Leeren gilt wieder der gemerkte Klappzustand', async () => {
    zeige();
    await userEvent.type(suchfeld(), 'BHP');
    expect(screen.getByRole('button', { name: 'BHP Nord' })).toBeInTheDocument();
    await userEvent.clear(suchfeld());
    expect(screen.queryByRole('button', { name: 'BHP Nord' })).toBeNull();
  });

  it('bleibt trotz des Löschknopfes von `allowClear` eindeutig greifbar', async () => {
    zeige();
    await userEvent.type(suchfeld(), 'BHP');
    expect(suchfeld().tagName).toBe('INPUT');
    expect(suchfeld()).toHaveValue('BHP');
  });
});

describe('MarkerSuche — Marke „Nicht verortet“', () => {
  const gemischt = [
    eintrag('uhs', 1, 'BHP Nord'),
    eintrag('uhs', 2, 'BHP Süd', false),
    eintrag('einsatzort', 0, 'Einsatzort', false),
  ];

  it('zählt die nicht verorteten samt Einsatzort und filtert auf Druck', async () => {
    zeige({ eintraege: gemischt });
    const marke = screen.getByRole('button', { name: 'Nicht verortet' });
    expect(marke).toHaveAttribute('aria-pressed', 'false');
    expect(marke).toHaveTextContent('Nicht verortet2');
    expect(marke).toHaveAccessibleDescription('2');
    await userEvent.click(marke);
    expect(marke).toHaveAttribute('aria-pressed', 'true');
    expect(gruppenKoepfe()).toEqual(['UHS 0/1']);
    expect(screen.getByText('BHP Süd')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'BHP Nord' })).toBeNull();
    expect(screen.getByText('Einsatzort')).toBeInTheDocument();
  });

  it('sagt bei null „Alles verortet“ statt eines Knopfes', () => {
    zeige({ eintraege: [eintrag('uhs', 1, 'BHP Nord')] });
    expect(screen.queryByRole('button', { name: 'Nicht verortet' })).toBeNull();
    expect(screen.getByText('Alles verortet')).toBeInTheDocument();
  });

  it('das laufende Ziel bleibt bei Filter und Begriff stehen, seine Gruppe offen', async () => {
    zeige({
      eintraege: [eintrag('uhs', 1, 'BHP Nord'), eintrag('uhs', 2, 'BHP Süd', false)],
      angeheftet: 'uhs-2',
      zeilenAktion: (e) => (e.schluessel === 'uhs-2' ? <span>wird platziert</span> : null),
    });
    expect(screen.getByText('wird platziert')).toBeInTheDocument();
    await userEvent.type(suchfeld(), 'Nord');
    expect(screen.getByText('BHP Süd')).toBeInTheDocument();
    expect(screen.getByText('wird platziert')).toBeInTheDocument();
  });
});

describe('MarkerSuche — Leere und Fehler', () => {
  it('zeigt bei einer Suche ohne Treffer EINEN Leerzustand mit dem Suchbegriff', async () => {
    zeige();
    await userEvent.type(suchfeld(), 'Kranwagen');
    expect(screen.getByText('Kein Kartenobjekt zu „Kranwagen“')).toBeInTheDocument();
    expect(screen.queryByText('Keine Daten')).toBeNull();
  });

  it('ohne jedes Objekt: „Keine Kartenobjekte“, ohne Anleitung (LFH-1078)', () => {
    zeige({ eintraege: [] });
    expect(screen.getByText('Keine Kartenobjekte')).toBeInTheDocument();
    expect(screen.queryByText('Keine Daten')).toBeNull();
    expect(screen.queryByText(/sobald sie|Suchbegriff kürzen/)).toBeNull();
  });

  it('behauptet bei Treffern keinen Leerzustand', () => {
    zeige();
    expect(screen.queryByText(/Kein Kartenobjekt|Keine Kartenobjekte/)).toBeNull();
  });

  it('bei ausgefallener Lagebild-Quelle: Fehler oben, „—“ in Köpfen und Marke, keine Leere', async () => {
    zeige({
      eintraege: [eintrag('uhs', 1, 'BHP Nord'), eintrag('uhs', 2, 'BHP Süd', false)],
      fehler: { text: 'Objektlisten konnten nicht geladen werden', onWiederholen: vi.fn() },
    });
    expect(gruppenKoepfe()).toEqual(['UHS —/—']);
    expect(screen.getByRole('button', { name: 'Nicht verortet' })).toHaveTextContent('—');
    await userEvent.type(suchfeld(), 'Kranwagen');
    expect(screen.queryByText(/Kein Kartenobjekt zu/)).toBeNull();
  });

  it('ohne Zeilen steht der Fehler-Slot statt einer Leere', () => {
    zeige({
      eintraege: [],
      fehler: { text: 'Objektlisten konnten nicht geladen werden', onWiederholen: vi.fn() },
    });
    expect(screen.getByText('Objektlisten konnten nicht geladen werden')).toBeInTheDocument();
    expect(screen.queryByText('Keine Kartenobjekte')).toBeNull();
  });

  it('fällt nur die Personenliste aus, tragen die Köpfe „—“, die Marke bleibt', () => {
    zeige({
      eintraege: [eintrag('uhs', 1, 'BHP Nord'), eintrag('person', 2, 'Müller, Anna')],
      zaehlerUnbekannt: true,
    });
    expect(gruppenKoepfe()).toEqual(['UHS —/—', 'Betroffene —']);
    expect(screen.getByText('Alles verortet')).toBeInTheDocument();
  });

  it('leer bei ausgefallener Personenliste: sagt, dass nicht alles geladen ist', () => {
    zeige({ eintraege: [], zaehlerUnbekannt: true });
    expect(
      screen.getByText('Objekte konnten nicht vollständig geladen werden'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Keine Kartenobjekte')).toBeNull();
  });
});

/**
 * Dieselben Daten einmal mit und einmal ohne Modulrecht, durch dieselbe Quelle wie die Leiste —
 * kein Name aus gesperrten Modulen, verortet oder nicht.
 */
describe('MarkerSuche — kein Name aus gesperrten Modulen (LFH-716)', () => {
  const verortet = [marker('uhs', 1, 'UHS Süd'), marker('betreuungsstelle', 2, 'Turnhalle Mitte')];
  const personen = [marker('person', 3, 'Müller, Anna')];
  const nichtVerortet = [{ typ: 'tier' as const, id: 4, label: 'Hund Bello' }];
  const eintraege = (zugriff: 'frei' | 'gesperrt') =>
    objektEintraege({
      suchbar: suchbareMarker({
        verortet,
        personen,
        personenZugriff: zugriff,
        personenEbeneAn: true,
        betreuungZugriff: zugriff,
        brZugriff: zugriff,
        tierZugriff: zugriff,
      }),
      nichtVerortet,
      einsatzortOhneOrt: false,
      betreuungZugriff: zugriff,
      brZugriff: zugriff,
      tierZugriff: zugriff,
    });

  it('mit Recht: alle Namen sind auffindbar', async () => {
    zeige({ eintraege: eintraege('frei') });
    await userEvent.type(suchfeld(), 'e');
    expect(screen.getByRole('button', { name: 'Turnhalle Mitte' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Müller, Anna' })).toBeInTheDocument();
    expect(screen.getByText('Hund Bello')).toBeInTheDocument();
  });

  it('ohne Recht: weder als Eintrag noch als Treffer eines passenden Begriffs', async () => {
    zeige({ eintraege: eintraege('gesperrt') });
    expect(gruppenKoepfe()).toEqual(['UHS 1/1']);
    await userEvent.type(suchfeld(), 'turnhalle');
    expect(screen.queryByText('Turnhalle Mitte')).toBeNull();
    expect(screen.getByText('Kein Kartenobjekt zu „turnhalle“')).toBeInTheDocument();
    await userEvent.clear(suchfeld());
    await userEvent.type(suchfeld(), 'bello');
    expect(screen.queryByText('Hund Bello')).toBeNull();
  });
});
