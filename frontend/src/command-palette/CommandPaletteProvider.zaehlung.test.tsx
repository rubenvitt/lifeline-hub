// Die Naht der Zählung je Schnellaktion (y3zh5ymv D5) über den ECHTEN Provider: er hält die
// Zählung, friert sie beim Öffnen ein und reicht `zaehle` an `useBefehle`. `baueBefehle` selbst ist
// in `befehle.test.ts` geprüft, der Hook in `useSchnellaktionZaehler.test.tsx`.
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { screen, waitFor } from '@testing-library/react';
import { meHandler, server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { globalKeys } from '../api/queryKeys';
import { benutzerFixture } from '../test/fixtures';
import { CommandPaletteProvider } from './CommandPaletteProvider';
import { SCHLUESSEL_SCHNELLAKTIONEN_ZAEHLER } from './schnellaktionZaehler';
import type { SchnellaktionZaehlung } from './useSchnellaktionZaehler';
import type { Befehl } from './typen';

/** Die Zählung, die `useBefehle` bei jedem Render bekam, jüngste zuletzt. */
const gesehen: SchnellaktionZaehlung[] = [];

vi.mock('./useBefehle', () => ({
  useBefehle: (
    _aktionen: unknown,
    _gedaechtnis: unknown,
    _navigate: unknown,
    _abmelden: unknown,
    zaehlung?: SchnellaktionZaehlung,
  ): Befehl[] => {
    if (zaehlung) gesehen.push(zaehlung);
    return [
      {
        id: 'aktion:etb',
        gruppe: 'schnellaktionen',
        label: 'ETB-Eintrag schreiben',
        ausfuehren: () => zaehlung?.zaehle('aktion:etb'),
      },
    ];
  },
}));
vi.mock('./useDatensaetze', () => ({ useDatensatzTreffer: () => [] }));

const nutzer = benutzerFixture({ anzeigename: 'EL', org_rolle: 'fuehrungskraft' });
let puts: { schluessel: string; wert: string }[];

beforeEach(() => {
  puts = [];
  gesehen.length = 0;
  server.use(
    meHandler(nutzer),
    http.put('/api/user-settings/:schluessel', async ({ params, request }) => {
      const body = (await request.json()) as { wert: string };
      puts.push({ schluessel: String(params.schluessel), wert: body.wert });
      return HttpResponse.json({ eintraege: { [String(params.schluessel)]: body.wert } });
    }),
  );
});

const oeffne = (u: ReturnType<typeof userEvent.setup>) => u.keyboard('{Control>}k{/Control}');

describe('Kommandopalette · Zählung der Schnellaktionen', () => {
  it('zählt eine ausgeführte Schnellaktion und kennt die Zahl beim nächsten Öffnen', async () => {
    server.use(http.get('/api/user-settings', () => HttpResponse.json({ eintraege: {} })));
    const u = userEvent.setup();
    const { client } = renderMitProviders(
      <CommandPaletteProvider>
        <div />
      </CommandPaletteProvider>,
    );
    await waitFor(() =>
      expect(client.getQueryData(globalKeys.benutzerEinstellungenVon(nutzer.id))).toBeDefined(),
    );

    await oeffne(u);
    await u.click(await screen.findByRole('option', { name: 'ETB-Eintrag schreiben' }));

    await waitFor(() => expect(screen.queryByRole('combobox')).toBeNull());
    await waitFor(() =>
      expect(puts).toEqual([
        { schluessel: SCHLUESSEL_SCHNELLAKTIONEN_ZAEHLER, wert: '{"aktion:etb":1}' },
      ]),
    );

    await oeffne(u);
    await screen.findByRole('option', { name: 'ETB-Eintrag schreiben' });
    expect(gesehen[gesehen.length - 1]?.zaehlung).toEqual({ 'aktion:etb': 1 });
  });

  /** Die Folge steht, solange die Palette offen ist: eine späte Antwort ändert sie nicht. */
  it('friert die Zählung beim Öffnen ein', async () => {
    let loese: () => void = () => {};
    const antwortFrei = new Promise<void>((r) => {
      loese = r;
    });
    server.use(
      http.get('/api/user-settings', async () => {
        await antwortFrei;
        return HttpResponse.json({
          eintraege: { [SCHLUESSEL_SCHNELLAKTIONEN_ZAEHLER]: '{"aktion:etb":5}' },
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
    await screen.findByRole('option', { name: 'ETB-Eintrag schreiben' });
    loese();
    await waitFor(() =>
      expect(client.getQueryData(globalKeys.benutzerEinstellungenVon(nutzer.id))).toBeDefined(),
    );
    await u.type(screen.getByRole('combobox'), 'e');

    expect(gesehen[gesehen.length - 1]?.zaehlung).toEqual({});
  });
});
