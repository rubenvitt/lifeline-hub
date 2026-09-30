/**
 * Das Benutzermenü (LFH-329 · B1/M12, LFH-392).
 *
 * ZWEI SORTEN AUSSAGE, nicht vermischen:
 *
 * 1. BREITENABHÄNGIG ist nur der TRIGGER — schmal schrumpft er auf die Initialen (kein Name,
 *    kein Chevron). Das tragen die Blöcke je Breite.
 * 2. BREITENUNABHÄNGIG sind die zwei Umschaltgruppen im Dropdown: der EINZIGE sichtbare
 *    Bedienweg für Farbschema und Bediendichte. Sie stehen im über beide Breiten
 *    parametrisierten Block ganz unten.
 *
 * Die Gruppen sind nicht verzichtbar: A1 weist Tablet und Handschirm `komfortabel` und
 * `handschuh` zu, und die Kommandopalette zeigt keinen AKTIVEN Wert an.
 *
 * JEDE NULLAUSSAGE BRAUCHT IHRE POSITIVE GEGENPROBE mit derselben Abfrage: eine reine
 * `queryBy…`-Null ist auch bei falscher Beschriftung grün.
 *
 * `setzeViewportBreite` läuft VOR dem Render: antds Beobachter liest beim Abonnieren nur
 * `matches`.
 */
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { meHandler, server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { setzeViewportBreite } from '../test/viewport';
import { ThemeModeProvider, useWarnsperre } from '../theme/ThemeModeProvider';
import BenutzerMenu from './BenutzerMenu';
import { adminFixture } from '../test/fixtures';

/** Zwei Wörter, damit die Initialen (erstes + letztes Wort) prüfbar sind. */
const ANZEIGENAME = 'Chef Dienst';
const INITIALEN = 'CD';

const benutzer = adminFixture({ anzeigename: ANZEIGENAME });

function zeige() {
  server.use(meHandler(benutzer));
  return renderMitProviders(
    <ThemeModeProvider>
      <BenutzerMenu />
    </ThemeModeProvider>,
  );
}

/** Der Trigger, über sein `aria-label` — daran hängt auch AppLayout.test.tsx. */
function trigger() {
  return screen.findByRole('button', { name: 'Benutzermenü' });
}

async function oeffne() {
  await userEvent.click(await trigger());
}

// `setup.ts` räumt den Speicher, nicht das Merkmalsverzeichnis am `<html>` — sonst erbte der
// nächste Test die zuletzt geklickte Stufe.
afterEach(() => {
  delete document.documentElement.dataset.dichte;
  delete document.documentElement.dataset.theme;
});

describe('BenutzerMenu — ab xl', () => {
  // Der Name steht erst ab `xl` (1200 px) im Trigger; der Vorgabe-Viewport des Stubs ist 1024 px.
  beforeEach(() => setzeViewportBreite(1366));

  it('der Trigger trägt den Anzeigenamen', async () => {
    zeige();
    // Am TRIGGER geprüft: der Name steht auch in der Kopfgruppe des Dropdowns.
    expect((await trigger()).textContent).toContain(ANZEIGENAME);
  });

  it('der Trigger trägt die Funktion statt des Namens, wenn sie bekannt ist (Neuentwurf)', async () => {
    server.use(meHandler(benutzer));
    renderMitProviders(
      <ThemeModeProvider>
        <BenutzerMenu funktion="S2 Lage" />
      </ThemeModeProvider>,
    );
    const knopf = await trigger();
    expect(knopf.textContent).toContain('S2 Lage');
    expect(knopf.textContent).toContain(INITIALEN);
    expect(knopf.textContent).not.toContain(ANZEIGENAME);
    // Der zugängliche Name bleibt — daran hängen die Layout-Suiten.
    expect(knopf).toHaveAttribute('aria-label', 'Benutzermenü');
  });

  it('zeigt die gebaute Frontend-Version sichtbar im Dropdown', async () => {
    zeige();
    await oeffne();
    expect(await screen.findByText(/^Version \d+\.\d+\.\d+/)).toBeInTheDocument();
  });
});

describe('BenutzerMenu — Führungs-Tablet zwischen lg und xl', () => {
  // 1024 px: die Kopfzeile soll einzeilig bleiben.
  beforeEach(() => setzeViewportBreite(1024));

  it('der Trigger trägt nur die Initialen — die Funktion steht im zugänglichen Namen nicht', async () => {
    server.use(meHandler(benutzer));
    renderMitProviders(
      <ThemeModeProvider>
        <BenutzerMenu funktion="S2 Lage" />
      </ThemeModeProvider>,
    );
    const knopf = await trigger();
    expect(knopf.textContent).toContain(INITIALEN);
    expect(knopf.textContent).not.toContain('S2 Lage');
    expect(knopf).toHaveAttribute('aria-label', 'Benutzermenü');
  });
});

describe('BenutzerMenu — unter lg', () => {
  // Breite VOR dem Render setzen (siehe Dateikopf).
  beforeEach(() => setzeViewportBreite(390));

  it('der Trigger schrumpft auf die Initialen — kein Name, kein Chevron', async () => {
    zeige();
    const knopf = await trigger();
    expect(knopf.textContent).not.toContain(ANZEIGENAME);
    expect(knopf.textContent).toContain(INITIALEN);
    // Das `aria-label` bleibt: AppLayout.test.tsx und EinsatzLayout.test.tsx greifen den Trigger
    // darüber.
    expect(knopf).toHaveAttribute('aria-label', 'Benutzermenü');
  });

  it('hält die A1-Trefffläche (Gate 3: ≥ 24 px in der kurzen Achse)', async () => {
    zeige();
    // jsdom rechnet kein Layout — geprüft wird die gesetzte Höhe; die gerenderte Fläche belegt
    // `e2e/kopfzeile-schmal.spec.ts`.
    expect((await trigger()).style.height).toBe('40px');
  });

  it('Profil und Abmelden bleiben erreichbar', async () => {
    // Die Gruppen kommen HINZU, sie ersetzen nichts.
    zeige();
    await oeffne();
    // Regex, nicht exakt: aus der Zeit, als antds Symbol-Span ein eigenes `aria-label` (`user`,
    // `logout`) trug. Die Ikonen des Satzes sind `aria-hidden` (LFH-595); die Einträge der zwei
    // Gruppen werden exakt geprüft.
    expect(await screen.findByRole('menuitem', { name: /Profil/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Abmelden/ })).toBeInTheDocument();
  });
});

/** LFH-387: „Abmelden“ aus einem veralteten Tab beendet keine fremde Sitzung und verlässt die
 *  Seite nicht — der Server lehnt mit 412 ab, der Tab zeigt den Benutzerkonflikt. */
describe('Abmelden', () => {
  function zeigeMitAnmeldeseite(logoutStatus: number) {
    server.use(
      meHandler(benutzer),
      http.post('/api/auth/logout', () =>
        logoutStatus === 204
          ? new HttpResponse(null, { status: 204 })
          : HttpResponse.json({ error: 'fremd' }, { status: logoutStatus }),
      ),
    );
    return renderMitProviders(
      <ThemeModeProvider>
        <Routes>
          <Route path="/login" element={<div>Anmeldeseite</div>} />
          <Route path="*" element={<BenutzerMenu />} />
        </Routes>
      </ThemeModeProvider>,
    );
  }

  it('führt nach dem Abmelden zur Anmeldeseite', async () => {
    zeigeMitAnmeldeseite(204);
    await oeffne();
    await userEvent.click(await screen.findByRole('menuitem', { name: /Abmelden/ }));
    expect(await screen.findByText('Anmeldeseite')).toBeInTheDocument();
  });

  it('bleibt stehen, wenn der Server das Abmelden mit 412 ablehnt', async () => {
    zeigeMitAnmeldeseite(412);
    await oeffne();
    await userEvent.click(await screen.findByRole('menuitem', { name: /Abmelden/ }));
    await waitFor(() => expect(screen.queryByText('Anmeldeseite')).not.toBeInTheDocument());
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByText('Anmeldeseite')).not.toBeInTheDocument();
    expect(await trigger()).toBeInTheDocument();
  });
});

