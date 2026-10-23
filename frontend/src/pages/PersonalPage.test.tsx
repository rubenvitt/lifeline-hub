import { http, HttpResponse } from 'msw';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Route, Routes, useLocation } from 'react-router';
import { meHandler, server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { setzeViewportBreite } from '../test/viewport';
import { einsatzKeys } from '../api/queryKeys';
import PersonalPage from './PersonalPage';
import type { EinsatzAnzeige } from '../api/types';
import { adminFixture, einsatzFixture, freigabenFixture } from '../test/fixtures';
import { oeffne, optionenVon, waehle } from '../test/auswahlListe';
import { kopfFilterWaehlen } from '../test/kopfFilter';

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
    fuehrer_id: null as number | null,
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

function render(
  einsatzObj: ReturnType<typeof einsatz>,
  personalDaten: unknown[] = disponiert,
  entlasseneDaten: unknown[] = [],
  einheitenDaten: unknown[] = einheiten,
  route = '/einsaetze/7/personal',
) {
  server.use(
    meHandler(admin),
    http.get('/api/einsaetze/7', () => HttpResponse.json(einsatzObj)),
    // Aktive und entlassene Kräfte teilen den Pfad (LLH-1079, `?entlassene=1`).
    http.get('/api/einsaetze/7/personal', ({ request }) =>
      HttpResponse.json(
        new URL(request.url).searchParams.has('entlassene') ? entlasseneDaten : personalDaten,
      ),
    ),
    http.get('/api/einsaetze/7/einheiten', () => HttpResponse.json(einheitenDaten)),
    http.get('/api/einsaetze/7/fahrzeuge', () => HttpResponse.json(fahrzeuge)),
    http.get('/api/personal-status', () =>
      HttpResponse.json([
        { id: 2, label: 'alarmiert', kategorie: 'gebunden', farbe: null, sortier: 20 },
        { id: 3, label: 'einsatzbereit', kategorie: 'verfuegbar', farbe: null, sortier: 30 },
      ]),
    ),
    http.get('/api/personal', () => HttpResponse.json([])), // Pool (nur_im_dienst)
    http.get('/api/qualifikationen', () =>
      HttpResponse.json([{ id: 1, label: 'Notfallsanitäter', sortier: 30 }]),
    ),
  );
  return renderMitProviders(
    <>
      <Ortsfuehler />
      <Routes>
        <Route path="/einsaetze/:id/personal" element={<PersonalPage />} />
      </Routes>
    </>,
    { route },
  );
}

/** Die aktuelle Adresse, wie der Router sie hält (LLH-1096). */
const ort = { aktuell: '' };
function Ortsfuehler() {
  const l = useLocation();
  ort.aktuell = `${l.pathname}${l.search}`;
  return null;
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

/** Wartet, bis die Einheitenliste steht: erst dann gruppiert die Liste und nennt die Einheit. */
async function bereit(name = 'Thomas Müller') {
  await screen.findByRole('button', { name: `Einheit zu ${name} bearbeiten` });
}

describe('PersonalPage', () => {
  it('bedient Status und Einteilung über benannte Auslöser, kein Auswahlfeld ruht in der Zeile', async () => {
    /**
     * Einheit, Fahrzeug und Position sind Inline-Angaben (LLH-1060 D4): erst der Auslöser öffnet
     * ein Auswahlfeld. Ein ruhendes `Select` schriebe beim Wählen sofort.
     */
    const { container } = render(einsatz());
    await bereit();
    const zeile = container.querySelector('[data-row-key="10"]') as HTMLElement;

    expect(within(zeile).queryAllByRole('combobox')).toHaveLength(0);
    for (const name of [
      'Status von Thomas Müller ändern',
      'Einheit zu Thomas Müller bearbeiten',
      'Fahrzeug zu Thomas Müller bearbeiten',
      'Position zu Thomas Müller bearbeiten',
    ]) {
      expect(within(zeile).getByRole('button', { name })).toBeInTheDocument();
    }
  });

  /**
   * Wechselt der Einheitsführer in der Zeile die Einheit, leert der Server die Führung still
   * (LLH-1060 D3, Prüfliste #9): die Marke steht deshalb schon vor dem Wechsel am Wert.
   */
  it('nennt am Einheitswert den Einheitsführer, nur bei ihm', async () => {
    const zweite = {
      ...disponiert[0],
      id: 11,
      personal_id: 6,
      name: 'Anna Berg',
      staerke_position: 'mannschaft',
    };
    const { container } = render(
      einsatz(),
      [disponiert[0], zweite],
      [],
      [{ ...einheiten[0], fuehrer_id: 10 }],
    );
    await bereit();
    await bereit('Anna Berg');
    const fuehrer = container.querySelector('[data-row-key="10"]') as HTMLElement;
    const andere = container.querySelector('[data-row-key="11"]') as HTMLElement;
    expect(
      within(fuehrer).getByRole('button', { name: 'Einheit zu Thomas Müller bearbeiten' }),
    ).toHaveTextContent('Einheitsführer');
    expect(within(andere).queryByText('Einheitsführer')).toBeNull();
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
    // Die Funktion steht erst ab `xl` (LFH-975).
    setzeViewportBreite(1440);
    render(einsatz());
    expect(await screen.findByText('Thomas Müller')).toBeInTheDocument();
    expect(screen.getByText('Sanitäter, Gruppenführer')).toBeInTheDocument();
  });

  // LLH-1067: die Einsatzfunktion steht vor der Qualifikation, beide sichtbar in der Zelle.
  it('zeigt Einsatzfunktion und Qualifikation und sucht in beiden', async () => {
    setzeViewportBreite(1440);
    render(einsatz(), [
      { ...disponiert[0], einsatzfunktion: 'Sprechfunker' },
      {
        ...disponiert[0],
        id: 11,
        personal_id: 6,
        name: 'Anna Berg',
        funktion: 'Notfallsanitäter',
        einheit_id: null,
        fahrzeug_id: null,
      },
    ]);
    const knopf = await screen.findByRole('button', {
      name: 'Funktion zu Thomas Müller bearbeiten',
    });
    expect(knopf).toHaveAccessibleDescription('Sprechfunker');
    expect(screen.getByText('Sanitäter, Gruppenführer')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Funktion zu Anna Berg eintragen' })).toBeVisible();

    const suche = screen.getByRole('searchbox', { name: 'Suche in Personal im Einsatz' });
    fireEvent.change(suche, { target: { value: 'sprechfunk' } });
    await waitFor(() => expect(screen.queryByText('Anna Berg')).toBeNull());
    expect(screen.getByText('Thomas Müller')).toBeInTheDocument();
    fireEvent.change(suche, { target: { value: 'notfallsan' } });
    await waitFor(() => expect(screen.queryByText('Thomas Müller')).toBeNull());
    expect(screen.getByText('Anna Berg')).toBeInTheDocument();
  });

  it('setzt die Einsatzfunktion inline und schlägt Vorgaben und Qualifikationen vor', async () => {
    setzeViewportBreite(1440);
    let patchBody: unknown = 'NICHT_AUFGERUFEN';
    server.use(
      http.patch('/api/einsaetze/7/personal/10', async ({ request }) => {
        patchBody = await request.json();
        return HttpResponse.json({ ...disponiert[0], einsatzfunktion: 'Notfallsanitäter' });
      }),
    );
    render(einsatz());
    // Nach dem Speichern liefert die Liste den neuen Stand.
    server.use(
      http.get('/api/einsaetze/7/personal', ({ request }) =>
        HttpResponse.json(
          new URL(request.url).searchParams.has('entlassene')
            ? []
            : [
                {
                  ...disponiert[0],
                  einsatzfunktion: patchBody === 'NICHT_AUFGERUFEN' ? null : 'Notfallsanitäter',
                },
              ],
        ),
      ),
    );
    await userEvent.click(
      await screen.findByRole('button', { name: 'Funktion zu Thomas Müller eintragen' }),
    );
    const feld = screen.getByRole('combobox', { name: 'Funktion zu Thomas Müller' });
    await userEvent.type(feld, 'notf');
    await userEvent.click(
      await screen.findByText(
        (_, el) =>
          el?.className === 'ant-select-item-option-content' &&
          el?.textContent === 'Notfallsanitäter',
      ),
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Funktion zu Thomas Müller speichern' }),
    );
    await waitFor(() => expect(patchBody).toEqual({ einsatzfunktion: 'Notfallsanitäter' }));
    expect(
      await screen.findByRole('button', { name: 'Funktion zu Thomas Müller bearbeiten' }),
    ).toHaveAccessibleDescription('Notfallsanitäter');
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
    await bereit();
    const zeile = container.querySelector('[data-row-key="10"]') as HTMLElement;

    // Der Auslöser ist über seinen Namen eindeutig, auch neben den Auslösern der Einteilung.
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
      await waitFor(() => expect(gerufen.length).toBeGreaterThanOrEqual(1));
      expect(gerufen[gerufen.length - 1].getAttribute('data-lfh')).toBe('datensicht-karte');
    } finally {
      Element.prototype.scrollIntoView = vorher;
    }
  });

  it('Leitung im aktiven Einsatz: Disponieren im Kopf, keine Lösch- und Zeitachsenbedienung in der Zeile', async () => {
    // Spec `personal-ansicht`, „Liste ohne Zeilenaktion“: Entlassen und Stornieren stehen nur in
    // der Personenansicht, ebenso die Zeitachse.
    const { container } = render(einsatz());
    await bereit();
    expect(screen.getByRole('button', { name: 'Personal disponieren' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ad-hoc-Person' })).toBeInTheDocument();
    const zeile = container.querySelector('[data-row-key="10"]') as HTMLElement;
    for (const wort of [/entlassen/i, /stornieren/i, /entfernen/i, /zeitachse/i, /weitere/i]) {
      expect(within(zeile).queryByRole('button', { name: wort })).toBeNull();
    }
    expect(screen.queryByRole('columnheader', { name: 'Aktionen' })).toBeNull();
    expect(zeile.querySelector('.ant-table-row-expand-icon, [aria-expanded]')).toBeNull();
  });

  it('der Name führt in die Personenansicht', async () => {
    render(einsatz());
    await bereit();
    expect(screen.getByRole('link', { name: 'Thomas Müller' })).toHaveAttribute(
      'href',
      '/einsaetze/7/personal/10',
    );
  });

  /** Spec „Block Entlassen“: eingeklappt unter der Liste, mit „Erneut disponieren“. */
  it('zeigt Entlassene eingeklappt unter der Liste, verlinkt sie und disponiert sie erneut', async () => {
    let reaktiviert: number | null = null;
    server.use(
      http.post('/api/einsaetze/7/personal/:ep/reaktivieren', ({ params }) => {
        reaktiviert = Number(params.ep);
        return HttpResponse.json(disponiert[0]);
      }),
    );
    const entlassen = (id: number, name: string) => ({
      ...disponiert[0],
      id,
      name,
      einheit_id: null,
      fahrzeug_id: null,
      beendet_at: '2026-05-26 12:00:00',
      beendet_als: 'entlassen',
    });
    render(einsatz(), disponiert, [entlassen(20, 'Anna Alt'), entlassen(21, 'Bert Alt')]);
    const kopf = await screen.findByRole('button', { name: /Entlassen \(2\)/ });
    expect(kopf).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Anna Alt')).toBeNull();
    // Die aktive Liste zählt nur ihre eigene Kraft.
    expect(screen.getByText('1 Kräfte')).toBeInTheDocument();
    await userEvent.click(kopf);
    // Der Name führt in die Ansicht der entlassenen Person (D8): dort steht ihr Nachweis.
    expect(await screen.findByRole('link', { name: 'Anna Alt' })).toHaveAttribute(
      'href',
      '/einsaetze/7/personal/20',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Erneut disponieren: Anna Alt' }));
    await waitFor(() => expect(reaktiviert).toBe(20));
  });

  it('Beobachter / abgeschlossen: reine Ansicht, Einteilung als Text', async () => {
    const { container } = render(
      einsatz({
        status: 'abgeschlossen',
        abgeschlossen_at: '2026-05-26 12:00:00',
        meine_rolle: 'beobachter',
      }),
    );
    const zeile = await waitFor(() => {
      const z = container.querySelector<HTMLElement>('[data-row-key="10"]');
      expect(z).toHaveTextContent('Zugtrupp');
      return z!;
    });
    expect(screen.queryByRole('button', { name: 'Ad-hoc-Person' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Personal disponieren' })).not.toBeInTheDocument();
    expect(screen.getByText(/abgeschlossen — nur Ansicht/)).toBeInTheDocument();
    expect(zelleNachKopf(container, zeile, 'Einheit')).toHaveTextContent('Zugtrupp');
    expect(zelleNachKopf(container, zeile, 'Fahrzeug')).toHaveTextContent('Florian 1');
    expect(zelleNachKopf(container, zeile, 'Position')).toHaveTextContent('F');
    // Kein Auslöser der Einteilung; der Name bleibt der einzige Link.
    expect(within(zeile).queryByRole('button', { name: /bearbeiten|eintragen/ })).toBeNull();
  });

  it('Position als Kürzel; leeren sendet nach „Speichern“ explizit null', async () => {
    // Clear muss explizit null senden (nicht absent), sonst verschluckt JSON.stringify das Feld
    // und das Backend behält den Altwert.
    let patchBody: unknown = 'NICHT_AUFGERUFEN';
    server.use(
      http.patch('/api/einsaetze/7/personal/10', async ({ request }) => {
        patchBody = await request.json();
        return HttpResponse.json({ ...disponiert[0], staerke_position: null });
      }),
    );
    const { container } = render(einsatz(), [
      disponiert[0],
      {
        ...disponiert[0],
        id: 11,
        personal_id: 6,
        name: 'Uwe Unter',
        staerke_position: 'unterfuehrer',
      },
    ]);
    await bereit();
    const uwe = container.querySelector('[data-row-key="11"]') as HTMLElement;
    expect(zelleNachKopf(container, uwe, 'Position')).toHaveTextContent(/^UF$/);

    await userEvent.click(
      screen.getByRole('button', { name: 'Position zu Thomas Müller bearbeiten' }),
    );
    const feld = screen
      .getByRole('combobox', { name: 'Position zu Thomas Müller' })
      .closest('.ant-select')!;
    await userEvent.click(feld.querySelector<HTMLElement>('.ant-select-clear')!);
    // Wählen allein schreibt nicht (D4).
    expect(patchBody).toBe('NICHT_AUFGERUFEN');
    await userEvent.click(
      screen.getByRole('button', { name: 'Position zu Thomas Müller speichern' }),
    );
    await waitFor(() => expect(patchBody).toEqual({ staerke_position: null }));
  });

  // ── Einteilung in der Zeile (D3–D5) ──

  it('ordnet eine Person in der Zeile einer Einheit zu: PUT erst nach „Speichern“', async () => {
    const aufrufe: string[] = [];
    server.use(
      http.put('/api/einsaetze/7/einheiten/:eid/personal/:ep', ({ params }) => {
        aufrufe.push(`PUT ${params.eid}/${params.ep}`);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const ohne = { ...disponiert[0], id: 12, personal_id: 6, name: 'Zora Zebra', einheit_id: null };
    render(einsatz(), [disponiert[0], ohne]);
    await bereit();
    await userEvent.click(screen.getByRole('button', { name: 'Einheit zu Zora Zebra eintragen' }));
    await waehle('Einheit zu Zora Zebra', 'Zugtrupp');
    expect(aufrufe).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: 'Einheit zu Zora Zebra speichern' }));
    await waitFor(() => expect(aufrufe).toEqual(['PUT 3/12']));
  });

  it('Escape verwirft eine gewählte Einheit ohne Schreiben', async () => {
    let gesendet = 0;
    server.use(
      http.put('/api/einsaetze/7/einheiten/:eid/personal/:ep', () => {
        gesendet += 1;
        return new HttpResponse(null, { status: 204 });
      }),
      http.delete('/api/einsaetze/7/einheiten/:eid/personal/:ep', () => {
        gesendet += 1;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const ohne = { ...disponiert[0], id: 12, personal_id: 6, name: 'Zora Zebra', einheit_id: null };
    render(einsatz(), [disponiert[0], ohne]);
    await bereit();
    await userEvent.click(screen.getByRole('button', { name: 'Einheit zu Zora Zebra eintragen' }));
    await waehle('Einheit zu Zora Zebra', 'Zugtrupp');
    await userEvent.keyboard('{Escape}');
    await userEvent.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByRole('combobox', { name: 'Einheit zu Zora Zebra' })).toBeNull(),
    );
    expect(gesendet).toBe(0);
  });

  it('die Fahrzeugauswahl stellt die Fahrzeuge der eigenen Einheit voran', async () => {
    render(einsatz(), [{ ...disponiert[0], fahrzeug_id: null }]);
    // Nach `render`: dessen Grundhandler gingen sonst vor.
    server.use(
      http.get('/api/einsaetze/7/fahrzeuge', () =>
        HttpResponse.json([
          { ...fahrzeuge[0], id: 9, funkrufname: 'Akkon 2', einheit_id: null },
          ...fahrzeuge,
        ]),
      ),
    );
    await bereit();
    await userEvent.click(
      await screen.findByRole('button', { name: 'Fahrzeug zu Thomas Müller eintragen' }),
    );
    await oeffne('Fahrzeug zu Thomas Müller');
    expect(optionenVon('Fahrzeug zu Thomas Müller')).toEqual(['Florian 1 (ELW)', 'Akkon 2 (ELW)']);
  });

  it('ein Fahrzeug einer anderen Einheit trägt die Marke „andere Einheit“', async () => {
    const { container } = render(einsatz(), [{ ...disponiert[0], einheit_id: null }]);
    await screen.findByRole('button', { name: 'Fahrzeug zu Thomas Müller bearbeiten' });
    const zeile = container.querySelector('[data-row-key="10"]') as HTMLElement;
    await waitFor(() =>
      expect(zelleNachKopf(container, zeile, 'Fahrzeug')).toHaveTextContent('andere Einheit'),
    );
  });

  it('ohne Freigabe des Moduls Fahrzeuge: keine Spalte „Fahrzeug“, kein „—“ an ihrer Stelle', async () => {
    // Den Abruf selbst prüft die Personenansicht: die Verdichtungszeile über der Liste liest die
    // Fahrzeuge für ihre eigenen Zahlen (Bestand, LFH-973).
    server.use(
      http.get('/api/einsaetze/7/modul-freigaben', () =>
        HttpResponse.json(freigabenFixture({ fahrzeuge: { zugriff: false } })),
      ),
    );
    const { container } = render(einsatz());
    await bereit();
    expect(screen.queryByRole('columnheader', { name: 'Fahrzeug' })).toBeNull();
    expect(screen.getByRole('columnheader', { name: 'Einheit' })).toBeInTheDocument();
    const zeile = container.querySelector('[data-row-key="10"]') as HTMLElement;
    // Jede Zelle hat ihren Kopf; keine behauptet ein leeres Fahrzeug.
    expect(zeile.querySelectorAll('td')).toHaveLength(
      container.querySelectorAll('th.ant-table-cell').length,
    );
    expect(zeile).not.toHaveTextContent('Florian 1');
    expect(within(zeile).queryByRole('button', { name: /Fahrzeug zu/ })).toBeNull();
  });

  it('ohne Freigabe des Moduls Einheiten: keine Spalte „Einheit“ und keine Gruppen', async () => {
    server.use(
      http.get('/api/einsaetze/7/modul-freigaben', () =>
        HttpResponse.json(freigabenFixture({ einheiten: { zugriff: false } })),
      ),
    );
    const { container } = render(einsatz());
    await screen.findByRole('button', { name: 'Fahrzeug zu Thomas Müller bearbeiten' });
    expect(screen.queryByRole('columnheader', { name: 'Einheit' })).toBeNull();
    expect(container.querySelector('[data-lfh="datensicht-gruppenzaehler"]')).toBeNull();
  });

  // ── Datensicht ──

  const epGebunden = disponiert[0];
  const epOhne = {
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

  /** Blendet eine voreingestellt verborgene Spalte über den Spaltenschalter ein. */
  async function blendeEin(spalte: string) {
    await userEvent.click(screen.getByRole('button', { name: /Spalten · \d+ ausgeblendet/ }));
    await userEvent.click(await screen.findByRole('checkbox', { name: spalte }));
  }

  it('eingeschaltete Bemerkungsspalte trägt bei leerem Wert einen benannten Auslöser', async () => {
    /**
     * Leeres Bemerkungsfeld an der Personalseite. Zwei Hälften: die Spalte ist per Voreinstellung
     * abgewählt, also gibt es vorher keinen Auslöser — eine reine „ist da"-Prüfung bestünde auch
     * bei einem Platzhalter irgendwo sonst.
     */
    setzeViewportBreite(1600);
    const { container } = render(einsatz());
    await bereit();
    expect(
      screen.queryByRole('button', { name: 'Bemerkung zu Thomas Müller hinzufügen' }),
    ).toBeNull();

    await blendeEin('Bemerkung');

    const zeile = container.querySelector('[data-row-key="10"]') as HTMLElement;
    expect(
      within(zeile).getByRole('button', { name: 'Bemerkung zu Thomas Müller hinzufügen' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Spalten · 2 ausgeblendet/ })).toBeInTheDocument();
  });

  it('der Spaltenschalter meldet Träger, Ruhe, Bemerkung und (unter xxl) Abschnitt als ausgeblendet, als TEXT', async () => {
    /**
     * Kein Zähl-Abzeichen: ein antd-`Badge` mit `count` und ohne `color` rendert auf
     * `token.colorError` — Rot für einen Spaltenzähler bricht „Rot bedient nichts". Der Zähler
     * steht im zugänglichen Namen des Knopfes.
     */
    setzeViewportBreite(1440);
    render(einsatz());
    await bereit();
    // Abschnitt weicht unter `xxl` wie auf der Fahrzeugseite (LLH-1096).
    expect(screen.getByRole('button', { name: /Spalten · 4 ausgeblendet/ })).toBeInTheDocument();
    for (const kopf of ['Träger', 'Ruhe', 'Bemerkung', 'Abschnitt']) {
      expect(screen.queryByRole('columnheader', { name: kopf })).toBeNull();
    }
  });

  it.each([
    // Je ein Platz mehr seit der Abschnitt-Spalte ab `xxl` (LLH-1096).
    [1024, 5],
    [1366, 4],
    [1440, 4],
  ])(
    'bei %i px stehen Einheit, Fahrzeug und Position ohne Schalter im Bild (%i ausgeblendet, LLH-1060 D7)',
    async (breite, anzahl) => {
      setzeViewportBreite(breite);
      render(einsatz());
      await bereit();
      expect(
        screen.getByRole('button', { name: new RegExp(`Spalten · ${anzahl} ausgeblendet`) }),
      ).toBeInTheDocument();
      for (const kopf of ['Einheit', 'Fahrzeug', 'Position', 'Status', 'Einsatzdauer']) {
        // Am Anfang: der Kopf „Status“ trägt dahinter den Filterauslöser (LLH-1086).
        expect(
          screen.getByRole('columnheader', { name: new RegExp(`^${kopf}`) }),
        ).toBeInTheDocument();
      }
    },
  );

  it('gruppiert nach Einheit: „nicht eingeteilt“ zuerst, mit Zähler im Etikett', async () => {
    const { container } = render(einsatz(), [epGebunden, epOhne]);
    await bereit();
    // Im Streifen gesucht: die Verdichtungszeile darüber schreibt Statuswörter (LFH-973).
    const streifen = within(
      container.querySelector<HTMLElement>('[data-lfh="datensicht-gruppenzaehler"]')!,
    );
    expect(streifen.getByText('1 nicht eingeteilt')).toBeInTheDocument();
    expect(streifen.getByText('1 Zugtrupp')).toBeInTheDocument();
    // „nicht eingeteilt“ (Zora) vor „Zugtrupp“ (Thomas) — weder Server- noch Namensordnung.
    expect(zeilenFolge(container)).toEqual(['12', '10']);
  });

  it('benennt eine Untereinheit mit ihrem Pfad und stellt sie nach ihre Obereinheit', async () => {
    const { container } = render(einsatz(), [
      { ...epGebunden, id: 10, einheit_id: 4, fahrzeug_id: null },
      { ...epOhne, id: 12, einheit_id: 5 },
    ]);
    server.use(
      http.get('/api/einsaetze/7/einheiten', () =>
        HttpResponse.json([
          { ...einheiten[0], id: 4, name: 'Staffel A', ueber_einheit_id: 5 },
          { ...einheiten[0], id: 5, name: 'Zug 1' },
        ]),
      ),
    );
    const streifen = await waitFor(() => {
      const s = container.querySelector<HTMLElement>('[data-lfh="datensicht-gruppenzaehler"]');
      expect(s).toHaveTextContent('1 Zug 1 › Staffel A');
      return within(s!);
    });
    expect(streifen.getByText('1 Zug 1')).toBeInTheDocument();
    expect(zeilenFolge(container)).toEqual(['12', '10']);
  });

  it('der Status bleibt Filter der Statusspalte', async () => {
    render(einsatz(), [epGebunden, epOhne]);
    await bereit();
    // Der Filter steht im Spaltenkopf der `Datensicht` (LLH-1086), mit Zähler je Wert.
    await kopfFilterWaehlen('Status', [/^verfügbar \(\d+\)$/]);
    await waitFor(() => expect(screen.queryByText('Thomas Müller')).toBeNull());
    expect(screen.getByText('Zora Zebra')).toBeInTheDocument();
  });

  it('ein Einheitswechsel unter dem Cursor verschiebt die Zeile NICHT (Kriterium 12)', async () => {
    /**
     * Die Zeile wandert erst, wenn Fokus und Zeiger die Sicht verlassen haben (Spec
     * `personal-ansicht`, „Einheitswechsel unter dem Zeiger“). Fokus auf dem Auslöser der
     * Einheitsangabe, wie nach dem Speichern.
     */
    const { container, client } = render(einsatz(), [epGebunden, epOhne]);
    await bereit();
    const vorher = zeilenFolge(container);
    expect(vorher).toEqual(['12', '10']);

    act(() => screen.getByRole('button', { name: 'Einheit zu Zora Zebra eintragen' }).focus());
    const sicht = screen.getByRole('region', { name: 'Personal im Einsatz' });
    expect(sicht.contains(document.activeElement)).toBe(true);

    act(() => {
      client.setQueryData(einsatzKeys.personal(7), [epGebunden, { ...epOhne, einheit_id: 3 }]);
    });

    await waitFor(() =>
      expect(
        within(
          container.querySelector<HTMLElement>('[data-lfh="datensicht-gruppenzaehler"]')!,
        ).getByText('2 Zugtrupp'),
      ).toBeInTheDocument(),
    );
    expect(zeilenFolge(container)).toEqual(vorher);
  });

  it('Gegenprobe: OHNE Fokus in der Sicht ordnet sich die Liste sofort neu', async () => {
    const { container, client } = render(einsatz(), [epGebunden, epOhne]);
    await bereit();
    expect(zeilenFolge(container)).toEqual(['12', '10']);

    act(() => {
      client.setQueryData(einsatzKeys.personal(7), [epGebunden, { ...epOhne, einheit_id: 3 }]);
    });

    // Beide in „Zugtrupp“, dort nach Namen: Thomas vor Zora.
    await waitFor(() => expect(zeilenFolge(container)).toEqual(['10', '12']));
  });

  describe('unter md', () => {
    it('steht keine Tabelle, sondern Karten mit Einteilung und ohne Zeilenaktion', async () => {
      setzeViewportBreite(390);
      const { container } = render(einsatz());
      await bereit();
      expect(container.querySelector('.ant-table')).toBeNull();
      expect(container.querySelectorAll('[data-lfh="datensicht-karte"]')).toHaveLength(1);
      // Der Statusslot trägt ein Etikett mit Text, nicht das Auswahlfeld der Spalte — ein Select
      // mit Mindestbreite drückte eine 390-px-Karte breit.
      const karte = container.querySelector('[data-lfh="datensicht-karte"]') as HTMLElement;
      expect(within(karte).getByText('alarmiert')).toBeInTheDocument();
      expect(karte.querySelector('.ant-select')).toBeNull();
      // Dieselben Angaben wie in der Zeile (`sekundaer`), der Name führt in die Ansicht.
      for (const name of [
        'Einheit zu Thomas Müller bearbeiten',
        'Fahrzeug zu Thomas Müller bearbeiten',
        'Position zu Thomas Müller bearbeiten',
      ]) {
        expect(within(karte).getByRole('button', { name })).toBeInTheDocument();
      }
      expect(within(karte).getByRole('link', { name: 'Thomas Müller' })).toHaveAttribute(
        'href',
        '/einsaetze/7/personal/10',
      );
      expect(
        within(karte).queryByRole('button', { name: /entlassen|Weitere Aktionen/ }),
      ).toBeNull();
    });
  });

  it('Gegenprobe: ab md steht die Tabelle', async () => {
    const { container } = render(einsatz());
    await bereit();
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

    expect(await screen.findByText(/Aktualisierung fehlgeschlagen/)).toBeInTheDocument();
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
    zeige(http.get('/api/personal', () => new HttpResponse(null, { status: 500 })));
    await screen.findByText('Noch kein Personal disponiert');
    await oeffnePersonalAuswahl();
    expect(
      await screen.findByText('Personalliste konnte nicht geladen werden'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Keine freien Personen')).not.toBeInTheDocument();
  });

  it('Partnerhälfte: leerer Stamm-Pool behält „Keine freien Personen"', async () => {
    zeige();
    await screen.findByText('Noch kein Personal disponiert');
    await oeffnePersonalAuswahl();
    expect(await screen.findByText('Keine freien Personen')).toBeInTheDocument();
    expect(screen.queryByText('Personalliste konnte nicht geladen werden')).not.toBeInTheDocument();
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

/** Öffnet den Disponier-Dialog über den Kopfknopf und darin die Personenauswahl. */
async function oeffnePersonalAuswahl() {
  await userEvent.click(screen.getByRole('button', { name: 'Personal disponieren' }));
  const dialog = await screen.findByRole('dialog');
  await userEvent.click(within(dialog).getByRole('combobox', { name: 'Personen' }));
}

describe('PersonalPage — Kräfte-Zeitachse (LFH-552)', () => {
  const zelleDerSpalte = (titel: string) => {
    const kopf = [...document.querySelectorAll('th')].map((t) => t.textContent);
    const i = kopf.indexOf(titel);
    expect(i).toBeGreaterThan(-1);
    const zeile = document.querySelector('[data-row-key="10"]') as HTMLElement;
    return zeile.querySelectorAll('td')[i] as HTMLElement;
  };
  /** „Ruhe“ steht seit LLH-1060 im Spaltenschalter (D7). */
  async function zeigeRuhe() {
    await userEvent.click(screen.getByRole('button', { name: /Spalten · \d+ ausgeblendet/ }));
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Ruhe' }));
  }

  it('ohne Ereignisse: „—" in Einsatzdauer und Ruhe, nie eine Zahl', async () => {
    setzeViewportBreite(1440);
    render(einsatz());
    await screen.findByText('Thomas Müller');
    await zeigeRuhe();
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
    await zeigeRuhe();
    await waitFor(() => expect(zelleDerSpalte('Einsatzdauer')).toHaveTextContent('2 h 05'));
    expect(zelleDerSpalte('Ruhe')).toHaveTextContent('—');
  });
});

/**
 * LFH-733 (Spec `demo-daten`): Demo-Personal bleibt in der Pool-Auswahl, steht aber gesammelt in
 * der Gruppe „Demo-Daten“ hinter allen echten Personen; disponiertes Demo-Personal trägt die
 * Marke „Demo“ in der Tabelle.
 */
describe('PersonalPage · Demo-Marke', () => {
  const stamm = (id: number, name: string, personalnummer: string, ist_demo: boolean) => ({
    id,
    benutzer_id: null,
    name,
    personalnummer,
    traegerorganisation: null,
    telefon: null,
    staerke_position: null,
    bemerkung: null,
    dienststatus: 'in_dienst',
    angelegt_at: '2026-05-26 09:00:00',
    qualifikationen: [],
    ist_demo,
  });

  // Eigener Handler-Satz statt `render()`: dessen Pool-Handler stünde vor jedem vorher
  // registrierten (`server.use` reiht vorn ein).
  function zeige(eps: unknown[], pool: ReturnType<typeof stamm>[]) {
    server.use(
      meHandler(admin),
      http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz())),
      http.get('/api/einsaetze/7/personal', () => HttpResponse.json(eps)),
      http.get('/api/einsaetze/7/einheiten', () => HttpResponse.json(einheiten)),
      http.get('/api/einsaetze/7/fahrzeuge', () => HttpResponse.json(fahrzeuge)),
      http.get('/api/personal-status', () =>
        HttpResponse.json([
          { id: 2, label: 'alarmiert', kategorie: 'gebunden', farbe: null, sortier: 20 },
        ]),
      ),
      http.get('/api/personal', () => HttpResponse.json(pool)),
    );
    return renderMitProviders(
      <Routes>
        <Route path="/einsaetze/:id/personal" element={<PersonalPage />} />
      </Routes>,
      { route: '/einsaetze/7/personal' },
    );
  }

  it('Auswahl: echte Personen vorn, die Gruppe „Demo-Daten“ dahinter, Demo wählbar', async () => {
    const gesendet: unknown[] = [];
    server.use(
      http.post('/api/einsaetze/7/personal/sammel', async ({ request }) => {
        gesendet.push(await request.json());
        return HttpResponse.json([{ ...disponiert[0], id: 30, personal_id: 2, ist_demo: true }], {
          status: 201,
        });
      }),
    );
    zeige([], [stamm(2, 'Dora Demo', 'DEMO-P-001', true), stamm(1, 'Erna Echt', 'P-1', false)]);
    await screen.findByText('Noch kein Personal disponiert');
    await oeffnePersonalAuswahl();
    await screen.findByText('Erna Echt (P-1)');
    const eintraege = [
      ...document.querySelectorAll<HTMLElement>('.ant-select-dropdown .ant-select-item'),
    ].map((e) => e.textContent);
    expect(eintraege).toEqual(['Erna Echt (P-1)', 'Demo-Daten', 'Dora Demo (DEMO-P-001)Demo']);

    await userEvent.click(screen.getByText('Dora Demo (DEMO-P-001)'));
    // Die Auswahl allein disponiert nicht (LFH-983), erst der Knopf im Dialog.
    expect(gesendet).toEqual([]);
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Disponieren' }),
    );
    await waitFor(() =>
      expect(gesendet).toEqual([{ personal_ids: [2], einheit_id: null, fahrzeug_id: null }]),
    );
  });

  it('Tabelle: nur die Demo-Disposition trägt „Demo“', async () => {
    zeige(
      [
        { ...disponiert[0], id: 10, personal_id: 1, name: 'Erna Echt', ist_demo: false },
        { ...disponiert[0], id: 11, personal_id: 2, name: 'Dora Demo', ist_demo: true },
      ],
      [],
    );
    const demoZeile = (await screen.findByText('Dora Demo')).closest('tr')!;
    const echteZeile = screen.getByText('Erna Echt').closest('tr')!;
    expect(within(demoZeile).getByText('Demo')).toBeInTheDocument();
    expect(within(echteZeile).queryByText('Demo')).not.toBeInTheDocument();
  });
});

/** LFH-983: Der Kopf öffnet nur; disponiert wird im Dialog mit Absende-Knopf im Formular. */
describe('PersonalPage · Disponieren im Dialog (LFH-983)', () => {
  it('der Kopf trägt Knöpfe, kein Auswahlfeld; der Dialog sendet erst über den Knopf', async () => {
    const { container } = render(einsatz());
    await screen.findByText('Thomas Müller');
    const kopf = container.querySelector<HTMLElement>('[data-lfh="seitenkopf-aktionen"]')!;
    expect(within(kopf).queryByRole('combobox')).toBeNull();
    expect(
      within(kopf)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Personal disponieren', 'Ad-hoc-Person']);

    await userEvent.click(within(kopf).getByRole('button', { name: 'Personal disponieren' }));
    const dialog = await screen.findByRole('dialog');
    const knopf = within(dialog).getByRole('button', { name: 'Disponieren' });
    expect(knopf.closest('form')).not.toBeNull();
    expect(dialog.querySelector('.ant-modal-footer')).toBeNull();
    await userEvent.click(knopf);
    expect(await within(dialog).findByText('Mindestens eine Person wählen')).toBeInTheDocument();
  });
});

/**
 * Sortieren und Filtern im Spaltenkopf (LLH-1096, Rollout des Musters aus LLH-1086): Status,
 * Abschnitt, Träger und Position filtern, jede vergleichbare Spalte sortiert, der Stand steht in der
 * Adresse.
 */
describe('PersonalPage · Sortieren und Filtern (LLH-1096)', () => {
  const einheitenMitAbschnitt = [
    { ...einheiten[0], abschnitt_id: 20, abschnitt_name: 'EA Süd' },
    { ...einheiten[0], id: 4, name: 'Staffel', abschnitt_id: 10, abschnitt_name: 'EA Nord' },
  ];
  const zweite = {
    ...disponiert[0],
    id: 11,
    personal_id: 6,
    name: 'Anna Berg',
    traegerorganisation: 'ASB',
    staerke_position: 'mannschaft',
    einheit_id: 4,
    fahrzeug_id: null,
  };
  const folge = () =>
    [...document.querySelectorAll('tbody tr[data-row-key]')].map((z) =>
      z.getAttribute('data-row-key'),
    );

  it('Sortieren und Filtern ändern die Menge und die Adresse', async () => {
    setzeViewportBreite(1600);
    render(einsatz(), [disponiert[0], zweite], [], einheitenMitAbschnitt);
    await bereit('Anna Berg');

    await kopfFilterWaehlen('Abschnitt', ['EA Nord (1)']);
    await waitFor(() => expect(folge()).toEqual(['11']));
    await waitFor(() => expect(ort.aktuell).toBe('/einsaetze/7/personal?f.abschnitt=EA%2520Nord'));

    await userEvent.click(screen.getByRole('button', { name: 'Filter zurücksetzen' }));
    await waitFor(() => expect(folge()).toHaveLength(2));
    await userEvent.click(screen.getByRole('columnheader', { name: /^Position/ }));
    await waitFor(() => expect(ort.aktuell).toBe('/einsaetze/7/personal?sort=position%3Aauf'));
  });

  it('eine Adresse mit Filter zeigt dieselbe Liste', async () => {
    setzeViewportBreite(1600);
    render(
      einsatz(),
      [disponiert[0], zweite],
      [],
      einheitenMitAbschnitt,
      '/einsaetze/7/personal?f.position=mannschaft',
    );
    await screen.findByText('Anna Berg');
    expect(screen.queryByText('Thomas Müller')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Filter Position: Mannschaft entfernen' }),
    ).toBeInTheDocument();
  });
});
