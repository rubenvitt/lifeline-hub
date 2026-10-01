import { http, HttpResponse } from 'msw';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router';
import { meHandler, server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { setzeViewportBreite } from '../test/viewport';
import { einsatzKeys } from '../api/queryKeys';
import PersonalPage from './PersonalPage';
import type { EinsatzAnzeige } from '../api/types';
import { adminFixture, einsatzFixture } from '../test/fixtures';

const admin = adminFixture();

function einsatz(overrides: Partial<EinsatzAnzeige> = {}) {
  return einsatzFixture({ id: 7, ...overrides });
}

// Struktur-Listen für die Auflösung einheit_id/fahrzeug_id → Klartext-Label.
const einheiten = [
  {
    id: 3,
    name: 'Zugtrupp',
    abschnitt_id: null,
    ueber_einheit_id: null,
    typ_label: null,
    fuehrer_name: null,
    soll: null,
  },
];
const fahrzeuge = [
  {
    id: 8,
    funkrufname: 'Florian 1',
    kennzeichen: 'FW-1234',
    fahrzeugtyp: 'ELW',
    einheit_id: 3,
    status_kategorie: null,
    status_label: null,
  },
];

const disponiert = [
  {
    id: 10,
    einsatz_id: 7,
    personal_id: 5,
    ist_adhoc: false,
    name: 'Thomas Müller',
    funktion: 'Sanitäter, Gruppenführer',
    traegerorganisation: 'DRK',
    staerke_position: 'fuehrer',
    status_id: 2,
    status_label: 'alarmiert',
    status_kategorie: 'gebunden',
    status_farbe: null,
    bemerkung: null,
    disponiert_at: '2026-05-26 09:10:00',
    disponiert_von: 1,
    einheit_id: 3,
    fahrzeug_id: 8,
  },
];

function render(einsatzObj: ReturnType<typeof einsatz>, personalDaten: unknown[] = disponiert) {
  server.use(
    meHandler(admin),
    http.get('/api/einsaetze/7', () => HttpResponse.json(einsatzObj)),
    http.get('/api/einsaetze/7/personal', () => HttpResponse.json(personalDaten)),
    http.get('/api/einsaetze/7/einheiten', () => HttpResponse.json(einheiten)),
    http.get('/api/einsaetze/7/fahrzeuge', () => HttpResponse.json(fahrzeuge)),
    http.get('/api/personal-status', () =>
      HttpResponse.json([
        { id: 2, label: 'alarmiert', kategorie: 'gebunden', farbe: null, sortier: 20 },
        { id: 3, label: 'einsatzbereit', kategorie: 'verfuegbar', farbe: null, sortier: 30 },
      ]),
    ),
    http.get('/api/personal', () => HttpResponse.json([])), // Pool (nur_im_dienst)
  );
  return renderMitProviders(
    <Routes>
      <Route path="/einsaetze/:id/personal" element={<PersonalPage />} />
    </Routes>,
    { route: '/einsaetze/7/personal' },
  );
}

/**
 * Öffnet das Statusmenü einer Zeile und liefert das geöffnete Menü-Portal. antd lässt die Portale
 * geschlossener Dropdowns im Baum stehen, und ein verlassendes Portal bekommt in jsdom nie `hidden`
 * — deshalb über `pointerEvents` filtern.
 */
async function oeffneStatusmenue(zeile: HTMLElement, name: string): Promise<HTMLElement> {
  await userEvent.click(within(zeile).getByRole('button', { name: `Status von ${name} ändern` }));
  const offen = [...document.querySelectorAll<HTMLElement>('.ant-dropdown')].filter(
    (d) => !d.classList.contains('ant-dropdown-hidden') && d.style.pointerEvents !== 'none',
  );
  expect(offen).toHaveLength(1);
  const menue = offen[0].querySelector<HTMLElement>('[role="menu"]');
  if (!menue) throw new Error(`Statusmenü zu ${name} ließ sich nicht öffnen`);
  return menue;
}

describe('PersonalPage', () => {
  it('bedient den Status am Etikett, nicht über eines von zwei Auswahlfeldern der Zeile', async () => {
    /**
     * Die Zeile trägt genau ein `combobox`, die Stärke-Position; der Status ist ein Auslöser mit
     * Namen. Ein Positionsindex über mehrere Auswahlfelder träfe beim Umsortieren still das
     * falsche.
     */
    const { container } = render(einsatz());
    await screen.findByText('Thomas Müller');
    const zeile = container.querySelector('[data-row-key="10"]') as HTMLElement;

    expect(within(zeile).getAllByRole('combobox')).toHaveLength(1);
    expect(
      within(zeile).getByRole('button', { name: 'Status von Thomas Müller ändern' }),
    ).toBeInTheDocument();
  });

  /**
   * Der Weg zum Meldebild von der Pflegefläche. Geprüft wird das `href`: ein Inline-Pfad neben dem
   * Builder wäre sonst nicht zu unterscheiden.
   */
  it('verlinkt das Meldebild (vormals Kräfteübersicht) über der Tabelle', async () => {
    render(einsatz());
    const link = await screen.findByRole('link', { name: 'Meldebild' });
    expect(link).toHaveAttribute('href', '/einsaetze/7/kraefteuebersicht');
  });

  it('zeigt disponiertes Personal mit Funktion und Position', async () => {
    render(einsatz());
    expect(await screen.findByText('Thomas Müller')).toBeInTheDocument();
    expect(screen.getByText('Sanitäter, Gruppenführer')).toBeInTheDocument();
  });

  it('setzt den Status zeilengenau optimistisch und rollt eine Serverablehnung zurück', async () => {
    let freigeben: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      freigeben = resolve;
    });
    server.use(
      http.patch('/api/einsaetze/7/personal/10', async () => {
        await gate;
        return HttpResponse.json({ error: 'Status abgelehnt' }, { status: 409 });
      }),
    );
    const zweitePerson = { ...disponiert[0], id: 11, personal_id: 6, name: 'Erika Muster' };
    const { container, client } = render(einsatz(), [disponiert[0], zweitePerson]);
    await screen.findByText('Thomas Müller');
    const zeile = container.querySelector('[data-row-key="10"]') as HTMLElement;

    // Der Auslöser ist über seinen Namen eindeutig, auch neben dem Auswahlfeld der Stärke-Position.
    const menue = await oeffneStatusmenue(zeile, 'Thomas Müller');
    await userEvent.click(within(menue).getByRole('menuitem', { name: /einsatzbereit/ }));

    await waitFor(() => {
      expect(client.getQueryData<typeof disponiert>(einsatzKeys.personal(7))?.[0].status_id).toBe(
        3,
      );
    });
    // Der neue Wert steht vor der Server-Antwort in der Ansicht, nicht bloß im Cache.
    expect(zeile.textContent).toContain('einsatzbereit');
    expect(within(zeile).getByRole('button', { name: /Status von Thomas Müller/ })).toBeDisabled();
    expect(
      within(container.querySelector('[data-row-key="11"]') as HTMLElement).getByRole('button', {
        name: /Status von Erika Muster/,
      }),
    ).toBeDisabled();

    let refetchFreigeben: (() => void) | undefined;
    const refetchGate = new Promise<void>((resolve) => {
      refetchFreigeben = resolve;
    });
    server.use(
      http.get('/api/einsaetze/7/personal', async () => {
        await refetchGate;
        return HttpResponse.json([{ ...disponiert[0], name: 'Extern geändert' }, zweitePerson]);
      }),
    );
    act(() => {
      client.setQueryData<typeof disponiert>(einsatzKeys.personal(7), (aktuell) =>
        aktuell?.map((eintrag) =>
          eintrag.id === 10 ? { ...eintrag, name: 'Extern geändert' } : eintrag,
        ),
      );
    });

    await act(async () => {
      freigeben?.();
    });
    await waitFor(() => {
      const stand = client.getQueryData<typeof disponiert>(einsatzKeys.personal(7));
      expect(stand?.find((eintrag) => eintrag.id === 10)?.status_id).toBe(2);
      expect(stand?.find((eintrag) => eintrag.id === 10)?.name).toBe('Extern geändert');
    });
    await act(async () => {
      refetchFreigeben?.();
    });
  });

  it('hebt per ?personal=<id> die Zeile hervor (LFH-25 Inspector-Deeplink)', async () => {
    server.use(
      meHandler(admin),
      http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz())),
      http.get('/api/einsaetze/7/personal', () => HttpResponse.json(disponiert)),
      http.get('/api/einsaetze/7/einheiten', () => HttpResponse.json(einheiten)),
      http.get('/api/einsaetze/7/fahrzeuge', () => HttpResponse.json(fahrzeuge)),
      http.get('/api/personal-status', () =>
        HttpResponse.json([
          { id: 2, label: 'alarmiert', kategorie: 'gebunden', farbe: null, sortier: 20 },
        ]),
      ),
      http.get('/api/personal', () => HttpResponse.json([])),
    );
    const { container } = renderMitProviders(
      <Routes>
        <Route path="/einsaetze/:id/personal" element={<PersonalPage />} />
      </Routes>,
      { route: '/einsaetze/7/personal?personal=10' },
    );
    await screen.findByText('Thomas Müller');
    await waitFor(() =>
      expect(container.querySelector('[data-row-key="10"]')).toHaveClass('zeile-hervorgehoben'),
    );
  });

  it('auch im KARTENZWEIG trägt der Deeplink seine Hervorhebung — und springt zum Ziel', async () => {
    /**
     * Unter `md` rendert `Datensicht` Karten, ohne das `data-row-key` der Tabelle: Hervorhebung und
     * Sprung müssen an der Karte hängen.
     *
     * Die CSS-Regel selbst kann hier nicht fallen (`css: false`, jsdom rechnet kein Layout).
     * Geprüft wird: die Klasse sitzt auf der Karte, und der Sprung findet sein Ziel.
     */
    setzeViewportBreite(390);
    const gerufen: Element[] = [];
    const vorher = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element) {
      gerufen.push(this);
    };

    try {
      server.use(
        meHandler(admin),
        http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz())),
        http.get('/api/einsaetze/7/personal', () => HttpResponse.json(disponiert)),
        http.get('/api/einsaetze/7/einheiten', () => HttpResponse.json(einheiten)),
        http.get('/api/einsaetze/7/fahrzeuge', () => HttpResponse.json(fahrzeuge)),
        http.get('/api/personal-status', () =>
          HttpResponse.json([
            { id: 2, label: 'alarmiert', kategorie: 'gebunden', farbe: null, sortier: 20 },
          ]),
        ),
        http.get('/api/personal', () => HttpResponse.json([])),
      );
      const { container } = renderMitProviders(
        <Routes>
          <Route path="/einsaetze/:id/personal" element={<PersonalPage />} />
        </Routes>,
        { route: '/einsaetze/7/personal?personal=10' },
      );
      await screen.findByText('Thomas Müller');
      expect(
        container.querySelector('.ant-table'),
        'Gegenprobe: hier steht keine Tabelle',
      ).toBeNull();
      await waitFor(() =>
        expect(
          container.querySelector('[data-lfh="datensicht-karte"].zeile-hervorgehoben'),
        ).not.toBeNull(),
      );
      await waitFor(() => expect(gerufen).toHaveLength(1));
      expect(gerufen[0].getAttribute('data-lfh')).toBe('datensicht-karte');
    } finally {
      Element.prototype.scrollIntoView = vorher;
    }
  });

  it('Leitung im aktiven Einsatz sieht Dispositions-Aktionen', async () => {
    render(einsatz());
    await screen.findByText('Thomas Müller');
    expect(screen.getByRole('button', { name: 'Ad-hoc-Person' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Entfernen' })).toBeInTheDocument();
  });

  it('Beobachter / abgeschlossen: reine Ansicht', async () => {
    render(
      einsatz({
        status: 'abgeschlossen',
        abgeschlossen_at: '2026-05-26 12:00:00',
        meine_rolle: 'beobachter',
      }),
    );
    await screen.findByText('Thomas Müller');
    expect(screen.queryByRole('button', { name: 'Ad-hoc-Person' })).not.toBeInTheDocument();
    expect(screen.getByText(/abgeschlossen — nur Ansicht/)).toBeInTheDocument();
  });

  // Der Position-Select ist leerbar; Clear muss explizit null senden (nicht absent), sonst
  // verschluckt JSON.stringify das Feld und das Backend behält den Altwert.
  it('Position leeren sendet explizit null', async () => {
    let patchBody: unknown = 'NICHT_AUFGERUFEN';
    server.use(
      http.patch('/api/einsaetze/7/personal/10', async ({ request }) => {
        patchBody = await request.json();
        return HttpResponse.json({ ...disponiert[0], staerke_position: null });
      }),
    );
    const { container } = render(einsatz());
    await screen.findByText('Thomas Müller');

    /**
     * Auf die Zeile gescopt: die Werkzeugzeile von `Datensicht` steht in Dokumentordnung davor und
     * kann eigene Löschknöpfe tragen, sobald ein Filter einen Wert hält. Ungescopt hörte der Test
     * dann auf zu prüfen, ohne rot zu werden.
     */
    const clear = container.querySelector('[data-row-key="10"] .ant-select-clear');
    expect(clear, 'Position-Select muss allowClear haben').not.toBeNull();
    fireEvent.mouseDown(clear!);
    fireEvent.click(clear!);

    await waitFor(() => expect(patchBody).toEqual({ staerke_position: null }));
  });

  // Gegenrichtung zur Fahrzeugseite: je Kraft das zugeordnete Fahrzeug (Funkrufname/Kennzeichen) +
  // die Einheit, jeweils als Deeplink zur Modulseite.
  it('zeigt zugeordnetes Fahrzeug (Funkrufname/Kennzeichen) und Einheit je Kraft, verlinkt (LFH-139)', async () => {
    render(einsatz());
    await screen.findByText('Thomas Müller');

    const fahrzeugLink = screen.getByRole('link', { name: 'Florian 1 (FW-1234)' });
    expect(fahrzeugLink).toHaveAttribute('href', '/einsaetze/7/fahrzeuge?fahrzeug=8');

    const einheitLink = screen.getByRole('link', { name: 'Zugtrupp' });
    expect(einheitLink).toHaveAttribute('href', '/einsaetze/7/einheiten?einheit=3');
  });

  it('stellt nicht zugeordnete Kräfte in Fahrzeug- und Einheit-Spalte als „—" dar (LFH-139)', async () => {
    const unzugeordnet = [
      {
        id: 11,
        einsatz_id: 7,
        personal_id: 6,
        ist_adhoc: false,
        name: 'Erika Mustermann',
        funktion: 'Helferin',
        traegerorganisation: 'THW',
        staerke_position: 'mannschaft',
        status_id: 2,
        status_label: 'alarmiert',
        status_kategorie: 'gebunden',
        status_farbe: null,
        bemerkung: 'x',
        disponiert_at: '2026-05-26 09:10:00',
        disponiert_von: 1,
        einheit_id: null,
        fahrzeug_id: null,
      },
    ];
    const { container } = render(einsatz(), unzugeordnet);
    await screen.findByText('Erika Mustermann');

    // Auf die Zeile der unzugeordneten Kraft scopen (robust gegen andere Zeilen/Kopf).
    const zeile = container.querySelector('[data-row-key="11"]') as HTMLElement;
    expect(zeile).not.toBeNull();
    // Keine Fahrzeug-/Einheit-Deeplinks in dieser Zeile — und deshalb trägt `karte.titel` kein
    // `ziel`: das machte die Namenszelle zum Link und drehte diese Aussage still um.
    expect(within(zeile).queryByRole('link')).toBeNull();
    /**
     * ... und beide Spalten zeigen den „—"-Platzhalter, gezielt je Zelle: ein Zähler
     * `getAllByText('—')` bliebe grün, wenn der Strich in zwei anderen Spalten stünde.
     */
    expect(zelleNachKopf(container, zeile, 'Fahrzeug').textContent).toBe('—');
    expect(zelleNachKopf(container, zeile, 'Einheit').textContent).toBe('—');
  });

  // ── Datensicht ──

  const epGebunden = disponiert[0];
  const epVerfuegbar = {
    ...disponiert[0],
    id: 12,
    personal_id: 6,
    name: 'Zora Zebra',
    staerke_position: 'mannschaft',
    status_label: 'einsatzbereit',
    status_kategorie: 'verfuegbar',
    einheit_id: null,
    fahrzeug_id: null,
  };
  const zeilenFolge = (container: HTMLElement) =>
    [...container.querySelectorAll('tr.ant-table-row')].map((r) => r.getAttribute('data-row-key'));

  it('eingeschaltete Bemerkungsspalte trägt bei leerem Wert einen benannten Auslöser', async () => {
    /**
     * Leeres Bemerkungsfeld an der Personalseite. Zwei Hälften: die Spalte ist per Voreinstellung
     * abgewählt, also gibt es vorher keinen Auslöser — eine reine „ist da"-Prüfung bestünde auch
     * bei einem Platzhalter irgendwo sonst.
     *
     * Die Voreinstellung bleibt: schreibtragende Spalten bekommen kein `abBreite`, sie weichen nur
     * über die Voreinstellung. Der Zähler stimmt vorher wie nachher.
     */
    const { container } = render(einsatz());
    await screen.findByText('Thomas Müller');
    expect(
      screen.queryByRole('button', { name: 'Bemerkung zu Thomas Müller hinzufügen' }),
    ).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: /Spalten · 1 ausgeblendet/ }));
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Bemerkung' }));

    const zeile = container.querySelector('[data-row-key="10"]') as HTMLElement;
    expect(
      within(zeile).getByRole('button', { name: 'Bemerkung zu Thomas Müller hinzufügen' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ausgeblendet/ })).toBeNull();
  });

  it('der Spaltenschalter meldet die ausgeblendete Bemerkungsspalte als TEXT', async () => {
    /**
     * Kein Zähl-Abzeichen: ein antd-`Badge` mit `count` und ohne `color` rendert auf
     * `token.colorError` — Rot für einen Spaltenzähler bricht „Rot bedient nichts". Der Zähler
     * steht im zugänglichen Namen des Knopfes.
     */
    render(einsatz());
    await screen.findByText('Thomas Müller');
    expect(screen.getByRole('button', { name: /Spalten · 1 ausgeblendet/ })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Bemerkung' })).toBeNull();
    // Position ist schreibtragend und bleibt sichtbar — ohne `abBreite`, weil das Führungs-Tablet
    // (1024–1280 px) sie sonst genau dort verlöre, und es keine Detailroute als Ausweichort gibt.
    expect(screen.getByRole('columnheader', { name: 'Position' })).toBeInTheDocument();
  });

  it('gruppiert nach Statuskategorie, mit Zähler im Etikett', async () => {
    const { container } = render(einsatz(), [epGebunden, epVerfuegbar]);
    await screen.findByText('Thomas Müller');
    expect(screen.getByText('verfügbar · 1')).toBeInTheDocument();
    expect(screen.getByText('gebunden · 1')).toBeInTheDocument();
    // Die Gruppenachse führt: verfügbar (Zora) steht vor gebunden (Thomas) — weder Server- noch
    // Namensordnung.
    expect(zeilenFolge(container)).toEqual(['12', '10']);
  });

  it('ein Statuswechsel unter dem Cursor verschiebt die Zeile NICHT (Kriterium 12)', async () => {
    /**
     * Zwei Auswahlfelder in der Zeile (Position und Status). Geprüft mit dem Fokus im
     * Positions-Feld: die Schleuse hängt nur daran, dass der Fokus in der Sicht liegt.
     */
    const { container, client } = render(einsatz(), [epGebunden, epVerfuegbar]);
    await screen.findByText('Thomas Müller');
    const vorher = zeilenFolge(container);
    expect(vorher).toEqual(['12', '10']);

    const zeile = container.querySelector('[data-row-key="10"]') as HTMLElement;
    act(() => within(zeile).getAllByRole('combobox')[0].focus());
    const sicht = screen.getByRole('region', { name: 'Personal im Einsatz' });
    expect(sicht.contains(document.activeElement)).toBe(true);

    act(() => {
      client.setQueryData(einsatzKeys.personal(7), [
        { ...epGebunden, status_kategorie: 'verfuegbar', status_label: 'einsatzbereit' },
        epVerfuegbar,
      ]);
    });

    await waitFor(() => expect(screen.getByText('verfügbar · 2')).toBeInTheDocument());
    expect(zeilenFolge(container)).toEqual(vorher);
  });

  it('Gegenprobe: OHNE Fokus in der Sicht ordnet sich die Liste sofort neu', async () => {
    const { container, client } = render(einsatz(), [epGebunden, epVerfuegbar]);
    await screen.findByText('Thomas Müller');
    expect(zeilenFolge(container)).toEqual(['12', '10']);

    act(() => {
      client.setQueryData(einsatzKeys.personal(7), [
        { ...epGebunden, status_kategorie: 'verfuegbar', status_label: 'einsatzbereit' },
        epVerfuegbar,
      ]);
    });

    await waitFor(() => expect(zeilenFolge(container)).toEqual(['10', '12']));
  });

  describe('unter md', () => {
    it('steht keine Tabelle, sondern Karten — und genau EIN Zweig im Baum', async () => {
      setzeViewportBreite(390);
      const { container } = render(einsatz());
      expect(await screen.findByText('Thomas Müller')).toBeInTheDocument();
      expect(container.querySelector('.ant-table')).toBeNull();
      expect(container.querySelectorAll('[data-lfh="datensicht-karte"]')).toHaveLength(1);
      // Der Statusslot trägt ein Etikett mit Text, nicht das Auswahlfeld der Spalte — ein Select
      // mit Mindestbreite drückte eine 390-px-Karte breit.
      const karte = container.querySelector('[data-lfh="datensicht-karte"]') as HTMLElement;
      expect(within(karte).getByText('alarmiert')).toBeInTheDocument();
      expect(karte.querySelector('.ant-select')).toBeNull();
    });
  });

  it('Gegenprobe: ab md steht die Tabelle', async () => {
    const { container } = render(einsatz());
    await screen.findByText('Thomas Müller');
    expect(container.querySelector('.ant-table')).not.toBeNull();
    expect(container.querySelector('[data-lfh="datensicht-karte"]')).toBeNull();
  });
});

