import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes, useLocation } from 'react-router';
import { meHandler, server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { setzeViewportBreite } from '../test/viewport';
import { bedienzieleNachRolle, radiosImKopf, zaehleBedienziele } from '../test/kopfzeile';
import { CommandPaletteProvider } from '../command-palette/CommandPaletteProvider';
import EinsatzLayout, { einsatzKennung, navGriffMass } from './EinsatzLayout';
import { leseZuletztModule, merkeModulBesuch } from './zuletztModule';
import { dichten, farbenDunkel, rahmenFarben } from '../theme/tokens';
import { ThemeModeProvider } from '../theme/ThemeModeProvider';
import { adminFixture, freigabenFixture } from '../test/fixtures';
import type { ModulFreigaben } from '../api/types';

vi.mock('./useModulZaehler', () => ({ useModulZaehler: () => ({}) }));
// Der Unwetter-Wächter hängt am Modulzähler-Modul und hat eigene Tests (`wetter/`, LFH-663).
vi.mock('../wetter/UnwetterHinweis', () => ({ default: () => null }));

/**
 * Der gemerkte Rahmen-Zustand wird gegen ein HANDGESCHRIEBENES Literal geprüft, sonst prüfte
 * der Test die Konstante gegen sich selbst.
 */
const EINGEKLAPPT = 'lfh:nav:eingeklappt';

const admin = adminFixture({ anzeigename: 'Chef' });
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
 * Sonde für den aktuellen Pfad — beweist die echte Navigation, statt nur den Panel-Zustand zu
 * lesen. Als Geschwister der `Routes`, damit sie unabhängig von der matchenden Kind-Route steht.
 */
function PfadAnzeige() {
  const { pathname, search } = useLocation();
  // `data-suche` für die Sprungmarken: ihr Ziel ist eine Query, kein Pfad.
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
 * `freigaben` ist die Antwort des Servers auf `/modul-freigaben` (LFH-669). `fehler` schaltet die
 * beiden Abrufe einzeln auf 500: der Einsatz-Abruf ersetzt die ganze Seite, der Freigaben-Abruf
 * nur ein Banner darüber.
 */
function setup(
  freigaben: ModulFreigaben = freigabenFixture(),
  fehler: { einsatz?: boolean; freigaben?: boolean } = {},
  aktuellerBenutzer: typeof admin = admin,
  route: string = '/einsaetze/7/etb',
) {
  server.use(
    meHandler(aktuellerBenutzer),
    http.get('/api/einsaetze', () => HttpResponse.json([einsatz])),
    http.get('/api/einsaetze/7', () =>
      fehler.einsatz ? new HttpResponse(null, { status: 500 }) : HttpResponse.json(einsatz),
    ),
    http.get('/api/einsaetze/7/modul-freigaben', () =>
      fehler.freigaben ? new HttpResponse(null, { status: 500 }) : HttpResponse.json(freigaben),
    ),
    http.get('/api/einsaetze/7/einstellungen', () => HttpResponse.json({})),
  );
  return renderMitProviders(
    <CommandPaletteProvider>
      <Routes>
        <Route path="/einsaetze/:id" element={<EinsatzLayout />}>
          <Route path="etb" element={<div>ETB-Inhalt</div>} />
          {/* Zweites Ziel in einer ANDEREN Kategorie: nur so lässt sich belegen, dass ein Modulklick im
              Drawer navigiert und ihn schließt. */}
          <Route path="lagekarte" element={<div>Lagekarte-Inhalt</div>} />
          {/* Erstes freigegebenes Modul der Kategorie 'lage': der Rail-Klick auf eine fremde Kategorie
              navigiert dorthin; ohne diese Route bliebe der Rahmen leer. */}
          <Route path="lage-dashboard" element={<div>Dashboard-Inhalt</div>} />
          {/* Zweites Ziel INNERHALB von 'erfassung': 'personen' ist dort nicht das erste Modul ('etb') —
              nur so sagt die Pfad-Sonde beim Selbstklick-Test etwas aus. */}
          <Route path="personen" element={<div>Personen-Inhalt</div>} />
        </Route>
      </Routes>
      <PfadAnzeige />
    </CommandPaletteProvider>,
    { route },
  );
}

function setupRoute(route: string, childPath: string) {
  server.use(
    meHandler(admin),
    http.get('/api/einsaetze', () => HttpResponse.json([einsatz])),
    http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz)),
    http.get('/api/einsaetze/7/einstellungen', () => HttpResponse.json({})),
  );
  return renderMitProviders(
    <CommandPaletteProvider>
      <Routes>
        <Route path="/einsaetze/:id" element={<EinsatzLayout />}>
          <Route path={childPath} element={<div>Outlet-Inhalt</div>} />
        </Route>
      </Routes>
    </CommandPaletteProvider>,
    { route },
  );
}

