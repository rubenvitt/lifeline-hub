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
  // Der Name steht erst ab `xl` im Benutzer-Trigger; die Tests lesen ihn als Ladeanker.
  beforeEach(() => setzeViewportBreite(1366));

  it('Admin: Verwaltung ist Link, Profil/Abmelden im Benutzermenü (Benutzer wohnt in der Sidebar)', async () => {
    setup(admin);
    await waitFor(() => expect(screen.getByText('Chef')).toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'Verwaltung' })).toBeInTheDocument();
    // Benutzer ist kein Topbar-Link (steht in der Admin-Sidebar).
    expect(screen.queryByRole('link', { name: 'Benutzer' })).not.toBeInTheDocument();
    expect(screen.getByText('Inhalt')).toBeInTheDocument();
    // Profil und Abmelden liegen im Benutzermenü.
    await userEvent.click(screen.getByRole('button', { name: 'Benutzermenü' }));
    expect(await screen.findByText('Profil')).toBeInTheDocument();
    expect(screen.getByText('Abmelden')).toBeInTheDocument();
  });

  it('Fuehrungskraft: Verwaltung frei, kein Benutzer-Topbar-Eintrag', async () => {
    setup({ ...admin, system_rolle: 'keiner', org_rolle: 'fuehrungskraft', anzeigename: 'Eva' });
    await waitFor(() => expect(screen.getByText('Eva')).toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'Verwaltung' })).toBeInTheDocument();
    // Der Grund steht als sichtbarer Text (Tag), nicht nur im `title` — bei freier Berechtigung
    // darf er nicht erscheinen.
    expect(screen.queryByText('Keine Berechtigung')).not.toBeInTheDocument();
  });

  it('Sonstige: Verwaltung gesperrt, kein Admin-Tag, kein Benutzer-Eintrag', async () => {
    setup({ ...admin, system_rolle: 'keiner', org_rolle: 'keine', anzeigename: 'Max' });
    await waitFor(() => expect(screen.getByText('Max')).toBeInTheDocument());
    expect(screen.queryByRole('link', { name: 'Verwaltung' })).not.toBeInTheDocument();
    // Der Grund steht als sichtbarer Tag-Text (auf dem Führungs-Tablet gibt es kein Hover).
    const grundTags = screen.getAllByText('Keine Berechtigung');
    // GENAU einer — sonst bliebe „kein Benutzer-Eintrag" unbewiesen.
    expect(grundTags).toHaveLength(1);
    const gesperrt = grundTags[0].closest('.ant-typography') as HTMLElement;
    expect(gesperrt).toHaveTextContent('Verwaltung');
    // Kein Icon-Vorleseziel im gesperrten Eintrag: das Wort trägt den Grund.
    expect(within(gesperrt).queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByText('Admin')).not.toBeInTheDocument();
  });

  /**
   * AK 1 von LFH-392: die Zahl der Bedienziele ist BELEGT gesunken — kalibriert gegen den Bestand
   * (dieselbe Abfrage zählte vorher 10). `getAllByRole('button')` allein mäße vorher wie nachher 2;
   * die Herleitung steht in `test/kopfzeile.ts`.
   *
   * `radio: 0` IST DIE NULLAUSSAGE und die einzige, die rot werden kann: sie schlägt an, sobald
   * IRGENDEIN Segmented oder Radio in die Kopfzeile zurückkehrt, unabhängig von der Beschriftung.
   */
  it('AK1 — die Kopfzeile trägt nur noch 4 Bedienziele (vorher 10)', async () => {
    setup(admin);
    await waitFor(() => expect(screen.getByText('Chef')).toBeInTheDocument());
    expect(bedienzieleNachRolle()).toEqual({ button: 2, radio: 0, link: 2 });
    expect(zaehleBedienziele()).toBe(4);
  });

  /**
   * AK 2 als PAAR zum Test darüber: was aus der Kopfzeile verschwindet, ist woanders erreichbar.
   *
   * Geprüft wird ERREICHBARKEIT, nicht Wirkung: ohne `ThemeModeProvider` fällt `useThemeMode` auf
   * die Vorgaben zurück. Die Wirkung bis ans `<html>` prüft `BenutzerMenu.test.tsx`.
   */
  it('AK2 — beide Achsen sind ab lg im Benutzermenü erreichbar', async () => {
    setup(admin);
    await waitFor(() => expect(screen.getByText('Chef')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Benutzermenü' }));

    const menu = await screen.findByRole('menu');
    // Vorgabe: Nachtbetrieb trägt das Häkchen.
    expect(within(menu).getByRole('menuitem', { name: /Dunkel ✓/ })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: /^System$/ })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: /Kompakt ✓/ })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: /^Handschuh$/ })).toBeInTheDocument();
  });

  it('rendert den sichtbaren Such-Trigger in der globalen Kopfzeile', async () => {
    setup(admin);
    await waitFor(() => expect(screen.getByText('Chef')).toBeInTheDocument());

    expect(screen.getByRole('button', { name: 'Suchen' })).toBeInTheDocument();
  });

  describe('unter lg', () => {
    // Breite VOR dem Render: antds Beobachter liest beim Abonnieren nur `matches`.
    beforeEach(() => setzeViewportBreite(390));

    it('legt beide Umschalter ab und behält das Benutzermenü', async () => {
      setup(admin);
      // Der Trigger trägt hier keinen Namen, deshalb hängt das Warten am `aria-label`.
      expect(await screen.findByRole('button', { name: 'Benutzermenü' })).toBeInTheDocument();
      // Über die ROLLE gezählt, nicht über ein Etikett, das es nicht mehr gibt (siehe
      // `test/kopfzeile.ts`).
      expect(radiosImKopf()).toBe(0);
      // Der Anzeigename ist mit dem Trigger geschrumpft; die Bestandsfälle oben laufen deshalb auf
      // der Standardbreite.
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
    // CommandPaletteProvider ist Pflicht: AppLayout rendert CommandPaletteTrigger, dessen
    // useCommandPalette() außerhalb des Providers wirft.
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
    // Die ROLLE ist die Aussage, nicht die Zahl: `farbenDunkel.schwach` hält gegen den
    // Kopfzeilengrund den Kontrast. jsdom rechnet keine Farbmischung, hier steht die Herkunft.
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
   * Der Tag steht erst ab `lg` (LFH-337): er kann weder kürzen noch umbrechen und sprengte bei
   * 390 px die Kopfzeile. Die Zahl misst `e2e/kopfzeile-schmal.spec.ts`, hier die Verdrahtung.
   *
   * ZWEI Zusicherungen: ohne „der gedämpfte Link steht noch" bliebe der Test grün, wenn jemand
   * den gesperrten Zweig entfernte — und „gesperrt statt versteckt" ist die Regel.
   */
  it('lässt auf 390 px nur den Tag weg, nicht den gedämpften Link', async () => {
    // Breite VOR dem Render: antds Beobachter liest beim Abonnieren nur `matches`.
    setzeViewportBreite(390);
    renderMitProviders(
      <CommandPaletteProvider>
        <AppLayout />
      </CommandPaletteProvider>,
    );
    const verwaltung = await screen.findByText('Verwaltung');
    expect(verwaltung).toBeVisible();
    // Immer noch der GESPERRTE Zweig — sonst prüfte die Zeile darunter einen Zustand ohne Tag.
    expect(screen.queryByRole('link', { name: 'Verwaltung' })).toBeNull();
    expect(screen.queryByText('Keine Berechtigung')).toBeNull();
  });
});
