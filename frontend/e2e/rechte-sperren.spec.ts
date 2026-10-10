import { expect, test, type Page } from '@playwright/test';
import { einsatzdatenPfad } from '../src/routing/deeplinks';
import { LETZTE_EINSATZLEITUNG_TEXT } from '../src/stammdaten/rechteText';
import { stehendeAuswahl } from './auswahl-kern';
import { oeffneMenue, waehleImMenue } from './menue-kern';
import {
  ADMIN,
  anmeldenAlsAdmin,
  benutzerAnlegen,
  mitgliedEintragen,
  wechsleZu,
  wechsleZuRolle,
} from './rollen-kern';

/**
 * LFH-966 — Rechteänderungen: gesperrt mit Grund statt einer Aktion, die nie gelingt; die eigene
 * Herabstufung fragt nach; kein Fehler als Toast.
 *
 * ROLLEN (LFH-435): der gesperrte Zustand der Zugriffsverwaltung wird als Einsatzleitung UND als
 * Führungspersonal gemessen. Die Vorbedingung des Rollenzweigs steht vor der Prüfung. Gewartet
 * wird auf einen Inhaltsanker (die Zeile), nicht auf `networkidle`.
 *
 * Bedient wird per Klick (LFH-355): die gesperrte Option wird angeklickt, und es geht KEIN PUT
 * hinaus; die Rückfrage wird über ihre Knöpfe beantwortet.
 */

async function einsatzAnlegen(page: Page): Promise<number> {
  const r = await page.request.post('/api/einsaetze', {
    data: { bezeichnung: `E2E Rechte-Sperren ${Date.now()}` },
  });
  expect(r.ok(), `Einsatz anlegen: ${r.status()}`).toBeTruthy();
  return ((await r.json()) as { id: number }).id;
}

const zugriff = (page: Page) => page.getByRole('region', { name: 'Zugriff' });

/** Zählt die PUTs auf die Mitgliederliste — der Beweis, dass ohne Bestätigung nichts gespeichert wird. */
function zaehleRollenPuts(page: Page): { anzahl: number } {
  const zaehler = { anzahl: 0 };
  page.on('request', (r) => {
    if (r.method() === 'PUT' && /\/api\/einsaetze\/\d+\/mitglieder\/\d+$/.test(r.url())) {
      zaehler.anzahl += 1;
    }
  });
  return zaehler;
}

/** Wählt im Rollenfeld von `name` die Option `option` per Klick. */
async function rolleWaehlen(page: Page, name: string, option: string) {
  await zugriff(page)
    .getByRole('combobox', { name: `Rolle von ${name}` })
    .click();
  const liste = await stehendeAuswahl(page);
  await liste.locator('.ant-select-item-option').filter({ hasText: option }).click();
}

const keinToast = async (page: Page) => expect(page.locator('.ant-message-notice')).toHaveCount(0);

for (const breite of [390, 1440]) {
  test.describe(`LFH-966 Zugriff bei ${breite} px`, () => {
    test.use({ viewport: { width: breite, height: 900 } });

    test('Einsatzleitung: die letzte Leitung ist gesperrt, mit Grund', async ({ page }) => {
      await anmeldenAlsAdmin(page);
      const id = await einsatzAnlegen(page);
      await page.goto(einsatzdatenPfad(id));

      // Vorbedingung des Rollenzweigs: verwalten dürfen (Hinzufügen steht), genau eine Leitung.
      await expect(zugriff(page).getByRole('button', { name: 'Hinzufügen' })).toBeVisible();
      const grund = zugriff(page).getByText(LETZTE_EINSATZLEITUNG_TEXT);
      await expect(grund).toHaveCount(1);
      const zeile = zugriff(page).getByRole('row').filter({ hasText: LETZTE_EINSATZLEITUNG_TEXT });
      await expect(zeile.getByRole('button', { name: 'Entfernen' })).toBeDisabled();
      // Der Grund liegt im Bildschirm, nicht im Scrollcontainer der Tabelle versteckt.
      const kasten = (await grund.boundingBox())!;
      expect(kasten.x + kasten.width, 'Grund rechts im Bild').toBeLessThanOrEqual(breite);

      // Die schwächere Rolle ist gesperrt: der Klick speichert nichts.
      const puts = zaehleRollenPuts(page);
      const name = (await zeile.getByRole('combobox').getAttribute('aria-label'))!.replace(
        /^Rolle von /,
        '',
      );
      await zeile.getByRole('combobox').click();
      // `force` unten, weil Playwright an `aria-disabled` sonst endlos auf „enabled“ wartet; dann
      // prüft es auch keine Ruhe ab, also erst das Aufklappen auslaufen lassen.
      const liste = await stehendeAuswahl(page);
      const beobachter = liste.locator('.ant-select-item-option').filter({ hasText: 'Beobachter' });
      await expect(beobachter).toHaveClass(/ant-select-item-option-disabled/);
      await beobachter.click({ force: true });
      await page.keyboard.press('Escape');
      await expect(
        zugriff(page).getByRole('combobox', { name: `Rolle von ${name}` }),
      ).toHaveAccessibleDescription(LETZTE_EINSATZLEITUNG_TEXT);
      await expect(zeile).toContainText('Einsatzleitung');
      expect(puts.anzahl, 'kein PUT für die gesperrte Rolle').toBe(0);
      await keinToast(page);
    });

    test('Führungspersonal: Rolle gesperrt, kein Entfernen, kein Sperrtext', async ({ page }) => {
      await anmeldenAlsAdmin(page);
      const id = await einsatzAnlegen(page);
      await wechsleZuRolle(page, 'fuehrungspersonal', String(id));
      await page.goto(einsatzdatenPfad(id));

      // Inhaltsanker und Vorbedingung des Rollenzweigs: Rollenfelder gesperrt, kein Hinzufügen.
      const felder = zugriff(page).getByRole('combobox');
      await expect(felder.first()).toBeDisabled();
      await expect(zugriff(page).getByRole('button', { name: 'Hinzufügen' })).toHaveCount(0);
      await expect(zugriff(page).getByRole('button', { name: 'Entfernen' })).toHaveCount(0);
      // Der Sperrgrund gilt der Verwaltung; wer nicht verwaltet, bekommt keinen Hinweis auf eine
      // Aktion, die er ohnehin nicht hat.
      await expect(zugriff(page).getByText(LETZTE_EINSATZLEITUNG_TEXT)).toHaveCount(0);
      const breiteDok = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(breiteDok).toBeLessThanOrEqual(breite);
    });
  });
}

