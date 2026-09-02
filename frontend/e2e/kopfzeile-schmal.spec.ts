import { expect, test, type Page } from '@playwright/test';

/**
 * Die Kopfzeile auf dem Handschirm (LFH-329 · B1/M12).
 *
 * WARUM HIER UND NICHT IN VITEST: `vite.config.ts` fährt Vitest mit `css: false`,
 * und jsdom rechnet kein Layout. Die eine Frage, die dieses Paket wirklich
 * beantworten muss — schlägt das Inline-`paddingInline` antds Klassenregel
 * (`padding: 0 46.875px` bei der kompakten Steuerhöhe), auch logisch gegen
 * physisch? — ist ausschließlich im Browser messbar. Die Quelltext-Verdrahtung
 * bewacht `src/theme/kopfpolsterung.guard.test.ts`.
 *
 * Bewusst KEIN zweites Playwright-Projekt und kein Device-Descriptor: ein
 * `devices['iPhone …']` zöge webkit nach, und ein Browser-Download ist im Repo
 * nirgends abgesichert. Der Viewport wird im bestehenden chromium-Projekt
 * umgestellt.
 *
 * NICHT geprüft: `document.body.scrollWidth <= window.innerWidth` über das ganze
 * Dokument. Der Überlauf auf 390 px hat auf einer Modulseite mehrere Quellen
 * (Tabellen, Karten) — dieses Paket kann nur seinen eigenen Beitrag belegen und
 * misst deshalb punktgenau das `header`-Element. Wer das zur dokumentweiten
 * Form „repariert", macht die Spec zur Sammelstelle fremder Befunde.
 */

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

const SCHMAL = { width: 390, height: 844 };
const BREIT = { width: 1366, height: 768 };

// Login-/Anlege-Helfer aus `kernfluss.spec.ts` kopiert — es gibt (noch) kein
// geteiltes e2e-Hilfsmodul.
async function anmeldenAls(page: Page, benutzer: string, passwort: string) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill(benutzer);
  await page.getByLabel('Passwort').fill(passwort);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

async function anmelden(page: Page) {
  await anmeldenAls(page, ADMIN, PW);
}

async function einsatzAnlegen(page: Page, name: string): Promise<string> {
  await page.getByRole('button', { name: 'Neuer Einsatz' }).click();
  await page.getByLabel('Bezeichnung').fill(name);
  await page.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze\/\d+/);
  return page.url().match(/\/einsaetze\/(\d+)/)![1];
}