/**
 * Die Zelle einer Zeile über den Spaltenkopf, nicht über einen Positionsindex: eine neue oder
 * ausgeblendete Spalte verschöbe jeden Index lautlos.
 */
function zelleNachKopf(container: HTMLElement, zeile: HTMLElement, kopf: string): HTMLElement {
  const koepfe = [...container.querySelectorAll('th.ant-table-cell')].map((th) => th.textContent);
  const index = koepfe.indexOf(kopf);
  expect(
    index,
    `Spaltenkopf „${kopf}" nicht gefunden (gefunden: ${koepfe.join(', ')})`,
  ).toBeGreaterThanOrEqual(0);
  const zellen = zeile.querySelectorAll('td');
  expect(zellen.length, 'Zeile hat weniger Zellen als Spaltenköpfe').toBeGreaterThan(index);
  return zellen[index] as HTMLElement;
}

/**
 * Datenzustände der Personalseite. Drei Quellen fallen unabhängig aus: die **Dispositionsliste**
 * (tauscht die Datensicht gegen die Fehlermeldung), der **Statuskatalog** (Banner über der Tabelle)
 * und der **Stamm-Pool** (Ausfall im Auswahlfeld statt „Keine freien Personen").
 *
 * Je Zusicherung „X nicht im DOM" steht die Partnerzusicherung „X ist im DOM" mit gleichem Literal;
 * je Fall scheitert genau eine Query, damit „Erneut abrufen" eindeutig bleibt.
 */
