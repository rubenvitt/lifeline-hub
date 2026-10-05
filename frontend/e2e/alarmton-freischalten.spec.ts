import { expect, test, type Page } from '@playwright/test';
import { anmeldenAlsAdmin, wechsleZuRolle } from './rollen-kern';

/**
 * LFH-950: Ohne Bediengeste bleibt der Alarmton gesperrt, und die Kopfleiste sagt es spätestens
 * nach der Frist (`ALARM_TON_FRIST_MS`, 2 s): „Ton blockiert" statt eines dauerhaften „wird
 * geprüft". Die erste Bediengeste irgendwo in der App schaltet frei.
 *
 * Die Sperre ist nachgebildet: das Chromium von Playwright meldet den AudioContext mit jedem
 * `--autoplay-policy` sofort `running` (gemessen 05.10.2026, Headless-Shell und volles Chromium
 * 141), und `navigator.userActivation` taugt nicht als Schalter, weil jedes `evaluate` von
 * Playwright selbst eine Aktivierung setzt. Die Nachbildung folgt der Web-Audio-Spezifikation:
 * `state` bleibt `suspended` und jedes `resume()` offen, bis eines WÄHREND einer
 * vertrauenswürdigen Eingabe kommt, die nach HTML als Aktivierung zählt (`keydown`,
 * `pointerdown` der Maus, `pointerup` von Finger oder Stift); dann lösen alle offenen gemeinsam
 * auf. So belegt die Spec auch, dass die App das `resume()` INNERHALB der Geste ruft.
 *
 * Jede Messung öffnet die Einsatzseite in einem FRISCHEN Tab: die Anmeldung über die Oberfläche
 * ist selbst eine Geste.
 */
test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    const AC = window.AudioContext;
    if (!AC) return;
    const basis = Object.getPrototypeOf(AC.prototype) as object;
    const stateEcht = Object.getOwnPropertyDescriptor(basis, 'state')!.get!;
    const resumeEcht = AC.prototype.resume;
    let frei = false;
    let inGeste = false;
    const wartende: Array<() => void> = [];
    // Vor den Zuhörern der App registriert (Init-Skript), also feuert dieser zuerst.
    const geste = (ev: Event) => {
      if (!ev.isTrusted) return;
      const zeiger = (ev as PointerEvent).pointerType;
      const zaehlt =
        (ev.type === 'keydown' && (ev as KeyboardEvent).key !== 'Escape') ||
        (ev.type === 'pointerdown' && zeiger === 'mouse') ||
        (ev.type === 'pointerup' && zeiger !== 'mouse');
      if (!zaehlt) return;
      inGeste = true;
      setTimeout(() => {
        inGeste = false;
      });
    };
    for (const typ of ['keydown', 'pointerdown', 'pointerup']) {
      window.addEventListener(typ, geste, true);
    }
    Object.defineProperty(AC.prototype, 'state', {
      configurable: true,
      get(this: AudioContext) {
        return frei ? stateEcht.call(this) : 'suspended';
      },
    });
    AC.prototype.resume = function (this: AudioContext) {
      if (inGeste) frei = true;
      if (!frei) return new Promise<void>((fertig) => wartende.push(fertig));
      return resumeEcht.call(this).then(() => {
        for (const fertig of wartende.splice(0)) fertig();
      });
    };
  });
});

/** Etwas mehr als die Frist, damit ein langsamer Lauf nicht an der Grenze kippt. */
const NACH_DER_FRIST = 6_000;

/** Die Einsatzseite in einem neuen Tab desselben Kontexts: angemeldet, aber ohne jede Geste. */
async function frischerTab(page: Page, einsatzId: string, breite: number): Promise<Page> {
  const tab = await page.context().newPage();
  await tab.setViewportSize({ width: breite, height: 900 });
  await tab.goto(`/einsaetze/${einsatzId}/einsatzdaten`);
  return tab;
}

async function einsatzAnlegen(page: Page): Promise<string> {
  const antwort = await page.request.post('/api/einsaetze', {
    data: { bezeichnung: `E2E Alarmton ${Date.now()}` },
  });
  expect(antwort.ok(), `Einsatz: ${antwort.status()} ${await antwort.text()}`).toBe(true);
  return String(((await antwort.json()) as { id: number }).id);
}

test('Fükw 1440: ohne Geste „Ton blockiert", ein Klick irgendwo schaltet frei', async ({
  page,
}) => {
  await anmeldenAlsAdmin(page);
  const einsatzId = await einsatzAnlegen(page);
  const tab = await frischerTab(page, einsatzId, 1440);

  const alarm = tab.locator('header [data-lfh="kopf-alarm"]');
  const ton = alarm.getByRole('button', { name: 'Alarmton blockiert – tippen zum Freischalten' });
  await expect(ton).toHaveText('Ton blockiert', { timeout: NACH_DER_FRIST });

  // Irgendwo, nicht auf die Glocke: die erste Geste genügt.
  await tab
    .locator('main')
    .first()
    .click({ position: { x: 5, y: 5 } });
  const bereit = alarm.getByRole('button', { name: 'Alarmton stummschalten' });
  await expect(bereit).toHaveText('Ton bereit');
  await expect(bereit).toHaveAttribute('aria-pressed', 'false');
});

