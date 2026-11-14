import { expect, test, type Page } from '@playwright/test';
import { anmeldenAlsAdmin, wechsleZuRolle } from './rollen-kern';
import { einsatzAnlegen } from './einsatz-kern';

/**
 * LLH-1158: Zwei Wörter im Kopf wechseln beim Start ohne Zutun, die Tonprüfung („Ton wird
 * geprüft“ → „Ton bereit“ bzw. nach der Frist „Ton blockiert“) und der Verbindungsaufbau
 * („VERBINDE“ → „SYNC“). In `handschuh` hängt der Umbruch des Kopfs an der Breite der rechten
 * Gruppe (seit LFH-1126 hat die Namensgruppe einen Boden). Bei 1360–1400 px sprang der Kopf
 * deshalb in den ersten Sekunden von zwei Zeilen auf eine, und alles darunter 72 px. Gemessen
 * wird jede Kopfhöhe ab dem ersten Bild mit Alarmzentrale, bis beide Wechsel durch sind.
 *
 * Der Ton ist nachgebildet wie in `kopfzeile-schmal.spec.ts`, aber mit Prüfung: `state` meldet
 * `suspended`, bis `resume()` auflöst. „bereit“ löst nach {@link BEREIT_NACH_MS} auf (innerhalb
 * der Frist), „blockiert“ nie. Ohne diese Verzögerung stünde „Ton bereit“ schon im ersten Bild,
 * und es gäbe keinen Wechsel zu messen. Benachrichtigung „aus“ wie im Befund. Der
 * Verbindungsaufbau ist echt; dass er im Bild stand und endete, ist Vorbedingung.
 *
 * LLH-1506: Der Aufbau hing am Zufall. Öffnete der Strom vor dem ersten Bild mit Alarmzentrale,
 * stand „VERBINDE“ nie in der Messung; öffnete er unter Last erst nach 5 s, endete die Messung
 * vor „SYNC“. Deshalb {@link stromNachVerbindeFreigeben}: der Strom geht erst hinaus, wenn
 * „VERBINDE“ neben dem Tonknopf im Bild stand, und gemessen wird, bis Ton und Verbindung ihren
 * Endzustand erreicht haben (mindestens {@link MESSDAUER_MS}), nicht ein festes Fenster lang.
 *
 * Mit Maus. Unter `xl` stand der Ruhezustand nur als Icon (LFH-637), eine Störung mit Wort, und
 * beide Startwechsel änderten die Breite in Gegenrichtung: bei 1120–1180 px sprang der Kopf
 * (gemessen 13.10.2026). Seit LLH-1232 trägt `handschuh` die Wörter mit Startplatz auch unter
 * `xl`; die Messung reicht deshalb ab 1100 px.
 */

const BREITEN = [
  1100, 1120, 1140, 1160, 1180, 1200, 1280, 1300, 1320, 1340, 1360, 1380, 1400, 1420, 1440,
];

/** Vor der Frist (`ALARM_TON_FRIST_MS`, 2 s), damit „bereit“ nicht über „blockiert“ läuft. */
const BEREIT_NACH_MS = 1000;

/** Mindestens so lange nach dem Laden wird gemessen. */
const MESSDAUER_MS = 5000;

/** Nach dem letzten Startwechsel wird noch so lange gemessen, ob der Kopf nachspringt. */
const NACHLAUF_MS = 500;

/** So lange darf der Start unter Last bis zu Endton und „SYNC“ brauchen. */
const ENDSTAND_FRIST_MS = 30_000;

/** Längstens so lange hält {@link stromNachVerbindeFreigeben} den Strom zurück. */
const STROM_HALTEN_MS = 10_000;

type Messpunkt = { t: number; hoehe: number; ton: string | null; sync: string | null };

