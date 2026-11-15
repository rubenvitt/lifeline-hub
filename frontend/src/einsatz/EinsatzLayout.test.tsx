import { http, HttpResponse } from 'msw';
import { skipToken, useQuery } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes, useLocation } from 'react-router';
import { meHandler, server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { sendeBreitenAenderung, setzeViewportBreite } from '../test/viewport';
import { bedienzieleNachRolle, radiosImKopf, zaehleBedienziele } from '../test/kopfzeile';
import { CommandPaletteProvider } from '../command-palette/CommandPaletteProvider';
import EinsatzLayout, { navGriffMass } from './EinsatzLayout';
import AltpfadWeiterleitung from './AltpfadWeiterleitung';
import { einsatzKennung } from './einsatzKennung';
import { leseZuletztModule, merkeModulBesuch } from './zuletztModule';
import { leseLetztenOrt } from './letzterOrt';
import { useEinsatzRahmen } from './EinsatzRahmenKontext';
import { dichten, farbenDunkel, rahmenFarben } from '../theme/tokens';
import { ThemeModeProvider } from '../theme/ThemeModeProvider';
import { adminFixture, benutzerFixture, freigabenFixture } from '../test/fixtures';
import type { BenutzerAnzeige, ModulFreigaben } from '../api/types';
import { einsatzKeys } from '../api/queryKeys';
import { queryNavEintrag } from './navEintragTest';

vi.mock('./useModulZaehler', () => ({
  useModulZaehler: () => ({}),
}));
// Der Unwetter-Wächter hängt am Modulzähler-Modul und hat eigene Tests (`wetter/`, LFH-663).
vi.mock('../wetter/UnwetterHinweis', () => ({ default: () => null }));

/**
 * Der gemerkte Rahmen-Zustand wird gegen ein HANDGESCHRIEBENES Literal geprüft, sonst prüfte
 * der Test die Konstante gegen sich selbst.
 */
const EINGEKLAPPT = 'lfh:nav:eingeklappt';

/** Ab `xl` ist das Modulpanel ohne Wahl offen (LFH-952); die Testbreite 1024 liegt darunter. */
const XL = 1440;

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

/**
 * Sonde für die Modulfreigaben (LFH-788): erscheint erst, wenn die Server-Antwort im Cache steht.
 * Sie hängt am selben Key wie der Rahmen und rendert deshalb im selben Durchgang mit ihm; ein
 * eigener Abruf (`skipToken`) entsteht nicht. Ohne sie gibt es bei den vollen Freigaben kein
 * Zeichen, dass sie angekommen sind — bis dahin zeigt die Navigation jedes Modul offen und der
 * Rail-Sprung geht ins Leere.
 */
function FreigabenSonde() {
  const { data } = useQuery({ queryKey: einsatzKeys.modulFreigaben(7), queryFn: skipToken });
  return data ? <span data-testid="freigaben-da" /> : null;
}

/** Wartet, bis der Rahmen mit den Freigaben des Servers gerendert hat (Anker vor einem Klick). */
async function freigabenAngekommen() {
  expect(await screen.findByTestId('freigaben-da')).toBeInTheDocument();
}

/** Inhalt des Informationstelefons: zeigt, welchen Anruf die Adresse ansteuert. */
function AnrufSonde() {
  const { search } = useLocation();
  return <div>{`Anruf ${new URLSearchParams(search).get('anruf') ?? '—'}`}</div>;
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
      <FreigabenSonde />
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
   * LFH-952 (D1), LLH-1728 (D1): der Kopf klebt über dem Inhalt, in jeder Breite. Die gemessene
   * Höhe prüft `components/rahmenOben.test.tsx`, das Kleben im Browser
   * `e2e/rahmen-stehen-bleiben.spec.ts`.
   */
  it('ab md klebt der Kopf auf der Rahmenebene (LFH-952)', async () => {
    setup();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Hochwasser Nord/ })).toBeInTheDocument(),
    );
    const kopf = screen.getByRole('banner');
    expect(kopf).toHaveAttribute('data-lfh', 'rahmen-kopf');
    expect(kopf).toHaveStyle({ position: 'sticky', top: '0px', zIndex: '100' });
  });

  it('unter md klebt der Kopf ebenfalls (LLH-1728)', async () => {
    setzeViewportBreite(390);
    setup();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Hochwasser Nord/ })).toBeInTheDocument(),
    );
    expect(screen.getByRole('banner')).toHaveStyle({
      position: 'sticky',
      top: '0px',
      zIndex: '100',
    });
  });

  /**
   * Aufzeichnung am KLICK, nicht am Routenwechsel: der Speicher trägt Wahlen, keine Ankünfte.
   * Ein Deep-Link von außen füllt ihn deshalb nicht.
   */
  it('merkt ein per Klick gewähltes Modul im Zuletzt-Speicher (LFH-337 · H12)', async () => {
    setzeViewportBreite(XL); // Panel ohne Wahl offen (LFH-952)
    localStorage.clear();
    setup();
    await waitFor(() => expect(screen.getByText('ETB-Inhalt')).toBeInTheDocument());
    // Die Ankunft auf /etb allein merkt NICHTS — ohne diese Gegenaussage bliebe der Test auch mit
    // einem Routen-Effekt grün.
    expect(leseZuletztModule(admin.id, 7)).toEqual([]);

    await userEvent.click(screen.getByRole('link', { name: 'Betroffene' }));

    expect(await screen.findByText('Personen-Inhalt')).toBeInTheDocument();
    expect(leseZuletztModule(admin.id, 7)).toEqual(['personen']);
  });

  /**
   * Die Panel-Gruppe „Zuletzt" gibt es nicht (Begründung an `ModulPanel`); der Speicher lebt für
   * die Kommandopalette. 'lagekarte' liegt in 'lage', offen ist 'erfassung': stünde die Gruppe
   * noch, wäre „Lagekarte" hier ein Knopf. Die Vorbedingung macht die Abwesenheit zur Aussage.
   */
  it('zeigt gemerkte Module nicht als „Zuletzt"-Gruppe im Panel', async () => {
    setzeViewportBreite(XL); // Panel ohne Wahl offen (LFH-952)
    localStorage.clear();
    merkeModulBesuch(admin.id, 7, 'lagekarte');
    setup();
    await waitFor(() => expect(screen.getByText('ETB-Inhalt')).toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'Betroffene' })).toBeInTheDocument();
    expect(screen.queryByText('Zuletzt')).toBeNull();
    expect(queryNavEintrag('Lagekarte')).toBeNull();
  });

  it('blendet ein verstecktes Modul aus der Navigation aus (LFH-132)', async () => {
    setzeViewportBreite(XL); // Panel ohne Wahl offen (LFH-952)
    // 'personen' ausblenden; das Erfassung-Panel ist via /etb offen.
    setup(freigabenFixture({ personen: { sichtbar: false, zugriff: false } }));
    // Erst der Panel-Anker, dann die Abwesenheit ABWARTEN: bis die Freigaben ankommen, steht
    // „Personen" offen da (LFH-788). Der ETB-Inhalt allein sagt darüber nichts.
    expect(await screen.findByRole('link', { name: 'ETB' })).toBeInTheDocument();
    await waitFor(() => expect(queryNavEintrag('Betroffene')).not.toBeInTheDocument());
  });

  it('hält das aktive Modul auf einer Sub-Route hervorgehoben (Panel bleibt offen)', async () => {
    setzeViewportBreite(XL); // Panel ohne Wahl offen (LFH-952)
    // Letztes Segment ist „liste"; das aktive Modul wird am Segment nach der Einsatz-ID erkannt —
    // sonst klappt das Panel beim UHS-Redirect zu.
    setupRoute('/einsaetze/7/unfallhilfsstellen/liste', 'unfallhilfsstellen/liste');
    expect(await screen.findByRole('link', { name: 'Unfallhilfsstellen' })).toBeInTheDocument();
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
    // Der Banner folgt dem Freigaben-Abruf, nicht dem Einsatz: abwarten (LFH-788).
    expect(await screen.findByText('Modulfreigaben nicht geladen')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Kategorien' })).toBeInTheDocument();
  });

  it('ohne Freigaben-Fehler steht kein Warnbanner über dem Rahmen', async () => {
    setup();
    await waitFor(() => expect(screen.getByText('ETB-Inhalt')).toBeInTheDocument());
    // Erst wenn der Abruf entschieden ist, ist die Abwesenheit eine Aussage (LFH-788).
    await freigabenAngekommen();
    expect(screen.queryByText('Modulfreigaben nicht geladen')).not.toBeInTheDocument();
  });

  // Gegenprobe zum Schmal-Block: sonst wäre der Schmal-Test auch grün, wenn der Hamburger bei
  // JEDER Breite erschiene.
  it('ab lg steht der Rahmen inline und es gibt keinen Hamburger', async () => {
    setzeViewportBreite(XL); // Panel ohne Wahl offen (LFH-952)
    setup();
    await waitFor(() => expect(screen.getByText('ETB-Inhalt')).toBeInTheDocument());
    expect(screen.getByRole('navigation', { name: 'Kategorien' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'ETB' })).toBeInTheDocument();
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
   * Die Kopfzeile trägt 6 Knöpfe (seit LLH-1143 mit „Eingänge“). Die Aufschlüsselung steht daneben, weil eine
   * nackte Zahl beim Fehlschlag nicht sagt, welche Sorte Ziel dazukam (`test/kopfzeile.ts`).
   * Die Wortmarke steht im Einsatz erst ab `xxl` (LLH-1726, Spec `app-marke`): darunter gehört ihr
   * Platz dem Einsatznamen, zur Einsatzliste führt „Alle Einsätze …“ im Wechsler.
   */
  it('AK1 — die Kopfzeile trägt 6 Knöpfe, unter xxl ohne Wortmarke (vorher 11 Ziele)', async () => {
    setup();
    await waitFor(() => expect(screen.getByText('ETB-Inhalt')).toBeInTheDocument());
    expect(bedienzieleNachRolle()).toEqual({ button: 6, radio: 0, link: 0 });
    expect(zaehleBedienziele()).toBe(6);
  });

  it.each([
    [XL, false],
    [1600, true],
  ])('bei %i px steht die Wortmarke: %s (LLH-1726)', async (px, da) => {
    setzeViewportBreite(px);
    setup();
    await waitFor(() => expect(screen.getByText('ETB-Inhalt')).toBeInTheDocument());
    const marke = within(screen.getByRole('banner')).queryByRole('link', { name: 'lifeline-hub' });
    if (da) expect(marke).toHaveAttribute('href', '/einsaetze');
    else expect(marke).toBeNull();
  });

  /**
   * Alle drei Achsen sind ab lg im Benutzermenü erreichbar. Die Wirkung prüft
   * `BenutzerMenu.test.tsx`; hier fehlt der `ThemeModeProvider`, die Hooks fallen auf ihre
   * Vorgaben zurück (Nachtbetrieb, `kompakt`, 100 %).
   */
  it('AK2 — alle drei Achsen sind ab lg im Benutzermenü erreichbar (LLH-1642: Leisten)', async () => {
    setup();
    await waitFor(() => expect(screen.getByText('ETB-Inhalt')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Benutzermenü' }));

    const menu = await screen.findByRole('menu');
    // Vorgabe: Nachtbetrieb, `kompakt`, 100 % sind gewählt.
    const darstellung = within(within(menu).getByRole('radiogroup', { name: 'Darstellung' }));
    expect(darstellung.getByRole('radio', { name: 'Dunkel' })).toBeChecked();
    expect(darstellung.getByRole('radio', { name: 'System' })).not.toBeChecked();
    const dichte = within(within(menu).getByRole('radiogroup', { name: 'Bediendichte' }));
    expect(dichte.getByRole('radio', { name: 'Kompakt' })).toBeChecked();
    expect(dichte.getByRole('radio', { name: 'Handschuh' })).not.toBeChecked();
    expect(
      within(within(menu).getByRole('radiogroup', { name: 'Helligkeit in %' })).getByRole('radio', {
        name: '100 %',
      }),
    ).toBeChecked();
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
    expect(zelle).toContainElement(within(kopf).getByRole('button', { name: /^Ton / }));
    // Die Eingänge stehen in derselben Zelle: auch sie ZEIGEN einen Zustand (LLH-1143).
    expect(zelle).toContainElement(within(kopf).getByRole('button', { name: /^Eingänge, / }));
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

  /**
   * LLH-1726 (Spec `kopfleiste`, design.md D2): ab `lg` liegen Namensgruppe und Suche in EINEM
   * Raster. Die Namensspalte bekommt ihre Eigenbreite (`max-content`), bevor die Suche (`1fr`) mehr
   * als ihre Lupe bekommt. Ob das im Browser trägt, misst `e2e/kopfleiste-einsatzname.spec.ts`;
   * hier die Verdrahtung.
   */
  it('der Einsatzname hat ab lg Vorrang vor der Suche (Raster)', async () => {
    setup();
    // `parentElement` ist belastbar: antds Dropdown klont sein Kind, statt es einzupacken.
    const switcher = await screen.findByRole('button', { name: /Hochwasser Nord/ });
    const rahmen = switcher.parentElement!;
    // Boden = Trefffläche des Wechslers, nicht 0 (LFH-1126). Ohne `contain`: der Name zählt jetzt
    // zur Eigenbreite, seine Mindestbreite ist dank Umbruch an jeder Stelle ein Zeichen.
    expect(Number.parseFloat(rahmen.style.minWidth)).toBeGreaterThan(0);
    expect(rahmen.style.contain).toBe('');
    expect(rahmen.style.flex).toBe('1 1 auto');
    const gruppe = rahmen.parentElement!.parentElement!;
    const raster = gruppe.parentElement!;
    expect(raster.dataset.lfh).toBe('kopf-name-suche');
    expect(raster.style.gridTemplateColumns).toMatch(
      /^minmax\(min-content, max-content\) minmax\(/,
    );
    expect(raster.style.gridTemplateColumns).toMatch(/1fr\)$/);
    // Der Behälter nimmt am Umbruch teil wie vorher beide Gruppen: Summe der Basen, Boden
    // `min-content` (fester Teil plus Trefffläche plus Lupe).
    expect(raster.style.minWidth).toBe('min-content');
    expect(within(raster).getByRole('button', { name: 'Suchen' })).toBeInTheDocument();
  });

  /**
   * LLH-1726: Der Name nimmt mit dem Laden seine Eigenbreite, und die Suche daneben rückte dabei
   * nach rechts (CLS 0,0103 an der Umbruchkante, `e2e/rahmen-cls-dichte.spec.ts`). Solange der
   * Einsatz lädt, ist die Suchzelle deshalb unsichtbar: sie erscheint gleich an ihrem Platz, und
   * ein Element, das erst sichtbar wird, verschiebt nichts.
   */
  // Review LLH-1726: Ein Wechsel über `lg` (Tablet drehen) darf den Wechsler nicht neu einhängen,
  // sonst gehen offenes Menü und Fokus verloren. Der Behälter des Rasters bleibt deshalb stehen und
  // ist unter `lg` nur `display: contents`.
  it('hängt den Einsatz-Wechsler beim Wechsel über lg nicht neu ein', async () => {
    setup();
    const vorher = await screen.findByRole('button', { name: /Hochwasser Nord/ });
    act(() => void sendeBreitenAenderung(820));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Navigation öffnen' })).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: /Hochwasser Nord/ })).toBe(vorher);
    act(() => void sendeBreitenAenderung(1024));
    // Zurück ab `lg`: die Markenzelle steht wieder statt des Griffs.
    await waitFor(() => expect(document.querySelector('[data-lfh="kopf-marke"]')).not.toBeNull());
    expect(screen.getByRole('button', { name: /Hochwasser Nord/ })).toBe(vorher);
  });

  // Review LLH-1726: Lädt der Einsatz lange (Wiederholungen), führt sonst nichts aus dem Kopf.
  it('zeigt die Suchzelle nach einer Sekunde auch dann, wenn der Einsatz noch lädt', async () => {
    setup();
    server.use(http.get('/api/einsaetze/7', () => new Promise<never>(() => {})));
    const zelle = await waitFor(() => {
      const el = document.querySelector<HTMLElement>('[data-lfh="kopf-suche"]');
      expect(el).not.toBeNull();
      return el!;
    });
    expect(zelle.style.visibility).toBe('hidden');
    await waitFor(() => expect(zelle.style.visibility).toBe(''), { timeout: 2500 });
  });

  it('hält die Suchzelle unsichtbar, solange der Einsatz lädt', async () => {
    let freigeben: () => void = () => {};
    const geladen = new Promise<void>((r) => (freigeben = r));
    setup();
    server.use(
      http.get('/api/einsaetze/7', async () => {
        await geladen;
        return HttpResponse.json(einsatz);
      }),
    );
    // Über das Attribut, nicht über die Rolle: unsichtbar hat die Suche keinen zugänglichen Namen.
    const zelle = await waitFor(() => {
      const el = document.querySelector<HTMLElement>('[data-lfh="kopf-suche"]');
      expect(el).not.toBeNull();
      return el!;
    });
    expect(zelle.style.visibility).toBe('hidden');
    freigeben();
    await screen.findByRole('button', { name: /Hochwasser Nord/ });
    await waitFor(() => expect(zelle.style.visibility).toBe(''));
  });

  /**
   * Der gemerkte Einklapp-Zustand ist ein EIGENES Boolean neben `offeneKategorie`: die Rail
   * behält ihre Hervorhebung (WELCHE Kategorie), das Panel verschwindet (OB offen), und der
   * Angleich-Effekt fasst das Flag nicht an.
   */
  it('merkt das eingeklappte Panel über einen Neu-Mount (lfh:nav:eingeklappt)', async () => {
    setzeViewportBreite(XL); // Panel ohne Wahl offen (LFH-952)
    setup();
    await waitFor(() => expect(screen.getByRole('link', { name: 'ETB' })).toBeInTheDocument());

    await userEvent.click(await screen.findByRole('link', { name: 'Erfassung' }));

    expect(queryNavEintrag('ETB')).not.toBeInTheDocument();
    // Die Rail bleibt auf der Kategorie — sonst wäre „zugeklappt" von „keine Kategorie aktiv"
    // nicht zu unterscheiden.
    expect(await screen.findByRole('link', { name: 'Erfassung' })).toHaveAttribute(
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
    expect(queryNavEintrag('ETB')).not.toBeInTheDocument();
  });

  /**
   * LLH-1734 (Spec `einsatztauglichkeit-layout`, „Ein Rail-Sprung achtet die gemerkte Panel-Wahl“):
   * vorher klappte der Sprung ein zugeklapptes Panel wieder auf. Beide Hälften: der Klick
   * navigiert, und das Panel bleibt trotzdem zu.
   */
  it('lässt ein zugeklapptes Panel beim Wechsel auf eine andere Kategorie zu', async () => {
    localStorage.setItem(EINGEKLAPPT, '1');
    setzeViewportBreite(XL);
    setup();
    await waitFor(() => expect(screen.getByText('ETB-Inhalt')).toBeInTheDocument());
    await freigabenAngekommen();

    await userEvent.click(screen.getByRole('link', { name: 'Lage' }));

    await waitFor(() => expect(pfad()).toBe('/einsaetze/7/lage-dashboard'));
    expect(screen.queryByRole('link', { name: 'Lagekarte' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Menü ausklappen' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    // Der Sprung ist keine Wahl (LFH-952, D5): gemerkt bleibt „zu“.
    expect(localStorage.getItem(EINGEKLAPPT)).toBe('1');
  });

  /**
   * LLH-1734, Review: Ohne Sprungziel (Freigaben gescheitert oder alles gesperrt) navigiert der Klick
   * nicht. Bliebe das zugeklappte Panel dann zu, wäre der Klick tot: nur die Hervorhebung spränge.
   */
  it('öffnet das zugeklappte Panel, wenn der Rail-Sprung kein Ziel hat', async () => {
    localStorage.setItem(EINGEKLAPPT, '1');
    setzeViewportBreite(XL);
    setup(freigabenFixture(), { freigaben: true });
    await waitFor(() => expect(screen.getByText('ETB-Inhalt')).toBeInTheDocument());
    expect(await screen.findByText('Modulfreigaben nicht geladen')).toBeInTheDocument();

    // Ohne Ziel ist die Kategorie ein Knopf, kein Link (LLH-1732).
    await userEvent.click(await screen.findByRole('button', { name: 'Lage' }));

    await waitFor(() => expect(document.querySelector('[data-lfh="modul-panel"]')).not.toBeNull());
    expect(screen.getByRole('button', { name: 'Menü einklappen' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(pfad()).toBe('/einsaetze/7/etb');
    expect(localStorage.getItem(EINGEKLAPPT)).toBe('1');
  });

  /**
   * LFH-952 (D5): ohne Wahl ist das Panel am Tablet quer (`lg` bis `xl`, hier die Testbreite 1024)
   * zu und ab `xl` offen. Der Griff „Menü“ im Rail-Fuß schreibt die Wahl, und sie gilt dann auf
   * jeder Breite.
   */
  describe('Modulmenü: Vorgabe je Breite und Griff (LFH-952)', () => {
    it('1024 ohne Wahl: Panel zu, Griff „Menü ausklappen“ mit aria-expanded false', async () => {
      setup();
      await waitFor(() => expect(screen.getByText('ETB-Inhalt')).toBeInTheDocument());
      expect(queryNavEintrag('ETB')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Menü ausklappen' })).toHaveAttribute(
        'aria-expanded',
        'false',
      );
      expect(await screen.findByRole('link', { name: 'Erfassung' })).toHaveAttribute(
        'aria-expanded',
        'false',
      );
    });

    it('1440 ohne Wahl: Panel offen (Gegenprobe zur Vorgabe)', async () => {
      setzeViewportBreite(XL);
      setup();
      expect(await screen.findByRole('link', { name: 'ETB' })).toBeInTheDocument();
      const griff = screen.getByRole('button', { name: 'Menü einklappen' });
      expect(griff).toHaveAttribute('aria-expanded', 'true');
      expect(document.getElementById(griff.getAttribute('aria-controls')!)).toHaveAttribute(
        'data-lfh',
        'modul-panel',
      );
    });

    it('der Griff öffnet, merkt „offen“, und die Wahl übersteht einen Neu-Mount', async () => {
      const { unmount } = setup();
      await waitFor(() => expect(screen.getByText('ETB-Inhalt')).toBeInTheDocument());
      await userEvent.click(screen.getByRole('button', { name: 'Menü ausklappen' }));
      expect(screen.getByRole('link', { name: 'ETB' })).toBeInTheDocument();
      expect(localStorage.getItem(EINGEKLAPPT)).toBe('0');
      unmount();

      setup();
      expect(await screen.findByRole('link', { name: 'ETB' })).toBeInTheDocument();
    });

    it('eine Wahl „zu“ gilt auch ab xl', async () => {
      localStorage.setItem(EINGEKLAPPT, '1');
      setzeViewportBreite(XL);
      setup();
      await waitFor(() => expect(screen.getByText('ETB-Inhalt')).toBeInTheDocument());
      expect(queryNavEintrag('ETB')).not.toBeInTheDocument();
    });

    it('der Rail-Sprung öffnet am Tablet, schreibt aber keine Wahl', async () => {
      setup();
      await waitFor(() => expect(screen.getByText('ETB-Inhalt')).toBeInTheDocument());
      await freigabenAngekommen();
      await userEvent.click(await screen.findByRole('link', { name: 'Lage' }));
      expect(await screen.findByRole('link', { name: 'Lagekarte' })).toBeInTheDocument();
      expect(localStorage.getItem(EINGEKLAPPT)).toBeNull();
    });
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
      expect(queryNavEintrag('ETB')).not.toBeInTheDocument();
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
      expect(within(dialog).getByRole('link', { name: 'ETB' })).toBeInTheDocument();
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
      await userEvent.click(await screen.findByRole('link', { name: 'Lagekarte' }));

      expect(await screen.findByText('Lagekarte-Inhalt')).toBeInTheDocument();
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(screen.queryAllByRole('navigation')).toHaveLength(0);
    });

    it('legt beide Umschalter ab, behält die Alarm-Zentrale', async () => {
      // Die Alarmzentrale bleibt, weil sie ihren Zustand ausspricht (sichtbarer Text plus
      // `aria-label`). Auf 390 px ist sie EIN gebündeltes Ziel, das seinen Zustand weiter nennt
      // („Ton blockiert"), mit beiden Steuerungen beschriftet im Menü — zwei Knöpfe brächen dort um.
      // Gezählt wird EIN Ziel, nicht keines: verschwände sie ganz, wäre der Test ebenso rot. Die
      // Null für Umschalter zählt über die ROLLE.
      setup();
      await waitFor(() => expect(screen.getByText('ETB-Inhalt')).toBeInTheDocument());
      expect(radiosImKopf()).toBe(0);
      const alarm = screen.getByRole('button', { name: /^Alarmzentrale:/ });
      expect(alarm).toHaveTextContent('Ton blockiert');
      // Die Einzelknöpfe der breiten Bauform stehen hier NICHT — sonst erfüllten auch drei Ziele
      // „ein Ziel".
      expect(screen.queryByRole('button', { name: 'Ton blockiert – freischalten' })).toBeNull();
    });

    it('der Suchauslöser zwischen md und lg hält die A1-Trefffläche und die Rahmenfarbe', async () => {
      setzeViewportBreite(820);
      setup();
      await waitFor(() => expect(screen.getByText('ETB-Inhalt')).toBeInTheDocument());
      const suche = within(screen.getByRole('banner')).getByRole('button', { name: 'Suchen' });
      expect(suche).toHaveAttribute('aria-label', 'Suchen');
      expect(suche.style.width).toBe('48px');
      expect(suche.style.height).toBe('48px');
      // Farbe aus der Nachtrolle des Rahmens — der Kopf ist modusfest.
      expect(suche).toHaveStyle({ color: farbenDunkel.text });
    });

    it('zeigt unter lg die Suche als Icon und keine Wortmarke', async () => {
      // Zwischen `md` und `lg` kein Suchfeld, und die Wortmarke weicht dem Griff der Navigation.
      setzeViewportBreite(820);
      setup();
      await waitFor(() => expect(screen.getByText('ETB-Inhalt')).toBeInTheDocument());
      const kopf = screen.getByRole('banner');
      expect(within(kopf).queryByRole('link', { name: 'lifeline-hub' })).toBeNull();
      expect(within(kopf).getByRole('button', { name: 'Suchen' })).not.toHaveTextContent(
        'Modul, Einheit',
      );
    });

    // LLH-1726: Der Name trägt seine Eigenbreite als Basis und drückt auf seine Nachbarn. Die
    // Zelle des Griffs schrumpft deshalb nie, sonst lag der Name 2 px über dem Griff (Gate 1, 390 px).
    it('die Zelle des Griffs schrumpft nicht unter den Griff', async () => {
      setup();
      const griff = await screen.findByRole('button', { name: 'Navigation öffnen' });
      expect(griff.parentElement!.style.flexShrink).toBe('0');
    });

    it('hält Hamburger und Schließen-Knopf auf der A1-Trefffläche', async () => {
      setup();
      await waitFor(() => expect(screen.getByText('ETB-Inhalt')).toBeInTheDocument());

      const hamburger = screen.getByRole('button', { name: 'Navigation öffnen' });
      expect(hamburger.style.width).toBe('48px');
      expect(hamburger.style.height).toBe('48px');

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

describe('EinsatzLayout · Handy-Kopf (LLH-1728)', () => {
  beforeEach(() => {
    localStorage.clear();
    setzeViewportBreite(390);
  });

  it('trägt Menü, Name, Alarm, Verbindung und Uhr, aber weder Suche noch Benutzermenü (D3)', async () => {
    setup();
    await waitFor(() => expect(screen.getByText('ETB-Inhalt')).toBeInTheDocument());
    const kopf = screen.getByRole('banner');
    expect(within(kopf).getByRole('button', { name: 'Navigation öffnen' })).toBeInTheDocument();
    expect(within(kopf).getByRole('button', { name: /Hochwasser Nord/ })).toBeInTheDocument();
    expect(within(kopf).getByRole('button', { name: /^Alarmzentrale:/ })).toBeInTheDocument();
    expect(kopf.querySelector('[data-lfh="kopf-sync"]')).not.toBeNull();
    const uhr = kopf.querySelector<HTMLElement>('[data-lfh="kopf-uhr"]');
    expect(uhr).not.toBeNull();
    // Die schmale Zellpolsterung des Handy-Kopfs, wie die Alarmzelle daneben.
    const alarmZelle = kopf.querySelector<HTMLElement>('[data-lfh="kopf-alarm"]')!;
    expect(uhr!.style.paddingInlineStart).toBe(alarmZelle.style.paddingInlineStart);
    expect(within(kopf).queryByRole('button', { name: 'Suchen' })).toBeNull();
    expect(within(kopf).queryByRole('button', { name: 'Benutzermenü' })).toBeNull();
  });

  it('ab md stehen Suche und Benutzermenü im Kopf, nicht im Drawer (Gegenprobe)', async () => {
    setzeViewportBreite(820);
    setup();
    await waitFor(() => expect(screen.getByText('ETB-Inhalt')).toBeInTheDocument());
    const kopf = screen.getByRole('banner');
    expect(within(kopf).getByRole('button', { name: 'Suchen' })).toBeInTheDocument();
    expect(within(kopf).getByRole('button', { name: 'Benutzermenü' })).toBeInTheDocument();
    await userEvent.click(within(kopf).getByRole('button', { name: 'Navigation öffnen' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByRole('button', { name: 'Suchen' })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Benutzermenü' })).toBeNull();
  });

  it('„Suchen“ im Drawer schließt ihn und öffnet die Sprungpalette', async () => {
    setup();
    await waitFor(() => expect(screen.getByText('ETB-Inhalt')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Navigation öffnen' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Suchen' }));
    const feld = await screen.findByPlaceholderText(
      'Suchen: Module, Aktionen, Einstellungen …',
      {},
      { timeout: 4000 },
    );
    expect(feld).toBeInTheDocument();
    // Wohin der Fokus nach dem Schließen geht, misst `e2e/kopfzeile-schmal.spec.ts` (Animation).
    // Der Drawer ist zu (`destroyOnHidden`: sein Inhalt verlässt den Baum).
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Erfassung' })).not.toBeInTheDocument(),
    );
  });

  it('das Benutzermenü im Drawer öffnet dasselbe Menü bis „Abmelden“', async () => {
    setup();
    await waitFor(() => expect(screen.getByText('ETB-Inhalt')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Navigation öffnen' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Benutzermenü' }));
    expect(await screen.findByRole('menuitem', { name: /Abmelden/ })).toBeInTheDocument();
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
    setzeViewportBreite(XL); // Panel ohne Wahl offen (LFH-952)
    localStorage.clear();
    setup();
    await waitFor(() => expect(screen.getByText('ETB-Inhalt')).toBeInTheDocument());

    await userEvent.click(
      screen.getByRole('link', { name: 'Vermisste, springt zu Personen · Vermisst' }),
    );

    await waitFor(() => expect(pfad()).toBe('/einsaetze/7/personen'));
    expect(screen.getByTestId('pfad')).toHaveAttribute(
      'data-suche',
      '?filter=vermisst&ansicht=zeilen',
    );
    expect(screen.getByRole('link', { name: 'Betroffene' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(leseZuletztModule(admin.id, 7)).toEqual([]);
  });

  it('springt beim Klick auf eine ANDERE Kategorie in deren erstes Modul', async () => {
    setup();
    await waitFor(() => expect(screen.getByText('ETB-Inhalt')).toBeInTheDocument());
    // Ohne Freigaben gibt der Resolver nichts frei, der Klick spränge nirgends hin (LFH-788).
    await freigabenAngekommen();

    await userEvent.click(await screen.findByRole('link', { name: 'Lage' }));

    // Die Aussage ist der PFAD, und das ZIEL wird benannt: ein Resolver, der das erste Modul einer
    // FALSCHEN Kategorie liefert, bestünde eine schwächere Form. Käme ein `verweistAuf`-Eintrag
    // dazu (er spränge in eine andere Kategorie), färbte sich dieser Test rot.
    await waitFor(() => expect(pfad()).toBe('/einsaetze/7/lage-dashboard'));
  });

  /**
   * LLH-1734 (Spec `seiten-orientierung`): der Rail-Sprung führt ins zuletzt besuchte Modul der
   * Kategorie. Start in 'personen' (nicht das erste Modul von Erfassung) als Ankunft per Adresse:
   * auch sie zählt. Vorher landete der Rückweg in 'etb'.
   */
  it('springt zurück ins zuletzt besuchte Modul der Kategorie', async () => {
    localStorage.clear();
    setup(freigabenFixture(), {}, admin, '/einsaetze/7/personen');
    await waitFor(() => expect(screen.getByText('Personen-Inhalt')).toBeInTheDocument());
    await freigabenAngekommen();

    await userEvent.click(screen.getByRole('link', { name: 'Lage' }));
    await waitFor(() => expect(pfad()).toBe('/einsaetze/7/lage-dashboard'));
    // Die Adresse des Rail-Links zeigt dorthin, wohin der Klick springt (LLH-1732): Strg/⌘+Klick
    // landet im neuen Tab im selben Modul.
    expect(screen.getByRole('link', { name: 'Erfassung' })).toHaveAttribute(
      'href',
      '/einsaetze/7/personen',
    );

    await userEvent.click(screen.getByRole('link', { name: 'Erfassung' }));
    await waitFor(() => expect(pfad()).toBe('/einsaetze/7/personen'));
    // Ankünfte füllen „Zuletzt besucht“ der Palette nicht (Spec `navigation-zuletzt-besucht`).
    expect(leseZuletztModule(admin.id, 7)).toEqual([]);
  });

  it('springt ins erste Modul, wenn das gemerkte inzwischen gesperrt ist', async () => {
    localStorage.clear();
    localStorage.setItem(
      `lfh:nav:kategorie-modul:${admin.id}:7`,
      JSON.stringify({ erfassung: { key: 'personen', at: Date.now() } }),
    );
    setup(
      freigabenFixture({ personen: { zugriff: false } }),
      {},
      admin,
      '/einsaetze/7/lage-dashboard',
    );
    await waitFor(() => expect(screen.getByText('Dashboard-Inhalt')).toBeInTheDocument());
    await freigabenAngekommen();

    await userEvent.click(screen.getByRole('link', { name: 'Erfassung' }));
    await waitFor(() => expect(pfad()).toBe('/einsaetze/7/etb'));
  });

  /**
   * Der Rail-Sprung landet NICHT im „Zuletzt"-Speicher, sonst überschrieben drei Rail-Klicks die
   * ganze Liste. Beide Hälften: „nicht gemerkt" wäre trivial, hätte der Klick nicht navigiert.
   */
  it('merkt den Rail-Sprung NICHT, obwohl er navigiert', async () => {
    localStorage.clear();
    setup();
    await waitFor(() => expect(screen.getByText('ETB-Inhalt')).toBeInTheDocument());
    await freigabenAngekommen();

    await userEvent.click(await screen.findByRole('link', { name: 'Lage' }));

    await waitFor(() => expect(pfad()).toBe('/einsaetze/7/lage-dashboard'));
    expect(leseZuletztModule(admin.id, 7)).toEqual([]);
  });

  it('navigiert beim Klick auf die AKTIVE Kategorie nicht, sondern klappt nur zu', async () => {
    setzeViewportBreite(XL); // Panel ohne Wahl offen (LFH-952)
    // Der Selbstklick ist der Zuklapp-Umschalter mit Persistenz; ohne diese Gegenaussage färbte
    // auch ein bedingungslos navigierender Klick den Test darüber grün. Startpunkt 'personen',
    // nicht 'etb' (das erste Modul der Kategorie) — sonst änderte ein falscher Sprung den Pfad nicht.
    setup(freigabenFixture(), {}, admin, '/einsaetze/7/personen');
    await waitFor(() => expect(screen.getByText('Personen-Inhalt')).toBeInTheDocument());
    const vorher = pfad();

    // „Erfassung" ist die Kategorie von 'personen' — der Klick trifft die aktive.
    await userEvent.click(await screen.findByRole('link', { name: 'Erfassung' }));

    expect(pfad()).toBe(vorher);
    // Panel zugeklappt: ein Erfassung-Modul wie „Personen" steht nicht mehr im Baum
    // (dieselbe Abfrage wie im Bestandstest zum gemerkten Einklapp-Zustand oben).
    expect(queryNavEintrag('Betroffene')).not.toBeInTheDocument();
  });

  /**
   * Server sagt `zugriff: false` (LFH-669): das Modul steht gesperrt in der Navigation, und der
   * Rail-Sprung der Kategorie überspringt es — er landet im nächsten freien Modul.
   */
  it('überspringt beim Rail-Sprung ein gesperrtes Modul (LFH-669)', async () => {
    setzeViewportBreite(XL); // Panel ohne Wahl offen (LFH-952)
    setup(
      freigabenFixture({
        'lage-dashboard': { zugriff: false },
        personen: { zugriff: false },
      }),
    );
    await waitFor(() => expect(screen.getByText('ETB-Inhalt')).toBeInTheDocument());
    // Erst wenn die Freigaben da sind, steht das gesperrte Modul mit Schloss in der Liste.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Betroffene' })).toBeDisabled());
    expect(screen.getByRole('button', { name: 'Betroffene' })).toHaveAttribute(
      'title',
      'Keine Berechtigung',
    );

    await userEvent.click(await screen.findByRole('link', { name: 'Lage' }));

    await waitFor(() => expect(pfad()).toBe('/einsaetze/7/lagekarte'));
    expect(screen.getByRole('button', { name: 'Lagebild' })).toBeDisabled();
  });

  /**
   * LLH-1732: Rail und Modulpanel tragen echte Adressen, damit Strg/⌘+Klick ein Modul in einen
   * neuen Tab legt. Die Rail-Adresse ist das Ziel des Rail-Sprungs (erstes freigegebenes Modul),
   * und ein Strg-Klick lässt diesen Tab, wo er ist.
   */
  it('führt Rail und Modulpanel als Links; Strg-Klick wechselt die Seite nicht (LLH-1732)', async () => {
    setzeViewportBreite(XL); // Panel ohne Wahl offen (LFH-952)
    localStorage.clear();
    setup(freigabenFixture({ 'lage-dashboard': { zugriff: false } }));
    await waitFor(() => expect(screen.getByText('ETB-Inhalt')).toBeInTheDocument());
    await freigabenAngekommen();

    // Das gesperrte Lage-Dashboard überspringt auch die Adresse, wie der Sprung (LFH-669).
    const lage = await screen.findByRole('link', { name: 'Lage' });
    expect(lage).toHaveAttribute('href', '/einsaetze/7/lagekarte');
    expect(screen.getByRole('link', { name: 'Betroffene' })).toHaveAttribute(
      'href',
      '/einsaetze/7/personen',
    );
    expect(
      screen.getByRole('link', { name: 'Vermisste, springt zu Personen · Vermisst' }),
    ).toHaveAttribute('href', '/einsaetze/7/personen?filter=vermisst&ansicht=zeilen');

    const vorher = pfad();
    fireEvent.click(lage, { ctrlKey: true });
    fireEvent.click(screen.getByRole('link', { name: 'Betroffene' }), { ctrlKey: true });
    expect(pfad()).toBe(vorher);
    expect(leseZuletztModule(admin.id, 7)).toEqual([]);
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
    // Sonst bliebe der Pfad schon deshalb stehen, weil noch keine Freigaben da sind (LFH-788).
    await freigabenAngekommen();
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

/**
 * Modulwächter (LFH-888, Spec `modul-freigabe`, design.md D1): eine Route in ein Modul, für das
 * der Server `zugriff: false` meldet, zeigt den einheitlichen Hinweis statt der Modulseite. Die
 * Kindseiten sind Sonden — wird eine gerendert, ist der Wächter offen.
 */
describe('EinsatzLayout · Modulwächter (LFH-888)', () => {
  function setupWaechter(
    route: string,
    freigaben: ModulFreigaben | 'laden' | 'fehler',
    einstellungen: Record<string, unknown> = {},
    {
      benutzer = admin,
      rolle = einsatz.meine_rolle,
    }: { benutzer?: BenutzerAnzeige; rolle?: string } = {},
  ) {
    const meinEinsatz = { ...einsatz, meine_rolle: rolle };
    server.use(
      meHandler(benutzer),
      http.get('/api/einsaetze', () => HttpResponse.json([meinEinsatz])),
      http.get('/api/einsaetze/7', () => HttpResponse.json(meinEinsatz)),
      http.get('/api/einsaetze/7/modul-freigaben', async () => {
        if (freigaben === 'laden') await new Promise(() => {});
        if (freigaben === 'fehler') return new HttpResponse(null, { status: 500 });
        return HttpResponse.json(freigaben);
      }),
      http.get('/api/einsaetze/7/einstellungen', () => HttpResponse.json(einstellungen)),
    );
    return renderMitProviders(
      <CommandPaletteProvider>
        <Routes>
          <Route path="/einsaetze/:id" element={<EinsatzLayout />}>
            <Route path="lagemeldungen" element={<div>Lagemeldungen-Inhalt</div>} />
            <Route path="fernmeldewesen" element={<div>Funkplan-Inhalt</div>} />
            <Route
              path="fernmeldewesen/kommunikationsplan"
              element={<div>Kommunikationsplan-Inhalt</div>}
            />
            <Route path="stab/funkplan" element={<AltpfadWeiterleitung modul="fernmeldewesen" />} />
            <Route
              path="stab/kommunikationsplan"
              element={
                <AltpfadWeiterleitung modul="fernmeldewesen" unterpfad="kommunikationsplan" />
              }
            />
            <Route path="infotelefon" element={<AnrufSonde />} />
            <Route path="stab/infotelefon" element={<AltpfadWeiterleitung modul="infotelefon" />} />
            <Route
              path="verpflegung/:zeitfensterId/ausgabe"
              element={<div>Ausgabeansicht-Inhalt</div>}
            />
            <Route path="einsatzdaten" element={<div>Einsatzdaten-Inhalt</div>} />
            <Route path="ueberblick" element={<div>Überblick-Inhalt</div>} />
            <Route path="etb" element={<div>ETB-Inhalt</div>} />
          </Route>
        </Routes>
        <PfadAnzeige />
        <FreigabenSonde />
      </CommandPaletteProvider>,
      { route },
    );
  }

  it('gesperrtes Modul: Hinweis statt Seite, Rail bleibt bedienbar', async () => {
    setupWaechter(
      '/einsaetze/7/lagemeldungen',
      freigabenFixture({ lagemeldungen: { zugriff: false } }),
    );
    expect(
      await screen.findByRole('heading', { level: 1, name: /Lagemeldungen/ }),
    ).toBeInTheDocument();
    expect(screen.getByText('Für deine Rolle nicht freigegeben')).toBeVisible();
    expect(screen.queryByText('Lagemeldungen-Inhalt')).not.toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Kategorien' })).toBeInTheDocument();
  });

  it('Einsatzleitung: „Modulfreigaben öffnen“ führt zu Einstellungen › Module (LFH-1078)', async () => {
    setupWaechter(
      '/einsaetze/7/lagemeldungen',
      freigabenFixture({ lagemeldungen: { zugriff: false } }),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Modulfreigaben öffnen' }));
    expect(pfad()).toBe('/einsaetze/7/einstellungen/module');
  });

  it('auch ohne Admin-Recht: die Einsatzleitung bekommt „Modulfreigaben öffnen“', async () => {
    setupWaechter(
      '/einsaetze/7/lagemeldungen',
      freigabenFixture({ lagemeldungen: { zugriff: false } }),
      {},
      { benutzer: benutzerFixture({ anzeigename: 'Leitung' }), rolle: 'einsatzleitung' },
    );
    expect(
      await screen.findByRole('button', { name: 'Modulfreigaben öffnen' }),
    ).toBeInTheDocument();
  });

  it('ohne Verwaltungsrecht steht nur die Sperrzeile, kein Weg in die Modulfreigaben', async () => {
    setupWaechter(
      '/einsaetze/7/lagemeldungen',
      freigabenFixture({ lagemeldungen: { zugriff: false } }),
      {},
      { benutzer: benutzerFixture({ anzeigename: 'Helfer' }), rolle: 'fuehrungspersonal' },
    );
    expect(await screen.findByText('Für deine Rolle nicht freigegeben')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Überblick öffnen' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Modulfreigaben öffnen' })).not.toBeInTheDocument();
  });

  it('Rückweg: das freie Standardmodul, sonst der Überblick', async () => {
    setupWaechter(
      '/einsaetze/7/lagemeldungen',
      freigabenFixture({ lagemeldungen: { zugriff: false }, etb: { zugriff: false } }),
      { standard_modul: 'etb' },
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Überblick öffnen' }));
    expect(pfad()).toBe('/einsaetze/7/ueberblick');
    expect(await screen.findByText('Überblick-Inhalt')).toBeInTheDocument();
  });

  it('Unterroute eines gesperrten Moduls (Fernmeldewesen › Kommunikationsplan) zeigt den Hinweis für „Fernmeldewesen“', async () => {
    setupWaechter(
      '/einsaetze/7/fernmeldewesen/kommunikationsplan',
      freigabenFixture({ fernmeldewesen: { zugriff: false } }),
    );
    expect(
      await screen.findByRole('heading', { level: 1, name: /Fernmeldewesen/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Kommunikationsplan-Inhalt')).not.toBeInTheDocument();
  });

  it('Ausgabeansicht eines ausgeblendeten Moduls Verpflegung zeigt die Sperre wie die Modulseite (LLH-1032)', async () => {
    setupWaechter(
      '/einsaetze/7/verpflegung/3/ausgabe',
      freigabenFixture({ verpflegung: { sichtbar: false, zugriff: false } }),
    );
    expect(
      await screen.findByRole('heading', { level: 1, name: /Verpflegung/ }),
    ).toBeInTheDocument();
    expect(screen.getByText('In diesem Einsatz ausgeblendet')).toBeInTheDocument();
    expect(screen.queryByText('Ausgabeansicht-Inhalt')).not.toBeInTheDocument();
  });

  // LLH-1180, design.md D7: die Altadresse gehört dem Ziel ihrer Weiterleitung.
  it('Altadresse des Funkplans leitet ins Fernmeldewesen, samt Darstellung', async () => {
    setupWaechter('/einsaetze/7/stab/funkplan?ansicht=skizze', freigabenFixture());
    expect(await screen.findByText('Funkplan-Inhalt')).toBeInTheDocument();
    expect(pfad()).toBe('/einsaetze/7/fernmeldewesen');
    expect(screen.getByTestId('pfad')).toHaveAttribute('data-suche', '?ansicht=skizze');
  });

  // i6k6mzed, design.md D3/D8: die Altadresse des Informationstelefons leitet dauerhaft um, mit
  // Query, und gehört dem neuen Modul.
  it('Altadresse des Informationstelefons leitet um, samt Anruf', async () => {
    setupWaechter('/einsaetze/7/stab/infotelefon?anruf=42', freigabenFixture());
    expect(await screen.findByText('Anruf 42')).toBeInTheDocument();
    expect(pfad()).toBe('/einsaetze/7/infotelefon');
    expect(screen.getByTestId('pfad')).toHaveAttribute('data-suche', '?anruf=42');
  });

  it('Altadresse bei gesperrtem Informationstelefon zeigt den Hinweis für „Informationstelefon“', async () => {
    setupWaechter(
      '/einsaetze/7/stab/infotelefon?neu=1',
      freigabenFixture({ infotelefon: { zugriff: false } }),
    );
    expect(
      await screen.findByRole('heading', { level: 1, name: /Informationstelefon/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/^Anruf/)).not.toBeInTheDocument();
  });

  it('Altadresse des Kommunikationsplans leitet ins Fernmeldewesen', async () => {
    setupWaechter('/einsaetze/7/stab/kommunikationsplan', freigabenFixture());
    expect(await screen.findByText('Kommunikationsplan-Inhalt')).toBeInTheDocument();
    expect(pfad()).toBe('/einsaetze/7/fernmeldewesen/kommunikationsplan');
  });

  it('Altadresse bei gesperrtem Fernmeldewesen zeigt den Hinweis für „Fernmeldewesen“', async () => {
    setupWaechter(
      '/einsaetze/7/stab/funkplan',
      freigabenFixture({ fernmeldewesen: { zugriff: false } }),
    );
    expect(
      await screen.findByRole('heading', { level: 1, name: /Fernmeldewesen/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Funkplan-Inhalt')).not.toBeInTheDocument();
  });

  it('ausgeblendetes Modul für ein Mitglied heißt „ausgeblendet“', async () => {
    setupWaechter(
      '/einsaetze/7/lagemeldungen',
      freigabenFixture({ lagemeldungen: { sichtbar: false, zugriff: false } }),
    );
    expect(await screen.findByText('In diesem Einsatz ausgeblendet')).toBeInTheDocument();
  });

  it('System-Admin im ausgeblendeten Modul (`zugriff: true`): die Seite rendert', async () => {
    setupWaechter(
      '/einsaetze/7/lagemeldungen',
      freigabenFixture({ lagemeldungen: { sichtbar: false, zugriff: true } }),
    );
    await freigabenAngekommen();
    expect(screen.getByText('Lagemeldungen-Inhalt')).toBeInTheDocument();
    expect(screen.queryByText('Keine Berechtigung')).not.toBeInTheDocument();
  });

  it('Freigaben laden noch: der Rahmen wartet, die Seite rendert noch nicht', async () => {
    // Kaltstart per Deeplink: rendert die Seite vor der Antwort, ginge ihre Listen-Anfrage an
    // ein gesperrtes Modul raus (design.md D1, Nachtrag).
    setupWaechter('/einsaetze/7/lagemeldungen', 'laden');
    expect(await screen.findByRole('navigation', { name: 'Kategorien' })).toBeInTheDocument();
    expect(screen.getByTestId('modulwaechter-laedt')).toBeInTheDocument();
    expect(screen.queryByText('Lagemeldungen-Inhalt')).not.toBeInTheDocument();
    expect(screen.queryByText('Keine Berechtigung')).not.toBeInTheDocument();
  });

  it('Einsatzdaten warten nie auf die Freigaben und zeigen nie den Hinweis', async () => {
    setupWaechter('/einsaetze/7/einsatzdaten', 'laden');
    expect(await screen.findByText('Einsatzdaten-Inhalt')).toBeInTheDocument();
    expect(screen.queryByTestId('modulwaechter-laedt')).not.toBeInTheDocument();
  });

  it('Freigaben gescheitert: die Seite rendert, ihr eigener 403-Zustand bleibt das Netz', async () => {
    setupWaechter('/einsaetze/7/lagemeldungen', 'fehler');
    expect(await screen.findByText('Modulfreigaben nicht geladen')).toBeInTheDocument();
    expect(screen.getByText('Lagemeldungen-Inhalt')).toBeInTheDocument();
  });

  it('freies Modul: die Seite rendert', async () => {
    setupWaechter('/einsaetze/7/lagemeldungen', freigabenFixture());
    await freigabenAngekommen();
    expect(screen.getByText('Lagemeldungen-Inhalt')).toBeInTheDocument();
    expect(screen.queryByText('Keine Berechtigung')).not.toBeInTheDocument();
  });
});

describe('EinsatzLayout · Orientierung (LFH-954)', () => {
  beforeEach(() => {
    localStorage.clear();
    setzeViewportBreite(XL);
    document.title = 'lifeline-hub';
  });

  it('setzt den Tab-Titel aus dem Modulnamen der Registry und dem Einsatz', async () => {
    setup();
    await waitFor(() => expect(document.title).toBe('ETB · Hochwasser Nord · lifeline-hub'));
  });

  it('folgt dem Modul der Route', async () => {
    setup(freigabenFixture(), {}, admin, '/einsaetze/7/lagekarte');
    await waitFor(() => expect(document.title).toBe('Lagekarte · Hochwasser Nord · lifeline-hub'));
  });

  it('stellt die Zahl der ungelesenen Eingänge voran, dieselbe wie am Knopf (LLH-1143)', async () => {
    server.use(
      http.get('/api/einsaetze/:id/benachrichtigungen', () =>
        HttpResponse.json({ eintraege: [], ungelesen: 3 }),
      ),
    );
    setup(freigabenFixture(), {}, admin, '/einsaetze/7/lagekarte');
    await waitFor(() =>
      expect(document.title).toBe('(3) Lagekarte · Hochwasser Nord · lifeline-hub'),
    );
    expect(
      await screen.findByRole('button', { name: 'Eingänge, 3 ungelesen' }),
    ).toBeInTheDocument();
  });

  it('merkt den offenen Pfad als letzten Ort der Person, ohne die Suche', async () => {
    // Die Suche trägt Freitextfilter (ETB `q`); sie gehören nicht in den Browserspeicher.
    setup(freigabenFixture(), {}, admin, '/einsaetze/7/personen?q=Meier');
    await screen.findByText('Personen-Inhalt');
    await waitFor(() =>
      expect(leseLetztenOrt(admin.id)).toEqual({ einsatzId: 7, pfad: '/einsaetze/7/personen' }),
    );
  });

  it('merkt kein gesperrtes Modul als letzten Ort', async () => {
    setup(freigabenFixture({ personen: { zugriff: false } }), {}, admin, '/einsaetze/7/personen');
    await freigabenAngekommen();
    await waitFor(() => expect(document.title).toContain('Hochwasser Nord'));
    expect(leseLetztenOrt(admin.id)).toBeNull();
  });

  it('reicht den geladenen Einsatz an die Seiten weiter', async () => {
    function Sonde() {
      return <span data-testid="rahmen-einsatz">{useEinsatzRahmen()?.bezeichnung ?? '—'}</span>;
    }
    server.use(
      meHandler(admin),
      http.get('/api/einsaetze', () => HttpResponse.json([einsatz])),
      http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz)),
      http.get('/api/einsaetze/7/modul-freigaben', () => HttpResponse.json(freigabenFixture())),
    );
    renderMitProviders(
      <CommandPaletteProvider>
        <Routes>
          <Route path="/einsaetze/:id" element={<EinsatzLayout />}>
            <Route path="etb" element={<Sonde />} />
          </Route>
        </Routes>
      </CommandPaletteProvider>,
      { route: '/einsaetze/7/etb' },
    );
    expect(await screen.findByTestId('rahmen-einsatz')).toHaveTextContent('Hochwasser Nord');
  });
});

/**
 * Übungsmarke im Rahmen (LLH-1725, Spec `uebungsmarke`, design.md D4–D6 in
 * `openspec/changes/archive/2026-11-15-wc3kzd54-uebungsmarke-rahmen/`). Das Kleben im Browser misst
 * `e2e/rahmen-stehen-bleiben.spec.ts`.
 */
describe('EinsatzLayout · Übung (LLH-1725)', () => {
  /** Derselbe Rahmen, aber der Einsatz ist eine Übung (Handler nach `setup`, er geht vor). */
  function setupUebung(route?: string) {
    const ergebnis = setup(freigabenFixture(), {}, admin, route);
    server.use(
      http.get('/api/einsaetze/7', () => HttpResponse.json({ ...einsatz, einsatzart: 'uebung' })),
    );
    return ergebnis;
  }

  beforeEach(() => {
    localStorage.clear();
    setzeViewportBreite(XL);
    document.title = 'lifeline-hub';
  });

  it('zeigt bei einer Übung das Band unter dem Kopf und die Marke vor dem Namen', async () => {
    setupUebung();
    const band = await waitFor(() => {
      const el = document.querySelector('[data-lfh="uebung-band"]');
      expect(el).not.toBeNull();
      return el!;
    });
    expect(band).toHaveTextContent('Übung');
    // Direkt nach dem Kopf: kein Hinweisband dazwischen.
    expect(screen.getByRole('banner').nextElementSibling).toBe(band);
    const kopf = screen.getByRole('banner');
    expect(kopf.querySelector('[data-lfh="uebung-marke"]')).not.toBeNull();
  });

  it('das Band klebt auch unter md, unter dem klebenden Kopf', async () => {
    setzeViewportBreite(390);
    setupUebung();
    const band = await waitFor(() => {
      const el = document.querySelector<HTMLElement>('[data-lfh="uebung-band"]');
      expect(el).not.toBeNull();
      return el!;
    });
    expect(band.style.position).toBe('sticky');
    // Unter md keine Kopfmarke: das Band trägt die Kennzeichnung (D5).
    expect(screen.getByRole('banner').querySelector('[data-lfh="uebung-marke"]')).toBeNull();
  });

  it('beim Realeinsatz stehen weder Band noch Marke (Gegenprobe)', async () => {
    setup();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Hochwasser Nord/ })).toBeInTheDocument(),
    );
    expect(document.querySelector('[data-lfh="uebung-band"]')).toBeNull();
    expect(document.querySelector('[data-lfh="uebung-marke"]')).toBeNull();
  });

  it('der Tab-Titel einer Übung beginnt mit „ÜBUNG ·“', async () => {
    setupUebung();
    await waitFor(() =>
      expect(document.title).toBe('ÜBUNG · ETB · Hochwasser Nord · lifeline-hub'),
    );
  });
});
