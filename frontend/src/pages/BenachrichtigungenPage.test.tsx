import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { spieleAlarmTon } from '../alarm/alarmTon';
import { beendeHuelle, starteMacHuelle } from '../test/huelle';
import { meHandler, server } from '../test/server';
import { benutzerFixture } from '../test/fixtures';
import { renderMitProviders } from '../test/utils';
import BenachrichtigungenPage, {
  IMMER_AN,
  PUSH_INHALT_SCHALTER,
  PUSH_SCHALTER,
  TEST_TEXT,
  TEST_TITEL,
  TEST_WORT,
} from './BenachrichtigungenPage';

vi.mock('../alarm/alarmTon', async (original) => ({
  ...(await original<typeof import('../alarm/alarmTon')>()),
  spieleAlarmTon: vi.fn(),
}));

type Stand = { zustand: string; inhalt: boolean };
const push = vi.hoisted(() => ({
  ladePushStand: vi.fn(async (): Promise<Stand> => ({ zustand: 'fehlt', inhalt: false })),
  pushEinschalten: vi.fn(async () => 'an'),
  pushAusschalten: vi.fn(async () => 'aus'),
  pushInhaltSetzen: vi.fn(async (_id: number, an: boolean) => an),
}));
vi.mock('../alarm/webPush', async (original) => ({
  ...(await original<typeof import('../alarm/webPush')>()),
  ...push,
}));

