import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes, useLocation } from 'react-router';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { setzeViewportBreite } from '../test/viewport';
import { bedienzieleNachRolle, radiosImKopf, zaehleBedienziele } from '../test/kopfzeile';
import { AuthProvider } from '../auth/AuthContext';
import { CommandPaletteProvider } from '../command-palette/CommandPaletteProvider';
import EinsatzLayout, { einsatzKennung } from './EinsatzLayout';
import { leseZuletztModule, merkeModulBesuch } from './zuletztModule';
import { farbenDunkel } from '../theme/tokens';

vi.mock('./useModulZaehler', () => ({ useModulZaehler: () => ({}) }));

/**
 * Der gemerkte Rahmen-Zustand wird gegen ein HANDGESCHRIEBENES Literal geprüft,
 * nicht gegen die Konstante aus `navPersistenz` — sonst prüfte der Test die
 * Konstante gegen sich selbst.
 */
const EINGEKLAPPT = 'lfh:nav:eingeklappt';

const admin = {
  id: 1,
  anzeigename: 'Chef',
  benutzername: 'chef',
  system_rolle: 'admin',
  org_rolle: 'keine',
  aktiv: true,
  erstellt_at: '2026-05-23 10:00:00',
};
const einsatz = {
  id: 7,
  bezeichnung: 'Hochwasser Nord',
  stichwort: null,
  status: 'aktiv',
  begonnen_at: '2026-05-23 09:00:00',
  abgeschlossen_at: null,
  abgeschlossen_von: null,
  meine_rolle: 'einsatzleitung',
};

/**
 * Sonde für den aktuellen Pfad (Muster `ModulStub.test.tsx`) — beweist die echte
 * Navigation aus `onKategorieKlick` (LFH-337 · H12), statt nur den Panel-Zustand zu
 * lesen. Als Geschwister der `Routes` in `setup()` gerendert, damit sie unabhängig
 * davon steht, welche Kind-Route gerade matcht.
 */