describe('EinsatzLayout', () => {
  /**
   * LFH-438: eine verbogene Einsatz-ID (Hand-URL, kaputtes Lesezeichen) führt auf die Einsatzliste,
   * wie die Detailseiten unter `pages/`. Vorher entstand `NaN` und damit Abrufe gegen
   * `/api/einsaetze/NaN`; die Anfrage-Sonde belegt, dass der Rahmen gar nicht erst abruft.
   */
  it.each(['abc', '0', '-3', '1.5'])(
    'leitet bei ungültiger Einsatz-ID „%s“ auf die Einsatzliste um, ohne abzurufen',
    async (id) => {
      const anfragen: string[] = [];
      const sonde = ({ request }: { request: Request }) => {
        anfragen.push(new URL(request.url).pathname);
      };
      server.events.on('request:start', sonde);
      try {
        server.use(meHandler(admin));
        renderMitProviders(
          <CommandPaletteProvider>
            <Routes>
              <Route path="/einsaetze" element={<div>Einsatzliste</div>} />
              <Route path="/einsaetze/:id" element={<EinsatzLayout />}>
                <Route path="etb" element={<div>ETB-Inhalt</div>} />
              </Route>
            </Routes>
            <PfadAnzeige />
          </CommandPaletteProvider>,
          { route: `/einsaetze/${id}/etb` },
        );
        expect(await screen.findByText('Einsatzliste')).toBeInTheDocument();
        expect(pfad()).toBe('/einsaetze');
        expect(screen.queryByText('ETB-Inhalt')).not.toBeInTheDocument();
        expect(anfragen.filter((a) => a.startsWith('/api/einsaetze/'))).toEqual([]);
      } finally {
        server.events.removeListener('request:start', sonde);
      }
    },
  );

  it('zeigt Switcher mit Einsatznamen, Kategorie-Rail und Outlet-Inhalt', async () => {
    setup();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Hochwasser Nord/ })).toBeInTheDocument(),
    );
    expect(screen.getByRole('navigation', { name: 'Kategorien' })).toBeInTheDocument();
    expect(screen.getByText('ETB-Inhalt')).toBeInTheDocument();
  });

  it('setzt den Kopfgrund aus rahmenFarben.grund, statt antds Header-Default zu erben (LFH-437)', async () => {
    setup();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Hochwasser Nord/ })).toBeInTheDocument(),
    );
    // Gegenstück zu `AppLayout.test.tsx`: beide Kopfleisten tragen ihren Grund selbst, und
    // `theme/rahmenKontrast.test.ts` rechnet jeden Text darauf gegen genau diesen Wert.
    expect(screen.getByRole('banner')).toHaveStyle({ backgroundColor: rahmenFarben.grund });
  });

  /**
   * Aufzeichnung am KLICK, nicht am Routenwechsel: der Speicher trägt Wahlen, keine Ankünfte.
   * Ein Deep-Link von außen füllt ihn deshalb nicht.
   */
  it('merkt ein per Klick gewähltes Modul im Zuletzt-Speicher (LFH-337 · H12)', async () => {
    localStorage.clear();
    setup();
    await waitFor(() => expect(screen.getByText('ETB-Inhalt')).toBeInTheDocument());
    // Die Ankunft auf /etb allein merkt NICHTS — ohne diese Gegenaussage bliebe der Test auch mit
    // einem Routen-Effekt grün.
    expect(leseZuletztModule(admin.id, 7)).toEqual([]);

    await userEvent.click(screen.getByRole('button', { name: 'Personen' }));

    expect(await screen.findByText('Personen-Inhalt')).toBeInTheDocument();
    expect(leseZuletztModule(admin.id, 7)).toEqual(['personen']);
  });

  /**
   * Die Panel-Gruppe „Zuletzt" gibt es nicht (Begründung an `ModulPanel`); der Speicher lebt für
   * die Kommandopalette. 'lagekarte' liegt in 'lage', offen ist 'erfassung': stünde die Gruppe
   * noch, wäre „Lagekarte" hier ein Knopf. Die Vorbedingung macht die Abwesenheit zur Aussage.
   */
  it('zeigt gemerkte Module nicht als „Zuletzt"-Gruppe im Panel', async () => {
    localStorage.clear();
    merkeModulBesuch(admin.id, 7, 'lagekarte');
    setup();
    await waitFor(() => expect(screen.getByText('ETB-Inhalt')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Personen' })).toBeInTheDocument();
    expect(screen.queryByText('Zuletzt')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Lagekarte' })).toBeNull();
  });

  it('blendet ein verstecktes Modul aus der Navigation aus (LFH-132)', async () => {
    // 'personen' ausblenden; das Erfassung-Panel ist via /etb offen.
    setup(freigabenFixture({ personen: { sichtbar: false, zugriff: false } }));
    await waitFor(() => expect(screen.getByText('ETB-Inhalt')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'ETB' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Personen' })).not.toBeInTheDocument();
  });

  it('hält das aktive Modul auf einer Sub-Route hervorgehoben (Panel bleibt offen)', async () => {
    // Letztes Segment ist „liste"; das aktive Modul wird am Segment nach der Einsatz-ID erkannt —
    // sonst klappt das Panel beim UHS-Redirect zu.
    setupRoute('/einsaetze/7/unfallhilfsstellen/liste', 'unfallhilfsstellen/liste');
    expect(await screen.findByRole('button', { name: 'Unfallhilfsstellen' })).toBeInTheDocument();
  });

  it('öffnet genau EINE SSE-Verbindung für den Einsatz (Stream im Layout, LFH-97)', async () => {
    // Der Live-Stream ist im Layout gehoistet → genau eine Verbindung pro Einsatz, unabhängig von
    // der offenen Modul-Seite (HTTP/1.1-6-Limit).
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
   * Partnerpaar zum Einsatz-Abruf, Hälfte 1: die Großform steht, und der Rahmen daneben NICHT —
   * sonst stellte die Kindseite eine zweite Fehlermeldung dazu. Angesetzt an der Überschrift; die
   * Detailzeile hängt am Fehlerkörper.
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
   * Hälfte 2 — dieselben Literale. Ohne sie wäre die Negativhälfte auch bei umformulierter
   * Überschrift grün.
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
   * Fehlen die Freigaben, zeigt die Navigation jedes ausgeblendete oder gesperrte Modul offen
   * (LFH-669, D3). Keine Sackgasse, aber eine Navigation, die mehr zeigt als konfiguriert, muss
   * sich dazu bekennen.
   */
  it('bei gescheitertem Freigaben-Abruf warnt ein Banner, der Rahmen bleibt bedienbar', async () => {
    setup(freigabenFixture(), { freigaben: true });
    await waitFor(() => expect(screen.getByText('ETB-Inhalt')).toBeInTheDocument());
    expect(
      screen.getByText(
        'Modulfreigaben konnten nicht geladen werden — die Navigation zeigt womöglich Module, die für diesen Einsatz ausgeblendet oder gesperrt sind.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Kategorien' })).toBeInTheDocument();
  });

  it('ohne Freigaben-Fehler steht kein Warnbanner über dem Rahmen', async () => {
    setup();
    await waitFor(() => expect(screen.getByText('ETB-Inhalt')).toBeInTheDocument());
    expect(
      screen.queryByText(
        'Modulfreigaben konnten nicht geladen werden — die Navigation zeigt womöglich Module, die für diesen Einsatz ausgeblendet oder gesperrt sind.',
      ),
    ).not.toBeInTheDocument();
  });

  // Gegenprobe zum Schmal-Block: sonst wäre der Schmal-Test auch grün, wenn der Hamburger bei
  // JEDER Breite erschiene.
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
   * Gegenprobe zum Kopfzeilen-Block unter lg; die Aussage trägt der Zähler darunter
   * (`radio: 0`), weil eine `queryBy…`-Null auf nicht mehr existierende Etiketten nicht
   * widerlegbar wäre.
   */

  /**
   * Die Kopfzeile trägt 5 Knöpfe und die Wortmarke. Die Aufschlüsselung steht daneben, weil eine
   * nackte Zahl beim Fehlschlag nicht sagt, welche Sorte Ziel dazukam (`test/kopfzeile.ts`).
   */
  it('AK1 — die Kopfzeile trägt 5 Knöpfe und die Wortmarke (vorher 11 Ziele)', async () => {
    // Die Wortmarke ist ab `lg` ein Link zur Einsatzliste — ein Bedienziel, kein Umschalter.
    setup();
    await waitFor(() => expect(screen.getByText('ETB-Inhalt')).toBeInTheDocument());
    expect(bedienzieleNachRolle()).toEqual({ button: 5, radio: 0, link: 1 });
    expect(zaehleBedienziele()).toBe(6);
    expect(
      within(screen.getByRole('banner')).getByRole('link', { name: 'lifeline-hub' }),
    ).toHaveAttribute('href', '/einsaetze');
  });

  /**
   * Beide Achsen sind ab lg im Benutzermenü erreichbar. Die Wirkung prüft
   * `BenutzerMenu.test.tsx`; hier fehlt der `ThemeModeProvider`, die Hooks fallen auf
   * `system`/`kompakt` zurück.
   */
  it('AK2 — beide Achsen sind ab lg im Benutzermenü erreichbar', async () => {
    setup();
    await waitFor(() => expect(screen.getByText('ETB-Inhalt')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Benutzermenü' }));

    const menu = await screen.findByRole('menu');
    // Vorgabe: Nachtbetrieb trägt das Häkchen.
    expect(within(menu).getByRole('menuitem', { name: /Dunkel ✓/ })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: /^System$/ })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: /Kompakt ✓/ })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: /^Handschuh$/ })).toBeInTheDocument();
  });

  /**
   * Die Alarmzentrale steht in EIGENER Zelle mit Haarlinie, abgesetzt von den Aktionen. In jsdom
   * belegbar ist die DOM-Semantik; die sichtbare Linie belegt `e2e/kopfzeile-schmal.spec.ts`.
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
    // Ohne interne oder Leitstellennummer steht KEINE Nummer da — nicht die Datenbank-`id`.
    expect(kopf.querySelector('[data-lfh="kopf-einsatznummer"]')).toBeNull();
    expect(within(kopf).getByRole('button', { name: /Hochwasser Nord/ })).toBeInTheDocument();
  });

  it('trägt die Funktion aus dem Backend im Benutzermenü, nicht aus den Sachgebieten (LFH-615)', async () => {
    // Beide Felder widersprechen sich absichtlich: maßgeblich ist allein `meine_funktion`. Ab `xl`
    // trägt der Trigger die Funktion, darunter nur die Initialen.
    setzeViewportBreite(1440);
    server.use(
      meHandler(admin),
      http.get('/api/einsaetze', () => HttpResponse.json([einsatz])),
      http.get('/api/einsaetze/7', () =>
        HttpResponse.json({ ...einsatz, meine_sachgebiete: ['s4'], meine_funktion: 'S2/S3' }),
      ),
      http.get('/api/einsaetze/7/einstellungen', () => HttpResponse.json({})),
    );
    renderMitProviders(
      <CommandPaletteProvider>
        <Routes>
          <Route path="/einsaetze/:id" element={<EinsatzLayout />}>
            <Route path="etb" element={<div>ETB-Inhalt</div>} />
          </Route>
        </Routes>
      </CommandPaletteProvider>,
      { route: '/einsaetze/7/etb' },
    );
    const menu = await screen.findByRole('button', { name: 'Benutzermenü' });
    await waitFor(() => expect(menu.textContent).toContain('S2/S3'));
    expect(menu.textContent).not.toContain('Versorgung');
  });

  it('rendert den sichtbaren Such-Trigger im Einsatz-Workspace', async () => {
    setup();
    await waitFor(() => expect(screen.getByText('ETB-Inhalt')).toBeInTheDocument());

    expect(screen.getByRole('button', { name: 'Suchen' })).toBeInTheDocument();
  });

  it('der Einsatzname sitzt im Restbreiten-Rahmen', async () => {
    // Der Rahmen ist eine Hälfte der Kürzung, die andere (Ellipsis, `title`) sitzt im Switcher.
    // Ohne `min-width: 0` kürzt ein Flex-Kind nicht, sondern schiebt seine Nachbarn hinaus.
    setup();
    // `parentElement` ist belastbar: antds Dropdown klont sein Kind, statt es einzupacken.
    const switcher = await screen.findByRole('button', { name: /Hochwasser Nord/ });
    const rahmen = switcher.parentElement!;
    expect(rahmen.style.minWidth).toBe('0px');
    expect(rahmen.style.flexGrow).toBe('1');
    // `flex-basis: 0`: mit `auto` wüchse der Rahmen mit einem langen Namen über die Kopfzeile.
    expect(rahmen.style.flexBasis).toBe('0px');
  });

  /**
   * Der gemerkte Einklapp-Zustand ist ein EIGENES Boolean neben `offeneKategorie`: die Rail
   * behält ihre Hervorhebung (WELCHE Kategorie), das Panel verschwindet (OB offen), und der
   * Angleich-Effekt fasst das Flag nicht an.
   */
  it('merkt das eingeklappte Panel über einen Neu-Mount (lfh:nav:eingeklappt)', async () => {
    setup();
    await waitFor(() => expect(screen.getByRole('button', { name: 'ETB' })).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'Erfassung' }));

    expect(screen.queryByRole('button', { name: 'ETB' })).not.toBeInTheDocument();
    // Die Rail bleibt auf der Kategorie — sonst wäre „zugeklappt" von „keine Kategorie aktiv"
    // nicht zu unterscheiden.
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
   * `setzeViewportBreite` MUSS vor dem Render laufen: antds Beobachter liest `matches` nur beim
   * Abonnieren. Dass im Breitstand kein Drawer bleibt, ist baulich zugesichert (dort wird er
   * nicht gerendert) und oben belegt.
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
      // Genau EINE Navigations-Landmarke — die Rail darf im Drawer-Zustand nicht zusätzlich im Baum
      // stehen.
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
      // Die Alarmzentrale bleibt, weil sie ihren Zustand ausspricht (sichtbarer Text plus
      // `aria-label`). Auf 390 px ist sie EIN gebündeltes Ziel, das seinen Zustand weiter nennt
      // („Ton blockiert"), mit beiden Steuerungen beschriftet im Menü — zwei Knöpfe brächen dort um.
      // Gezählt wird EIN Ziel, nicht keines: verschwände sie ganz, wäre der Test ebenso rot. Die
      // Null für Umschalter zählt über die ROLLE.
      setup();
      await waitFor(() => expect(screen.getByText('ETB-Inhalt')).toBeInTheDocument());
      expect(radiosImKopf()).toBe(0);
      expect(screen.getByRole('button', { name: 'Benutzermenü' })).toBeInTheDocument();
      const alarm = screen.getByRole('button', { name: /^Alarmzentrale:/ });
      expect(alarm).toHaveTextContent('Ton blockiert');
      // Die Einzelknöpfe der breiten Bauform stehen hier NICHT — sonst erfüllten auch drei Ziele
      // „ein Ziel".
      expect(screen.queryByRole('button', { name: 'Alarmton durch Klick entsperren' })).toBeNull();
    });

    it('zeigt unter lg die Suche als Icon und keine Wortmarke', async () => {
      // Auf 390 px kein Suchfeld, und die Wortmarke weicht dem Griff der Navigation.
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
      // Farbe aus der Nachtrolle des Rahmens — der Kopf ist modusfest.
      expect(suche).toHaveStyle({ color: farbenDunkel.text });

      await userEvent.click(hamburger);
      // Der Schließen-Knopf des Drawers ist von Haus aus kleiner als 48 px und wird gesetzt.
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
   * Sprungmarke: der Klick führt ins ZIELmodul mit Sichtauftrag, die Hervorhebung bleibt beim
   * Modul, in dem man dann steht, und „Vermisste" wird nicht als Modulbesuch gemerkt.
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
    expect(leseZuletztModule(admin.id, 7)).toEqual([]);
  });

  it('springt beim Klick auf eine ANDERE Kategorie in deren erstes Modul', async () => {
    setup();
    await waitFor(() => expect(screen.getByText('ETB-Inhalt')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'Lage' }));

    // Die Aussage ist der PFAD, und das ZIEL wird benannt: ein Resolver, der das erste Modul einer
    // FALSCHEN Kategorie liefert, bestünde eine schwächere Form. Käme ein `verweistAuf`-Eintrag
    // dazu (er spränge in eine andere Kategorie), färbte sich dieser Test rot.
    await waitFor(() => expect(pfad()).toBe('/einsaetze/7/lage-dashboard'));
  });

  /**
   * Der Rail-Sprung landet NICHT im „Zuletzt"-Speicher, sonst überschrieben drei Rail-Klicks die
   * ganze Liste. Beide Hälften: „nicht gemerkt" wäre trivial, hätte der Klick nicht navigiert.
   */
  it('merkt den Rail-Sprung NICHT, obwohl er navigiert', async () => {
    localStorage.clear();
    setup();
    await waitFor(() => expect(screen.getByText('ETB-Inhalt')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'Lage' }));

    await waitFor(() => expect(pfad()).toBe('/einsaetze/7/lage-dashboard'));
    expect(leseZuletztModule(admin.id, 7)).toEqual([]);
  });

  it('navigiert beim Klick auf die AKTIVE Kategorie nicht, sondern klappt nur zu', async () => {
    // Der Selbstklick ist der Zuklapp-Umschalter mit Persistenz; ohne diese Gegenaussage färbte
    // auch ein bedingungslos navigierender Klick den Test darüber grün. Startpunkt 'personen',
    // nicht 'etb' (das erste Modul der Kategorie) — sonst änderte ein falscher Sprung den Pfad nicht.
    setup(freigabenFixture(), {}, admin, '/einsaetze/7/personen');
    await waitFor(() => expect(screen.getByText('Personen-Inhalt')).toBeInTheDocument());
    const vorher = pfad();

    // „Erfassung" ist die Kategorie von 'personen' — der Klick trifft die aktive.
    await userEvent.click(screen.getByRole('button', { name: 'Erfassung' }));

    expect(pfad()).toBe(vorher);
    // Panel zugeklappt: ein Erfassung-Modul wie „Personen" steht nicht mehr im Baum
    // (dieselbe Abfrage wie im Bestandstest zum gemerkten Einklapp-Zustand oben).
    expect(screen.queryByRole('button', { name: 'Personen' })).not.toBeInTheDocument();
  });

  /**
   * Server sagt `zugriff: false` (LFH-669): das Modul steht gesperrt in der Navigation, und der
   * Rail-Sprung der Kategorie überspringt es — er landet im nächsten freien Modul.
   */
  it('überspringt beim Rail-Sprung ein gesperrtes Modul (LFH-669)', async () => {
    setup(
      freigabenFixture({
        'lage-dashboard': { zugriff: false },
        personen: { zugriff: false },
      }),
    );
    await waitFor(() => expect(screen.getByText('ETB-Inhalt')).toBeInTheDocument());
    // Erst wenn die Freigaben da sind, steht das gesperrte Modul mit Schloss in der Liste.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Personen' })).toBeDisabled());
    expect(screen.getByRole('button', { name: 'Personen' })).toHaveAttribute(
      'title',
      'Keine Berechtigung',
    );

    await userEvent.click(screen.getByRole('button', { name: 'Lage' }));

    await waitFor(() => expect(pfad()).toBe('/einsaetze/7/lagekarte'));
    expect(screen.getByRole('button', { name: 'Dashboard' })).toBeDisabled();
  });

  it('öffnet das Panel auch ohne freigegebenes Modul der Kategorie, navigiert aber nicht', async () => {
    // Kategorie 'lage' komplett ausgeblendet: der Resolver liefert `null`, der Fremdklick klappt
    // nur auf — ein Sprung ins Leere wäre schlechter als keiner.
    const lageVersteckt = freigabenFixture(
      Object.fromEntries(
        [
          'lage-dashboard',
          'lagekarte',
          'lageberichte',
          'gefahrenzonen',
          'wetter-pegel',
          'lagemeldungen',
        ].map((key) => [key, { sichtbar: false, zugriff: false }]),
      ),
    );
    setup(lageVersteckt);
    await waitFor(() => expect(screen.getByText('ETB-Inhalt')).toBeInTheDocument());
    const vorher = pfad();

    await userEvent.click(screen.getByRole('button', { name: 'Lage' }));

    expect(pfad()).toBe(vorher);
    // Generischer Typparameter statt `as HTMLElement`: `within()` verlangt `HTMLElement`.
    await waitFor(() =>
      expect(document.querySelector<HTMLElement>('[data-lfh="modul-panel"]')).not.toBeNull(),
    );
    const panel = document.querySelector<HTMLElement>('[data-lfh="modul-panel"]')!;
    expect(within(panel).getByText('Lage')).toBeInTheDocument();
  });
});

