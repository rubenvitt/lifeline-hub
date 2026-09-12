// frontend/src/command-palette/CommandPaletteProvider.gedaechtnis.test.tsx
import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { globalKeys } from '../api/queryKeys';
import { CommandPaletteProvider } from './CommandPaletteProvider';
import { SCHLUESSEL_ZULETZT_BEFEHLE } from './zuletztBefehle';

/**
 * DIE NAHT des Befehls-Gedächtnisses (LFH-391 · Etappe D).
 *
 * `zuletztBefehle.test.ts` prüft den reinen Kern, `useZuletztBefehle.test.tsx` die
 * Beschaffung, `befehle.test.ts` die Auflösung — alle drei könnten grün sein, während die
 * Teile gar nicht miteinander verbunden sind. Hier läuft der Weg als BEDIENUNG: Palette
 * auf, Befehl ausführen, Palette schliesst sich dabei selbst, Palette wieder auf, Eintrag da.
 *
 * `useBefehle` ist hier ECHT (anders als in den beiden anderen Provider-Testdateien) — die
 * Injektion `zuletztBefehlIds`/`merkeBefehl` ist genau das, was geprüft werden soll.
 */

const nutzer = {
  id: 1,
  anzeigename: 'EL',
  benutzername: 'el',
  system_rolle: 'keiner',
  org_rolle: 'fuehrungskraft',
  aktiv: true,
  erstellt_at: '',
  totp_aktiviert: false,
};

let puts: { schluessel: string; wert: string }[];

beforeEach(() => {
  puts = [];
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(nutzer)),
    http.get('/api/einsaetze', () => HttpResponse.json([])),
    http.put('/api/benutzer-einstellungen/:schluessel', async ({ params, request }) => {
      const body = (await request.json()) as { wert: string };
      puts.push({ schluessel: String(params.schluessel), wert: body.wert });
      return HttpResponse.json({ eintraege: { [String(params.schluessel)]: body.wert } });
    }),
  );
});

const oeffne = (u: ReturnType<typeof userEvent.setup>) => u.keyboard('{Control>}k{/Control}');
const gedaechtnisGruppe = () => screen.queryByRole('group', { name: 'Zuletzt ausgeführt' });

