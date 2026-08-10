import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes, useLocation } from 'react-router';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { setzeViewportBreite } from '../test/viewport';
import { AuthProvider } from '../auth/AuthContext';
import { CommandPaletteProvider } from '../command-palette/CommandPaletteProvider';
import EinsatzLayout from './EinsatzLayout';
import { leseZuletztModule, merkeModulBesuch } from './zuletztModule';

vi.mock('./useModulZaehler', () => ({ useModulZaehler: () => ({}) }));

/**
 * Der gemerkte Rahmen-Zustand wird gegen ein HANDGESCHRIEBENES Literal geprüft,
 * nicht gegen die Konstante aus `navPersistenz` — sonst prüfte der Test die
 * Konstante gegen sich selbst.
 */
const EINGEKLAPPT = 'lfh:nav:eingeklappt';

const admin = {
  id: 1, anzeigename: 'Chef', benutzername: 'chef', system_rolle: 'admin',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-05-23 10:00:00',
};
/**
 * Ein Benutzer OHNE Admin-Bypass — `istModulGesperrt` lässt Admins grundsätzlich frei
 * (`benutzer?.system_rolle === 'admin' → return false`), deshalb belegt der
 * `admin`-Benutzer keine Rollen-Sperre. Für den Zuletzt-Filtertest auf „rollen-gesperrt"
 * braucht es einen Benutzer, an dem die Sperre tatsächlich greifen kann.
 */
const mitarbeiterOhneRolle = {
  id: 2, anzeigename: 'Helfer', benutzername: 'helfer', system_rolle: 'keiner',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-05-23 10:00:00',
};
const einsatz = {
  id: 7, bezeichnung: 'Hochwasser Nord', stichwort: null, status: 'aktiv',
  begonnen_at: '2026-05-23 09:00:00', abgeschlossen_at: null,
  abgeschlossen_von: null, meine_rolle: 'einsatzleitung',
};

/**
 * Sonde für den aktuellen Pfad (Muster `ModulStub.test.tsx`) — beweist die echte
 * Navigation aus `onKategorieKlick` (LFH-337 · H12), statt nur den Panel-Zustand zu
 * lesen. Als Geschwister der `Routes` in `setup()` gerendert, damit sie unabhängig
 * davon steht, welche Kind-Route gerade matcht.
 */
function PfadAnzeige() {
  return <span data-testid="pfad">{useLocation().pathname}</span>;
}

/** Liest den aktuellen Pfad aus der `PfadAnzeige`-Sonde. */
function pfad(): string {
  return screen.getByTestId('pfad').textContent ?? '';
}

/**
 * `fehler` schaltet die beiden Abrufe des Rahmens einzeln auf 500 — einzeln, weil
 * die beiden Ausfälle im Layout verschiedene Antworten haben: der Einsatz-Abruf
 * ersetzt die ganze Seite, der Overrides-Abruf nur ein Banner darüber.
 */
function setup(
  overrides: Record<string, unknown> = {},
  fehler: { einsatz?: boolean; overrides?: boolean } = {},
  aktuellerBenutzer: typeof admin | typeof mitarbeiterOhneRolle = admin,
  route: string = '/einsaetze/7/etb',
) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(aktuellerBenutzer)),
    http.get('/api/einsaetze', () => HttpResponse.json([einsatz])),
    http.get('/api/einsaetze/7', () =>
      fehler.einsatz ? new HttpResponse(null, { status: 500 }) : HttpResponse.json(einsatz),
    ),
    http.get('/api/einsaetze/7/modul-overrides', () =>
      fehler.overrides ? new HttpResponse(null, { status: 500 }) : HttpResponse.json(overrides),
    ),
    http.get('/api/einsaetze/7/einstellungen', () => HttpResponse.json({})),
  );
  return renderMitProviders(
    <AuthProvider>
      <CommandPaletteProvider>
        <Routes>
          <Route path="/einsaetze/:id" element={<EinsatzLayout />}>
            <Route path="etb" element={<div>ETB-Inhalt</div>} />
            {/* Zweites Ziel in einer ANDEREN Kategorie: nur damit lässt sich
                belegen, dass ein Modulklick im Drawer wirklich navigiert und den
                Drawer dabei schließt. */}
            <Route path="lagekarte" element={<div>Lagekarte-Inhalt</div>} />
            {/* Erstes freigegebenes Modul der Kategorie 'lage' (LFH-337 · H12): der
                Rail-Klick auf eine fremde Kategorie navigiert jetzt dorthin, ohne
                eigenes Zutun der Tests — ohne diese Route matcht `<Routes>` gar
                nichts mehr und der Rahmen bliebe leer. */}
            <Route path="lage-dashboard" element={<div>Dashboard-Inhalt</div>} />
            {/* Zweites Ziel INNERHALB der Kategorie 'erfassung' (Fix-Runde 1, LFH-337 ·
                H12): 'personen' ist dort NICHT das erste fertige Modul (das ist 'etb') —
                nur mit einem Startpunkt jenseits des ersten Moduls sagt die Pfad-Sonde
                beim Selbstklick-Test überhaupt etwas aus. */}
            <Route path="personen" element={<div>Personen-Inhalt</div>} />
          </Route>
        </Routes>
        <PfadAnzeige />
      </CommandPaletteProvider>
    </AuthProvider>,
    { route },
  );
}

