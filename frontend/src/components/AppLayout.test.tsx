import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { setzeViewportBreite } from '../test/viewport';
import { AuthProvider } from '../auth/AuthContext';
import { CommandPaletteProvider } from '../command-palette/CommandPaletteProvider';
import { farbenDunkel } from '../theme/tokens';
import { bedienzieleNachRolle, radiosImKopf, zaehleBedienziele } from '../test/kopfzeile';
import AppLayout from './AppLayout';

const admin = {
  id: 1,
  anzeigename: 'Chef',
  benutzername: 'chef',
  system_rolle: 'admin',
  org_rolle: 'keine',
  aktiv: true,
  erstellt_at: '2026-05-23 10:00:00',
};

function setup(me: Record<string, unknown>) {
  server.use(http.get('/api/auth/me', () => HttpResponse.json(me)));
  return renderMitProviders(
    <AuthProvider>
      <CommandPaletteProvider>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/" element={<div>Inhalt</div>} />
          </Route>
        </Routes>
      </CommandPaletteProvider>
    </AuthProvider>,
  );
}

describe('AppLayout (globale Topbar)', () => {
  it('Admin: Verwaltung ist Link, Profil/Abmelden im Benutzermenü (Benutzer wohnt in der Sidebar)', async () => {
    setup(admin);
    await waitFor(() => expect(screen.getByText('Chef')).toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'Verwaltung' })).toBeInTheDocument();
    // Benutzer ist kein Topbar-Link mehr (steht in der Admin-Sidebar).
    expect(screen.queryByRole('link', { name: 'Benutzer' })).not.toBeInTheDocument();
    expect(screen.getByText('Inhalt')).toBeInTheDocument();
    // Profil und Abmelden liegen jetzt im Benutzermenü (Dropdown).
    await userEvent.click(screen.getByRole('button', { name: 'Benutzermenü' }));
    expect(await screen.findByText('Profil')).toBeInTheDocument();
    expect(screen.getByText('Abmelden')).toBeInTheDocument();
  });

  it('Fuehrungskraft: Verwaltung frei, kein Benutzer-Topbar-Eintrag', async () => {
    setup({ ...admin, system_rolle: 'keiner', org_rolle: 'fuehrungskraft', anzeigename: 'Eva' });
    await waitFor(() => expect(screen.getByText('Eva')).toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'Verwaltung' })).toBeInTheDocument();
    // Der Grund steht seit LFH-337/M10 als sichtbarer Text (Tag), nicht mehr nur im
    // `title`-Hover — bei freier Berechtigung darf dieser Text gar nicht erscheinen.
    expect(screen.queryByText('Keine Berechtigung')).not.toBeInTheDocument();
  });

  it('Sonstige: Verwaltung gesperrt, kein Admin-Tag, kein Benutzer-Eintrag', async () => {
    setup({ ...admin, system_rolle: 'keiner', org_rolle: 'keine', anzeigename: 'Max' });
    await waitFor(() => expect(screen.getByText('Max')).toBeInTheDocument());
    expect(screen.queryByRole('link', { name: 'Verwaltung' })).not.toBeInTheDocument();
    // Seit LFH-337/M10 steht der Grund als sichtbarer Tag-Text da, nicht mehr im
    // `title`-Attribut (auf dem Führungs-Tablet gibt es kein Hover).
    const grundTags = screen.getAllByText('Keine Berechtigung');
    // GENAU einer — sonst bliebe „kein Benutzer-Eintrag" unbewiesen.
    expect(grundTags).toHaveLength(1);
    const gesperrt = grundTags[0].closest('.ant-typography') as HTMLElement;
    expect(gesperrt).toHaveTextContent('Verwaltung');
    // Die Schloss-Ikone ist mit dem Tag entfallen (LFH-337 · M10, sie sagte dasselbe
    // wie der jetzt sichtbare Text) — hier bleibt geprüft, dass kein Icon-Vorleseziel
    // in den gesperrten Eintrag zurückkehrt.
    expect(within(gesperrt).queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByText('Admin')).not.toBeInTheDocument();
  });

  /**
   * AK 1 von LFH-392: die Zahl der Bedienziele ist BELEGT gesunken.
   *
   * KALIBRIERT GEGEN DEN BESTAND, nicht gegen eine Wunschzahl: vor dem Umbau
   * zählte dieselbe Abfrage hier 10 (2 Links + 2 Knöpfe + 6 Segment-Radios),
   * danach 4. Wer den Zähler auf `getAllByRole('button')` verkürzt, misst vorher
   * wie nachher 2 und behauptet einen Fortschritt, den er nicht gemessen hat —
   * die Herleitung steht in `test/kopfzeile.ts`.
   *
   * `radio: 0` IST DIE NULLAUSSAGE dieses Pakets, und zwar die einzige, die rot
   * werden kann. Hier stand zuerst ein Paar `queryByRole('radiogroup', { name:
   * 'Farbschema wählen' })` — nutzlos: das Etikett kam mit `ThemeToggle.tsx` fort
   * und existiert im ganzen Repo nicht mehr, die Null war damit durch keine
   * Änderung am Produktivcode widerlegbar. Diese hier schlägt an, sobald
   * IRGENDEIN Segmented oder Radio in die Kopfzeile zurückkehrt — unabhängig
   * davon, wie es beschriftet ist.
   */
  it('AK1 — die Kopfzeile trägt nur noch 4 Bedienziele (vorher 10)', async () => {
    setup(admin);
    await waitFor(() => expect(screen.getByText('Chef')).toBeInTheDocument());
    expect(bedienzieleNachRolle()).toEqual({ button: 2, radio: 0, link: 2 });
    expect(zaehleBedienziele()).toBe(4);
  });

  /**
   * AK 2 als PAAR zum Test darüber: was aus der Kopfzeile verschwindet, ist
   * nachweislich woanders erreichbar. Ohne diese Hälfte belegte die 4 oben nur,
   * dass etwas WEG ist — nicht, dass es noch bedienbar ist.
   *
   * Geprüft wird ERREICHBARKEIT, nicht Wirkung: `renderMitProviders` montiert
   * keinen `ThemeModeProvider`, `useThemeMode` fällt deshalb auf `system` /
   * `kompakt` zurück (ThemeModeProvider.tsx:165-175). Dass ein Klick bis ans
   * `<html>` durchschlägt, prüft `BenutzerMenu.test.tsx` — dort steht der
   * Provider.
   */
  it('AK2 — beide Achsen sind ab lg im Benutzermenü erreichbar', async () => {
    setup(admin);
    await waitFor(() => expect(screen.getByText('Chef')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Benutzermenü' }));

    const menu = await screen.findByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: /System ✓/ })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: /^Dunkel$/ })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: /Kompakt ✓/ })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: /^Handschuh$/ })).toBeInTheDocument();
  });

  it('rendert den sichtbaren Such-Trigger in der globalen Kopfzeile', async () => {
    setup(admin);
    await waitFor(() => expect(screen.getByText('Chef')).toBeInTheDocument());

    expect(screen.getByRole('button', { name: 'Suchen' })).toBeInTheDocument();
  });

  describe('unter lg', () => {
    // Breite VOR dem Render: antds Beobachter ruft seinen Zuhörer beim
    // Abonnieren synchron auf und liest dabei nur `matches`.
    beforeEach(() => setzeViewportBreite(390));

    it('legt beide Umschalter ab und behält das Benutzermenü', async () => {
      setup(admin);
      // Der Trigger trägt hier keinen Namen mehr, deshalb hängt das Warten am
      // `aria-label` statt am Anzeigenamen.
      expect(await screen.findByRole('button', { name: 'Benutzermenü' })).toBeInTheDocument();
      // Über die ROLLE gezählt, nicht über das Etikett: „Farbschema wählen"
      // existiert seit LFH-392 nirgends mehr im Repo, eine Null darauf wäre
      // durch keine Änderung widerlegbar. Siehe `test/kopfzeile.ts`.
      expect(radiosImKopf()).toBe(0);
      // Der Anzeigename ist mit dem Trigger geschrumpft — die drei
      // Bestandsfälle oben laufen deshalb bewusst auf der Standardbreite.
      expect(screen.queryByText('Chef')).not.toBeInTheDocument();
      const suche = screen.getByRole('button', { name: 'Suchen' });
      expect(suche).toHaveAttribute('aria-label', 'Suchen');
      expect(suche.style.width).toBe('48px');
      expect(suche.style.height).toBe('48px');
    });
  });
});