afterEach(() => {
  push.ladePushStand.mockReset().mockResolvedValue({ zustand: 'fehlt', inhalt: false });
  push.pushEinschalten.mockReset().mockResolvedValue('an');
  push.pushAusschalten.mockReset().mockResolvedValue('aus');
  push.pushInhaltSetzen.mockReset().mockImplementation(async (_id: number, an: boolean) => an);
});

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
      // Katalog LLH-1142 E1 (LLH-1425): dazu Vermisstenmeldung und Unwetter (Warnstufe rot).
      'Vermisstenmeldung',
      'Unwetterwarnung',
    ]) {
      expect(within(alarme).getByText(name)).toBeInTheDocument();
    }
    expect(within(alarme).getAllByText(IMMER_AN)).toHaveLength(6);
    expect(within(alarme).queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Sofortmeldung' })).not.toBeInTheDocument();
  });

  it('je Hinweis-Art ein Schalter mit kurzem Namen, ohne gespeicherte Liste alle an', async () => {
    zeige();
    const hinweise = await screen.findByRole('region', { name: 'Hinweise' });
    const alle = await within(hinweise).findAllByRole('switch');
    expect(alle).toHaveLength(20);
    for (const s of alle) expect(s).toBeChecked();
    expect(within(hinweise).getByRole('switch', { name: 'Neuer Auftrag' })).toBeInTheDocument();
    // Die Hinweise der Ablösung (LLH-1131) sind je für sich abschaltbar.
    expect(
      within(hinweise).getByRole('switch', { name: 'Keine ablösende Einheit geplant' }),
    ).toBeInTheDocument();
    expect(within(hinweise).getByRole('switch', { name: 'Ablösende Einheit' })).toBeInTheDocument();
    expect(within(hinweise).getByRole('switch', { name: 'Neuer Einsatz' })).toBeInTheDocument();
    // Rückmeldung überfällig ist ein Eingang (LLH-1425); Unwetter ist seither ein Alarm.
    expect(
      within(hinweise).getByRole('switch', { name: 'Rückmeldung überfällig' }),
    ).toBeInTheDocument();
    expect(
      within(hinweise).queryByRole('switch', { name: 'Unwetterwarnung' }),
    ).not.toBeInTheDocument();
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

describe('Web Push: „Auch bei geschlossener App“ (LLH-1223, D8)', () => {
  it('fehlt, wenn Browser, Hülle oder Server kein Push bieten', async () => {
    zeige();
    await screen.findByRole('region', { name: 'Hinweise' });
    await waitFor(() => expect(push.ladePushStand).toHaveBeenCalled());
    expect(screen.queryByRole('switch', { name: PUSH_SCHALTER })).not.toBeInTheDocument();
  });

  it('schaltet ein und aus', async () => {
    push.ladePushStand.mockResolvedValue({ zustand: 'aus', inhalt: false });
    zeige();
    const s = await schalter(PUSH_SCHALTER);
    expect(s).not.toBeChecked();
    await userEvent.click(s);
    await waitFor(async () => expect(await schalter(PUSH_SCHALTER)).toBeChecked());
    expect(push.pushEinschalten).toHaveBeenCalledWith(benutzerFixture().id);

    await userEvent.click(await schalter(PUSH_SCHALTER));
    await waitFor(async () => expect(await schalter(PUSH_SCHALTER)).not.toBeChecked());
    expect(push.pushAusschalten).toHaveBeenCalledWith(benutzerFixture().id);
  });

  it('blockierte Erlaubnis: Schalter aus und gesperrt, mit Marke', async () => {
    push.ladePushStand.mockResolvedValue({ zustand: 'aus', inhalt: false });
    push.pushEinschalten.mockResolvedValue('blockiert');
    zeige();
    await userEvent.click(await schalter(PUSH_SCHALTER));
    expect(await screen.findByText('Vom Browser blockiert')).toBeInTheDocument();
    expect(await schalter(PUSH_SCHALTER)).not.toBeChecked();
    expect(await schalter(PUSH_SCHALTER)).toBeDisabled();
  });

  it('„Mit Absender und Wortlaut“ erscheint nur bei eingeschaltetem Push, Vorgabe aus (LLH-1369)', async () => {
    push.ladePushStand.mockResolvedValue({ zustand: 'aus', inhalt: false });
    zeige();
    await schalter(PUSH_SCHALTER);
    expect(screen.queryByRole('switch', { name: PUSH_INHALT_SCHALTER })).not.toBeInTheDocument();

    await userEvent.click(await schalter(PUSH_SCHALTER));
    const inhalt = await schalter(PUSH_INHALT_SCHALTER);
    expect(inhalt).not.toBeChecked();
    await userEvent.click(inhalt);
    await waitFor(async () => expect(await schalter(PUSH_INHALT_SCHALTER)).toBeChecked());
    expect(push.pushInhaltSetzen).toHaveBeenCalledWith(benutzerFixture().id, true);

    await userEvent.click(await schalter(PUSH_SCHALTER));
    await waitFor(() =>
      expect(screen.queryByRole('switch', { name: PUSH_INHALT_SCHALTER })).not.toBeInTheDocument(),
    );
  });

  it('zeigt die gespeicherte Wahl und schaltet sie aus (LLH-1369)', async () => {
    push.ladePushStand.mockResolvedValue({ zustand: 'an', inhalt: true });
    zeige();
    const inhalt = await schalter(PUSH_INHALT_SCHALTER);
    expect(inhalt).toBeChecked();
    await userEvent.click(inhalt);
    await waitFor(async () => expect(await schalter(PUSH_INHALT_SCHALTER)).not.toBeChecked());
    expect(push.pushInhaltSetzen).toHaveBeenCalledWith(benutzerFixture().id, false);
  });

  it('scheitert die Wahl des Inhalts, bleibt sie und die Zeile sagt es (LLH-1369)', async () => {
    push.ladePushStand.mockResolvedValue({ zustand: 'an', inhalt: false });
    push.pushInhaltSetzen.mockRejectedValue(new Error('500'));
    zeige();
    await userEvent.click(await schalter(PUSH_INHALT_SCHALTER));
    expect(await screen.findByText('nicht gespeichert')).toBeInTheDocument();
    expect(await schalter(PUSH_INHALT_SCHALTER)).not.toBeChecked();
    expect(await schalter(PUSH_SCHALTER)).toBeChecked();
  });

  it('scheitert das Einschalten, bleibt der Schalter aus und die Zeile sagt es', async () => {
    push.ladePushStand.mockResolvedValue({ zustand: 'aus', inhalt: false });
    push.pushEinschalten.mockRejectedValue(new Error('kein Worker'));
    zeige();
    await userEvent.click(await schalter(PUSH_SCHALTER));
    expect(await screen.findByText('nicht gespeichert')).toBeInTheDocument();
    expect(await schalter(PUSH_SCHALTER)).not.toBeChecked();
  });
});

/**
 * Web-API wie im Browser: `requestPermission` beantwortet die Frage mit `antwort` und setzt
 * danach `permission`, wie der Browser es tut.
 */
function stubNotification(
  permission: NotificationPermission,
  antwort: NotificationPermission = 'granted',
) {
  const Ctor = vi.fn(function (this: { close: () => void }) {
    this.close = vi.fn();
  }) as unknown as typeof Notification & {
    permission: NotificationPermission;
    requestPermission: ReturnType<typeof vi.fn>;
  };
  Ctor.permission = permission;
  Ctor.requestPermission = vi.fn(() => {
    Ctor.permission = antwort;
    return Promise.resolve(antwort);
  });
  vi.stubGlobal('Notification', Ctor);
  return Ctor;
}

async function testKnopf() {
  const paneel = await screen.findByRole('region', { name: 'Test' });
  return within(paneel).getByRole('button', { name: TEST_TITEL });
}

describe('Testbenachrichtigung (LLH-1284)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(spieleAlarmTon).mockClear();
    beendeHuelle();
  });

  it('in der Desktop-App geht die Meldung über die Hülle, mit Ton und „gesendet“', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    starteMacHuelle({ invoke });
    zeige();
    await userEvent.click(await testKnopf());
    expect(invoke).toHaveBeenCalledExactlyOnceWith('benachrichtigung_zeigen', {
      titel: TEST_TITEL,
      text: TEST_TEXT,
    });
    expect(spieleAlarmTon).toHaveBeenCalledExactlyOnceWith('dezent');
    expect(await screen.findByRole('status')).toHaveTextContent(TEST_WORT.gesendet);
  });

  it('im Browser ohne Entscheidung fragt der Klick erst an und zeigt dann die Meldung', async () => {
    const Ctor = stubNotification('default', 'granted');
    zeige();
    await userEvent.click(await testKnopf());
    expect(Ctor.requestPermission).toHaveBeenCalledOnce();
    await waitFor(() =>
      expect(Ctor).toHaveBeenCalledExactlyOnceWith(TEST_TITEL, { body: TEST_TEXT }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent(TEST_WORT.gesendet);
  });

  it('wird die Anfrage verweigert, steht „blockiert“ am Knopf und es kommt keine Meldung', async () => {
    const Ctor = stubNotification('default', 'denied');
    zeige();
    await userEvent.click(await testKnopf());
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(TEST_WORT.blockiert));
    expect(Ctor).not.toHaveBeenCalled();
    expect(spieleAlarmTon).not.toHaveBeenCalled();
  });

  it('bei schon verweigerter Erlaubnis „blockiert“, ohne erneut zu fragen', async () => {
    const Ctor = stubNotification('denied');
    zeige();
    await userEvent.click(await testKnopf());
    expect(screen.getByRole('status')).toHaveTextContent(TEST_WORT.blockiert);
    expect(Ctor.requestPermission).not.toHaveBeenCalled();
    expect(Ctor).not.toHaveBeenCalled();
  });

  it('ohne Notification-API „nicht verfügbar“', async () => {
    vi.stubGlobal('Notification', undefined);
    Reflect.deleteProperty(window, 'Notification');
    zeige();
    await userEvent.click(await testKnopf());
    expect(screen.getByRole('status')).toHaveTextContent(TEST_WORT['nicht-verfuegbar']);
    expect(spieleAlarmTon).not.toHaveBeenCalled();
  });
});
