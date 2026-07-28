import { http, HttpResponse } from 'msw';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { setzeViewportBreite } from '../test/viewport';
import { einsatzKeys } from '../api/queryKeys';
import { AuthProvider } from '../auth/AuthContext';
import PersonalPage from './PersonalPage';

const admin = {
  id: 1, anzeigename: 'Admin', benutzername: 'admin', system_rolle: 'admin',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-05-26 10:00:00',
};

function einsatz(overrides: Record<string, unknown> = {}) {
  return {
    id: 7, bezeichnung: 'Hochwasser', stichwort: null, status: 'aktiv', begonnen_at: '2026-05-26 09:00:00',
    abgeschlossen_at: null, abgeschlossen_von: null, einsatzart: 'realeinsatz', einsatznummer_intern: null,
    angelegt_at: '2026-05-26 09:00:00', leitstellen_nr: null, einsatzort: null, einsatzort_lat: null,
    einsatzort_lon: null, meldende_stelle: null, sachverhalt: null, anzahl_betroffene_initial: null,
    meine_rolle: 'einsatzleitung', ...overrides,
  };
}

// LFH-139: Struktur-Listen für die Auflösung einheit_id/fahrzeug_id → Klartext-Label.
const einheiten = [
  { id: 3, name: 'Zugtrupp', abschnitt_id: null, ueber_einheit_id: null, typ_label: null, fuehrer_name: null, soll: null },
];
const fahrzeuge = [
  { id: 8, funkrufname: 'Florian 1', kennzeichen: 'FW-1234', fahrzeugtyp: 'ELW', einheit_id: 3, status_kategorie: null, status_label: null },
];

const disponiert = [
  {
    id: 10, einsatz_id: 7, personal_id: 5, ist_adhoc: false, name: 'Thomas Müller',
    funktion: 'Sanitäter, Gruppenführer', traegerorganisation: 'DRK', staerke_position: 'fuehrer',
    status_id: 2, status_label: 'alarmiert', status_kategorie: 'gebunden', status_farbe: null,
    bemerkung: null, disponiert_at: '2026-05-26 09:10:00', disponiert_von: 1,
    einheit_id: 3, fahrzeug_id: 8,
  },
];

function render(einsatzObj: ReturnType<typeof einsatz>, personalDaten: unknown[] = disponiert) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(admin)),
    http.get('/api/einsaetze/7', () => HttpResponse.json(einsatzObj)),
    http.get('/api/einsaetze/7/personal', () => HttpResponse.json(personalDaten)),
    http.get('/api/einsaetze/7/einheiten', () => HttpResponse.json(einheiten)),
    http.get('/api/einsaetze/7/fahrzeuge', () => HttpResponse.json(fahrzeuge)),
    http.get('/api/personal-status', () => HttpResponse.json([
      { id: 2, label: 'alarmiert', kategorie: 'gebunden', farbe: null, sortier: 20 },
    ])),
    http.get('/api/personal', () => HttpResponse.json([])), // Pool (nur_im_dienst)
  );
  return renderMitProviders(
    <AuthProvider>
      <Routes>
        <Route path="/einsaetze/:id/personal" element={<PersonalPage />} />
      </Routes>
    </AuthProvider>,
    { route: '/einsaetze/7/personal' },
  );
}

