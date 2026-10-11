import { expect, test, type Page } from '@playwright/test';
import { anmeldenAlsAdmin, benutzerAnlegen, wechsleZu } from './rollen-kern';
import { einsatzAnlegen } from './einsatz-kern';

/**
 * Die Kopfzeile auf dem Handschirm. Ob das Inline-`paddingInline` antds Klassenregel schlägt
 * (auch logisch gegen physisch), ist nur im Browser messbar; die Quelltext-Verdrahtung
 * bewacht `src/theme/kopfpolsterung.guard.test.ts`.
 *
 * Kein Device-Descriptor (zöge webkit nach); der Viewport wird umgestellt.
 *
 * Gemessen wird punktgenau das `header`-Element, nicht `body.scrollWidth`: auf einer
 * Modulseite hat der Überlauf mehrere Quellen, und die Spec würde sonst zur Sammelstelle
 * fremder Befunde.
 */

const SCHMAL = { width: 390, height: 844 };
const BREIT = { width: 1366, height: 768 };

async function anmelden(page: Page) {
  await anmeldenAlsAdmin(page);
}

/**
 * Der Einsatz-Wechsler hält im Kopf seine Trefffläche (72 px in `handschuh`), und kein Bedienziel
 * des Kopfs liegt über einem anderen (LFH-1126). Gemessen wie in Gate 1.
 */
async function pruefeNameUeberdecktNichts(page: Page, fall: string) {
  const ziele = await page.locator('header').evaluate((el) =>
    Array.from(el.querySelectorAll('button, a[href]')).map((ziel) => {
      const r = ziel.getBoundingClientRect();
      return {
        name: ziel.getAttribute('aria-label') ?? ziel.textContent ?? '',
        x: r.x,
        y: r.y,
        rechts: r.right,
        unten: r.bottom,
        breite: r.width,
      };
    }),
  );
  const wechsler = ziele.find((z) => z.name.startsWith('LFH-460 Hochwasser'));
  expect(wechsler, `${fall}: der Einsatz-Wechsler steht im Kopf`).toBeDefined();
  expect(wechsler!.breite, `${fall}: Trefffläche des Namens`).toBeGreaterThanOrEqual(72);
  for (const ziel of ziele) {
    for (const nachbar of ziele) {
      if (nachbar === ziel) continue;
      const ueberlappt =
        Math.min(ziel.rechts, nachbar.rechts) > Math.max(ziel.x, nachbar.x) &&
        Math.min(ziel.unten, nachbar.unten) > Math.max(ziel.y, nachbar.y);
      expect.soft(ueberlappt, `${fall}: ${ziel.name} überdeckt ${nachbar.name}`).toBe(false);
    }
  }
}

/**
 * Ruhezustand der Alarmzentrale headless nachgebildet, in `handschuh`: Benachrichtigungen
 * erlaubt, Ton bereit. Warum der Ton nachgebildet wird, steht am Ruhezustands-Test (LFH-809).
 */
async function ruhezustandNachbilden(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('lifeline-hub.dichte', 'handschuh');
    class ErlaubteBenachrichtigung {
      static permission = 'granted';
      static requestPermission = async () => 'granted';
    }
    Object.defineProperty(window, 'Notification', {
      value: ErlaubteBenachrichtigung,
      configurable: true,
    });
    // Ton bereit: `state` meldet `running`, `resume()` löst sofort auf. Der echte `resume()`
    // bleibt unberührt liegen, er könnte in einer gesperrten Umgebung nie auflösen.
    const AC = window.AudioContext;
    if (AC) {
      Object.defineProperty(AC.prototype, 'state', {
        configurable: true,
        get: () => 'running',
      });
      AC.prototype.resume = () => Promise.resolve();
    }
  });
}