/**
 * Die zwei Umschaltgruppen hängen an KEINER Breite (LFH-392). Die Parametrisierung schreibt die
 * Abwesenheit einer Breitenregel hin.
 *
 * Die Breite steht als LITERAL da (1024 = Vitest-Vorgabe, 390 = Handschirm); aus `useViewport`
 * zurückgelesen prüfte sie sich selbst.
 */
describe.each([
  ['ab lg', 1024],
  ['unter lg', 390],
])('BenutzerMenu — Umschaltgruppen, %s', (_lage, breite) => {
  beforeEach(() => setzeViewportBreite(breite));

  it('Darstellung liegt im Dropdown, der aktive Modus trägt ihn im Namen', async () => {
    zeige();
    await oeffne();
    // Das Häkchen ist der ZWEITE KANAL neben der Auswahlfarbe (WCAG 1.4.1) und prüfbar. Ohne
    // gespeicherte Wahl ist der Nachtbetrieb aktiv; „System" bleibt wählbar.
    expect(await screen.findByRole('menuitem', { name: /Dunkel ✓/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /^Hell$/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /^System$/ })).toBeInTheDocument();
  });

  it('die Bediendichte liegt daneben — alle drei Stufen', async () => {
    // Der Grund für die Gruppe: die Kommandopalette zeigt keinen aktiven Wert an.
    zeige();
    await oeffne();
    expect(await screen.findByRole('menuitem', { name: /Kompakt ✓/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /^Komfortabel$/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /^Handschuh$/ })).toBeInTheDocument();
  });

  it('ein Klick führt bis ans <html> durch — beide Achsen', async () => {
    // Gemessen am Wurzelelement: eine Wahl, die den Eintrag markiert, aber das Merkmal nicht setzt,
    // ließe das CSS auf der Ausgangsstufe stehen. DIESE HÄLFTE TRÄGT DIE AUSSAGE — ein fehlender
    // `onClick`-Zweig ließe die Präsenztests oben grün.
    zeige();
    await oeffne();
    // Gewählt wird der NICHT aktive Modus: ein Klick auf „Dunkel" (Vorgabe) bewiese nichts.
    await userEvent.click(screen.getByRole('menuitem', { name: /^Hell$/ }));
    expect(document.documentElement.dataset.theme).toBe('light');

    await oeffne();
    await userEvent.click(screen.getByRole('menuitem', { name: /^Handschuh$/ }));
    expect(document.documentElement.dataset.dichte).toBe('handschuh');

    // DIE ACHSEN SIND UNABHÄNGIG — der Dichte-Klick setzt das Farbschema nicht mit (ein Context im
    // `ThemeModeProvider`, zwei Setter).
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});

/**
 * Die Helligkeitsgruppe (LFH-397, design.md D6). Mit Warnung wird die Sperre ERKLÄRT, nicht
 * stumm weggeschaltet (M16): die Überschrift nennt Boden und Grund, die Stufen darunter
 * sind gesperrt, und eine Wahl unter dem Boden sagt, was wirkt.
 */
describe('BenutzerMenu — Helligkeit (LFH-397)', () => {
  afterEach(() => {
    delete document.documentElement.dataset.helligkeit;
  });

  function Warnquelle() {
    useWarnsperre(true);
    return null;
  }

  it('fünf Stufen, die gewählte trägt ✓, ein Klick führt bis ans <html> durch', async () => {
    zeige();
    await oeffne();
    expect(await screen.findByRole('menuitem', { name: /^100 % ✓$/ })).toBeInTheDocument();
    for (const s of ['80 %', '60 %', '40 %', '20 %']) {
      expect(screen.getByRole('menuitem', { name: new RegExp(`^${s}$`) })).toBeInTheDocument();
    }
    await userEvent.click(screen.getByRole('menuitem', { name: /^40 %$/ }));
    expect(document.documentElement.dataset.helligkeit).toBe('40');
    expect(localStorage.getItem('lifeline-hub.helligkeit')).toBe('40');
  });

  it('ohne Warnung ist keine Stufe gesperrt und die Überschrift nennt keinen Boden', async () => {
    zeige();
    await oeffne();
    const zwanzig = await screen.findByRole('menuitem', { name: /^20 %$/ });
    expect(zwanzig).not.toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('Helligkeit')).toBeInTheDocument();
    expect(screen.queryByText(/Warnung aktiv/)).not.toBeInTheDocument();
  });

  it('mit Warnung: Boden und Grund in der Überschrift, Stufen darunter gesperrt, Wahl zeigt die Wirkung', async () => {
    localStorage.setItem('lifeline-hub.helligkeit', '40');
    server.use(meHandler(benutzer));
    renderMitProviders(
      <ThemeModeProvider>
        <BenutzerMenu />
        <Warnquelle />
      </ThemeModeProvider>,
    );
    await oeffne();
    expect(await screen.findByText('Helligkeit · mind. 80 % (Warnung aktiv)')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /^40 % ✓ \(wirkt 80 %\)$/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    for (const s of ['60 %', '20 %']) {
      expect(screen.getByRole('menuitem', { name: new RegExp(`^${s}$`) })).toHaveAttribute(
        'aria-disabled',
        'true',
      );
    }
    for (const s of ['100 %', '80 %']) {
      expect(screen.getByRole('menuitem', { name: new RegExp(`^${s}$`) })).not.toHaveAttribute(
        'aria-disabled',
        'true',
      );
    }
  });
});