describe('Kommandopalette · Gedächtnis zuletzt ausgeführter Befehle', () => {
  /**
   * FALLE (a): `CommandPalette.fuehreAus` ruft `schliesse()` VOR `ausfuehren()`, und
   * `{offen && <PaletteHost/>}` hängt den Teilbaum dabei ab. Ein Träger mit
   * Komponentenbindung schriebe aus einem abgehängten Baum — der Eintrag fehlte beim
   * nächsten Öffnen, ohne Fehlermeldung. Genau dieser Ablauf steht hier.
   */
  it('merkt einen ausgeführten Befehl über das Schliessen der Palette hinweg', async () => {
    server.use(http.get('/api/benutzer-einstellungen', () => HttpResponse.json({ eintraege: {} })));
    const u = userEvent.setup();
    renderMitProviders(
      <CommandPaletteProvider>
        <div />
      </CommandPaletteProvider>,
    );

    await oeffne(u);
    await u.click(await screen.findByRole('option', { name: 'Profil' }));

    // Die Palette hat sich beim Ausführen selbst geschlossen.
    await waitFor(() => expect(screen.queryByRole('combobox')).toBeNull());
    await waitFor(() =>
      expect(puts).toEqual([{ schluessel: SCHLUESSEL_ZULETZT_BEFEHLE, wert: '["nav:profil"]' }]),
    );

    await oeffne(u);

    const gruppe = await screen.findByRole('group', { name: 'Zuletzt ausgeführt' });
    expect(within(gruppe).getByRole('option', { name: 'Profil' })).toBeInTheDocument();
    // Zuoberst — die Gruppe ist die erste im Kasten, nicht irgendwo dazwischen.
    const gruppen = within(screen.getByRole('listbox')).getAllByRole('group');
    expect(gruppen[0]).toHaveAttribute('aria-label', 'Zuletzt ausgeführt');
  });

  /** Die Gegenaussage: ohne Ausführung entsteht die Gruppe nicht. Ohne sie wäre auch eine
   *  Fassung grün, die jeden Befehl von Anfang an ins Gedächtnis schriebe. */
  it('zeigt ohne gemerkten Befehl gar keine Gedächtnisgruppe', async () => {
    server.use(http.get('/api/benutzer-einstellungen', () => HttpResponse.json({ eintraege: {} })));
    const u = userEvent.setup();
    renderMitProviders(
      <CommandPaletteProvider>
        <div />
      </CommandPaletteProvider>,
    );

    await oeffne(u);

    await screen.findByRole('option', { name: 'Profil' });
    expect(gedaechtnisGruppe()).toBeNull();
    expect(puts).toEqual([]);
  });

  /**
   * FALLE (b): der Serverstand kommt nicht synchron. Die Startansicht ist per Vertrag
   * kuratiert (LFH-337 · M11) und „Live-Updates springen nicht unter dem Cursor" ist
   * Projektregel (WCAG 3.2.5) — eine Gruppe, die ZUOBERST nachklappt, schiebt jede darunter
   * liegende Zeile nach unten, während der Finger schon unterwegs ist.
   *
   * Gelöst durch EINEN Standbild-Griff beim Öffnen (`useState`-Initialwert in `PaletteHost`).
   * Der Test belegt beide Hälften: während die Palette offen steht, ändert die eintreffende
   * Antwort nichts; beim nächsten Öffnen ist sie da.
   */
  it('lässt eine nachträglich eintreffende Antwort nicht in die offene Palette springen', async () => {
    let loese: () => void = () => {};
    const antwortFrei = new Promise<void>((r) => {
      loese = r;
    });
    server.use(
      http.get('/api/benutzer-einstellungen', async () => {
        await antwortFrei;
        return HttpResponse.json({
          eintraege: { [SCHLUESSEL_ZULETZT_BEFEHLE]: '["nav:profil"]' },
        });
      }),
    );
    const u = userEvent.setup();
    const { client } = renderMitProviders(
      <CommandPaletteProvider>
        <div />
      </CommandPaletteProvider>,
    );

    await oeffne(u);
    await screen.findByRole('option', { name: 'Profil' });
    expect(gedaechtnisGruppe()).toBeNull();

    loese();
    await waitFor(() =>
      expect(client.getQueryData(globalKeys.benutzerEinstellungenVon(nutzer.id))).toBeDefined(),
    );

    // Der Stand IST da — und die offene Palette hat sich trotzdem nicht umsortiert.
    expect(gedaechtnisGruppe()).toBeNull();

    await u.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('combobox')).toBeNull());
    await oeffne(u);

    const gruppe = await screen.findByRole('group', { name: 'Zuletzt ausgeführt' });
    expect(within(gruppe).getByRole('option', { name: 'Profil' })).toBeInTheDocument();
  });

  /**
   * Bei AKTIVER Suche entfällt die Gruppe — sonst stünde jeder gemerkte Befehl doppelt in
   * der flachen Trefferliste, mit gleichem Label und gleichem Ziel.
   */
  it('zeigt den gemerkten Befehl bei aktiver Suche genau einmal', async () => {
    server.use(
      http.get('/api/benutzer-einstellungen', () =>
        HttpResponse.json({
          eintraege: { [SCHLUESSEL_ZULETZT_BEFEHLE]: '["nav:profil"]' },
        }),
      ),
    );
    const u = userEvent.setup();
    renderMitProviders(
      <CommandPaletteProvider>
        <div />
      </CommandPaletteProvider>,
    );

    await oeffne(u);
    await screen.findByRole('group', { name: 'Zuletzt ausgeführt' });
    await u.type(screen.getByRole('combobox'), 'profil');

    await waitFor(() => expect(gedaechtnisGruppe()).toBeNull());
    expect(screen.getAllByRole('option', { name: 'Profil' })).toHaveLength(1);
  });
});