test('Kopf-Polsterung: 24 px an der Suchzelle am Fükw-Schirm, randlose Leiste auf 390 px', async ({
  page,
}) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Kopf ${Date.now()}`);

  // BEIDE Layouts: `/einsaetze` hängt an der Ebene-1-Shell, die Modulseite am
  // Einsatz-Workspace — Geschwister, die einzeln umgestellt werden könnten. Die Leiste ist
  // randlos; die viewportabhängige Polsterung sitzt an der Suchzelle (ab `lg`).
  for (const route of ['/einsaetze', `/einsaetze/${einsatzId}/etb`]) {
    await page.setViewportSize(BREIT);
    await page.goto(route);
    const kopf = page.locator('header');
    // Genau eine Kopfzeile — sonst wäre eine grüne Zusicherung grün durch Nichtstun.
    await expect(kopf, route).toHaveCount(1);
    await expect(kopf, route).toHaveCSS('padding-left', '0px');
    const suche = kopf.locator('[data-lfh="kopf-suche"]');
    await expect(suche, route).toHaveCount(1);
    await expect(suche, route).toHaveCSS('padding-left', '24px');
    await expect(suche, route).toHaveCSS('padding-right', '24px');

    await page.setViewportSize(SCHMAL);
    await expect(kopf, route).toHaveCSS('padding-left', '0px');
    await expect(kopf, route).toHaveCSS('padding-right', '0px');
    // Unter `lg` gibt es kein Suchfeld — die Suche steht als Icon in der rechten Gruppe.
    await expect(suche, route).toHaveCount(0);
  }
});

/** Kompakte Vorgabe und Touch-Vorbelegung, beide Layoutfamilien: der Kopf darf kontrolliert
 *  umbrechen, seine Ziele aber nicht abschneiden (die drei gespeicherten Stufen prüft
 *  `gate1-ueberlauf`). */
async function kopfLaeuftNichtUeber(page: Page, route: string, stufe: 'kompakt' | 'komfortabel') {
  await page.goto(route);
  const kopf = page.locator('header');
  await expect(kopf, route).toBeVisible();
  await expect(page.locator('html'), `${route}: Vorbedingung Dichtestufe`).toHaveAttribute(
    'data-dichte',
    stufe,
  );
  const masse = await kopf.evaluate((el) => ({
    scrollB: el.scrollWidth,
    klientB: el.clientWidth,
    scrollH: el.scrollHeight,
    klientH: el.clientHeight,
  }));
  expect(masse.scrollB, `${route}: Kopfzeile läuft WAAGERECHT über`).toBeLessThanOrEqual(
    masse.klientB,
  );
  // BEIDE ACHSEN, die senkrechte ist die schärfere: ein Umbruch kauft Breite mit Höhe, und
  // ein Kopf, dessen Inhalt höher ist als er selbst, schneidet ihn an.
  expect(masse.scrollH, `${route}: Kopfzeile läuft SENKRECHT über`).toBeLessThanOrEqual(
    masse.klientH,
  );
  // Zwei Zeilen sind erlaubt, der Deckel verhindert ungebremstes Wachstum. Eine Zeile ist die
  // 52-px-Kommandoleiste, in `kompakt` wie in `komfortabel`.
  const einzeilig = 52;
  expect(masse.klientH, `${route}: Kopfhöhe der Stufe ${stufe}`).toBeGreaterThanOrEqual(einzeilig);
  expect(masse.klientH, `${route}: höchstens zwei Kopfzeilen`).toBeLessThanOrEqual(2 * einzeilig);
}

for (const [stufe, hasTouch] of [
  ['kompakt', false],
  ['komfortabel', true],
] as const) {
  test.describe(`Kopfzeile auf 390 px in Stufe ${stufe}`, () => {
    test.use({ hasTouch });

    test('die Ebene-1-Kopfzeile läuft nicht über', async ({ page }) => {
      await anmelden(page);
      await page.setViewportSize(SCHMAL);
      await kopfLaeuftNichtUeber(page, '/einsaetze', stufe);
    });

    test('die Einsatz-Kopfzeile läuft nicht über', async ({ page }) => {
      await anmelden(page);
      const einsatzId = await einsatzAnlegen(
        page,
        // Absichtlich lang: genau daran zeigt sich, ob der Name kürzt oder schiebt.
        `E2E Hochwasser Nord — Deichverteidigung Abschnitt West ${Date.now()}`,
      );
      await page.setViewportSize(SCHMAL);
      await kopfLaeuftNichtUeber(page, `/einsaetze/${einsatzId}/etb`, stufe);
    });
  });
}

/**
 * Derselbe Nachweis für den GESPERRTEN Verwaltungs-Zweig der Topbar: gedämpfter Text, ab `lg`
 * plus „Keine Berechtigung"-Tag. Ein Admin läuft nur durch den freien Zweig. Nur `/einsaetze`:
 * `GlobalLink` wohnt in der Ebene-1-Schale.
 *
 * BEIDE BREITEN (LFH-435): auf 390 px entfällt der Tag (so wurde LFH-337 behoben), auf dem
 * Führungs-Tablet (1024 px) steht er — dort ist der Zweig am breitesten.
 *
 * Die VORBEDINGUNGEN sind tragend: ohne sie bliebe der Test grün, wenn jemand den gesperrten
 * Zweig ganz entfernte.
 */
for (const { breite, mitTag } of [
  { breite: SCHMAL.width, mitTag: false },
  { breite: 1024, mitTag: true },
]) {
  test(`Kopfzeile: auf ${breite} px läuft sie auch für einen Benutzer OHNE Verwaltungsrecht nicht über`, async ({
    page,
  }) => {
    // Ohne `org_rolle` gilt 'keiner'/'keine' — `darfVerwaltung` ist false. Mitglied eines
    // Einsatzes muss der Benutzer dafür nicht sein.
    await anmelden(page);
    await wechsleZu(page, await benutzerAnlegen(page, 'beobachter'));

    await page.setViewportSize({ width: breite, height: 844 });
    await page.goto('/einsaetze');

    const kopf = page.locator('header');
    await expect(kopf).toHaveCount(1);
    // ── VORBEDINGUNGEN: der gesperrte Zweig muss überhaupt stehen.
    await expect(
      page.getByRole('link', { name: 'Verwaltung' }),
      'Vorbedingung: kein freier Verwaltungs-Link — sonst misst der Test den falschen Zweig',
    ).toHaveCount(0);
    // Präfix statt Wortlaut: ab `lg` trägt dasselbe Element den Tag mit.
    await expect(
      kopf.getByText(/^Verwaltung/),
      'Vorbedingung: der gedämpfte Eintrag bleibt auf JEDER Breite stehen (gesperrt statt versteckt)',
    ).toBeVisible();
    // Unter `lg` entfällt der Tag — das behebt den Überlauf; ab `lg` MUSS er stehen, sonst
    // misst der Tablet-Durchgang den schmalen Zweig.
    await expect(
      kopf.getByText('Keine Berechtigung'),
      mitTag ? 'Vorbedingung: ab lg steht der Tag' : 'unter lg trägt die Kopfzeile den Tag nicht',
    ).toHaveCount(mitTag ? 1 : 0);

    const masse = await kopf.evaluate((el) => ({
      scrollB: el.scrollWidth,
      klientB: el.clientWidth,
      scrollH: el.scrollHeight,
      klientH: el.clientHeight,
    }));
    expect(masse.scrollB, 'Kopfzeile läuft WAAGERECHT über (gesperrter Zweig)').toBeLessThanOrEqual(
      masse.klientB,
    );
    expect(masse.scrollH, 'Kopfzeile läuft SENKRECHT über (gesperrter Zweig)').toBeLessThanOrEqual(
      masse.klientH,
    );
  });
}

test('Such-Trigger bleibt auf 390 px in beiden Kopfzeilen eine 48-px-Trefffläche', async ({
  page,
}) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Suche ${Date.now()}`);

  await page.setViewportSize(SCHMAL);
  for (const route of ['/einsaetze', `/einsaetze/${einsatzId}/etb`]) {
    await page.goto(route);
    const trigger = page.getByRole('button', { name: 'Suchen' });
    await expect(trigger, route).toBeVisible();
    const kasten = (await trigger.boundingBox())!;
    expect(
      Math.min(kasten.width, kasten.height),
      `${route}: Such-Trefffläche`,
    ).toBeGreaterThanOrEqual(48);
  }
});