async function tonPruefungNachbilden(page: Page, ton: 'bereit' | 'blockiert') {
  await page.addInitScript(
    ({ tonBereit, bereitNach }) => {
      localStorage.setItem('lifeline-hub.dichte', 'handschuh');
      class OffeneBenachrichtigung {
        static permission = 'default';
        static requestPermission = async () => 'default';
      }
      Object.defineProperty(window, 'Notification', {
        value: OffeneBenachrichtigung,
        configurable: true,
      });
      const AC = window.AudioContext;
      if (AC) {
        let frei = false;
        Object.defineProperty(AC.prototype, 'state', {
          configurable: true,
          get: () => (frei ? 'running' : 'suspended'),
        });
        // Der echte `resume()` bleibt unberührt liegen, er könnte headless nie auflösen.
        AC.prototype.resume = () =>
          tonBereit
            ? new Promise<void>((fertig) =>
                setTimeout(() => {
                  frei = true;
                  fertig();
                }, bereitNach),
              )
            : new Promise<void>(() => undefined);
      }
      // Jede Kopfhöhe ab dem ersten Bild, mit Ton- und Sync-Zustand daneben. Ein Bild je Frame,
      // nur Änderungen; `performance.now()` zählt ab dem Navigationsstart.
      const punkte: Array<{ t: number; hoehe: number; ton: string | null; sync: string | null }> =
        [];
      (window as unknown as { __lfhKopf: typeof punkte }).__lfhKopf = punkte;
      const bild = () => {
        const kopf = document.querySelector('header');
        if (kopf) {
          const tonKnopf = kopf.querySelector('[data-lfh="kopf-alarm"] button[aria-pressed]');
          const ton = tonKnopf?.getAttribute('aria-label') ?? null;
          const sync =
            kopf.querySelector('[data-lfh="kopf-sync"]')?.getAttribute('data-zustand') ?? null;
          const letzter = punkte[punkte.length - 1];
          if (
            !letzter ||
            letzter.hoehe !== kopf.clientHeight ||
            letzter.ton !== ton ||
            letzter.sync !== sync
          ) {
            punkte.push({ t: performance.now(), hoehe: kopf.clientHeight, ton, sync });
          }
        }
        // Ohne festes Ende: unter Last steht die Verbindung später (LLH-1506). Jedes `goto` lädt
        // ein neues Dokument mit eigener Aufnahme, `messe` schneidet bei `bis` ab.
        requestAnimationFrame(bild);
      };
      requestAnimationFrame(bild);
    },
    { tonBereit: ton === 'bereit', bereitNach: BEREIT_NACH_MS },
  );
}

/**
 * Hält jeden Aufbau des Einsatz-Stroms zurück, bis „VERBINDE“ neben dem Tonknopf im Bild stand
 * (LLH-1506), höchstens {@link STROM_HALTEN_MS}. Danach öffnet die echte `EventSource` zum
 * Server, der Aufbau bleibt echt. Ohne das Zurückhalten öffnete der Strom auf einem schnellen
 * Runner, bevor die Alarmzentrale im Kopf stand, und die Messung sah den Wechsel
 * „VERBINDE“ → „SYNC“ nie.
 *
 * Im Browser statt über `page.route`: Ein Routing schaltet in Playwright den HTTP-Cache ab
 * („Enabling routing disables http cache“). Dann lud jedes der 30 `goto` alle rund 1340 Module
 * des Vite-Servers neu, 9–32 s je Aufruf unter CI-Last, und der Test lief aus seiner Frist
 * (Lauf 43575061389, `e2e 4/4`). Die Hülle bietet, was `src/live/liveVerbindung.ts` nutzt:
 * `readyState`, `onopen`/`onerror`/`onmessage`, `add`/`removeEventListener`, `close`.
 */
async function stromNachVerbindeFreigeben(page: Page, einsatzId: string) {
  await page.addInitScript(
    ({ pfad, haltenMs }) => {
      const Echt = window.EventSource;
      type Hoerer = [string, EventListenerOrEventListenerObject, unknown];
      class ZurueckgehalteneQuelle {
        static readonly CONNECTING = 0;
        static readonly OPEN = 1;
        static readonly CLOSED = 2;
        readonly CONNECTING = 0;
        readonly OPEN = 1;
        readonly CLOSED = 2;
        onopen: ((e: Event) => unknown) | null = null;
        onerror: ((e: Event) => unknown) | null = null;
        onmessage: ((e: MessageEvent) => unknown) | null = null;
        private echt: EventSource | null = null;
        private zu = false;
        private hoerer: Hoerer[] = [];
        constructor(
          readonly url: string,
          private readonly init?: EventSourceInit,
        ) {
          const frist = performance.now() + haltenMs;
          const pruefen = () => {
            if (this.zu) return;
            const kopf = (window as unknown as { __lfhKopf?: Messpunkt[] }).__lfhKopf ?? [];
            const verbindeStand = kopf.some((p) => p.ton !== null && p.sync === 'verbinde');
            if (verbindeStand || performance.now() >= frist) this.oeffnen();
            else setTimeout(pruefen, 20);
          };
          pruefen();
        }
        get readyState() {
          if (this.echt) return this.echt.readyState;
          return this.zu ? 2 : 0;
        }
        get withCredentials() {
          return this.init?.withCredentials ?? false;
        }
        addEventListener(typ: string, h: EventListenerOrEventListenerObject, o?: unknown) {
          this.hoerer.push([typ, h, o]);
          this.echt?.addEventListener(typ, h, o as AddEventListenerOptions);
        }
        removeEventListener(typ: string, h: EventListenerOrEventListenerObject, o?: unknown) {
          this.hoerer = this.hoerer.filter(([t, x]) => t !== typ || x !== h);
          this.echt?.removeEventListener(typ, h, o as EventListenerOptions);
        }
        close() {
          this.zu = true;
          this.echt?.close();
        }
        private oeffnen() {
          const echt = new Echt(this.url, this.init);
          this.echt = echt;
          for (const [typ, h, o] of this.hoerer) {
            echt.addEventListener(typ, h, o as AddEventListenerOptions);
          }
          echt.onopen = (e) => this.onopen?.(e);
          echt.onerror = (e) => this.onerror?.(e);
          echt.onmessage = (e) => this.onmessage?.(e);
        }
      }
      // Nur der Einsatz-Strom wartet; jede andere Quelle (Org-Strom) bleibt die echte.
      window.EventSource = new Proxy(Echt, {
        construct(ziel, [url, init]: [string | URL, EventSourceInit?]) {
          if (new URL(String(url), location.href).pathname !== pfad) return new ziel(url, init);
          return new ZurueckgehalteneQuelle(String(url), init) as unknown as EventSource;
        },
      });
    },
    { pfad: `/api/einsaetze/${einsatzId}/live`, haltenMs: STROM_HALTEN_MS },
  );
}

