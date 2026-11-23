import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../test/server';
import { beendeHuelle, starteIosHuelle } from '../test/huelle';
import { EINGANG_ARTEN, setzeStumm, vergesseStummStand } from './eingaengeStumm';
import { IOS_PUSH_TOKEN_MERKER, iosPushKanal, iosPushMerker } from './iosPush';
import { pushKanal } from './pushKanal';

const KENNUNG = '3f1c2b7a-8d4e-4c55-9a10-0b6f2d7e1a42';
const TOKEN = 'ab'.repeat(32);
const SCHLUESSEL = 'c2NobHVlc3NlbHNjaGx1ZXNzZWxzY2hsdWVzc2VsMTI';
const BENUTZER = 7;

type Antwort = { permission: 'granted' | 'denied' | 'undetermined'; registration_id?: string };

/** Hülle mit Push; die Brücke antwortet mit dem Stand des Geräts. */
function huelle(
  opts: {
    permission?: Antwort['permission'];
    token?: string;
    schluessel?: string;
    ablehnen?: string;
  } = {},
) {
  const geraet = { permission: opts.permission ?? 'undetermined', token: opts.token ?? TOKEN };
  const nachrichten: string[] = [];
  const bruecke = {
    postMessage: (n: { cmd: string; id?: number }) => {
      nachrichten.push(n.cmd);
      const antwort = (window as unknown as { __LIFELINE_REPLY__: (...a: unknown[]) => void })
        .__LIFELINE_REPLY__;
      queueMicrotask(() => {
        if (n.cmd === 'push_register') {
          if (opts.ablehnen) return antwort(n.id, opts.ablehnen);
          geraet.permission = 'granted';
          return antwort(n.id, null, {
            registration_id: KENNUNG,
            token: geraet.token,
            environment: 'sandbox',
            key: opts.schluessel ?? SCHLUESSEL,
          });
        }
        if (n.cmd === 'push_unregister') return antwort(n.id, null);
        if (n.cmd === 'push_state') {
          const stand: Antwort = { permission: geraet.permission };
          if (geraet.permission === 'granted') stand.registration_id = KENNUNG;
          return antwort(n.id, null, stand);
        }
      });
    },
  };
  starteIosHuelle({ bruecke });
  return { geraet, nachrichten };
}

type Stand = {
  eingeschaltet: true;
  angemeldet: boolean;
  an_dieser_sitzung: boolean;
  inhalt: boolean;
  stumm: string[];
  ueber_hub?: { name: string; adresse: string };
  relais_gesperrt: boolean;
};

function server_(stand: Partial<Stand> = {}) {
  const anmeldungen: Record<string, unknown>[] = [];
  const abmeldungen: unknown[] = [];
  const abfragen: (string | null)[] = [];
  server.use(
    http.get('/api/ios-push', ({ request }) => {
      abfragen.push(new URL(request.url).searchParams.get('kennung'));
      return HttpResponse.json({
        eingeschaltet: true,
        angemeldet: false,
        an_dieser_sitzung: false,
        inhalt: false,
        stumm: [],
        relais_gesperrt: false,
        ...stand,
      });
    }),
    http.put('/api/ios-push/registration', async ({ request }) => {
      anmeldungen.push((await request.json()) as Record<string, unknown>);
      return new HttpResponse(null, { status: 204 });
    }),
    http.delete('/api/ios-push/registration', async ({ request }) => {
      abmeldungen.push(await request.json());
      return new HttpResponse(null, { status: 204 });
    }),
  );
  return { anmeldungen, abmeldungen, abfragen };
}

beforeEach(() => {
  localStorage.clear();
  vergesseStummStand();
});

afterEach(() => {
  beendeHuelle();
  localStorage.clear();
  vergesseStummStand();
  vi.restoreAllMocks();
});