function setupRoute(route: string, childPath: string) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(admin)),
    http.get('/api/einsaetze', () => HttpResponse.json([einsatz])),
    http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz)),
    http.get('/api/einsaetze/7/modul-overrides', () => HttpResponse.json({})),
    http.get('/api/einsaetze/7/einstellungen', () => HttpResponse.json({})),
  );
  return renderMitProviders(
    <AuthProvider>
      <CommandPaletteProvider>
        <Routes>
          <Route path="/einsaetze/:id" element={<EinsatzLayout />}>
            <Route path={childPath} element={<div>Outlet-Inhalt</div>} />
          </Route>
        </Routes>
      </CommandPaletteProvider>
    </AuthProvider>,
    { route },
  );
}

describe('EinsatzLayout', () => {
  it('zeigt Switcher mit Einsatznamen, Kategorie-Rail und Outlet-Inhalt', async () => {
    setup();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Hochwasser Nord/ })).toBeInTheDocument(),
    );
    expect(screen.getByRole('navigation', { name: 'Kategorien' })).toBeInTheDocument();
    expect(screen.getByText('ETB-Inhalt')).toBeInTheDocument();
  });

  it('merkt das besuchte Modul im Zuletzt-Speicher (LFH-337 · H12)', async () => {
    localStorage.clear();
    setup();
    // `waitFor`, weil die Aufzeichnung in einem Effekt nach dem ersten Paint läuft.
    await waitFor(() => expect(leseZuletztModule(7)).toEqual(['etb']));
  });

  /**
   * Review-Fix (LFH-337 · H12, Fix-Runde 1): Ohne Kategorie-Filter deckte nur der
   * Ausschluss des AKTUELLEN Moduls die Zuletzt-Liste ab — der häufigste Pfad blieb
   * unentdeckt. Kategorie „Erfassung" hat fünf Module; wer von „Personen" zu „ETB"
   * wechselt (beide Erfassung), sähe „Personen" zweimal: einmal unter „Zuletzt",
   * einmal in der offenen Kategorieliste, beide als gleichnamiger `<button>`.
   * „Zuletzt" ist die Abkürzung zu dem, was NICHT ohnehin sichtbar ist — ein Modul der
   * offenen Kategorie steht bereits zwei Zeilen weiter unten, ein zweiter Eintrag
   * darüber verkürzt nichts, er verdoppelt nur ein Bedienziel.
   */
  it('nennt ein Modul der offenen Kategorie nicht zusätzlich unter „Zuletzt"', async () => {
    localStorage.clear();
    // 'personen' liegt wie die Route /etb in der Kategorie 'erfassung' — der
    // Kollisionsfall wird bewusst HERGESTELLT, nicht durch die Testdatenwahl umgangen.
    merkeModulBesuch(7, 'personen');
    setup();
    await waitFor(() => expect(screen.getByText('ETB-Inhalt')).toBeInTheDocument());
    expect(screen.getAllByRole('button', { name: 'Personen' })).toHaveLength(1);
    // Die Zuletzt-Gruppe ist damit ganz leer (einziger gemerkter Eintrag war 'personen',
    // 'etb' selbst ist das aktuelle Modul) — sie darf dann gar nicht erst stehen.
    expect(screen.queryByText('Zuletzt')).toBeNull();
  });

  /**
   * Review-Fix (LFH-337 · H12, Fix-Runde 1): Der Freigabe-Filter der Zuletzt-Ableitung
   * (`status === 'fertig' && istModulSichtbar(...) && !istModulGesperrt(...)`) war nur
   * über den reinen Speicher-Roundtrip geprüft, nie über die gerenderte, gefilterte
   * Ableitung. Ein entzogenes Modul darf nicht als Abkürzung stehenbleiben und in eine
   * gesperrte Seite führen.
   *
   * 'lagekarte' (Kategorie 'lage') ist bewusst gewählt: eine ANDERE Kategorie als die
   * offene ('erfassung' via /etb) — sonst griffe schon der Kategorie-Filter aus dem Test
   * darüber, und die Aussage über den Freigabe-Filter wäre nicht von ihm zu unterscheiden.
   */
  describe('Zuletzt-Gruppe respektiert die Freigabe-Filter (Review-Fix)', () => {
    beforeEach(() => {
      localStorage.clear();
      merkeModulBesuch(7, 'lagekarte');
    });

    it('steht ohne Einschränkung unter „Zuletzt"', async () => {
      setup();
      expect(await screen.findByRole('button', { name: 'Lagekarte' })).toBeInTheDocument();
    });

    it('verschwindet, wenn es per Override ausgeblendet ist', async () => {
      setup({
        lagekarte: {
          einsatz_id: 7, modul_key: 'lagekarte', sichtbar: false,
          benoetigte_rolle: null, geaendert_at: null, geaendert_von: null,
        },
      });
      await waitFor(() => expect(screen.getByText('ETB-Inhalt')).toBeInTheDocument());
      expect(screen.queryByRole('button', { name: 'Lagekarte' })).not.toBeInTheDocument();
    });

    it('verschwindet, wenn es rollen-gesperrt ist', async () => {
      setup(
        {
          lagekarte: {
            einsatz_id: 7, modul_key: 'lagekarte', sichtbar: true,
            benoetigte_rolle: 'fuehrungskraft', geaendert_at: null, geaendert_von: null,
          },
        },
        {},
        mitarbeiterOhneRolle,
      );
      await waitFor(() => expect(screen.getByText('ETB-Inhalt')).toBeInTheDocument());
      expect(screen.queryByRole('button', { name: 'Lagekarte' })).not.toBeInTheDocument();
    });
  });

  it('blendet ein verstecktes Modul aus der Navigation aus (LFH-132)', async () => {
    // 'personen' (Kategorie Erfassung) ausblenden; das Erfassung-Panel ist via
    // /etb offen. ETB bleibt sichtbar, Personen verschwindet aus der Nav.
    setup({
      personen: {
        einsatz_id: 7, modul_key: 'personen', sichtbar: false,
        benoetigte_rolle: null, geaendert_at: null, geaendert_von: null,
      },
    });
    await waitFor(() => expect(screen.getByText('ETB-Inhalt')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'ETB' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Personen' })).not.toBeInTheDocument();
  });

  it('hält das aktive Modul auf einer Sub-Route hervorgehoben (Panel bleibt offen)', async () => {
    // Letztes Segment ist „liste"; das aktive Modul wird am Segment nach der
    // Einsatz-ID erkannt — sonst klappt das Erfassung-Panel beim UHS-Redirect zu.
    setupRoute('/einsaetze/7/unfallhilfsstellen/liste', 'unfallhilfsstellen/liste');
    expect(await screen.findByRole('button', { name: 'Unfallhilfsstellen' })).toBeInTheDocument();
  });

  it('öffnet genau EINE SSE-Verbindung für den Einsatz (Stream im Layout, LFH-97)', async () => {
    // Der Live-Stream ist hier gehoistet; das Layout ist immer gemountet → genau eine
    // Verbindung pro Einsatz, unabhängig von der offenen Modul-Seite (HTTP/1.1-6-Limit).
    const urls: string[] = [];
    class FakeEventSource {
      constructor(url: string) { urls.push(url); }
      addEventListener() {}
      removeEventListener() {}
      close() {}
    }
    vi.stubGlobal('EventSource', FakeEventSource);
    setup();
    await waitFor(() => expect(screen.getByText('ETB-Inhalt')).toBeInTheDocument());
    expect(urls).toHaveLength(1);
    expect(urls[0]).toBe('/api/einsaetze/7/live');
  });

  /**
   * AK4-Partnerpaar zum Einsatz-Abruf (LFH-331 · B3), Hälfte 1.
   *
   * Geprüft wird die Großform UND ihre Ausschließlichkeit: der Rahmen darf daneben
   * nicht stehenbleiben. Sonst läse die Kindseite im Outlet dieselbe kaputte Abfrage
   * aus demselben Zwischenspeicher und stellte eine zweite, konkurrierende
   * Fehlermeldung daneben.
   *
   * Angesetzt wird an der Überschrift, nicht an der Detailzeile: die stammt aus
   * `ursacheText` und trägt nur bei einer `ApiError` mit Meldungsrumpf Text — eine
   * nackte 500 ohne Rumpf ergäbe dort nichts und der Test wäre von der Laune des
   * Fehlerkörpers abhängig.
   */
  it('bei gescheitertem Einsatz-Abruf steht die Sackgasse STATT des Rahmens', async () => {
    setup({}, { einsatz: true });
    expect(await screen.findByText('Einsatz konnte nicht geladen werden')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Erneut abrufen' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zur Einsatzliste' })).toBeInTheDocument();
    expect(screen.queryByText('ETB-Inhalt')).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Kategorien' })).not.toBeInTheDocument();
  });

  /**
   * Hälfte 2 — dieselben Literale, dieselbe Datei. Ohne sie belegte die Negativhälfte
   * oben nichts: eine umformulierte Überschrift ließe sie auch dann grün, wenn die
   * Sackgasse gar nicht mehr entstünde.
   */
  it('bei erfolgreichem Einsatz-Abruf steht der Rahmen und KEINE Sackgasse', async () => {
    setup();
    await waitFor(() => expect(screen.getByText('ETB-Inhalt')).toBeInTheDocument());
    expect(screen.getByRole('navigation', { name: 'Kategorien' })).toBeInTheDocument();
    expect(screen.queryByText('Einsatz konnte nicht geladen werden')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Erneut abrufen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Zur Einsatzliste' })).not.toBeInTheDocument();
  });

  /**
   * Der zweite Ausfall hat bewusst eine ANDERE Antwort: fehlen die Overrides, blendet
   * `istModulSichtbar` jedes per LFH-132 ausgeblendete Modul wieder ein (gemessen:
   * `overrides?.[key]?.sichtbar !== false` ist ohne Overrides wahr). Das ist keine
   * Sackgasse — der Einsatz bleibt bedienbar —, aber eine Navigation, die mehr zeigt
   * als der Einsatz konfiguriert hat, muss sich dazu bekennen.
   */
  it('bei gescheitertem Overrides-Abruf warnt ein Banner, der Rahmen bleibt bedienbar', async () => {
    setup({}, { overrides: true });
    await waitFor(() => expect(screen.getByText('ETB-Inhalt')).toBeInTheDocument());
    expect(
      screen.getByText(
        'Modul-Sichtbarkeit konnte nicht geladen werden — die Navigation zeigt womöglich Module, die für diesen Einsatz ausgeblendet sind.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Kategorien' })).toBeInTheDocument();
  });

  it('ohne Overrides-Fehler steht kein Warnbanner über dem Rahmen', async () => {
    setup();
    await waitFor(() => expect(screen.getByText('ETB-Inhalt')).toBeInTheDocument());
    expect(
      screen.queryByText(
        'Modul-Sichtbarkeit konnte nicht geladen werden — die Navigation zeigt womöglich Module, die für diesen Einsatz ausgeblendet sind.',
      ),
    ).not.toBeInTheDocument();
  });

  // Die Gegenprobe zum Schmal-Block darunter. Ohne sie wäre der Schmal-Test auch
  // dann grün, wenn der Hamburger versehentlich BEI JEDER Breite erschiene.
  it('ab lg steht der Rahmen inline und es gibt keinen Hamburger', async () => {
    setup();
    await waitFor(() => expect(screen.getByText('ETB-Inhalt')).toBeInTheDocument());
    expect(screen.getByRole('navigation', { name: 'Kategorien' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ETB' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Navigation öffnen' })).not.toBeInTheDocument();
    // Der Drawer existiert im Breitstand gar nicht — auch nicht geschlossen.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  /**
   * Gegenprobe zum Kopfzeilen-Block unter lg — mit DERSELBEN Abfrage. Eine
   * `queryBy…`-Null allein belegt nichts: sie wäre auch bei falsch
   * geschriebener Beschriftung grün.
   */
  it('ab lg stehen beide Umschalter in der Kopfzeile', async () => {
    setup();
    await waitFor(() => expect(screen.getByText('ETB-Inhalt')).toBeInTheDocument());
    expect(screen.getByRole('radiogroup', { name: 'Farbschema wählen' })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Bediendichte wählen' })).toBeInTheDocument();
  });

  it('rendert den sichtbaren Such-Trigger im Einsatz-Workspace', async () => {
    setup();
    await waitFor(() => expect(screen.getByText('ETB-Inhalt')).toBeInTheDocument());

    expect(screen.getByRole('button', { name: 'Suchen' })).toBeInTheDocument();
  });

  it('der Einsatzname sitzt im Restbreiten-Rahmen', async () => {
    // Der Rahmen ist die eine Hälfte der Kürzung — die andere (Ellipsis und
    // `title`) sitzt im Switcher und wird dort geprüft. Ohne `min-width: 0`
    // kürzt ein Flex-Kind nicht, sondern schiebt seine Nachbarn hinaus.
    setup();
    //
    // `parentElement` ist belastbar: antds Dropdown klont sein Kind, statt es
    // einzupacken — zwischen Rahmen und Knopf liegt nichts.
    const switcher = await screen.findByRole('button', { name: /Hochwasser Nord/ });
    const rahmen = switcher.parentElement!;
    expect(rahmen.style.minWidth).toBe('0px');
    expect(rahmen.style.flexGrow).toBe('1');
    // `flex-basis: 0` gehört dazu: mit `auto` bemäße sich der Rahmen am
    // Inhalt und wüchse mit einem langen Namen über die Kopfzeile hinaus.
    expect(rahmen.style.flexBasis).toBe('0px');
  });

  /**
   * Der gemerkte Einklapp-Zustand ist ein EIGENES Boolean neben `offeneKategorie`.
   * Diese drei Tests pinnen die Auftrennung: die Rail behält ihre Hervorhebung
   * (WELCHE Kategorie), das Panel verschwindet (OB offen) — und der Effekt, der
   * das Panel beim Navigieren an die Kategorie angleicht, fasst das Flag nicht an.
   */
  it('merkt das eingeklappte Panel über einen Neu-Mount (lfh:nav:eingeklappt)', async () => {
    setup();
    await waitFor(() => expect(screen.getByRole('button', { name: 'ETB' })).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'Erfassung' }));

    expect(screen.queryByRole('button', { name: 'ETB' })).not.toBeInTheDocument();
    // Die Rail bleibt auf der Kategorie stehen — sonst wäre „zugeklappt" von
    // „keine Kategorie aktiv" nicht zu unterscheiden.
    expect(screen.getByRole('button', { name: 'Erfassung' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(localStorage.getItem(EINGEKLAPPT)).toBe('1');
  });

  it('liest den gemerkten Zustand beim Mount', async () => {
    localStorage.setItem(EINGEKLAPPT, '1');
    setup();
    await waitFor(() => expect(screen.getByText('ETB-Inhalt')).toBeInTheDocument());
    expect(screen.getByRole('navigation', { name: 'Kategorien' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'ETB' })).not.toBeInTheDocument();
  });

  it('klappt beim Wechsel auf eine andere Kategorie wieder auf', async () => {
    localStorage.setItem(EINGEKLAPPT, '1');
    setup();
    await waitFor(() => expect(screen.getByText('ETB-Inhalt')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'Lage' }));

    expect(await screen.findByRole('button', { name: 'Lagekarte' })).toBeInTheDocument();
    expect(localStorage.getItem(EINGEKLAPPT)).toBeNull();
  });

  /**
   * `setzeViewportBreite` MUSS vor dem Render laufen: antds Beobachter ruft
   * seinen Zuhörer beim Abonnieren synchron auf und liest dabei nur `matches` —
   * eine nachträglich gesetzte Breite erreicht ihn nicht mehr.
   *
   * NICHT geprüft, weil der jsdom-Stub es nicht hergibt: der Breitenwechsel zur
   * LAUFZEIT (er kennt keinen Sender für Breiten-Ereignisse, nur für die
   * Zeigerart). Dass im Breitstand kein Drawer zurückbleibt, ist stattdessen
   * baulich zugesichert — er wird dort gar nicht erst gerendert — und oben in
   * der Gegenprobe belegt.
   */
  describe('unter lg', () => {
    beforeEach(() => setzeViewportBreite(390));

    it('blendet den inline-Rahmen aus und legt die Navigation hinter „Navigation öffnen"', async () => {
      setup();
      await waitFor(() => expect(screen.getByText('ETB-Inhalt')).toBeInTheDocument());
      expect(screen.getByRole('button', { name: 'Navigation öffnen' })).toBeInTheDocument();
      expect(screen.queryByRole('navigation', { name: 'Kategorien' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'ETB' })).not.toBeInTheDocument();
    });

    it('öffnet die Navigation im Drawer', async () => {
      setup();
      await waitFor(() => expect(screen.getByText('ETB-Inhalt')).toBeInTheDocument());

      await userEvent.click(screen.getByRole('button', { name: 'Navigation öffnen' }));

      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByRole('button', { name: 'Erfassung' })).toHaveAttribute(
        'aria-expanded',
        'true',
      );
      expect(within(dialog).getByRole('button', { name: 'ETB' })).toBeInTheDocument();
      // Genau EINE Navigations-Landmarke — die Rail darf im Drawer-Zustand nicht
      // zusätzlich im Baum stehen (sonst wäre jede Abfrage danach mehrdeutig).
      expect(screen.getAllByRole('navigation')).toHaveLength(1);
    });

    it('schließt den Drawer beim Modulklick und hinterlässt keine zweite Navigation', async () => {
      setup();
      await waitFor(() => expect(screen.getByText('ETB-Inhalt')).toBeInTheDocument());
      await userEvent.click(screen.getByRole('button', { name: 'Navigation öffnen' }));

      const dialog = await screen.findByRole('dialog');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Lage' }));
      await userEvent.click(await screen.findByRole('button', { name: 'Lagekarte' }));

      expect(await screen.findByText('Lagekarte-Inhalt')).toBeInTheDocument();
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(screen.queryAllByRole('navigation')).toHaveLength(0);
    });

    it('legt beide Umschalter ab, behält Alarm-Zentrale und Benutzermenü', async () => {
      // Die Alarm-Zentrale ist bereits reines Symbol und bleibt deshalb stehen —
      // sie kostet auf 390 px so wenig Breite wie der Griff daneben.
      setup();
      await waitFor(() => expect(screen.getByText('ETB-Inhalt')).toBeInTheDocument());
      expect(
        screen.queryByRole('radiogroup', { name: 'Farbschema wählen' }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('radiogroup', { name: 'Bediendichte wählen' }),
      ).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Benutzermenü' })).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Alarmton durch Klick entsperren' }),
      ).toBeInTheDocument();
    });

    it('hält Hamburger und Schließen-Knopf auf der A1-Trefffläche', async () => {
      setup();
      await waitFor(() => expect(screen.getByText('ETB-Inhalt')).toBeInTheDocument());

      const hamburger = screen.getByRole('button', { name: 'Navigation öffnen' });
      expect(hamburger.style.width).toBe('48px');
      expect(hamburger.style.height).toBe('48px');

      const suche = screen.getByRole('button', { name: 'Suchen' });
      expect(suche).toHaveAttribute('aria-label', 'Suchen');
      expect(suche.style.width).toBe('48px');
      expect(suche.style.height).toBe('48px');
      expect(suche.style.color).toBe('var(--lfh-kopf-vordergrund)');

      await userEvent.click(hamburger);
      // Der Drawer bringt seinen Schließen-Knopf selbst mit; dessen Trefffläche
      // ist von Haus aus kleiner als das A1-Maß und wird deshalb gesetzt.
      const schliessen = (await screen.findByRole('dialog')).querySelector<HTMLElement>(
        '.ant-drawer-close',
      )!;
      expect(schliessen.style.minWidth).toBe('48px');
      expect(schliessen.style.minHeight).toBe('48px');
    });
  });
});