async function messe(page: Page, einsatzId: string, breite: number, ton: 'bereit' | 'blockiert') {
  const fall = `${breite} px, Ton ${ton}`;
  await page.setViewportSize({ width: breite, height: 800 });
  await page.goto(`/einsaetze/${einsatzId}/etb`);
  await expect(page.locator('html')).toHaveAttribute('data-dichte', 'handschuh');
  const alarm = page.locator('header [data-lfh="kopf-alarm"]');
  // Vorbedingung: die breite Bauform mit zwei Knöpfen, der Ton nennt seinen Endzustand im Wort.
  const tonKnopf = alarm.getByRole('button', {
    name: ton === 'bereit' ? 'Ton bereit – stummschalten' : 'Ton blockiert – freischalten',
  });
  await expect(tonKnopf).toHaveText(`Ton ${ton}`, { timeout: 10_000 });
  await expect(alarm.getByRole('button', { name: /^Alarmzentrale:/ })).toHaveCount(0);
  // Auf den Endstand warten statt auf ein festes Fenster: Ton im Endwort und die Verbindung steht.
  const endTon = ton === 'bereit' ? 'Ton bereit – stummschalten' : 'Ton blockiert – freischalten';
  const letzter = () =>
    page.evaluate(() => {
      const punkte = (window as unknown as { __lfhKopf: Messpunkt[] }).__lfhKopf;
      return punkte[punkte.length - 1] ?? null;
    });
  await expect
    .poll(
      async () => {
        const p = await letzter();
        return p && { ton: p.ton, sync: p.sync };
      },
      {
        message: `${fall}: Ton und Verbindung erreichen ihren Endstand`,
        timeout: ENDSTAND_FRIST_MS,
        intervals: [100],
      },
    )
    .toEqual({ ton: endTon, sync: 'verbunden' });
  const endstand = (await letzter())!.t;
  const bis = Math.max(MESSDAUER_MS, endstand + NACHLAUF_MS);
  await page.waitForFunction((b) => performance.now() >= b, bis);
  const punkte = await page.evaluate(
    () => (window as unknown as { __lfhKopf: Messpunkt[] }).__lfhKopf,
  );
  const gemessen = punkte.filter((p) => p.t <= bis && p.ton !== null);
  // Vorbedingung: die Prüfung stand im Bild, sonst gäbe es keinen Wechsel zu messen.
  expect(
    gemessen.some((p) => p.ton === 'Ton wird geprüft – freischalten'),
    `${fall}: „Ton wird geprüft“ stand im Bild`,
  ).toBe(true);
  expect(
    gemessen.some((p) => p.sync === 'verbinde'),
    `${fall}: „VERBINDE“ stand im Bild`,
  ).toBe(true);
  expect(gemessen[gemessen.length - 1]?.sync, `${fall}: die Verbindung steht`).toBe('verbunden');
  const verlauf = gemessen.map((p) => `${Math.round(p.t)} ms ${p.hoehe} px (${p.ton}, ${p.sync})`);
  const hoehen = new Set(gemessen.map((p) => p.hoehe));
  expect.soft(hoehen.size, `${fall}: Kopfhöhe über das Laden\n${verlauf.join('\n')}`).toBe(1);
}

test.describe('LLH-1158/LLH-1232 Kopfhöhe über Tonprüfung und Verbindungsaufbau (handschuh, Maus)', () => {
  for (const ton of ['bereit', 'blockiert'] as const) {
    test(`1100–1440 px, Ton prüft → ${ton}, VERBINDE → SYNC: der Kopf springt nicht (auch als Beobachter)`, async ({
      page,
    }) => {
      test.setTimeout(600_000);
      await tonPruefungNachbilden(page, ton);
      await anmeldenAlsAdmin(page);
      const einsatzId = await einsatzAnlegen(
        page,
        `LFH-460 Hochwasser Abschnitt Nordwest ${Date.now()}`,
      );
      await stromNachVerbindeFreigeben(page, einsatzId);
      for (const breite of BREITEN) await messe(page, einsatzId, breite, ton);
      // Der Benutzerkopf trägt die Einsatzfunktion, seine Breite hängt an der Rolle (LFH-435).
      await wechsleZuRolle(page, 'beobachter', einsatzId);
      for (const breite of BREITEN) await messe(page, einsatzId, breite, ton);
    });
  }
});
