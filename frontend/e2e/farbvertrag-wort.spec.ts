import { expect, test, type Page } from '@playwright/test';
import { anmelden, einsatzAnlegen, post } from './fuehrungsorganisation-kern';
import { wechsleZuRolle } from './rollen-kern';

/**
 * Farbvertrag mit sichtbarem Wort (LFH-962): eine Statusfarbe ohne Wort las sich falsch — das
 * gelbe Quadrat im Gliederungsbaum wie „angespannt", das Rot an jeder nicht zugeordneten
 * Besatzung wie Unterbesetzung. Hier steht, was jsdom nicht belegt: das Wort ist auf Handy und
 * Desktop wirklich sichtbar, und es schiebt die Seite nicht über den Rand.
 *
 * Gemessen als Admin UND als Beobachter (`frontend/e2e/AGENTS.md`, Layout-Gate
 * nicht-privilegiert): ohne Schreibrecht fehlen Anlegen und Frei-Pool, das Wort bleibt.
 *
 * Mutationsprobe: in `AbschnittKnoten.tsx` den Chip „ohne Leiter" entfernen bzw. in
 * `FahrzeugePage.tsx` die Regel „nicht erfasst" streichen → die Sichtbarkeit wird rot.
 */

const BREITEN = [
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
];

const ABSCHNITT = 'Abschnitt Deich Süd';
const FAHRZEUG = 'Florian Farbvertrag 1';

/** Waagerechter Überhang der Seite in px (Chromium rundet `scrollWidth`, 1 px Toleranz). */
async function ueberhang(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

async function seede(page: Page): Promise<string> {
  const einsatzId = await einsatzAnlegen(page, `E2E Farbvertrag ${Date.now()}`);
  await post(page, einsatzId, 'abschnitte', { name: ABSCHNITT, lagezustand: 'angespannt' });
  await post(page, einsatzId, 'fahrzeuge', { adhoc: { funkrufname: FAHRZEUG } });
  return einsatzId;
}

async function pruefe(page: Page, einsatzId: string, rolle: string) {
  for (const breite of BREITEN) {
    await page.setViewportSize(breite);
    const wo = `${rolle} ${breite.width}`;

    await page.goto(`/einsaetze/${einsatzId}/einsatzabschnitte`);
    const knoten = page.getByText(ABSCHNITT, { exact: true }).first();
    await expect(knoten, `${wo}: Datenanker Abschnitt`).toBeVisible();
    await expect(
      page.getByText('ohne Leiter').first(),
      `${wo}: „ohne Leiter" als Wort`,
    ).toBeVisible();
    await expect(page.getByText('angespannt').first(), `${wo}: Lagezustand als Wort`).toBeVisible();
    expect(await ueberhang(page), `${wo}: Gliederung ohne Überhang`).toBeLessThanOrEqual(1);

    await page.goto(`/einsaetze/${einsatzId}/fahrzeuge`);
    await expect(page.getByText(FAHRZEUG).first(), `${wo}: Datenanker Fahrzeug`).toBeVisible();
    const urteil = page.locator('[data-lfh="besatzung-urteil"]').first();
    await expect(urteil, `${wo}: Besatzung als Wort`).toContainText('Besatzung nicht erfasst');
    await expect(urteil).toBeVisible();
    await expect(urteil, `${wo}: kein Rot ohne Zuordnung`).toHaveAttribute(
      'data-urteil',
      'nicht_erfasst',
    );
    expect(await ueberhang(page), `${wo}: Fahrzeuge ohne Überhang`).toBeLessThanOrEqual(1);
  }
}

test('Gliederung und Fahrzeuge: Führung und Besatzung stehen als Wort, ohne Überhang (Admin)', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await anmelden(page);
  const einsatzId = await seede(page);
  await pruefe(page, einsatzId, 'admin');
});

test('Gliederung und Fahrzeuge: dasselbe als Beobachter, ohne Schreibrecht', async ({ page }) => {
  test.setTimeout(90_000);
  await anmelden(page);
  const einsatzId = await seede(page);
  await wechsleZuRolle(page, 'beobachter', einsatzId);
  // Vorbedingung: der Rollenzweig steht, bevor gemessen wird.
  await page.goto(`/einsaetze/${einsatzId}/fahrzeuge`);
  await expect(page.getByText(FAHRZEUG).first()).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Ad-hoc-Fahrzeug', exact: true }),
    'Vorbedingung: ohne Schreibrecht kein „Ad-hoc-Fahrzeug"',
  ).toHaveCount(0);
  await pruefe(page, einsatzId, 'beobachter');
});