test('LFH-966 Zweite Einsatzleitung ohne Systemrolle: eigene Herabstufung fragt nach', async ({
  page,
}) => {
  await anmeldenAlsAdmin(page);
  const id = await einsatzAnlegen(page);
  const konto = await benutzerAnlegen(page, 'fuehrungspersonal', 'Zweite Leitung');
  await mitgliedEintragen(page, String(id), konto.id, 'einsatzleitung');
  await wechsleZu(page, konto);
  await page.goto(einsatzdatenPfad(id));

  // Vorbedingung: zwei Leitungen, also keine Sperre; diese Sitzung verwaltet.
  await expect(zugriff(page).getByRole('button', { name: 'Hinzufügen' })).toBeVisible();
  await expect(zugriff(page).getByText(LETZTE_EINSATZLEITUNG_TEXT)).toHaveCount(0);
  const puts = zaehleRollenPuts(page);

  await rolleWaehlen(page, 'Zweite Leitung', 'Beobachter');
  const frage = page.getByRole('dialog').filter({ hasText: 'Eigene Rolle herabstufen?' });
  await frage.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(frage).toHaveCount(0);
  const eigene = zugriff(page).getByRole('row').filter({ hasText: 'Zweite Leitung' });
  await expect(eigene).toContainText('Einsatzleitung');
  expect(puts.anzahl, 'ohne Bestätigung kein PUT').toBe(0);

  await rolleWaehlen(page, 'Zweite Leitung', 'Beobachter');
  await frage.getByRole('button', { name: 'Rolle herabstufen' }).click();
  await expect.poll(() => puts.anzahl).toBe(1);
  await expect(eigene).toContainText('Beobachter');
  await keinToast(page);
});

test('LFH-966 Benutzerverwaltung: eigenes Konto gesperrt, ein anderes ohne Rückfrage deaktiviert', async ({
  page,
}) => {
  await anmeldenAlsAdmin(page);
  const anderes = await benutzerAnlegen(page, 'beobachter', 'Abzuschalten');
  await page.goto('/admin/benutzer');

  const suche = page.getByPlaceholder('Name oder Benutzername');
  await suche.fill(ADMIN);
  const eigene = page
    .locator('tr.ant-table-row')
    .filter({ hasText: `@${ADMIN}` })
    .first();
  // Die Aktionen stehen auf jeder Breite im Menü (LFH-1122), der Grund im gesperrten Eintrag.
  // Welcher der beiden Gründe gilt, hängt davon ab, ob der Lauf schon weitere Admins angelegt hat.
  const eigenesMenue = await oeffneMenue(
    page,
    eigene.getByRole('button', { name: /^Aktionen zu/ }),
  );
  await expect(
    eigenesMenue.getByRole('menuitem', {
      name: /^Deaktivieren gesperrt: (eigenes Konto|letzter aktiver Admin)$/,
    }),
  ).toHaveAttribute('aria-disabled', 'true');
  await page.keyboard.press('Escape');

  await suche.fill(anderes.benutzername);
  const zeile = page.locator('tr.ant-table-row').filter({ hasText: `@${anderes.benutzername}` });
  const ausloeser = zeile.getByRole('button', { name: /^Aktionen zu/ });
  await waehleImMenue(page, ausloeser, 'Deaktivieren');
  // Keine Rückfrage (LFH-363): die Wahl wirkt, der Rückweg steht im selben Menü.
  await expect(zeile.getByText('deaktiviert', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await waehleImMenue(page, ausloeser, 'Reaktivieren');
  await expect(zeile.getByText('aktiv', { exact: true })).toBeVisible();
  await keinToast(page);
});