test('Fükw 1440: ein Klick auf die gesperrte Glocke schaltet frei und nicht stumm', async ({
  page,
}) => {
  await anmeldenAlsAdmin(page);
  const einsatzId = await einsatzAnlegen(page);
  const tab = await frischerTab(page, einsatzId, 1440);

  const alarm = tab.locator('header [data-lfh="kopf-alarm"]');
  await alarm
    .getByRole('button', { name: 'Alarmton blockiert – tippen zum Freischalten' })
    .click({ timeout: NACH_DER_FRIST });
  const bereit = alarm.getByRole('button', { name: 'Alarmton stummschalten' });
  await expect(bereit).toHaveText('Ton bereit');
  await expect(bereit).toHaveAttribute('aria-pressed', 'false');
  expect(await tab.evaluate(() => localStorage.getItem('lfh:alarm:mute'))).not.toBe('1');
});

test.describe('Führungs-Tablet mit Finger', () => {
  test.use({ hasTouch: true });

  // Benachrichtigungen ausdrücklich verweigert statt der Vorgabe der Umgebung: nach dem
  // Freischalten nennt die Marke dann „Benachrichtigung blockiert", das längste Störungswort.
  test.beforeEach(async ({ context }) => {
    await context.addInitScript(() => {
      class VerweigerteBenachrichtigung {
        static permission = 'denied';
        static requestPermission = async () => 'denied';
      }
      Object.defineProperty(window, 'Notification', {
        value: VerweigerteBenachrichtigung,
        configurable: true,
      });
    });
  });

  /**
   * Alle Ziele der Einsatz-Kopfzeile liegen in EINER Zeile: die oberste Oberkante liegt über der
   * untersten Unterkante. Bricht die Zeile um, kippt das.
   */
  async function kopfIstEinzeilig(page: Page, kontext: string) {
    const ziele = await page
      .locator('header')
      .first()
      .evaluate((kopf) =>
        [...kopf.querySelectorAll('button, a, input')]
          .map((el) => el.getBoundingClientRect())
          .filter((r) => r.width > 0 && r.height > 0)
          .map((r) => ({ oben: r.top, unten: r.bottom })),
      );
    expect(ziele.length, `${kontext}: Ziele im Kopf`).toBeGreaterThan(2);
    const oberste = Math.max(...ziele.map((z) => z.oben));
    const unterste = Math.min(...ziele.map((z) => z.unten));
    expect(oberste, `${kontext}: alle Kopfziele in EINER Zeile`).toBeLessThan(unterste);
  }

  async function messe(angemeldet: Page, einsatzId: string, rolle: string, breite: number) {
    const page = await frischerTab(angemeldet, einsatzId, breite);
    const kontext = `${rolle} ${breite} px`;
    // Vorbedingung: der Finger ist erkannt, sonst misst der Test die Maus-Bauform.
    expect(
      await page.evaluate(() => window.matchMedia('(pointer: coarse)').matches),
      `${kontext}: grober Zeiger`,
    ).toBe(true);

    const alarm = page.locator('header [data-lfh="kopf-alarm"]');
    // EIN Ziel, das die Störung benennt — die Einzelknöpfe der Maus-Bauform stehen nicht.
    const ziel = alarm.getByRole('button', { name: 'Alarmzentrale: Ton blockiert' });
    await expect(ziel).toHaveText('Ton blockiert', { timeout: NACH_DER_FRIST });
    await expect(alarm.getByRole('button', { name: /^Alarmton / })).toHaveCount(0);
    await kopfIstEinzeilig(page, `${kontext}, Ton blockiert`);

    // Der Tipp öffnet das Menü; Handlung und Zustand stehen dort als Satz, ohne Tooltip.
    await ziel.tap();
    const menue = page.locator('.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]');
    await expect(menue.getByRole('menuitem').nth(1)).toHaveText(
      /^Alarmton (blockiert – tippen zum Freischalten|ist bereit – stummschalten)$/,
    );
    // Der Tipp war eine Geste: der Ton ist frei. Die Marke nennt jetzt die verbleibende Störung,
    // der Menüeintrag die Handlung zum freien Ton.
    await expect(menue.getByRole('menuitem').nth(1)).toHaveText(
      'Alarmton ist bereit – stummschalten',
    );
    const danach = alarm.getByRole('button', {
      name: 'Alarmzentrale: Benachrichtigung blockiert',
    });
    await expect(danach).toHaveText('Benachrichtigung blockiert');
    expect(await page.evaluate(() => localStorage.getItem('lfh:alarm:mute'))).not.toBe('1');
    await page.keyboard.press('Escape');
    await kopfIstEinzeilig(page, `${kontext}, Benachrichtigung blockiert`);
    await page.close();
  }

  for (const breite of [820, 1180]) {
    test(`${breite} px: ein Ziel mit Menü, die Kopfzeile bricht nicht um (auch als Beobachter)`, async ({
      page,
    }) => {
      test.setTimeout(90_000);
      await anmeldenAlsAdmin(page);
      const einsatzId = await einsatzAnlegen(page);
      await messe(page, einsatzId, 'Admin', breite);
      await wechsleZuRolle(page, 'beobachter', einsatzId);
      await messe(page, einsatzId, 'Beobachter', breite);
    });
  }
});