function PfadAnzeige() {
  const { pathname, search } = useLocation();
  // `data-suche` für die Sprungmarken (LFH-620): ihr Ziel ist eine Query, kein Pfad.
  return (
    <span data-testid="pfad" data-suche={search}>
      {pathname}
    </span>
  );
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
  aktuellerBenutzer: typeof admin = admin,
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

  /**
   * Aufzeichnung am KLICK, nicht am Routenwechsel (LFH-337 · Fix-Welle, Befund B4).
   *
   * Die Vorfassung dieses Tests behauptete „Route betreten → gemerkt" und prüfte damit
   * genau das, was jetzt bewusst nicht mehr gilt: der Speicher trägt Wahlen, keine
   * Ankünfte. Ein Deep-Link von außen füllt ihn deshalb nicht — das ist die Konsequenz
   * der Entscheidung, nicht eine Lücke.
   */
  it('merkt ein per Klick gewähltes Modul im Zuletzt-Speicher (LFH-337 · H12)', async () => {
    localStorage.clear();
    setup();
    await waitFor(() => expect(screen.getByText('ETB-Inhalt')).toBeInTheDocument());
    // Die Ankunft auf /etb allein merkt NICHTS — die Gegenaussage zur Vorfassung, und
    // ohne sie bliebe der Test auch mit dem alten Routen-Effekt grün.
    expect(leseZuletztModule(7)).toEqual([]);

    await userEvent.click(screen.getByRole('button', { name: 'Personen' }));

    expect(await screen.findByText('Personen-Inhalt')).toBeInTheDocument();
    expect(leseZuletztModule(7)).toEqual(['personen']);
  });

  /**
   * Die Panel-Gruppe „Zuletzt" ist entfernt (Begründung an `ModulPanel`). Der Speicher
   * lebt für die Kommandopalette weiter und wird weiter gefüllt — gemerkte Module dürfen
   * im Rahmen deshalb nirgends mehr als zusätzliche Abkürzung auftauchen.
   *
   * 'lagekarte' liegt in 'lage', offen ist 'erfassung' (via /etb): stünde die Gruppe noch,
   * wäre „Lagekarte" hier ein Knopf. Die Vorbedingung (Rahmen steht, Panel offen) ist die
   * Hälfte, die die Abwesenheit zur Aussage macht.
   */
  it('zeigt gemerkte Module nicht als „Zuletzt"-Gruppe im Panel', async () => {
    localStorage.clear();
    merkeModulBesuch(7, 'lagekarte');
    setup();
    await waitFor(() => expect(screen.getByText('ETB-Inhalt')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Personen' })).toBeInTheDocument();
    expect(screen.queryByText('Zuletzt')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Lagekarte' })).toBeNull();
  });

  it('blendet ein verstecktes Modul aus der Navigation aus (LFH-132)', async () => {
    // 'personen' (Kategorie Erfassung) ausblenden; das Erfassung-Panel ist via
    // /etb offen. ETB bleibt sichtbar, Personen verschwindet aus der Nav.
    setup({
      personen: {
        einsatz_id: 7,
        modul_key: 'personen',
        sichtbar: false,
        benoetigte_rolle: null,
        geaendert_at: null,
        geaendert_von: null,
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
      constructor(url: string) {
        urls.push(url);
      }
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
   *
   * SEIT LFH-392 trägt diese Aussage der AK1-Zähler darunter (`radio: 0`) — ein
   * eigener Test auf die zwei Etiketten stand hier und ist gefallen: „Farbschema
   * wählen" kam mit `ThemeToggle.tsx` fort und existiert im Repo nicht mehr, die
   * Null darauf war durch keine Änderung am Produktivcode rot zu bekommen.
   */

  /**
   * AK 1 von LFH-392, kalibriert gegen den Bestand: vor dem Umbau zählte
   * dieselbe Abfrage 11 (5 Knöpfe + 6 Segment-Radios), danach 5. Die
   * Aufschlüsselung steht daneben, weil eine nackte Zahl beim Fehlschlag nicht
   * sagt, welche Sorte Ziel dazugekommen ist. Herleitung: `test/kopfzeile.ts`.
   */
  it('AK1 — die Kopfzeile trägt 5 Knöpfe und die Wortmarke (vorher 11 Ziele)', async () => {
    // Neuentwurf (21.09.2026): die Wortmarke `lifeline-hub` ist ab `lg` ein Link zur
    // Einsatzliste — ein Bedienziel mehr als LFH-392 zählte, keine Umschalter zurück.
    setup();
    await waitFor(() => expect(screen.getByText('ETB-Inhalt')).toBeInTheDocument());
    expect(bedienzieleNachRolle()).toEqual({ button: 5, radio: 0, link: 1 });
    expect(zaehleBedienziele()).toBe(6);
    expect(
      within(screen.getByRole('banner')).getByRole('link', { name: 'lifeline-hub' }),
    ).toHaveAttribute('href', '/einsaetze');
  });

  /**
   * AK 2 als PAAR: erreichbar statt bloß verschwunden. Wirkung prüft
   * `BenutzerMenu.test.tsx` (dort steht der `ThemeModeProvider`), hier nur
   * Erreichbarkeit — der Test-Wrapper montiert keinen Provider, die Hooks fallen
   * auf `system`/`kompakt` zurück.
   */
  it('AK2 — beide Achsen sind ab lg im Benutzermenü erreichbar', async () => {
    setup();
    await waitFor(() => expect(screen.getByText('ETB-Inhalt')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Benutzermenü' }));

    const menu = await screen.findByRole('menu');
    // Vorgabe seit dem Neuentwurf (21.09.2026): Nachtbetrieb trägt das Häkchen.
    expect(within(menu).getByRole('menuitem', { name: /Dunkel ✓/ })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: /^System$/ })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: /Kompakt ✓/ })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: /^Handschuh$/ })).toBeInTheDocument();
  });

  /**
   * Die Alarmzentrale ist von den Aktionen ABGESETZT (LFH-392) — seit dem Neuentwurf über
   * eine EIGENE Zelle der Kommandoleiste mit Haarlinie statt über einen Trenner im
   * Knopfrhythmus. Belegbar in jsdom ist die DOM-Semantik: die Alarm-Knöpfe stehen in der
   * Alarmzelle, Suche und Benutzermenü NICHT. Die sichtbare Linie belegt der Browser
   * (`e2e/kopfzeile-schmal.spec.ts`).
   */
  it('setzt die Alarmzentrale in eine eigene Zelle, abgesetzt von den Aktionen', async () => {
    setup();
    await waitFor(() => expect(screen.getByText('ETB-Inhalt')).toBeInTheDocument());

    const kopf = screen.getByRole('banner');
    const zelle = kopf.querySelector<HTMLElement>('[data-lfh="kopf-alarm"]')!;
    expect(zelle).not.toBeNull();
    expect(zelle).toContainElement(within(kopf).getByRole('button', { name: /Alarmton/ }));
    expect(zelle).not.toContainElement(within(kopf).getByRole('button', { name: 'Suchen' }));
    expect(zelle).not.toContainElement(within(kopf).getByRole('button', { name: 'Benutzermenü' }));
    // Kein Trenner-Element mehr — die Zelle trägt die Linie.
    expect(within(kopf).queryAllByRole('separator')).toHaveLength(0);
  });

  it('zeigt Statuspunkt, Einsatzname und — nur wenn vorhanden — die Einsatznummer', async () => {
    setup();
    const kopf = await screen.findByRole('banner');
    await waitFor(() =>
      expect(within(kopf).getByRole('img', { name: 'Einsatzstatus: Aktiv' })).toBeInTheDocument(),
    );
    // Der Fixture-Einsatz hat weder interne noch Leitstellennummer — dann steht KEINE da,
    // statt der Datenbank-`id` (Neuentwurf, Entscheidung 4: nichts erfinden).
    expect(kopf.querySelector('[data-lfh="kopf-einsatznummer"]')).toBeNull();
    expect(within(kopf).getByRole('button', { name: /Hochwasser Nord/ })).toBeInTheDocument();
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
      // Die Alarm-Zentrale bleibt stehen, WEIL sie ihren Zustand ausspricht:
      // beide Knöpfe tragen sichtbaren Text („Desktop blockiert" / „Ton bereit",
      // AlarmZentrale.tsx) plus `aria-label`. Hier stand bis LFH-392 das
      // Gegenteil — „bereits reines Symbol" — und das war am Bestand falsch;
      // genau der Text ist der Grund, dass sie nicht ins Menü wandert.
      //
      // Die Null darunter ist seit LFH-392 KEINE Breitenaussage mehr: die
      // Umschalter sind auf jeder Breite aus dem Kopf. Gezählt wird über die
      // ROLLE, nicht über die zwei Etiketten — die existieren im Repo nicht mehr,
      // eine Null darauf wäre nicht widerlegbar (siehe `test/kopfzeile.ts`).
      //
      // SEIT LFH-511 IST SIE AUF 390 px EIN ZIEL STATT ZWEIER — die Begründung
      // oben bleibt davon unberührt, sie ist sogar ihr Maßstab: das gebündelte
      // Ziel spricht seinen Zustand weiterhin aus („Ton blockiert"), beide
      // Steuerungen liegen vollständig beschriftet im Menü darunter. Zwei
      // beschriftete Knöpfe passten hier nicht (180 px verfügbar, 286 nötig) und
      // brachen um, was den Kopfinhalt auf 144 px in einem 96 px hohen Kopf
      // trieb. Gezählt wird deshalb EIN Ziel, nicht keines: verschwände die
      // Alarmzentrale ganz, wäre dieser Test ebenso rot.
      setup();
      await waitFor(() => expect(screen.getByText('ETB-Inhalt')).toBeInTheDocument());
      expect(radiosImKopf()).toBe(0);
      expect(screen.getByRole('button', { name: 'Benutzermenü' })).toBeInTheDocument();
      const alarm = screen.getByRole('button', { name: /^Alarmzentrale:/ });
      expect(alarm).toHaveTextContent('Ton blockiert');
      // Und die Einzelknöpfe der breiten Bauform stehen hier NICHT mehr — ohne
      // diese Hälfte wäre „ein Ziel" auch von drei Zielen erfüllt.
      expect(screen.queryByRole('button', { name: 'Alarmton durch Klick entsperren' })).toBeNull();
    });

    it('zeigt unter lg die Suche als Ikone und keine Wortmarke', async () => {
      // Gegenprobe zum Suchfeld ab lg: auf 390 px trägt die Leiste kein 520-px-Feld, und
      // die Wortmarke weicht dem Griff der Navigation.
      setup();
      await waitFor(() => expect(screen.getByText('ETB-Inhalt')).toBeInTheDocument());
      const kopf = screen.getByRole('banner');
      expect(within(kopf).queryByRole('link', { name: 'lifeline-hub' })).toBeNull();
      expect(within(kopf).getByRole('button', { name: 'Suchen' })).not.toHaveTextContent(
        'Modul, Einheit',
      );
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
      // Farbe aus der Nachtrolle des Rahmens — nicht aus dem Modus-Token (Kopf ist modusfest).
      expect(suche).toHaveStyle({ color: farbenDunkel.text });

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

describe('EinsatzLayout · Einsatzkennung im Kopf (Neuentwurf)', () => {
  it('nimmt die interne Nummer, sonst die Leitstellennummer, sonst keine', () => {
    expect(einsatzKennung({ einsatznummer_intern: 'E-2026-0431', leitstellen_nr: '4711' })).toBe(
      'E-2026-0431',
    );
    expect(einsatzKennung({ einsatznummer_intern: '  ', leitstellen_nr: '4711' })).toBe('4711');
    expect(einsatzKennung({ einsatznummer_intern: null, leitstellen_nr: null })).toBeNull();
    expect(einsatzKennung(undefined)).toBeNull();
  });
});

describe('EinsatzLayout · Rail-Klick (LFH-337 · H12)', () => {
  /**
   * Sprungmarke (LFH-620): der Klick führt ins ZIELmodul mit Sichtauftrag, die Hervorhebung
   * bleibt beim Modul, in dem man dann steht. Und er wird nicht als Modulbesuch gemerkt —
   * „Vermisste" ist kein Modulschlüssel.
   */
  it('springt über eine Sprungmarke ins Zielmodul, ohne sie als Besuch zu merken', async () => {
    localStorage.clear();
    setup();
    await waitFor(() => expect(screen.getByText('ETB-Inhalt')).toBeInTheDocument());

    await userEvent.click(
      screen.getByRole('button', { name: 'Vermisste, springt zu Personen, Filter Vermisst' }),
    );

    await waitFor(() => expect(pfad()).toBe('/einsaetze/7/personen'));
    expect(screen.getByTestId('pfad')).toHaveAttribute(
      'data-suche',
      '?filter=vermisst&ansicht=zeilen',
    );
    expect(screen.getByRole('button', { name: 'Personen' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(leseZuletztModule(7)).toEqual([]);
  });

  it('springt beim Klick auf eine ANDERE Kategorie in deren erstes Modul', async () => {
    setup();
    await waitFor(() => expect(screen.getByText('ETB-Inhalt')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'Lage' }));

    // Die Aussage ist der PFAD, nicht der Panel-Zustand (AK5) — die Pfad-Sonde ist
    // dieselbe wie in `ModulStub.test.tsx`, hier als Geschwister der Routes gerendert.
    //
    // Das ZIEL wird benannt, nicht nur „irgendwohin, aber nicht /etb" (Fix-Welle,
    // Befund B2): ein Resolver, der das erste Modul einer FALSCHEN Kategorie liefert,
    // bestünde die schwache Form. Nebenbei hebt die scharfe Fassung einen latenten Fall
    // ab — `erstesFreigegebenesModul` filtert nach `kategorie`, der Aufrufer navigiert
    // aber per `modulZielRoute`, das bei gesetztem `verweistAuf` in eine ANDERE
    // Kategorie spränge. Heute nutzt kein Registry-Eintrag `verweistAuf`; käme einer
    // dazu, färbte dieser Test rot statt es unbemerkt zu lassen.
    await waitFor(() => expect(pfad()).toBe('/einsaetze/7/lage-dashboard'));
  });

  /**
   * Die Gegenaussage zur Aufzeichnung (Fix-Welle, Befund B4): der Rail-Sprung landet NICHT
   * im „Zuletzt"-Speicher. Bei drei Plätzen und sechs Kategorien überschrieben sonst drei
   * Rail-Klicks die ganze Liste mit Zielen, die niemand gewählt hat.
   *
   * BEIDE Hälften, in dieser Reihenfolge: „nicht gemerkt" ist trivial wahr, wenn der Klick
   * auch gar nicht navigiert hat. Erst der belegte Pfad macht die leere Liste zur Aussage.
   */
  it('merkt den Rail-Sprung NICHT, obwohl er navigiert', async () => {
    localStorage.clear();
    setup();
    await waitFor(() => expect(screen.getByText('ETB-Inhalt')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'Lage' }));

    await waitFor(() => expect(pfad()).toBe('/einsaetze/7/lage-dashboard'));
    expect(leseZuletztModule(7)).toEqual([]);
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
      [
        'lage-dashboard',
        'lagekarte',
        'lageberichte',
        'kraefteuebersicht',
        'gefahrenzonen',
        'lagemeldungen',
      ].map((key) => [
        key,
        {
          einsatz_id: 7,
          modul_key: key,
          sichtbar: false,
          benoetigte_rolle: null,
          geaendert_at: null,
          geaendert_von: null,
        },
      ]),
    );
    setup(lageVersteckt);
    await waitFor(() => expect(screen.getByText('ETB-Inhalt')).toBeInTheDocument());
    const vorher = pfad();

    await userEvent.click(screen.getByRole('button', { name: 'Lage' }));

    expect(pfad()).toBe(vorher);
    // Generischer Typparameter statt `as HTMLElement` (Präzedenz Commit 23386c21,
    // `LageDashboardPage.test.tsx`): `querySelector` liefert sonst `Element`, `within()`
    // verlangt `HTMLElement`.
    await waitFor(() =>
      expect(document.querySelector<HTMLElement>('[data-lfh="modul-panel"]')).not.toBeNull(),
    );
    const panel = document.querySelector<HTMLElement>('[data-lfh="modul-panel"]')!;
    expect(within(panel).getByText('Lage')).toBeInTheDocument();
  });
});

afterEach(() => vi.unstubAllGlobals());
