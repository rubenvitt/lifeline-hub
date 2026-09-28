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
 * Die Naht des Befehls-Gedächtnisses als BEDIENUNG: Palette auf, Befehl ausführen (die Palette
 * schließt sich), Palette wieder auf, Eintrag da. Kern, Beschaffung und Auflösung sind je für
 * sich geprüft. `useBefehle` ist hier ECHT, die Injektion ist genau das Prüfobjekt.
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
   * `CommandPalette.fuehreAus` ruft `schliesse()` VOR `ausfuehren()` und hängt den Palettenbaum
   * ab; ein Träger mit Komponentenbindung verlöre den Eintrag still.
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
    // Zuoberst: die Gruppe ist die erste im Kasten.
    const gruppen = within(screen.getByRole('listbox')).getAllByRole('group');
    expect(gruppen[0]).toHaveAttribute('aria-label', 'Zuletzt ausgeführt');
  });

  /** Gegenaussage: ohne Ausführung entsteht die Gruppe nicht. */
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
   * Der Serverstand kommt nicht synchron; eine ZUOBERST nachklappende Gruppe schöbe jede Zeile
   * unter dem Finger nach unten (WCAG 3.2.5). Gelöst durch das Standbild beim Öffnen: in der
   * offenen Palette ändert die späte Antwort nichts, beim nächsten Öffnen ist sie da.
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

    // Der Stand IST da, und die offene Palette hat sich trotzdem nicht umsortiert.
    expect(gedaechtnisGruppe()).toBeNull();

    await u.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('combobox')).toBeNull());
    await oeffne(u);

    const gruppe = await screen.findByRole('group', { name: 'Zuletzt ausgeführt' });
    expect(within(gruppe).getByRole('option', { name: 'Profil' })).toBeInTheDocument();
  });

  /**
   * Bei AKTIVER Suche entfällt die Gruppe, sonst stünde jeder gemerkte Befehl doppelt in der
   * flachen Liste.
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