afterEach(() => vi.unstubAllGlobals());

/**
 * Die zwei Griffe des Drawer-Zweigs OHNE Rendern — `test/utils.tsx` montiert ein nacktes
 * `ConfigProvider`, `useToken()` kennt dort die Staffel nicht. Böden als LITERALE.
 */
describe('EinsatzLayout · Griffmaß des Drawer-Zweigs (LFH-384)', () => {
  const griff = (s: keyof typeof dichten) =>
    navGriffMass({ controlHeight: dichten[s].zeilenhoehe });

  it('hält den A1-Boden von 48 px und wächst in `handschuh` auf 72', () => {
    // `Math.max`, nicht `??`: mit `??` stände in `kompakt` 30, mit fester 48 in `handschuh` 48.
    expect(griff('kompakt')).toBe(48);
    expect(griff('komfortabel')).toBe(48);
    expect(griff('handschuh')).toBe(72);
  });
});

/**
 * Die Warnsperre des Helligkeitsreglers am Rahmen (LFH-397, design.md D3): nur das Layout
 * steht für den ganzen Einsatz, deshalb meldet ES die Warnung. Gemessen am Austritt
 * (`data-helligkeit` am <html>), mit echtem `ThemeModeProvider` — der Test-Wrapper hängt
 * keinen auf, und ohne ihn liefe `useWarnsperre` ins Leere.
 */
