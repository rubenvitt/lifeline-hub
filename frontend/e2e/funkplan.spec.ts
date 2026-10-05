import { expect, test } from '@playwright/test';
import {
  ABSCHNITT,
  A4_DRUCKBREITE,
  EINHEIT,
  EINHEIT_RUF,
  EINHEIT_ZWEI,
  ERREICHBAR,
  FAHRZEUG,
  FUEKW,
  KURZ,
  LOKAL,
  SG_HINWEIS,
  SG_LANG,
  SUBPIXEL,
  anmelden,
  einsatzAnlegen,
  oeffne,
  seede,
  seedeSprechgruppen,
  sgZeile,
  sprechgruppenSicht,
  tabelle,
} from './funkplan-kern';

/**
 * Funkplan S6 (LFH-548): die Nachweise, die NUR im Browser gehen. jsdom rechnet kein Layout,
 * wertet `@media print` nicht aus und kennt keine Contentbreite.
 *
 * - MESSUNG (Aufgabe 1.1, Akzeptanzkriterium „Breite vor dem Bau“): Contentbreite am Fükw mit
 *   offenem Panel und die Laufweiten langer Werte. Die Werte stehen in design.md D4 (Nachtrag);
 *   hier bleiben sie als Annotation stehen, und die Tabelle hat am Fükw keinen Überhang.
 * - LÜCKEN IM ERSTEN BILD bei 1366 × 768 mit offenem Modulpanel (`toBeInViewport`).
 * - 390 px: Tabelle, nicht Karten; die Kennung bleibt fixiert.
 * - ÜBERNAHME: genau EIN POST auf `…/lageberichte`, kein PATCH, danach der Bericht offen.
 * - ZEILENLINK: die Kennung einer Einheit führt auf ihre Detailseite.
 *
 * Der Druckpfad (A4-Breite, `beforeprint`) steht in `funkplan-druck.spec.ts` und läuft dort auch
 * in Firefox und WebKit (`DRUCK_SPECS`, LFH-915). Hier bleibt nur der Druckschritt der
 * Führungsstelle: er hängt an der Erfassung auf den Einsatzdaten und an der Übernahme.
 */

const HANDSCHIRM = { width: 390, height: 844 };

test('Fükw mit offenem Panel: Messwerte, kein Überhang, Lücken im ersten Bild', async ({
  page,
}) => {
  await page.setViewportSize(FUEKW);
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Funkplan ${Date.now()}`);
  await seede(page, einsatzId);
  await oeffne(page, einsatzId);

  await expect(page.locator('[data-lfh="modul-panel"]'), 'Panel offen am Fükw').toBeVisible();

  // ── Messung (Aufgabe 1.1): Contentbreite und Laufweiten in der Tabellenschrift.
  const messwerte = await page.evaluate(
    async ({ werte }) => {
      await document.fonts.ready;
      const inhalt = document.querySelector('[data-lfh="seiten-inhalt"]') as HTMLElement;
      const s = getComputedStyle(inhalt);
      const contentBreite =
        inhalt.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight);
      const zelle = document.querySelector('tr.ant-table-row td:nth-child(2)') as HTMLElement;
      const zs = getComputedStyle(zelle);
      const probe = document.createElement('span');
      probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap';
      document.body.append(probe);
      const miss = (wert: string, schrift: string) => {
        probe.style.font = schrift;
        probe.textContent = wert;
        return Math.ceil(probe.getBoundingClientRect().width);
      };
      const mono = "400 12px 'LFH JetBrains Mono', ui-monospace, monospace";
      const ergebnis: Record<string, number> = {
        contentBreite,
        zellpolster: parseFloat(zs.paddingLeft) + parseFloat(zs.paddingRight),
      };
      for (const [k, v] of Object.entries(werte)) ergebnis[`mono:${k}`] = miss(v, mono);
      probe.remove();
      return ergebnis;
    },
    {
      werte: {
        kurz: KURZ,
        einheitRuf: EINHEIT_RUF,
        fahrzeug: FAHRZEUG,
        sprechgruppe: 'TMO 412_F_DRK',
      },
    },
  );
  for (const [k, v] of Object.entries(messwerte)) {
    test.info().annotations.push({ type: 'messwert', description: `${k}=${v}` });
  }

  // Die Spaltenbreiten (Σ 1020 px) passen in die Contentbreite: kein waagerechter Bildlauf,
  // auch mit der Erreichbarkeit (1366 ≥ xl).
  await expect(tabelle(page).getByRole('columnheader', { name: 'Erreichbarkeit' })).toBeVisible();
  const ueberhang = await page
    .locator('.ant-table-body')
    .evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(ueberhang, `Tabelle am Fükw ohne Überhang (gemessen ${ueberhang}px)`).toBeLessThanOrEqual(
    SUBPIXEL,
  );

  // ── Lücken im ersten Bild, mit ihren Zahlen.
  const luecken = page.getByRole('region', { name: 'Lücken' });
  await expect(luecken).toBeInViewport();
  const zeile = (titel: string) =>
    luecken.locator('[data-lfh="funkplan-luecke"]').filter({ hasText: titel });
  await expect(zeile('Einheiten ohne Sprechgruppe')).toContainText('1');
  await expect(
    zeile('Einheiten ohne Sprechgruppe').getByRole('link', { name: EINHEIT }),
  ).toBeVisible();
  await expect(zeile('Abschnitte ohne Sprechgruppe')).toContainText('0');
  await expect(zeile('Einsatzlokale Sprechgruppen ohne Zuordnung')).toContainText(LOKAL);
  await expect(luecken.getByText('nicht erfasst')).toBeInViewport();
});

test('390 px: Tabelle statt Karten, die Kennung bleibt fixiert', async ({ page }) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Funkplan schmal ${Date.now()}`);
  await seede(page, einsatzId);
  await page.setViewportSize(HANDSCHIRM);
  await oeffne(page, einsatzId);
  await expect(tabelle(page).locator('.ant-table')).toHaveCount(1);
  await expect(page.locator('[data-lfh="datensicht-karte"]')).toHaveCount(0);
  const fixiert = tabelle(page).locator('th.ant-table-cell-fix-start');
  await expect(fixiert).toHaveCount(1);
  await expect(fixiert).toHaveText('Stelle');
  await expect(fixiert).toHaveCSS('position', 'sticky');
});