test('Kopf-Polsterung: 24 px am Fükw-Schirm, 12 px auf 390 px', async ({ page }) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Kopf ${Date.now()}`);

  // BEIDE Layouts: `/einsaetze` hängt an der Ebene-1-Shell, die Modulseite am
  // Einsatz-Workspace. Es sind Geschwister — wer nur eines umstellt, lässt den
  // Handschirm auf der halben App auf dem antd-Maß stehen.
  for (const route of ['/einsaetze', `/einsaetze/${einsatzId}/etb`]) {
    await page.setViewportSize(BREIT);
    await page.goto(route);
    const kopf = page.locator('header');
    // Beweist, dass der Selektor genau eine Kopfzeile trifft — sonst wäre eine
    // grüne Zusicherung grün durch Nichtstun.
    await expect(kopf, route).toHaveCount(1);
    await expect(kopf, route).toHaveCSS('padding-left', '24px');
    await expect(kopf, route).toHaveCSS('padding-right', '24px');

    await page.setViewportSize(SCHMAL);
    await expect(kopf, route).toHaveCSS('padding-left', '12px');
    await expect(kopf, route).toHaveCSS('padding-right', '12px');
  }
});

/**
 * IN BEIDEN DICHTESTUFEN, und das ist eine Messung aus LFH-392: mit einem
 * zusätzlichen `Space`-Kind in der Einsatz-Kopfzeile (dem Trenner vor den
 * Aktionen) lief der Kopf auf 390 px um 20 px über — `scrollWidth` 410 gegen
 * `clientWidth` 390 — aber NUR in `komfortabel`, wo der `middle`-Abstand 18 px
 * statt 11 px trägt und jedes Ziel 48 statt 30 px breit ist. Dieser Test lief
 * bis dahin ausschließlich mit feinem Zeiger, also in `kompakt`, und blieb grün;
 * gefunden hat den Überlauf ein Touch-Test einer fremden Seite
 * (`uhs-grundriss-touch.spec.ts`, `hasTouch: true`). Ein 390-px-Budget, das nur
 * in der Fükw-Stufe geprüft wird, prüft den Kontext nicht, für den 390 px
 * stehen: der mobile Kontext ist `komfortabel` (Bedien-Leitlinie A1).
 *
 * `hasTouch` statt einer gespeicherten Wahl, weil das der Weg ist, den das Gerät
 * nimmt: `useViewport.zeigerIstGrob` belegt die Stufe ohne gespeicherte Wahl
 * aus `(pointer: coarse)` vor (LFH-361). Die VORBEDINGUNG auf `data-dichte` ist
 * tragend — fiele die Vorbelegung, liefe die Touch-Variante still in `kompakt`
 * und wäre grün durch Nichtstun.
 *
 * LFH-511 IST GESCHLOSSEN, das `fixme` ist damit heraus. Der Befund lautete:
 * auch OHNE den Trenner mass die `Space` in `komfortabel` 299 px (Alarmzentrale
 * 169 + 2 × 18 Abstand + Suchen 48 + Benutzermenü 46) und stand mit Hamburger
 * (48) und zwei Kopf-Abständen (16 + 16) bei 379 px gegen 366 px Innenbreite —
 * 13 px in die Polsterung, 1 px über den Kopf (`scrollWidth` 391).
 *
 * Behoben in `einsatz/EinsatzLayout.tsx` durch einen DECKEL auf den
 * Kopf- und Reihen-Abstand am schmalen Schirm (Bauform `aktionsabstand()` aus
 * LFH-378). Es wächst nur der Abstand, nicht der Inhalt: die drei Ziele sind in
 * jeder Stufe gleich breit. Die Alarmzentrale behält deshalb ihren Text — die
 * Forderung aus LFH-392, dass „blockiert"/„stumm" nicht nur über eine Ikone
 * läuft, ist unangetastet. Die Bilanz je Dichtestufe prüft
 * `EinsatzLayout.test.tsx` ohne Rendern; DASS sie im Browser aufgeht, prüft
 * dieser Test.
 *
 * ZWEI WEITERE SPECS HINGEN AM SELBEN BEFUND, ohne ihn zu nennen:
 * `einstellungen-schmal` und `kraefte-schmal` setzen ebenfalls `hasTouch` und
 * messen `documentElement` — sie waren schlicht übersehen und liefen rot mit.
 */
async function kopfLaeuftNichtUeber(page: Page, route: string, stufe: 'kompakt' | 'komfortabel') {
  await page.goto(route);
  const kopf = page.locator('header');
  await expect(kopf, route).toBeVisible();
  await expect(page.locator('html'), `${route}: Vorbedingung Dichtestufe`).toHaveAttribute(
    'data-dichte',
    stufe,
  );
  const masse = await kopf.evaluate((el) => ({ scroll: el.scrollWidth, klient: el.clientWidth }));
  expect(masse.scroll, `${route}: Kopfzeile läuft über`).toBeLessThanOrEqual(masse.klient);
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
 * DERSELBE Nachweis für den GESPERRTEN Zweig der Topbar (LFH-337 · Fix-Welle, Befund B1).
 *
 * Der Test darüber meldet sich als Admin an; `darfVerwaltung(admin)` ist `true`, er läuft
 * also ausschließlich durch den freien `<Link>`-Zweig von `GlobalLink`
 * (`src/components/AppLayout.tsx`). Der gesperrte Zweig — gedämpfter Text plus
 * „Keine Berechtigung"-Tag — war nie gemessen, und genau er ist der breitere: er kann
 * weder kürzen (`flexShrink: 0`) noch umbrechen (antds `Tag` setzt `white-space: nowrap`).
 * Ein Guard, der nur den privilegiertesten Benutzer prüft, ist strukturell blind.
 *
 * NUR `/einsaetze`, KEINE Einsatzroute: `GlobalLink` wohnt in der Ebene-1-Schale
 * (`App.tsx:132-133`), der Einsatz-Workspace hat eine eigene Kopfzeile ohne diesen
 * Eintrag. Damit entfällt zugleich die Mitgliedschaftsfrage an einem vom Admin
 * angelegten Einsatz.
 *
 * Die VORBEDINGUNGEN sind tragend: ohne sie bliebe der Test auch dann grün, wenn
 * jemand den gesperrten Zweig ganz entfernte — dann liefe die Breitenmessung gegen
 * eine Kopfzeile ohne den Block, den sie messen soll.
 */
test('Kopfzeile: auf 390 px läuft sie auch für einen Benutzer OHNE Verwaltungsrecht nicht über', async ({
  page,
}) => {
  const LAUF = Date.now();
  const NUTZER = `e2e-kopf-ohne-${LAUF}`;
  const NUTZER_PW = 'e2e-kopf-ohne-pw-123';

  // Anlegen braucht den Admin. Ohne `system_rolle`/`org_rolle` im Body fällt das
  // Backend auf 'keiner'/'keine' zurück (`src/routes/benutzer.rs:99-103`) —
  // `darfVerwaltung` ist damit false. Präzedenz: `fokus-verdeckung.spec.ts:197-209`.
  await anmelden(page);
  const angelegt = await page.request.post('/api/benutzer', {
    data: { anzeigename: `E2E Ohne Recht ${LAUF}`, benutzername: NUTZER, passwort: NUTZER_PW },
  });
  expect(
    angelegt.ok(),
    `Seeding Benutzer: ${angelegt.status()} ${await angelegt.text()}`,
  ).toBeTruthy();

  // Sitzung wechseln. Der Cookie-Jar ist zwischen `page` und `page.request` geteilt,
  // ein Abmelden über die API genügt deshalb.
  const abgemeldet = await page.request.post('/api/auth/logout');
  expect(abgemeldet.ok(), `Abmelden: ${abgemeldet.status()}`).toBeTruthy();
  await anmeldenAls(page, NUTZER, NUTZER_PW);

  await page.setViewportSize(SCHMAL);
  await page.goto('/einsaetze');

  const kopf = page.locator('header');
  await expect(kopf).toHaveCount(1);
  // ── VORBEDINGUNGEN: der gesperrte Zweig muss überhaupt stehen.
  await expect(
    page.getByRole('link', { name: 'Verwaltung' }),
    'Vorbedingung: kein freier Verwaltungs-Link — sonst misst der Test den falschen Zweig',
  ).toHaveCount(0);
  await expect(
    kopf.getByText('Verwaltung', { exact: true }),
    'Vorbedingung: der gedämpfte Eintrag bleibt auf JEDER Breite stehen (gesperrt statt versteckt)',
  ).toBeVisible();
  // Der Tag selbst entfällt unter `lg` — das ist die Änderung, die den Überlauf behebt.
  await expect(
    kopf.getByText('Keine Berechtigung'),
    'unter lg trägt die Kopfzeile den Tag nicht',
  ).toHaveCount(0);

  const masse = await kopf.evaluate((el) => ({ scroll: el.scrollWidth, klient: el.clientWidth }));
  expect(masse.scroll, 'Kopfzeile läuft über (gesperrter Zweig)').toBeLessThanOrEqual(masse.klient);
});

test('Such-Trigger bleibt auf 390 px in beiden Kopfzeilen eine 48-px-Trefffläche', async ({ page }) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Suche ${Date.now()}`);

  await page.setViewportSize(SCHMAL);
  for (const route of ['/einsaetze', `/einsaetze/${einsatzId}/etb`]) {
    await page.goto(route);
    const trigger = page.getByRole('button', { name: 'Suchen' });
    await expect(trigger, route).toBeVisible();
    const kasten = (await trigger.boundingBox())!;
    expect(Math.min(kasten.width, kasten.height), `${route}: Such-Trefffläche`).toBeGreaterThanOrEqual(48);
  }
});

