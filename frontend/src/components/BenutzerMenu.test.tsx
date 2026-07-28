/**
 * Das Benutzermenü auf beiden Breiten (LFH-329 · B1/M12).
 *
 * ZWEI AUSSAGEN, DIE ZUSAMMENGEHÖREN. Die Kopfzeile legt unterhalb von antds
 * `lg` ihre Umschalter ab — den Anzeigenamen im Trigger und den
 * Kopfzeilen-Umschalter für Farbschema und Bediendichte. Das erste ist Fläche,
 * das zweite wäre ein Verlust: A1 weist dem Führungs-Tablet und dem mobilen
 * Kontext ausdrücklich `komfortabel` und `handschuh` zu, und die
 * Kommandopalette hat heute keinen sichtbaren Auslöser (0 Konsumenten von
 * `useCommandPalette`, nur Cmd/Ctrl+K). Ohne die Gruppen hier wären beide
 * Stufen auf 390 px unbedienbar.
 *
 * JEDE SCHMAL-BEHAUPTUNG HAT IHRE POSITIVE GEGENPROBE mit derselben Abfrage im
 * breiten Ast. Eine reine `queryBy…`-Null ist auch dann grün, wenn die
 * Beschriftung falsch geschrieben oder die Rolle eine andere ist — sie belegt
 * für sich genommen nichts.
 *
 * `setzeViewportBreite` läuft VOR dem Render: antds Beobachter ruft seinen
 * Zuhörer beim Abonnieren synchron auf und liest dabei nur `matches`.
 */
import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { setzeViewportBreite } from '../test/viewport';
import { ThemeModeProvider } from '../theme/ThemeModeProvider';
import BenutzerMenu from './BenutzerMenu';

/** Zwei Wörter, damit die Initialen (erstes + letztes Wort) prüfbar sind. */
const ANZEIGENAME = 'Chef Dienst';
const INITIALEN = 'CD';

const benutzer = {
  id: 1, anzeigename: ANZEIGENAME, benutzername: 'chef', system_rolle: 'admin',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-05-23 10:00:00',
};

function zeige() {
  server.use(http.get('/api/auth/me', () => HttpResponse.json(benutzer)));
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

// `setup.ts` räumt den Speicher, nicht das Merkmalsverzeichnis am `<html>`:
// ohne diesen Aufräumer erbte der nächste Test die zuletzt geklickte Stufe.
afterEach(() => {
  delete document.documentElement.dataset.dichte;
  delete document.documentElement.dataset.theme;
});

describe('BenutzerMenu — ab lg', () => {
  it('der Trigger trägt den Anzeigenamen', async () => {
    zeige();
    // Am TRIGGER geprüft, nicht am Dokument: der Name steht auch in der
    // Kopfgruppe des Dropdowns — eine Abfrage über `screen` bliebe grün, wenn
    // er aus dem Trigger verschwände.
    expect((await trigger()).textContent).toContain(ANZEIGENAME);
  });

  it('kein Darstellungs- und kein Dichte-Eintrag im Dropdown', async () => {
    // Beide Achsen stehen ab lg als Umschalter in der Kopfzeile. Stünden sie
    // zusätzlich hier, gäbe es zwei Bedienwege mit getrenntem Aussehen für
    // dieselbe Wahl.
    zeige();
    await oeffne();
    // Regex, nicht exakt: antds Symbol-Span trägt ein eigenes `aria-label`
    // (`user`, `logout`) und geht damit in den zugänglichen Namen ein. Die
    // Einträge der zwei neuen Gruppen nutzen react-icons ohne Beschriftung und
    // heißen deshalb genau wie ihr Text — deren Prüfungen dürfen exakt sein.
    expect(await screen.findByRole('menuitem', { name: /Profil/ })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Hell/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Handschuh/ })).not.toBeInTheDocument();
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
    // Das `aria-label` bleibt: AppLayout.test.tsx und EinsatzLayout.test.tsx
    // greifen den Trigger darüber.
    expect(knopf).toHaveAttribute('aria-label', 'Benutzermenü');
  });

  it('hält die A1-Trefffläche (Gate 3: ≥ 24 px in der kurzen Achse)', async () => {
    zeige();
    // jsdom rechnet kein Layout — geprüft wird die gesetzte Höhe, nicht die
    // gerenderte. Die gerenderte Fläche belegt `e2e/kopfzeile-schmal.spec.ts`.
    expect((await trigger()).style.height).toBe('40px');
  });

  it('Darstellung liegt im Dropdown, der aktive Modus trägt ihn im Namen', async () => {
    zeige();
    await oeffne();
    // Das Häkchen ist der ZWEITE KANAL neben der Auswahlfarbe (WCAG 1.4.1) —
    // und zugleich das, was hier prüfbar ist: eine Klasse wäre es nicht.
    expect(await screen.findByRole('menuitem', { name: /System ✓/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /^Hell$/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /^Dunkel$/ })).toBeInTheDocument();
  });

  it('die Bediendichte liegt daneben — alle drei Stufen', async () => {
    // DER GRUND FÜR DIE GANZE GRUPPE: ohne sie wäre die Stufe auf 390 px nur
    // noch über die Palette erreichbar, die keinen sichtbaren Auslöser hat.
    zeige();
    await oeffne();
    expect(await screen.findByRole('menuitem', { name: /Kompakt ✓/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /^Komfortabel$/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /^Handschuh$/ })).toBeInTheDocument();
  });

  it('ein Klick führt bis ans <html> durch — beide Achsen', async () => {
    // Gemessen wird am Wurzelelement, nicht am Zustand der Komponente: eine
    // Wahl, die den Eintrag markiert, aber das Merkmal nicht setzt, ließe das
    // handgeschriebene CSS auf der Ausgangsstufe stehen.
    zeige();
    await oeffne();
    await userEvent.click(screen.getByRole('menuitem', { name: /^Dunkel$/ }));
    expect(document.documentElement.dataset.theme).toBe('dark');

    await oeffne();
    await userEvent.click(screen.getByRole('menuitem', { name: /^Handschuh$/ }));
    expect(document.documentElement.dataset.dichte).toBe('handschuh');
  });

  it('Profil und Abmelden bleiben erreichbar', async () => {
    // Die neuen Gruppen kommen HINZU, sie ersetzen nichts.
    zeige();
    await oeffne();
    // Regex, nicht exakt: antds Symbol-Span trägt ein eigenes `aria-label`
    // (`user`, `logout`) und geht damit in den zugänglichen Namen ein. Die
    // Einträge der zwei neuen Gruppen nutzen react-icons ohne Beschriftung und
    // heißen deshalb genau wie ihr Text — deren Prüfungen dürfen exakt sein.
    expect(await screen.findByRole('menuitem', { name: /Profil/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Abmelden/ })).toBeInTheDocument();
  });
});