test('Übernahme: genau ein POST, kein PATCH, danach der Bericht', async ({ page }) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Funkplan Übernahme ${Date.now()}`);
  await seede(page, einsatzId);
  await page.setViewportSize(FUEKW);
  await oeffne(page, einsatzId);

  const anfragen: string[] = [];
  page.on('request', (r) => {
    if (/\/lageberichte(\/\d+)?$/.test(new URL(r.url()).pathname) && r.method() !== 'GET') {
      anfragen.push(`${r.method()} ${new URL(r.url()).pathname}`);
    }
  });
  await page.getByRole('button', { name: 'In Lagebericht übernehmen' }).click();
  await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/lageberichte/\\d+$`));
  expect(anfragen).toEqual([`POST /api/einsaetze/${einsatzId}/lageberichte`]);
  await expect(page.getByText(ABSCHNITT).first()).toBeVisible();
  await expect(page.getByText(ERREICHBAR)).toHaveCount(0);
});

test('die Kennung einer Einheit führt auf ihre Detailseite', async ({ page }) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Funkplan Link ${Date.now()}`);
  const { einheit } = await seede(page, einsatzId);
  await page.setViewportSize(FUEKW);
  await oeffne(page, einsatzId);
  await tabelle(page).getByRole('link', { name: EINHEIT }).click();
  await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/einheiten/${einheit}$`));
});

// ── Eigene Führungsstelle (LFH-849) ─────────────────────────────────────────────────────────────
//
// Erfasst wird sie auf den Einsatzdaten (Zeilenbearbeitung), der Funkplan zeigt sie als erste
// Zeile. Der Druckpfad (A4, `beforeprint`) trägt ihre Erreichbarkeit, die Übernahme nie.

const FS_RUF = 'Florian Musterstadt 10/1';
const FS_ERREICHBAR = '+49 171 7654321';

test('Führungsstelle: auf Einsatzdaten erfasst, erste Zeile im Plan, im Druck mit Erreichbarkeit, im Bericht ohne', async ({
  page,
}) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Funkplan Führungsstelle ${Date.now()}`);
  await seede(page, einsatzId);

  await page.setViewportSize(FUEKW);
  await page.goto(`/einsaetze/${einsatzId}/einsatzdaten`);
  const paneel = page.getByRole('region', { name: 'Eigene Führungsstelle' });
  await paneel.getByRole('button', { name: 'Rufname eintragen', exact: true }).click();
  const ruf = paneel.getByRole('textbox', { name: 'Rufname', exact: true });
  await ruf.fill(FS_RUF);
  await ruf.press('Enter');
  await expect(paneel.getByRole('button', { name: 'Rufname bearbeiten' })).toContainText(FS_RUF);
  await paneel.getByRole('button', { name: 'Erreichbarkeit eintragen', exact: true }).click();
  const erreichbar = paneel.getByRole('textbox', { name: 'Erreichbarkeit', exact: true });
  await erreichbar.fill(FS_ERREICHBAR);
  await erreichbar.press('Enter');
  await expect(paneel.getByRole('button', { name: 'Erreichbarkeit bearbeiten' })).toContainText(
    FS_ERREICHBAR,
  );

  await oeffne(page, einsatzId);
  const ersteZeile = tabelle(page).locator('tr[data-row-key]').first();
  await expect(ersteZeile).toHaveAttribute('data-row-key', 'fs');
  await expect(ersteZeile).toContainText(FS_RUF);
  await expect(
    page.getByRole('region', { name: 'Lücken' }).getByText('Eigene Gegenstelle (Führungsstelle)'),
  ).toHaveCount(0);

  // Druckpfad bei A4-Breite: die Erreichbarkeit der Führungsstelle steht da.
  await page.setViewportSize({ width: A4_DRUCKBREITE, height: 900 });
  await expect(ersteZeile).not.toContainText(FS_ERREICHBAR);
  await page.evaluate(() => {
    window.print = () => {
      window.dispatchEvent(new Event('beforeprint'));
    };
  });
  await page.getByRole('button', { name: /Drucken/ }).click();
  await page.emulateMedia({ media: 'print' });
  await expect(tabelle(page).locator('tr[data-row-key="fs"]')).toContainText(FS_ERREICHBAR);
  await page.emulateMedia({ media: null });

  // Übernahme: die Führungsstelle steht im Bericht, ihre Erreichbarkeit nie.
  await page.reload();
  await page.setViewportSize(FUEKW);
  await expect(tabelle(page).getByText(FAHRZEUG)).toBeVisible();
  await page.getByRole('button', { name: 'In Lagebericht übernehmen' }).click();
  await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/lageberichte/\\d+$`));
  await expect(page.getByText(FS_RUF).first()).toBeVisible();
  await expect(page.getByText(FS_ERREICHBAR)).toHaveCount(0);
});

