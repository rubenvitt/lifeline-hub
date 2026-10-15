import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { meHandler, server } from '../test/server';
import { benutzerFixture } from '../test/fixtures';
import { renderMitProviders } from '../test/utils';
import BenachrichtigungenPage, { IMMER_AN } from './BenachrichtigungenPage';

function zeige(aus: string[] | null = null) {
  const geschrieben: string[][] = [];
  let stand = aus === null ? {} : { benachrichtigungen_aus: JSON.stringify(aus) };
  server.use(
    meHandler(benutzerFixture()),
    http.get('/api/benutzer-einstellungen', () => HttpResponse.json({ eintraege: stand })),
    http.put('/api/benutzer-einstellungen/benachrichtigungen_aus', async ({ request }) => {
      const { wert } = (await request.json()) as { wert: string };
      geschrieben.push(JSON.parse(wert) as string[]);
      stand = { ...stand, benachrichtigungen_aus: wert };
      return HttpResponse.json({ eintraege: stand, geaendert_at: '2026-10-14 12:00:00' });
    }),
  );
  renderMitProviders(<BenachrichtigungenPage />);
  return { geschrieben };
}

function schalter(name: string) {
  return screen.findByRole('switch', { name });
}

describe('Benachrichtigungen einstellen (tasks.md 2.6)', () => {
  it('Alarm-Arten stehen „immer an“ und ohne Schalter', async () => {
    zeige();
    const alarme = await screen.findByRole('region', { name: 'Alarme' });
    for (const name of [
      'Sofortmeldung',
      'Sofortmeldung unbestätigt',
      'Auftrag überfällig',
      'Ablösung fällig',
    ]) {
      expect(within(alarme).getByText(name)).toBeInTheDocument();
    }
    expect(within(alarme).getAllByText(IMMER_AN)).toHaveLength(4);
    expect(within(alarme).queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Sofortmeldung' })).not.toBeInTheDocument();
  });

  it('je Hinweis-Art ein Schalter mit kurzem Namen, ohne gespeicherte Liste alle an', async () => {
    zeige();
    const hinweise = await screen.findByRole('region', { name: 'Hinweise' });
    const alle = await within(hinweise).findAllByRole('switch');
    expect(alle).toHaveLength(18);
    for (const s of alle) expect(s).toBeChecked();
    expect(within(hinweise).getByRole('switch', { name: 'Neuer Auftrag' })).toBeInTheDocument();
    expect(within(hinweise).getByRole('switch', { name: 'Neuer Einsatz' })).toBeInTheDocument();
    // Unwetter erkennt der Browser selbst und prüft diesen Schalter dort (LLH-1209).
    expect(within(hinweise).getByRole('switch', { name: 'Unwetterwarnung' })).toBeInTheDocument();
  });

  it('zeigt die gespeicherten abgeschalteten Arten aus', async () => {
    zeige(['befehl']);
    expect(await schalter('Neuer Befehl')).not.toBeChecked();
    expect(await schalter('Neuer Auftrag')).toBeChecked();
  });

  it('Abschalten und wieder Einschalten schreiben die Liste auf den Server', async () => {
    const { geschrieben } = zeige(['befehl']);
    await userEvent.click(await schalter('Neuer Lagebericht'));
    expect(await schalter('Neuer Lagebericht')).not.toBeChecked();
    await waitFor(() => expect(geschrieben).toEqual([['befehl', 'lagebericht']]));

    await waitFor(async () => expect(await schalter('Neuer Befehl')).toBeEnabled());
    await userEvent.click(await schalter('Neuer Befehl'));
    await waitFor(() => expect(geschrieben[geschrieben.length - 1]).toEqual(['lagebericht']));
    expect(await schalter('Neuer Befehl')).toBeChecked();
  });

  it('lehnt der Server ab, springt nur dieser Schalter zurück und die Zeile sagt es', async () => {
    zeige();
    server.use(
      http.put('/api/benutzer-einstellungen/benachrichtigungen_aus', () =>
        HttpResponse.json({ error: 'abgelehnt' }, { status: 422 }),
      ),
    );
    await userEvent.click(await schalter('Neue Gefahr'));
    expect(await screen.findByText('nicht gespeichert')).toBeInTheDocument();
    expect(await schalter('Neue Gefahr')).toBeChecked();
    expect(await schalter('Neuer Auftrag')).toBeChecked();
  });
});