describe('PersonalPage', () => {
  it('zeigt disponiertes Personal mit Funktion und Position', async () => {
    render(einsatz());
    expect(await screen.findByText('Thomas Müller')).toBeInTheDocument();
    expect(screen.getByText('Sanitäter, Gruppenführer')).toBeInTheDocument();
  });

  it('hebt per ?personal=<id> die Zeile hervor (LFH-25 Inspector-Deeplink)', async () => {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(admin)),
      http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz())),
      http.get('/api/einsaetze/7/personal', () => HttpResponse.json(disponiert)),
      http.get('/api/einsaetze/7/einheiten', () => HttpResponse.json(einheiten)),
      http.get('/api/einsaetze/7/fahrzeuge', () => HttpResponse.json(fahrzeuge)),
      http.get('/api/personal-status', () => HttpResponse.json([
        { id: 2, label: 'alarmiert', kategorie: 'gebunden', farbe: null, sortier: 20 },
      ])),
      http.get('/api/personal', () => HttpResponse.json([])),
    );
    const { container } = renderMitProviders(
      <AuthProvider>
        <Routes>
          <Route path="/einsaetze/:id/personal" element={<PersonalPage />} />
        </Routes>
      </AuthProvider>,
      { route: '/einsaetze/7/personal?personal=10' },
    );
    await screen.findByText('Thomas Müller');
    await waitFor(() =>
      expect(container.querySelector('[data-row-key="10"]')).toHaveClass('zeile-hervorgehoben'),
    );
  });

  it('Leitung im aktiven Einsatz sieht Dispositions-Aktionen', async () => {
    render(einsatz());
    await screen.findByText('Thomas Müller');
    expect(screen.getByRole('button', { name: 'Ad-hoc-Person' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Entfernen' })).toBeInTheDocument();
  });

  it('Beobachter / abgeschlossen: reine Ansicht', async () => {
    render(einsatz({ status: 'abgeschlossen', abgeschlossen_at: '2026-05-26 12:00:00', meine_rolle: 'beobachter' }));
    await screen.findByText('Thomas Müller');
    expect(screen.queryByRole('button', { name: 'Ad-hoc-Person' })).not.toBeInTheDocument();
    expect(screen.getByText(/abgeschlossen — nur Ansicht/)).toBeInTheDocument();
  });

  // LFH-4 P1: Position-Select ist leerbar; Clear muss explizit null senden (nicht absent),
  // sonst verschluckt JSON.stringify das Feld und das Backend behält den Altwert.
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
     * AUF DIE ZEILE GESCOPET, seit die Werkzeugzeile von `Datensicht` eigene Felder trägt.
     * Der Selektor greift den ERSTEN Treffer in Dokumentordnung, und die Werkzeugzeile
     * steht davor. Gemessen bricht es heute noch nicht: ein leerer Filter-`Select` rendert
     * gar keinen Löschknoten (`useAllowClear` verlangt einen gewählten Wert), und die
     * Freitextsuche ist ein nacktes `input type="search"` ohne antd-Löscher. Der Test wäre
     * also grün geblieben, BIS irgendwann ein Filter einen Wert hält — genau die Sorte
     * Test, die aufhört zu prüfen, ohne rot zu werden. Deshalb scopen statt abwarten.
     */
    const clear = container.querySelector('[data-row-key="10"] .ant-select-clear');
    expect(clear, 'Position-Select muss allowClear haben').not.toBeNull();
    fireEvent.mouseDown(clear!);
    fireEvent.click(clear!);

    await waitFor(() => expect(patchBody).toEqual({ staerke_position: null }));
  });

  // LFH-139: Gegenrichtung zur Fahrzeugseite — je Kraft das zugeordnete Fahrzeug
  // (Funkrufname/Kennzeichen) + die Einheit, jeweils als Deeplink zur Modulseite.
  it('zeigt zugeordnetes Fahrzeug (Funkrufname/Kennzeichen) und Einheit je Kraft, verlinkt (LFH-139)', async () => {
    render(einsatz());
    await screen.findByText('Thomas Müller');

    const fahrzeugLink = screen.getByRole('link', { name: 'Florian 1 (FW-1234)' });
    expect(fahrzeugLink).toHaveAttribute('href', '/einsaetze/7/fahrzeuge?fahrzeug=8');

    const einheitLink = screen.getByRole('link', { name: 'Zugtrupp' });
    expect(einheitLink).toHaveAttribute('href', '/einsaetze/7/einheiten?einheit=3');
  });

  it('stellt nicht zugeordnete Kräfte in Fahrzeug- und Einheit-Spalte als „—" dar (LFH-139)', async () => {
    const unzugeordnet = [{
      id: 11, einsatz_id: 7, personal_id: 6, ist_adhoc: false, name: 'Erika Mustermann',
      funktion: 'Helferin', traegerorganisation: 'THW', staerke_position: 'mannschaft',
      status_id: 2, status_label: 'alarmiert', status_kategorie: 'gebunden', status_farbe: null,
      bemerkung: 'x', disponiert_at: '2026-05-26 09:10:00', disponiert_von: 1,
      einheit_id: null, fahrzeug_id: null,
    }];
    const { container } = render(einsatz(), unzugeordnet);
    await screen.findByText('Erika Mustermann');

    // Auf die Zeile der unzugeordneten Kraft scopen (robust gegen andere Zeilen/Kopf).
    const zeile = container.querySelector('[data-row-key="11"]') as HTMLElement;
    expect(zeile).not.toBeNull();
    // Keine Fahrzeug-/Einheit-Deeplinks in dieser Zeile — und GENAU deshalb trägt
    // `karte.titel` kein `ziel`: das würde die Namenszelle in beiden Zweigen zu einem Link
    // machen und diese Aussage lautlos umdrehen, obwohl `personalPfad` auf DIESE Seite zeigt.
    expect(within(zeile).queryByRole('link')).toBeNull();
    /**
     * ... und beide Spalten zeigen den „—"-Platzhalter. GEZIELT je Zelle statt
     * `getAllByText('—')).toHaveLength(2)`: der Zähler stimmt rechnerisch auch nach dem
     * Umbau, pinnt aber eine Platzhalterzahl statt einer Aussage — er bliebe grün, wenn
     * der Strich in zwei ganz anderen Spalten stünde.
     */
    expect(zelleNachKopf(container, zeile, 'Fahrzeug').textContent).toBe('—');
    expect(zelleNachKopf(container, zeile, 'Einheit').textContent).toBe('—');
  });

  // ── Datensicht (LFH-330 · B2) ───────────────────────────────────────────────────

  const epGebunden = disponiert[0];
  const epVerfuegbar = {
    ...disponiert[0], id: 12, personal_id: 6, name: 'Zora Zebra', staerke_position: 'mannschaft',
    status_label: 'einsatzbereit', status_kategorie: 'verfuegbar', einheit_id: null, fahrzeug_id: null,
  };
  const zeilenFolge = (container: HTMLElement) =>
    [...container.querySelectorAll('tr.ant-table-row')].map((r) => r.getAttribute('data-row-key'));

  it('der Spaltenschalter meldet die ausgeblendete Bemerkungsspalte als TEXT', async () => {
    /**
     * Kein Zähl-Abzeichen: ein antd-`Badge` mit `count` und ohne `color` rendert auf
     * `token.colorError` — Rot für einen Spaltenzähler bricht „Rot bedient nichts" und
     * Kriterium 7. Der Zähler steht deshalb im ZUGÄNGLICHEN NAMEN des Knopfes.
     */
    render(einsatz());
    await screen.findByText('Thomas Müller');
    expect(screen.getByRole('button', { name: /Spalten · 1 ausgeblendet/ })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Bemerkung' })).toBeNull();
    // Position ist SCHREIBTRAGEND und bleibt deshalb sichtbar — sie bekommt kein
    // `abBreite`, weil das Führungs-Tablet (1024–1280 px) sie sonst genau dort verlöre,
    // wo sie gebraucht wird, und es keine Detailroute als Ausweichort gibt.
    expect(screen.getByRole('columnheader', { name: 'Position' })).toBeInTheDocument();
  });

  it('gruppiert nach Statuskategorie, mit Zähler im Etikett', async () => {
    const { container } = render(einsatz(), [epGebunden, epVerfuegbar]);
    await screen.findByText('Thomas Müller');
    expect(screen.getByText('verfügbar · 1')).toBeInTheDocument();
    expect(screen.getByText('gebunden · 1')).toBeInTheDocument();
    // Die Gruppenachse führt: verfügbar (Zora) steht VOR gebunden (Thomas) — das ist
    // WEDER die Serverordnung noch die Namensordnung.
    expect(zeilenFolge(container)).toEqual(['12', '10']);
  });

  it('ein Statuswechsel unter dem Cursor verschiebt die Zeile NICHT (Kriterium 12)', async () => {
    /**
     * Diese Seite trägt ZWEI Auswahlfelder in der Zeile (Position und Status). Geprüft wird
     * mit dem Fokus im POSITIONS-Feld: die Schleuse darf nicht davon abhängen, welches
     * Element der Zeile den Fokus hält, sondern nur davon, dass er in der Sicht liegt.
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
      // Der Statusslot trägt ein Etikett MIT Text, nicht das Auswahlfeld der Spalte —
      // ein `minWidth: 150`-Select drückte eine 390-px-Karte breit.
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
 * Die Zelle einer Zeile über den SPALTENKOPF, nicht über einen Positionsindex: eine neue
 * oder ausgeblendete Spalte verschöbe jeden gezählten Index lautlos.
 */
function zelleNachKopf(container: HTMLElement, zeile: HTMLElement, kopf: string): HTMLElement {
  const koepfe = [...container.querySelectorAll('th.ant-table-cell')].map((th) => th.textContent);
  const index = koepfe.indexOf(kopf);
  expect(index, `Spaltenkopf „${kopf}" nicht gefunden (gefunden: ${koepfe.join(', ')})`).toBeGreaterThanOrEqual(0);
  const zellen = zeile.querySelectorAll('td');
  expect(zellen.length, 'Zeile hat weniger Zellen als Spaltenköpfe').toBeGreaterThan(index);
  return zellen[index] as HTMLElement;
}