// ── Darstellung „Skizze“ ────────────────────────────────────────────────────────────────────────
//
// Die Fernmeldeskizze (LFH-893) hat ihre eigene Spec: `fernmeldeskizze.spec.ts` (Fläche, Ziehen,
// Tastatur, Rechte, Lage) und `fernmeldeskizze-druck.spec.ts` (Druck). Die Tests der alten
// Baum-Skizze (LFH-625: Klappen, Kante, Schleuse) sind dort ersetzt.

// ── Darstellung „Sprechgruppen“: die Kanalbelegung (LFH-848 D8) ───────────────────────────────────
//
// - UMSCHALTEN am Fükw mit offenem Panel: dritte Stellung des Umschalters, eine Zeile je
//   Sprechgruppe mit ihren Teilnehmern; der Teilnehmer-Verweis führt (geklickt) zur Einheit.
// - BREITE: Σ Spaltenbreiten 930 px gegen die gemessene Contentbreite (LFH-548 D4) — kein
//   waagerechter Bildlauf, die Lücken stehen im ersten Bild.
//
// Mutationsprobe: `mindestBreite` der Teilnehmer auf 600 → am Fükw Überhang, die Breitenprobe wird
// rot.

test('Sprechgruppen am Fükw: Umschalten, Teilnehmer, kein Überhang, Lücken im ersten Bild', async ({
  page,
}) => {
  await page.setViewportSize(FUEKW);
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Sprechgruppen ${Date.now()}`);
  const { einheit } = await seedeSprechgruppen(page, einsatzId);
  await page.goto(`/einsaetze/${einsatzId}/stab/funkplan`);
  await expect(tabelle(page).getByRole('link', { name: EINHEIT })).toBeVisible();
  await expect(page.locator('[data-lfh="modul-panel"]'), 'Panel offen am Fükw').toBeVisible();

  const umschalter = page.getByRole('radiogroup', { name: 'Darstellung' });
  await umschalter.getByRole('radio', { name: 'Sprechgruppen' }).click();
  await expect(umschalter.getByRole('radio', { name: 'Sprechgruppen' })).toBeChecked();
  await expect(tabelle(page)).toHaveCount(0);

  // Datenanker: die Zeile der langen TMO-Gruppe mit beiden Einheiten und dem Abschnitt.
  const tmo = sgZeile(page, SG_LANG);
  await expect(tmo.getByRole('link', { name: EINHEIT_ZWEI })).toBeVisible();
  await expect(tmo.getByRole('link', { name: ABSCHNITT })).toBeVisible();
  await expect(tmo).toContainText(SG_HINWEIS);
  await expect(tmo).toContainText(EINHEIT_RUF);
  // `POST …/einsaetze/{id}/sprechgruppen` legt einsatzlokal an; der Katalog ist Org-Stammdaten.
  await expect(tmo).toContainText('einsatzlokal');
  // TMO vor DMO, die lokale ohne Zuordnung mit „keine“.
  await expect(sprechgruppenSicht(page).locator('tr.ant-table-row').first()).toContainText(SG_LANG);
  await expect(sgZeile(page, LOKAL)).toContainText('einsatzlokal');
  await expect(sgZeile(page, LOKAL)).toContainText('keine');

  const ueberhang = await sprechgruppenSicht(page)
    .locator('.ant-table-body')
    .evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(ueberhang, `Sprechgruppen am Fükw ohne Überhang (${ueberhang}px)`).toBeLessThanOrEqual(
    SUBPIXEL,
  );
  await expect(page.getByRole('region', { name: 'Lücken' })).toBeInViewport();

  // Der Verweis eines Teilnehmers bedient (geklickt, nicht nur sichtbar).
  await tmo.getByRole('link', { name: EINHEIT, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/einheiten/${einheit}$`));
});