test('Bediendichte bleibt auf 390 px bedienbar — über das Benutzermenü', async ({ page }) => {
  // A1 weist Führungs-Tablet und mobilem Kontext `komfortabel` und `handschuh` zu; das Menü
  // ist der Bedienweg, der die Stufe zeigt UND setzt.
  await anmelden(page);
  await page.setViewportSize(SCHMAL);
  await page.goto('/einsaetze');

  // Über die ROLLE gezählt, nicht über Etiketten, die es nicht mehr gibt: schlägt an, sobald
  // irgendein Segmented in die Kopfzeile zurückkehrt.
  await expect(page.locator('header').getByRole('radio')).toHaveCount(0);

  const trigger = page.getByRole('button', { name: 'Benutzermenü' });
  const kasten = (await trigger.boundingBox())!;
  // A1 Gate 3: fokussierbare Elemente ≥ 24 px in der kurzen Achse.
  expect(Math.min(kasten.width, kasten.height), 'Trefffläche des Triggers').toBeGreaterThanOrEqual(
    24,
  );

  await trigger.click();
  await page.getByRole('menuitem', { name: /Handschuh/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-dichte', 'handschuh');

  await trigger.click();
  await page.getByRole('menuitem', { name: /Dunkel/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('auch ab lg stehen die Umschalter nicht im Kopf — bedienbar bleiben sie', async ({ page }) => {
  /**
   * Die Umschalter stehen auf JEDER Breite nicht im Kopf. Die Gegenprobe zur Null ist deshalb
   * die andere Hälfte: im Menü bedienbar, auf derselben Breite geprüft.
   */
  await anmelden(page);
  await page.setViewportSize(BREIT);
  await page.goto('/einsaetze');

  // Über die ROLLE gezählt (s. o.).
  await expect(page.locator('header').getByRole('radio')).toHaveCount(0);

  const trigger = page.getByRole('button', { name: 'Benutzermenü' });
  await trigger.click();
  await page.getByRole('menuitem', { name: /Komfortabel/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-dichte', 'komfortabel');

  await trigger.click();
  await page.getByRole('menuitem', { name: /Dunkel/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('die Alarmzentrale steht ab lg sichtbar abgesetzt von den Aktionen', async ({ page }) => {
  /**
   * Die Alarm-Knöpfe stehen in eigener Zelle, die DOM-Semantik belegt
   * `EinsatzLayout.test.tsx`. Hier: die Zelle trägt eine echte Haarlinie und die Suche liegt
   * nicht in ihr — ein `display: none` oder eine Nullbreite fiele auf.
   */
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Absetzung ${Date.now()}`);
  await page.setViewportSize(BREIT);
  await page.goto(`/einsaetze/${einsatzId}/etb`);

  const zelle = page.locator('header [data-lfh="kopf-alarm"]');
  await expect(zelle).toHaveCount(1);
  await expect(zelle).toHaveCSS('border-right-width', '1px');
  const kasten = (await zelle.boundingBox())!;
  expect(kasten.height, 'Zelle hat sichtbare Höhe').toBeGreaterThan(0);

  const ton = (await page.getByRole('button', { name: /^Ton / }).boundingBox())!;
  const suchen = (await page.getByRole('button', { name: 'Suchen' }).boundingBox())!;
  expect(ton.x, 'Alarmknopf liegt in der Alarmzelle').toBeGreaterThanOrEqual(kasten.x - 1);
  expect(ton.x + ton.width, 'Alarmknopf liegt in der Alarmzelle').toBeLessThanOrEqual(
    kasten.x + kasten.width + 1,
  );
  const suchenDrin = suchen.x < kasten.x + kasten.width && suchen.x + suchen.width > kasten.x;
  expect(suchenDrin, 'die Suche liegt NICHT in der Alarmzelle').toBe(false);
});

test('Führungs-Tablet 1024 px, handschuh: im Ruhezustand höchstens zwei Zeilen, und der Name überdeckt nichts', async ({
  page,
}) => {
  /**
   * Der RUHEZUSTAND, für den die Verdichtung gebaut ist (die Störungswörter misst
   * `gate1-ueberlauf.spec.ts`): Benachrichtigungen erlaubt und Ton bereit (beide headless
   * nachgebildet), Strom verbunden. Dann stehen die Zustände nur als Icon.
   *
   * Eine Zeile hält `handschuh` hier NICHT (LFH-1126, Entscheidung 10.10.2026): Marke,
   * Wortmarke, Nummer und 72 px Name (≈ 436 px), die Suche und die rechte Gruppe (488 px)
   * brauchen über 1024 px. Bis LFH-1126 stand der Kopf trotzdem einzeilig, weil die Namenszelle
   * auf 0 px schrumpfte und der Wechsler über „Suchen“ lag; diese Spec maß nur die Höhe. Jetzt
   * bricht die rechte Gruppe um, in jedem Alarmzustand gleich, und gemessen wird die Überdeckung.
   *
   * Warum der Ton nachgebildet wird (LFH-809): ob der AudioContext ohne Nutzergeste
   * `running` meldet, entscheidet die Audio-Umgebung der Maschine, nicht die App. Im
   * Linux-Container stand er auch im vollen Suite-Lauf unter Last ab der ersten Zeile auf
   * `running` (gemessen 03.10.2026, Load 15 auf 4 Kernen). Im vollen Suite-Lauf
   * unter Fremdlast (29.09.2026) blieb er in beiden Läufen gesperrt, allein gefahren nie.
   * Die App prüft den Ton nur EINMAL beim Betreten des Einsatzes und hält das Ergebnis
   * modulweit (`src/alarm/alarmTon.ts`, `stelleAudioBereit`). Erst ein Klick prüft neu,
   * deshalb stand „Ton blockiert" für das ganze Dokument, und der Kopf trug ein Wort, das
   * diese Spec gar nicht misst. Den echten Prüfpfad decken `AlarmZentrale.pruefung.test.tsx`
   * und `kopfzeile-start-cls.spec.ts` ab.
   */
  test.setTimeout(60_000);
  await ruhezustandNachbilden(page);
  await page.setViewportSize({ width: 1024, height: 800 });
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(
    page,
    `LFH-460 Hochwasser Abschnitt Nordwest ${Date.now()}`,
  );
  await page.goto(`/einsaetze/${einsatzId}/etb`);
  await expect(page.locator('html')).toHaveAttribute('data-dichte', 'handschuh');
  await expect(page.locator('header [data-lfh="kopf-sync"]')).toHaveAttribute(
    'data-zustand',
    'verbunden',
    { timeout: 30_000 },
  );
  const alarm = page.locator('header [data-lfh="kopf-alarm"]');
  // Vorbedingung VOR der Messung, mit vollem Namen statt Regex: der Name trägt den Zustand,
  // und ein Fehlschlag soll die gestörte Nachbildung nennen, nicht das Layout. Gesperrt hieße
  // der Ton-Knopf „Ton blockiert – freischalten".
  await expect(
    alarm.getByRole('button', {
      name: 'Benachrichtigung erlaubt',
      exact: true,
    }),
  ).toBeVisible();
  await expect(alarm.getByRole('button', { name: 'Ton bereit – stummschalten' })).toBeVisible();
  // Ruhezustand ohne Wort — aber benannt: beide Ziele stehen mit Zustand im Namen da.
  await expect(alarm).toHaveText('');
  const hoehe = await page.locator('header').evaluate((h) => h.clientHeight);
  expect(hoehe, 'höchstens zwei Zeilen in handschuh (2 × 72 px)').toBeLessThanOrEqual(144);
  await pruefeNameUeberdecktNichts(page, 'Ruhezustand');
});

/**
 * Führungs-Tablet 1024 px, handschuh, Benachrichtigung verweigert (LFH-1126): der Einsatzname
 * behält in JEDEM Wortlaut der Alarmmarke seine Trefffläche und liegt nicht über „Suchen“.
 *
 * Mit „Benachrichtigung blockiert“ bricht die rechte Gruppe um; wechselt die Marke auf „Ton
 * blockiert“, passt sie in die erste Zeile. Dann schrumpfte die Namensgruppe auf ihre Basis
 * (`KOPF_NAME_FLEX`, auf `kompakt` gerechnet), der feste Teil in `handschuh` ist aber breiter,
 * und der Wechsler (Boden 72 px) lief über die Suche. Beide Wortlaute werden hier gezielt
 * nachgebildet, statt auf den Zeitpunkt der Tonprüfung zu hoffen (`gate1-ueberlauf.spec.ts`
 * misst den echten Ablauf und war deshalb nur zeitweise rot).
 */
test.describe('LFH-1126 Name und Alarmmarke am Führungs-Tablet', () => {
  // Mit Finger bündelt die Alarmzentrale zu EINER Marke (`buendeln`), wie in Gate 1.
  test.use({ hasTouch: true });
  for (const ton of ['bereit', 'blockiert'] as const) {
    test(`Führungs-Tablet 1024 px, handschuh, Benachrichtigung verweigert, Ton ${ton}: der Name überdeckt nichts`, async ({
      page,
    }) => {
      test.setTimeout(60_000);
      await page.addInitScript((tonBereit) => {
        localStorage.setItem('lifeline-hub.dichte', 'handschuh');
        class VerweigerteBenachrichtigung {
          static permission = 'denied';
          static requestPermission = async () => 'denied';
        }
        Object.defineProperty(window, 'Notification', {
          value: VerweigerteBenachrichtigung,
          configurable: true,
        });
        // Ton nachgebildet wie im Ruhezustands-Test oben: bereit meldet `running`; gesperrt
        // bleibt `suspended`, und `resume()` löst nie auf, bis die Frist „blockiert“ setzt.
        const AC = window.AudioContext;
        if (AC) {
          Object.defineProperty(AC.prototype, 'state', {
            configurable: true,
            get: () => (tonBereit ? 'running' : 'suspended'),
          });
          AC.prototype.resume = () =>
            tonBereit ? Promise.resolve() : new Promise<void>(() => undefined);
        }
      }, ton === 'bereit');
      await page.setViewportSize({ width: 1024, height: 800 });
      await anmelden(page);
      const einsatzId = await einsatzAnlegen(
        page,
        `LFH-460 Hochwasser Abschnitt Nordwest ${Date.now()}`,
      );
      await page.goto(`/einsaetze/${einsatzId}/etb`);
      await expect(page.locator('html')).toHaveAttribute('data-dichte', 'handschuh');
      await expect(page.getByPlaceholder('Inhalt …')).toBeVisible();
      // Vorbedingung VOR der Messung: die Marke trägt genau den Wortlaut dieses Falls.
      const marke = ton === 'bereit' ? 'Benachrichtigung blockiert' : 'Ton blockiert';
      await expect(
        page
          .locator('header [data-lfh="kopf-alarm"]')
          .getByRole('button', { name: `Alarmzentrale: ${marke}`, exact: true }),
      ).toBeVisible({ timeout: 10_000 });

      await pruefeNameUeberdecktNichts(page, marke);
    });
  }
});

/**
 * Führungs-Tablet 1024 px, handschuh, Ruhezustand: der Kopf hat beim Laden schon seine endgültige
 * Höhe (LFH-1126). Die Einsatznummer trägt den Boden der Namensgruppe mit; ohne ihren
 * Platzhalter stand der Kopf beim Laden in einer Zeile und brach erst mit der Nummer um, und
 * alles darunter sprang 72 px.
 */
test.describe('LFH-1126 Kopfhöhe über das Laden', () => {
  // Ohne Finger wie der Ruhezustands-Test: zwei Alarmziele, nur als Icon (rechte Gruppe 488 px).
  test('Führungs-Tablet 1024 px, handschuh: der Kopf springt nicht, wenn der Einsatz lädt', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await ruhezustandNachbilden(page);
    await page.setViewportSize({ width: 1024, height: 800 });
    await anmelden(page);
    const einsatzId = await einsatzAnlegen(
      page,
      `LFH-460 Hochwasser Abschnitt Nordwest ${Date.now()}`,
    );
    // Nur der Kopf-GET des Einsatzes wird gehalten; alles andere läuft.
    let loslassen!: () => void;
    const tor = new Promise<void>((f) => (loslassen = f));
    let gehalten = 0;
    await page.route(`**/api/einsaetze/${einsatzId}`, async (route) => {
      if (route.request().method() === 'GET') {
        gehalten += 1;
        await tor;
      }
      await route.continue();
    });
    await page.goto(`/einsaetze/${einsatzId}/etb`);
    await expect(page.locator('html')).toHaveAttribute('data-dichte', 'handschuh');
    const kopf = page.locator('header');
    const name = kopf.locator('[data-lfh="kopf-einsatzname"]');
    // Vorbedingung: der Einsatz lädt noch, der Name steht nicht.
    await expect(name).toBeVisible();
    await expect(name.getByRole('button')).toHaveCount(0);
    await expect(
      kopf
        .locator('[data-lfh="kopf-alarm"]')
        .getByRole('button', { name: 'Ton bereit – stummschalten' }),
    ).toBeVisible();
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const vorher = await kopf.evaluate((h) => h.clientHeight);
    expect(gehalten, 'gehaltene Abfragen').toBeGreaterThan(0);
    loslassen();
    await expect(name.getByRole('button', { name: /LFH-460 Hochwasser/ })).toBeVisible();
    await expect(kopf.locator('[data-lfh="kopf-einsatznummer"]')).toBeVisible();
    const nachher = await kopf.evaluate((h) => h.clientHeight);
    expect(nachher, `Kopfhöhe ${vorher} → ${nachher}`).toBe(vorher);
    await pruefeNameUeberdecktNichts(page, 'nach dem Laden');
  });
});