describe('PersonalPage · Datenzustände', () => {
  const gruenerBoden = () => [
    meHandler(admin),
    http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz())),
    http.get('/api/einsaetze/7/personal', () => HttpResponse.json([])),
    http.get('/api/einsaetze/7/einheiten', () => HttpResponse.json(einheiten)),
    http.get('/api/einsaetze/7/fahrzeuge', () => HttpResponse.json(fahrzeuge)),
    http.get('/api/personal-status', () =>
      HttpResponse.json([
        { id: 2, label: 'alarmiert', kategorie: 'gebunden', farbe: null, sortier: 20 },
      ]),
    ),
    http.get('/api/personal', () => HttpResponse.json([])),
  ];

  function zeige(...abweichungen: ReturnType<typeof http.get>[]) {
    // Abweichung vorn: `server.use` reiht in Übergabereihenfolge ein, der erste Treffer gewinnt.
    server.use(...abweichungen, ...gruenerBoden());
    return renderMitProviders(
      <Routes>
        <Route path="/einsaetze/:id/personal" element={<PersonalPage />} />
      </Routes>,
      { route: '/einsaetze/7/personal' },
    );
  }

  it('gescheiterte Dispositionsliste: Fehler statt Leertext', async () => {
    zeige(http.get('/api/einsaetze/7/personal', () => new HttpResponse(null, { status: 500 })));
    expect(await screen.findByRole('button', { name: 'Erneut abrufen' })).toBeInTheDocument();
    expect(screen.queryByText('Noch kein Personal disponiert')).not.toBeInTheDocument();
  });

  it('leere Dispositionsliste: Leertext und KEIN Fehler', async () => {
    zeige();
    expect(await screen.findByText('Noch kein Personal disponiert')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Erneut abrufen' })).not.toBeInTheDocument();
  });

  /**
   * Veralteter Stand = `isError` mit Zeilen im Zwischenspeicher — nicht `isFetching`, nicht
   * `isStale`. Der Ablauf ist der echte: erst ein geglückter Abruf, dann eine gescheiterte
   * Aktualisierung; die Zeilen müssen stehen bleiben.
   *
   * Assertiert wird der Banner-Text, nicht der Knopf „Erneut abrufen": den tragen
   * `SeitenStandVeraltet`, `SeitenFehler` und das Statuskatalog-Banner.
   */
  it('meldet den veralteten Stand, wenn die Aktualisierung mit Zeilen im Cache scheitert', async () => {
    const { client } = zeige(
      http.get('/api/einsaetze/7/personal', () => HttpResponse.json(disponiert)),
    );
    await screen.findByText('Thomas Müller');

    server.use(
      http.get('/api/einsaetze/7/personal', () => new HttpResponse(null, { status: 500 })),
    );
    await client.refetchQueries({ queryKey: einsatzKeys.personal(7) });

    expect(
      await screen.findByText(/Angezeigter Stand konnte nicht aktualisiert werden/),
    ).toBeInTheDocument();
    // Die Zeile aus dem Zwischenspeicher bleibt stehen — der Fehler verdrängt sie nicht.
    expect(screen.getByText('Thomas Müller')).toBeInTheDocument();
    expect(
      screen.queryByText('Disponiertes Personal konnte nicht geladen werden'),
    ).not.toBeInTheDocument();
  });

  it('gescheiterter Statuskatalog: Banner über der Tabelle', async () => {
    zeige(http.get('/api/personal-status', () => new HttpResponse(null, { status: 500 })));
    expect(
      await screen.findByText(
        'Statuskatalog konnte nicht geladen werden — Statuswechsel derzeit nicht möglich',
      ),
    ).toBeInTheDocument();
  });

  it('Partnerhälfte: mit Statuskatalog steht kein Banner', async () => {
    zeige();
    await screen.findByText('Noch kein Personal disponiert');
    expect(
      screen.queryByText(
        'Statuskatalog konnte nicht geladen werden — Statuswechsel derzeit nicht möglich',
      ),
    ).not.toBeInTheDocument();
  });

  it('gescheiterter Stamm-Pool: das Auswahlfeld nennt den Ausfall statt „Keine freien Personen"', async () => {
    const { container } = zeige(
      http.get('/api/personal', () => new HttpResponse(null, { status: 500 })),
    );
    await screen.findByText('Noch kein Personal disponiert');
    await oeffnePersonalAuswahl(container, 'Person aus Pool disponieren …');
    expect(
      await screen.findByText('Personalliste konnte nicht geladen werden'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Keine freien Personen')).not.toBeInTheDocument();
  });

  it('Partnerhälfte: leerer Stamm-Pool behält „Keine freien Personen"', async () => {
    const { container } = zeige();
    await screen.findByText('Noch kein Personal disponiert');
    await oeffnePersonalAuswahl(container, 'Person aus Pool disponieren …');
    expect(await screen.findByText('Keine freien Personen')).toBeInTheDocument();
    expect(screen.queryByText('Personalliste konnte nicht geladen werden')).not.toBeInTheDocument();
  });

  // LFH-733, design.md D5: „Demo“ steht im Wortlaut, also findet die Suche es.
  it('Tippen von „Demo“ lässt nur die Demo-Personen in der Auswahl', async () => {
    const { container } = zeige(
      http.get('/api/personal', () =>
        HttpResponse.json([
          {
            id: 31,
            name: 'Berta Beispiel',
            personalnummer: 'DEMO-P-002',
            demo: true,
            qualifikationen: [],
          },
          { id: 32, name: 'Anton Echt', personalnummer: '4711', demo: false, qualifikationen: [] },
          {
            id: 33,
            name: 'Dora Demo-Frei',
            personalnummer: null,
            demo: false,
            qualifikationen: [],
          },
        ]),
      ),
    );
    await screen.findByText('Noch kein Personal disponiert');
    await oeffnePersonalAuswahl(container, 'Person aus Pool disponieren …');
    await screen.findByText('Anton Echt (4711)');
    expect(sichtbareOptionen()).toEqual([
      'Anton Echt (4711)',
      'Dora Demo-Frei',
      'Berta Beispiel (DEMO-P-002) · Demo',
    ]);
    const feld = [...container.querySelectorAll<HTMLElement>('.ant-select')].find((s) =>
      s.textContent?.includes('Person aus Pool disponieren …'),
    );
    await userEvent.type(within(feld!).getByRole('combobox'), '· Demo');
    await waitFor(() =>
      expect(sichtbareOptionen()).toEqual(['Berta Beispiel (DEMO-P-002) · Demo']),
    );
  });
});

/**
 * Ad-hoc-Disposition als Schnellerfassung. An der Bereitstellung wird eine Helferkette am Stück
 * aufgenommen — der Fall für den Serienmodus. Geprüft wird, was an dieser Maske verdrahtet ist:
 * Fokus, Enter, Serie, Wertübernahme. Die Hülle prüft `components/Erfassung.test.tsx`.
 */
describe('PersonalPage — Ad-hoc-Schnellerfassung', () => {
  /**
   * Immer im Dialog greifen: die Tabelle dahinter trägt eine sortierbare Spalte „Name" mit
   * `aria-label`, ein `getByLabelText('Name')` auf `screen` fände zwei Knoten.
   */
  const imDialog = () => within(screen.getByRole('dialog'));

  /** Öffnet den Ad-hoc-Dialog und sammelt die abgesetzten POST-Bodies. */
  async function oeffneAdhoc() {
    const gesendet: unknown[] = [];
    render(einsatz());
    server.use(
      http.post('/api/einsaetze/7/personal', async ({ request }) => {
        gesendet.push(await request.json());
        return HttpResponse.json({ ...disponiert[0], id: 99 });
      }),
    );
    await screen.findByText('Thomas Müller');
    await userEvent.click(screen.getByRole('button', { name: 'Ad-hoc-Person' }));
    await screen.findByRole('dialog');
    return gesendet;
  }

  it('öffnet mit Fokus im Namensfeld', async () => {
    await oeffneAdhoc();
    await waitFor(() => expect(document.activeElement).toBe(imDialog().getByLabelText('Name')));
  });

  it('Enter im Namensfeld disponiert und schliesst den Dialog', async () => {
    const gesendet = await oeffneAdhoc();
    await userEvent.type(imDialog().getByLabelText('Name'), 'Dr. Schmidt{Enter}');

    await waitFor(() => expect(gesendet).toHaveLength(1));
    expect(gesendet[0]).toMatchObject({ adhoc: { name: 'Dr. Schmidt' } });
    /**
     * `queryByRole('dialog')).toBeNull()` wäre nie grün: jsdom feuert kein
     * `transitionend`/`animationend`, und antds Modal räumt seinen Knoten erst am Ende der
     * Zoom-Bewegung ab. Beobachtbar ist der Verlassen-Zustand — er belegt, dass `onFertig`
     * geschlossen hat. (Der Serienlauf tut das nicht, siehe Gegenprobe darunter.)
     */
    await waitFor(() => expect(screen.getByRole('dialog')).toHaveClass('ant-zoom-leave'));
  });

  it('„Speichern und nächste" hält den Dialog offen, zählt mit und behält die Wiederholfelder', async () => {
    /**
     * Trägerorganisation und Stärke-Position gehören zur Kette, nicht zur Person — sie überleben
     * das Speichern, der Name nicht. Mit dem zurückkehrenden Fokus ist der zweite Datensatz reine
     * Namenseingabe.
     */
    const gesendet = await oeffneAdhoc();
    const nutzer = userEvent.setup();

    // Der Schalter steht per Vorgabe aus — ohne ihn gäbe es keine Übernahme.
    await nutzer.click(imDialog().getByRole('checkbox', { name: 'Werte behalten' }));
    await nutzer.type(imDialog().getByLabelText('Name'), 'Dr. Schmidt');
    await nutzer.type(imDialog().getByLabelText('Trägerorganisation'), 'KV Musterstadt');
    // Die zweite Übernahme läuft über `components/Select`, nicht über ein `<input>` — dass
    // `setFieldsValue` dort greift, ist der Prüfpunkt. Der Dialog trägt genau eine Combobox
    // (Stärke-Position).
    await nutzer.click(imDialog().getByRole('combobox'));
    // Klickbar ist `.ant-select-item-option-content`; der `role="option"`-Knoten ist nur das
    // a11y-Spiegelelement und reagiert nicht auf Klicks.
    await nutzer.click(
      await screen.findByText(
        (_, el) =>
          typeof el?.className === 'string' &&
          el.className.includes('ant-select-item-option-content') &&
          el.textContent === 'Führer',
      ),
    );
    await nutzer.click(imDialog().getByRole('button', { name: 'Speichern und nächste' }));

    await waitFor(() => expect(gesendet).toHaveLength(1));
    expect(gesendet[0]).toMatchObject({
      adhoc: {
        name: 'Dr. Schmidt',
        traegerorganisation: 'KV Musterstadt',
        staerke_position: 'fuehrer',
      },
    });

    // Offen geblieben, mit Zähler.
    expect(await imDialog().findByText('Erfasst: 1')).toBeInTheDocument();
    // Übernahme greift, der Name ist frei, der Fokus steht wieder im ersten Feld.
    await waitFor(() =>
      expect(imDialog().getByLabelText('Trägerorganisation')).toHaveValue('KV Musterstadt'),
    );
    expect(imDialog().getByLabelText('Name')).toHaveValue('');
    await waitFor(() => expect(document.activeElement).toBe(imDialog().getByLabelText('Name')));

    // Der zweite Datensatz ist reine Namenseingabe — Enter genügt. Der abgesetzte Rumpf ist der
    // stärkere Beleg: beide Wiederholfelder sind dabei, obwohl dazwischen zurückgesetzt wurde.
    await nutzer.type(imDialog().getByLabelText('Name'), 'Frau Meier{Enter}');
    await waitFor(() => expect(gesendet).toHaveLength(2));
    expect(gesendet[1]).toMatchObject({
      adhoc: {
        name: 'Frau Meier',
        traegerorganisation: 'KV Musterstadt',
        staerke_position: 'fuehrer',
      },
    });
  });

  it('ein abgelehntes Speichern lässt den Wortlaut stehen', async () => {
    // Ohne `mutateAsync` leerte die Hülle die Felder, obwohl nichts ankam.
    render(einsatz());
    server.use(
      http.post('/api/einsaetze/7/personal', () =>
        HttpResponse.json({ error: 'Name bereits disponiert' }, { status: 409 }),
      ),
    );
    await screen.findByText('Thomas Müller');
    await userEvent.click(screen.getByRole('button', { name: 'Ad-hoc-Person' }));
    await screen.findByRole('dialog');
    await userEvent.type(imDialog().getByLabelText('Name'), 'Dr. Schmidt{Enter}');

    await screen.findByText('Name bereits disponiert');
    // Gegenprobe zum Test oben: kein Verlassen-Zustand — der Dialog steht.
    expect(screen.getByRole('dialog')).not.toHaveClass('ant-zoom-leave');
    expect(imDialog().getByLabelText('Name')).toHaveValue('Dr. Schmidt');
  });
});

/**
 * Öffnet ein antd-Auswahlfeld über seinen Platzhaltertext. Nicht per Klick auf den Platzhalter:
 * dessen Knoten trägt `pointer-events: none`. Gegriffen wird die Combobox — der Knoten, den auch
 * die Tastatur fokussiert.
 */
/** Die Optionen eines geöffneten Auswahlfelds in Anzeigereihenfolge (LFH-733). */
function sichtbareOptionen(): string[] {
  return [...document.querySelectorAll<HTMLElement>('.ant-select-item-option-content')].map(
    (o) => o.textContent ?? '',
  );
}

async function oeffnePersonalAuswahl(container: HTMLElement, platzhalter: string) {
  const feld = [...container.querySelectorAll<HTMLElement>('.ant-select')].find((s) =>
    s.textContent?.includes(platzhalter),
  );
  expect(feld, `Auswahlfeld „${platzhalter}" nicht gefunden`).toBeTruthy();
  await userEvent.click(within(feld!).getByRole('combobox'));
}

describe('PersonalPage — Kräfte-Zeitachse (LFH-552)', () => {
  const zelleDerSpalte = (titel: string) => {
    const kopf = [...document.querySelectorAll('th')].map((t) => t.textContent);
    const i = kopf.indexOf(titel);
    expect(i).toBeGreaterThan(-1);
    const zeile = document.querySelector('[data-row-key="10"]') as HTMLElement;
    return zeile.querySelectorAll('td')[i] as HTMLElement;
  };

  it('ohne Ereignisse: „—" in Einsatzdauer und Ruhe, nie eine Zahl', async () => {
    setzeViewportBreite(1440);
    render(einsatz());
    await screen.findByText('Thomas Müller');
    await waitFor(() => expect(zelleDerSpalte('Einsatzdauer')).toHaveTextContent('—'));
    expect(zelleDerSpalte('Ruhe')).toHaveTextContent('—');
    expect(zelleDerSpalte('Einsatzdauer').textContent).not.toMatch(/\d/);
  });

  it('laufende Periode: Einsatzdauer steht, Ruhe fehlt', async () => {
    setzeViewportBreite(1440);
    const beginn = new Date(Date.now() - (2 * 60 + 5) * 60_000)
      .toISOString()
      .slice(0, 19)
      .replace('T', ' ');
    server.use(
      http.get('/api/einsaetze/7/personal/zeitachse', () =>
        HttpResponse.json([
          { personal_id: 10, perioden: [{ beginn_at: beginn, anker: 'alarmierung' }] },
        ]),
      ),
    );
    render(einsatz());
    await screen.findByText('Thomas Müller');
    await waitFor(() => expect(zelleDerSpalte('Einsatzdauer')).toHaveTextContent('2 h 05'));
    expect(zelleDerSpalte('Ruhe')).toHaveTextContent('—');
  });

  it('klappt die Zeitachse der Person inline auf', async () => {
    setzeViewportBreite(1440);
    render(einsatz());
    await screen.findByText('Thomas Müller');
    await userEvent.click(
      await screen.findByRole('button', { name: 'Zeitachse zu Thomas Müller' }),
    );
    expect(await screen.findByText(/Noch keine Ereignisse/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nachtragen' })).toBeEnabled();
  });
});