test('Bediendichte bleibt auf 390 px bedienbar — über das Benutzermenü', async ({ page }) => {
  // DIE EIGENTLICHE ZUSICHERUNG DIESES PAKETS. A1 weist dem Führungs-Tablet und
  // dem mobilen Kontext gerade `komfortabel` und `handschuh` zu. Die
  // Kommandopalette trägt beide Achsen zwar und hat seit LFH-335 auch einen
  // sichtbaren Auslöser — sie zeigt aber keinen AKTIVEN Wert an. Das Menü ist
  // der Bedienweg, der die Stufe zeigt UND setzt.
  //
  // Unter lg ist dieser Test seit LFH-392 UNVERÄNDERT — was sich geändert hat,
  // ist die Gegenprobe darunter: sie belegt nicht mehr, dass die BREITE die
  // Umschalter entfernt, sondern dass sie in keiner Breite mehr im Kopf stehen.
  await anmelden(page);
  await page.setViewportSize(SCHMAL);
  await page.goto('/einsaetze');

  // Über die ROLLE gezählt, nicht über die zwei Etiketten: die kamen mit
  // `ThemeToggle.tsx` fort und stehen im Repo nirgends mehr — eine Null darauf
  // wäre durch keine Änderung am Produktivcode rot zu bekommen. Diese hier
  // schlägt an, sobald irgendein Segmented in die Kopfzeile zurückkehrt.
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
   * UMGEDREHT IN LFH-392. Bis dahin hieß dieser Test „ab lg stehen die
   * Umschalter wieder in der Kopfzeile" und war die Gegenprobe zur Null oben:
   * ohne ihn belegte jene nur, dass irgendetwas fehlt, nicht dass die BREITE es
   * entfernt.
   *
   * Diese Gegenprobe gibt es nicht mehr, weil es die Regel nicht mehr gibt — die
   * Umschalter sind auf JEDER Breite aus dem Kopf. Die Null oben ersatzlos
   * stehenzulassen hieße, eine nicht mehr widerlegbare Behauptung zu behalten.
   * An ihre Stelle tritt deshalb die ANDERE Hälfte: nicht im Kopf, aber im Menü
   * bedienbar — beides auf derselben Breite, in derselben Runde geprüft.
   */
  await anmelden(page);
  await page.setViewportSize(BREIT);
  await page.goto('/einsaetze');

  // Über die ROLLE gezählt, nicht über die zwei Etiketten: die kamen mit
  // `ThemeToggle.tsx` fort und stehen im Repo nirgends mehr — eine Null darauf
  // wäre durch keine Änderung am Produktivcode rot zu bekommen. Diese hier
  // schlägt an, sobald irgendein Segmented in die Kopfzeile zurückkehrt.
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
   * DIE HÄLFTE, DIE VITEST NICHT KANN (LFH-392). `EinsatzLayout.test.tsx` belegt
   * die DOM-Semantik — genau ein Trenner, Alarm davor, Aktionen dahinter. Ob
   * daraus im Browser eine sichtbare Trennung wird, kann es nicht sagen:
   * `vite.config.ts` fährt Vitest mit `css: false`, und jsdom rechnet kein Layout.
   *
   * Gemessen wird deshalb, dass der Trenner eine echte Ausdehnung hat und
   * zwischen den zwei Gruppen LIEGT — nicht nur, dass er im Baum steht. Ein
   * `display: none` oder eine Nullbreite fiele hier auf und in jsdom nicht.
   */
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Absetzung ${Date.now()}`);
  await page.setViewportSize(BREIT);
  await page.goto(`/einsaetze/${einsatzId}/etb`);

  const trenner = page.locator('header [role="separator"]');
  await expect(trenner).toHaveCount(1);
  const trennerKasten = (await trenner.boundingBox())!;
  expect(trennerKasten.height, 'Trenner hat sichtbare Höhe').toBeGreaterThan(0);

  const ton = (await page.getByRole('button', { name: /Alarmton/ }).boundingBox())!;
  const suchen = (await page.getByRole('button', { name: 'Suchen' }).boundingBox())!;
  expect(ton.x + ton.width, 'Alarmzentrale endet links vom Trenner').toBeLessThanOrEqual(
    trennerKasten.x + 1,
  );
  expect(suchen.x, 'Aktionen beginnen rechts vom Trenner').toBeGreaterThanOrEqual(
    trennerKasten.x + trennerKasten.width - 1,
  );
});