describe('Warnsperre des Helligkeitsreglers (LFH-397)', () => {
  afterEach(() => {
    localStorage.removeItem('lifeline-hub.helligkeit');
    delete document.documentElement.dataset.helligkeit;
  });

  function mitWarnstufe(stufe: string, ...weitere: Parameters<typeof server.use>) {
    localStorage.setItem('lifeline-hub.helligkeit', '40');
    server.use(
      ...weitere,
      meHandler(admin),
      http.get('/api/einsaetze', () => HttpResponse.json([einsatz])),
      http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz)),
      http.get('/api/einsaetze/7/einstellungen', () => HttpResponse.json({})),
      http.get('/api/einsaetze/7/gefahrengebiete', () =>
        HttpResponse.json([
          { id: 1, einsatz_id: 7, hoechste_warnstufe: stufe, label: 'Deich', zonen_ids: [] },
        ]),
      ),
    );
    return renderMitProviders(
      <ThemeModeProvider>
        <CommandPaletteProvider>
          <Routes>
            <Route path="/einsaetze/:id" element={<EinsatzLayout />}>
              <Route path="etb" element={<div>ETB-Inhalt</div>} />
            </Route>
            <Route path="/einsaetze" element={<div>Einsatzauswahl</div>} />
          </Routes>
        </CommandPaletteProvider>
      </ThemeModeProvider>,
      { route: '/einsaetze/7/etb' },
    );
  }

  it('Gefahrengebiet „akut": Wahl 40 %, wirksam der Boden 80 %', async () => {
    mitWarnstufe('akut');
    await screen.findByText('ETB-Inhalt');
    await waitFor(() => expect(document.documentElement.dataset.helligkeit).toBe('80'));
    expect(localStorage.getItem('lifeline-hub.helligkeit')).toBe('40');
  });

  it('Gefahrengebiet „mittel": keine Sperre, die Wahl 40 % wirkt', async () => {
    mitWarnstufe('mittel');
    await screen.findByText('ETB-Inhalt');
    // Einen Takt über den Abruf hinaus warten — ein vorzeitiges „40" belegte nichts.
    await new Promise((r) => setTimeout(r, 50));
    expect(document.documentElement.dataset.helligkeit).toBe('40');
  });

  it('Unwetter „extrem" gilt jetzt: Wahl 40 %, wirksam der Boden 80 % (LFH-774)', async () => {
    // Dass Sperre und Modulzähler EIN Cache-Fach teilen, belegt `useAktiveWarnung.test.tsx`
    // (der Modulzähler ist hier weggemockt).
    const um = (ms: number) => new Date(Date.now() + ms).toISOString();
    mitWarnstufe(
      'keine',
      http.get('/api/einsaetze/7/wetter', () =>
        HttpResponse.json({
          warnungen: {
            zustand: 'ok',
            abgerufen_at: um(-60_000),
            daten: [
              {
                stufe: 'extrem',
                ereignis: 'ORKANBÖEN',
                ueberschrift: 'Amtliche UNWETTERWARNUNG vor EXTREMEN ORKANBÖEN',
                beginn: um(-3_600_000),
                ende: um(3_600_000),
              },
            ],
          },
          vorhersage: { zustand: 'kein_ort' },
        }),
      ),
    );
    await screen.findByText('ETB-Inhalt');
    await waitFor(() => expect(document.documentElement.dataset.helligkeit).toBe('80'));
    expect(localStorage.getItem('lifeline-hub.helligkeit')).toBe('40');
  });
});