describe('EinsatzLayout · Rail-Klick (LFH-337 · H12)', () => {
  it('springt beim Klick auf eine ANDERE Kategorie in deren erstes Modul', async () => {
    setup();
    await waitFor(() => expect(screen.getByText('ETB-Inhalt')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'Lage' }));

    // Die Aussage ist der PFAD, nicht der Panel-Zustand (AK5) — die Pfad-Sonde ist
    // dieselbe wie in `ModulStub.test.tsx`, hier als Geschwister der Routes gerendert.
    await waitFor(() => expect(pfad()).toMatch(/^\/einsaetze\/7\//));
    await waitFor(() => expect(pfad()).not.toBe('/einsaetze/7/etb'));
  });

  it('navigiert beim Klick auf die AKTIVE Kategorie nicht, sondern klappt nur zu', async () => {
    // Die Gegenaussage hält LFH-329/B1 am Leben: der Selbstklick ist der
    // Zuklapp-Umschalter mit Persistenz. Ohne sie wäre „nur fremde Kategorie
    // navigiert" unbewiesen — ein bedingungslos navigierender Klick färbte den
    // Test darüber ebenfalls grün.
    //
    // Startpunkt bewusst 'personen', nicht 'etb' (Fix-Runde 1): 'etb' ist das ERSTE
    // fertige Modul der Kategorie 'erfassung' — eine bedingungslos navigierende
    // Implementierung landete beim Klick auf „Erfassung" wieder exakt auf 'etb' und
    // die Pfad-Assertion bliebe grün, obwohl sie genau diesen Bug fangen soll. Mit
    // 'personen' als Startpunkt ändert ein bedingungsloser Sprung den Pfad wirklich.
    setup({}, {}, admin, '/einsaetze/7/personen');
    await waitFor(() => expect(screen.getByText('Personen-Inhalt')).toBeInTheDocument());
    const vorher = pfad();

    // „Erfassung" ist die Kategorie von 'personen' — der Klick trifft die aktive.
    await userEvent.click(screen.getByRole('button', { name: 'Erfassung' }));

    expect(pfad()).toBe(vorher);
    // Panel zugeklappt: ein Erfassung-Modul wie „Personen" steht nicht mehr im Baum
    // (dieselbe Abfrage wie im Bestandstest zum gemerkten Einklapp-Zustand oben).
    expect(screen.queryByRole('button', { name: 'Personen' })).not.toBeInTheDocument();
  });

  it('öffnet das Panel auch ohne freigegebenes Modul der Kategorie, navigiert aber nicht', async () => {
    // Kategorie 'lage' komplett per Override versteckt: der Resolver liefert `null`
    // (eigens getestet in modulRegistry.test.ts), der Fremdklick bleibt dann beim reinen
    // Aufklappen — ein Sprung ins Leere wäre schlechter als keiner (Kommentar an
    // `onKategorieKlick`).
    const lageVersteckt = Object.fromEntries(
      ['lage-dashboard', 'lagekarte', 'lageberichte', 'kraefteuebersicht', 'gefahrenzonen', 'lagemeldungen']
        .map((key) => [key, {
          einsatz_id: 7, modul_key: key, sichtbar: false,
          benoetigte_rolle: null, geaendert_at: null, geaendert_von: null,
        }]),
    );
    setup(lageVersteckt);
    await waitFor(() => expect(screen.getByText('ETB-Inhalt')).toBeInTheDocument());
    const vorher = pfad();

    await userEvent.click(screen.getByRole('button', { name: 'Lage' }));

    expect(pfad()).toBe(vorher);
    await waitFor(() =>
      expect(document.querySelector('[data-lfh="modul-panel"]')).not.toBeNull(),
    );
    const panel = document.querySelector('[data-lfh="modul-panel"]')!;
    expect(within(panel).getByText('Lage')).toBeInTheDocument();
  });
});

afterEach(() => vi.unstubAllGlobals());