describe('iOS-Push in der Seite', () => {
  it('pushKanal wählt iOS-Push nur mit Push in der Hülle', () => {
    expect(pushKanal()).not.toBe(iosPushKanal);
    huelle();
    expect(pushKanal()).toBe(iosPushKanal);
  });

  it('einschalten_meldet_token_und_schluessel_mit_inhalt_und_stumm', async () => {
    setzeStumm(EINGANG_ARTEN[0]!, true);
    huelle();
    const s = server_();
    await expect(iosPushKanal.einschalten(BENUTZER)).resolves.toBe('an');
    expect(s.anmeldungen).toEqual([
      {
        kennung: KENNUNG,
        token: TOKEN,
        umgebung: 'sandbox',
        schluessel: SCHLUESSEL,
        inhalt: false,
        stumm: [EINGANG_ARTEN[0]],
      },
    ]);
    expect(localStorage.getItem(iosPushMerker(BENUTZER))).toBe('1');
    await expect(iosPushKanal.inhaltSetzen(BENUTZER, true)).resolves.toBe(true);
    expect(s.anmeldungen[1]).toMatchObject({ kennung: KENNUNG, token: TOKEN, inhalt: true });
    expect(localStorage.getItem(iosPushMerker(BENUTZER))).toBe('inhalt');
  });

  it('verweigerte_berechtigung_ergibt_blockiert', async () => {
    const h = huelle({ ablehnen: 'denied' });
    const s = server_();
    await expect(iosPushKanal.einschalten(BENUTZER)).resolves.toBe('blockiert');
    expect(s.anmeldungen).toEqual([]);
    expect(h.nachrichten).toContain('push_register');
    // Auch der Stand zeigt es, wenn die Berechtigung in den Einstellungen verweigert ist.
    beendeHuelle();
    huelle({ permission: 'denied' });
    await expect(iosPushKanal.ladeStand()).resolves.toMatchObject({ zustand: 'blockiert' });
  });

  it('abgleichen_meldet_geaendertes_token_neu', async () => {
    const h = huelle();
    const s = server_();
    await iosPushKanal.einschalten(BENUTZER);
    s.anmeldungen.length = 0;
    // Der Server kennt die Anmeldung an dieser Sitzung; das Token ist unverändert: nichts zu tun.
    beendeHuelle();
    huelle({ permission: 'granted' });
    const still = server_({ angemeldet: true, an_dieser_sitzung: true });
    await iosPushKanal.abgleichen(BENUTZER, { nurBeiBedarf: true });
    expect(still.anmeldungen).toEqual([]);
    // Neues Token (Neuinstallation): meldet neu, mit derselben Kennung und demselben Schlüssel.
    beendeHuelle();
    huelle({ permission: 'granted', token: 'cd'.repeat(32) });
    const neu = server_({ angemeldet: true, an_dieser_sitzung: true });
    await iosPushKanal.abgleichen(BENUTZER, { nurBeiBedarf: true });
    expect(neu.anmeldungen).toHaveLength(1);
    expect(neu.anmeldungen[0]).toMatchObject({
      kennung: KENNUNG,
      token: 'cd'.repeat(32),
      schluessel: SCHLUESSEL,
    });
    expect(h.nachrichten).toContain('push_register');
    expect(localStorage.getItem(IOS_PUSH_TOKEN_MERKER)).not.toBeNull();
  });

  it('abgleichen_meldet_einen_neuen_schluessel_neu', async () => {
    huelle();
    const s = server_();
    await iosPushKanal.einschalten(BENUTZER);
    s.anmeldungen.length = 0;
    // Der Schlüssel fehlte im Schlüsselbund, die App hat unter derselben Kennung einen neuen
    // angelegt; der Server verschlüsselt sonst weiter mit dem alten, und die Extension zeigt nur
    // „Öffnen, um die Meldung zu sehen“.
    const neuerSchluessel = 'bmV1ZXJTY2hsdWVzc2VsbmV1ZXJTY2hsdWVzc2VsMTI';
    beendeHuelle();
    huelle({ permission: 'granted', schluessel: neuerSchluessel });
    const neu = server_({ angemeldet: true, an_dieser_sitzung: true });
    await iosPushKanal.abgleichen(BENUTZER, { nurBeiBedarf: true });
    expect(neu.anmeldungen).toHaveLength(1);
    expect(neu.anmeldungen[0]).toMatchObject({ kennung: KENNUNG, schluessel: neuerSchluessel });
  });

  it('abgleichen_bindet_eine_anmeldung_aus_einer_anderen_sitzung_neu', async () => {
    huelle();
    const s = server_();
    await iosPushKanal.einschalten(BENUTZER);
    s.anmeldungen.length = 0;
    // Sitzung A ist abgelaufen, die Person hat sich neu angemeldet (Sitzung B): der Server kennt
    // das Gerät mit derselben Wahl und demselben Token, aber nicht an dieser Sitzung. Ohne neues
    // `PUT` nähme ein Logout in B die Anmeldung nicht mit.
    beendeHuelle();
    huelle({ permission: 'granted' });
    const neu = server_({ angemeldet: true, an_dieser_sitzung: false });
    await iosPushKanal.abgleichen(BENUTZER, { nurBeiBedarf: true });
    expect(neu.anmeldungen).toHaveLength(1);
    expect(neu.anmeldungen[0]).toMatchObject({ kennung: KENNUNG, token: TOKEN });
  });

  it('abgleichen tut ohne Wahl, ohne Berechtigung und bei Fehlern nichts und wirft nie', async () => {
    huelle({ permission: 'granted' });
    const s = server_();
    await expect(iosPushKanal.abgleichen(BENUTZER)).resolves.toBeUndefined();
    expect(s.anmeldungen).toEqual([]);
    localStorage.setItem(iosPushMerker(BENUTZER), '1');
    server.use(http.get('/api/ios-push', () => new HttpResponse(null, { status: 500 })));
    await expect(iosPushKanal.abgleichen(BENUTZER)).resolves.toBeUndefined();
  });

  it('ueber_hub_zeigt_den_hub', async () => {
    huelle({ permission: 'granted' });
    server_({ ueber_hub: { name: 'Hub Kreisverband', adresse: 'https://hub.example.org' } });
    await expect(iosPushKanal.ladeStand()).resolves.toEqual({
      zustand: 'ueber_hub',
      inhalt: false,
      hub: { name: 'Hub Kreisverband', adresse: 'https://hub.example.org' },
      // In der App führt kein Link zum Hub: er muss als eigener Server in die App.
      hinweis: 'Push läuft über Hub Kreisverband: Hub in der App hinzufügen und dort einschalten.',
    });
  });

  it('gesperrtes_relais_zeigt_den_hinweis', async () => {
    huelle({ permission: 'granted' });
    server_({ relais_gesperrt: true, angemeldet: true });
    await expect(iosPushKanal.ladeStand()).resolves.toEqual({
      zustand: 'fehlt',
      inhalt: false,
      hinweis: 'Der Push-Dienst nimmt diesen Server nicht an. Bitte den Betreiber informieren.',
    });
  });

  it('ohne Schalter am Server gibt es keinen Push (404)', async () => {
    huelle();
    server.use(http.get('/api/ios-push', () => new HttpResponse(null, { status: 404 })));
    await expect(iosPushKanal.ladeStand()).resolves.toEqual({ zustand: 'fehlt', inhalt: false });
  });

  it('ladeStand zeigt eine Anmeldung samt Inhalt und fragt mit der Kennung des Geräts', async () => {
    huelle({ permission: 'granted' });
    const s = server_({ angemeldet: true, inhalt: true });
    await expect(iosPushKanal.ladeStand()).resolves.toEqual({ zustand: 'an', inhalt: true });
    expect(s.abfragen).toEqual([KENNUNG]);
  });

  it('ausschalten meldet ab, entfernt Merker und gibt die Registrierung zurück', async () => {
    const h = huelle();
    const s = server_();
    await iosPushKanal.einschalten(BENUTZER);
    await expect(iosPushKanal.ausschalten(BENUTZER)).resolves.toBe('aus');
    expect(s.abmeldungen).toEqual([{ kennung: KENNUNG }]);
    expect(h.nachrichten).toContain('push_unregister');
    expect(localStorage.getItem(iosPushMerker(BENUTZER))).toBeNull();
    expect(localStorage.getItem(IOS_PUSH_TOKEN_MERKER)).toBeNull();
  });
});