describe('AppLayout · gesperrter Verwaltungs-Link (LFH-337 · M10)', () => {
  it('nennt den Grund als sichtbaren Text, nicht nur im title', async () => {
    // Default-`/api/auth/me` liefert 401 → benutzer = null → darfVerwaltung false.
    // CommandPaletteProvider ist hier Pflicht: AppLayout rendert CommandPaletteTrigger,
    // dessen useCommandPalette() außerhalb dieses Providers wirft — renderMitProviders
    // liefert ihn nicht mit, das ist AppLayout-spezifisch wie im `setup()` oben.
    renderMitProviders(
      <CommandPaletteProvider>
        <AppLayout />
      </CommandPaletteProvider>,
    );
    expect(await screen.findByText('Keine Berechtigung')).toBeVisible();
  });

  it('färbt den gesperrten Link aus der Farbrolle, nicht aus einem rgba-Hartwert', async () => {
    renderMitProviders(
      <CommandPaletteProvider>
        <AppLayout />
      </CommandPaletteProvider>,
    );
    const text = (await screen.findByText('Verwaltung')).closest('span');
    // Die ROLLE ist die Aussage, nicht die Zahl: `farbenDunkel.schwach` liefert gegen
    // den Kopfzeilengrund #001529 gerechnete 5,3:1, der abgelöste Wert
    // rgba(255,255,255,0.35) nur ~3,2:1. jsdom rechnet keine Farbmischung — die Zahl
    // steht deshalb im Commit, hier steht die Herkunft.
    expect(text).toHaveStyle({ color: farbenDunkel.schwach });
  });

  it('zeigt für Berechtigte den freien Link ohne Sperrhinweis', async () => {
    server.use(
      http.get('/api/auth/me', () =>
        HttpResponse.json({
          id: 1,
          anzeigename: 'A',
          benutzername: 'a',
          system_rolle: 'admin',
          org_rolle: 'keine',
          aktiv: true,
          erstellt_at: '2026-05-23 10:00:00',
          totp_aktiviert: false,
        }),
      ),
    );
    renderMitProviders(
      <CommandPaletteProvider>
        <AppLayout />
      </CommandPaletteProvider>,
    );
    // Die Gegenaussage macht die erste überhaupt prüfbar: ohne sie wäre ein
    // dauerhaft eingeblendetes „Keine Berechtigung" ebenfalls grün.
    expect(await screen.findByRole('link', { name: 'Verwaltung' })).toBeInTheDocument();
    expect(screen.queryByText('Keine Berechtigung')).toBeNull();
  });

  /**
   * Der Tag steht erst ab `lg` (LFH-337 · Fix-Welle, Befund B1).
   *
   * Der Block kann weder kürzen noch umbrechen (`flexShrink: 0` plus antds
   * `white-space: nowrap` am Tag); auf 390 px sprengte er die Kopfzeile. Die Zahl
   * misst nur der Browser — die e2e-Wache dafür steht in
   * `e2e/kopfzeile-schmal.spec.ts`. Hier wird die Verdrahtung geprüft, die sie trägt.
   *
   * ZWEI Zusicherungen, nicht eine: ohne die zweite („der gedämpfte Link steht noch")
   * bliebe der Test auch dann grün, wenn jemand den ganzen gesperrten Zweig entfernte —
   * und „gesperrt statt versteckt" ist die Regel, die dieser Zweig trägt.
   */
  it('lässt auf 390 px nur den Tag weg, nicht den gedämpften Link', async () => {
    // Breite VOR dem Render: antds Beobachter ruft seinen Zuhörer beim Abonnieren
    // synchron auf und liest dabei nur `matches`.
    setzeViewportBreite(390);
    renderMitProviders(
      <CommandPaletteProvider>
        <AppLayout />
      </CommandPaletteProvider>,
    );
    const verwaltung = await screen.findByText('Verwaltung');
    expect(verwaltung).toBeVisible();
    // Immer noch der GESPERRTE Zweig, nicht der freie Link — sonst prüfte die Zeile
    // darunter einen Zustand, in dem es ohnehin keinen Tag gäbe.
    expect(screen.queryByRole('link', { name: 'Verwaltung' })).toBeNull();
    expect(screen.queryByText('Keine Berechtigung')).toBeNull();
  });
});
