import { expect, test, type Locator, type Page } from '@playwright/test';
import { detailBereit, einheitMitZuordnungen, kopfFelder, zuordnungsKarte } from './einheit-fixture';

/** LFH-446: Gate 3 auf der Einheiten-Detailroute.
 * Sichtbare Feldhüllen, Zuordnungszeilen und Aktionsabstände werden im Browser gemessen.
 * Die Böden stehen als Literale; weder CSS-Tokens noch data-dichte ersetzen die Geometrie.
 */
const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';
const STAFFEL = [
  { dichte: 'kompakt', soll: 30 },
  { dichte: 'komfortabel', soll: 48 },
  { dichte: 'handschuh', soll: 72 },
] as const;
// Chromium liefert Subpixelwerte. Ein halbes Pixel trennt die drei Stufen weiterhin klar.
const SUBPIXEL = 0.5;
const FUEKW = { width: 1366, height: 768 };
const DICHTE_SCHLUESSEL = 'lifeline-hub.dichte';

async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill(ADMIN);
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

async function stelleDichte(page: Page, dichte: string) {
  await page.evaluate(([schluessel, wert]) => window.localStorage.setItem(schluessel, wert), [
    DICHTE_SCHLUESSEL,
    dichte,
  ] as const);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-dichte', dichte);
}

/** Höhe GENAU EINES Knotens, subpixel-tolerant gegen die Sollstufe (Untergrenze). */
async function haeltStufe(ziel: Locator, soll: number, name: string): Promise<number> {
  await expect(ziel, `${name}: genau ein Knoten muss gemessen werden`).toHaveCount(1);
  const kasten = await ziel.boundingBox();
  expect(kasten, `${name}: kein Kasten messbar`).not.toBeNull();
  expect(
    kasten!.height,
    `${name} (gemessen ${kasten!.height}px hoch, Soll ≥ ${soll})`,
  ).toBeGreaterThanOrEqual(soll - SUBPIXEL);
  return kasten!.height;
}

/** LFH-446: sichtbare Feldhüllen und alle gesäten Zuordnungsarten, keine Token-Selbstprüfung. */
test('Einheit: Formularfelder und Zuordnungszeilen halten 30 / 48 / 72 px und den Aktionsabstand', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize(FUEKW);
  await anmelden(page);
  const { pfad } = await einheitMitZuordnungen(page);
  const messwerte: string[] = [];
  for (const { dichte, soll } of STAFFEL) {
    await page.goto(pfad);
    await stelleDichte(page, dichte);
    await detailBereit(page);
    const ziele = kopfFelder(page).map(({ name, huelle }) => ({ name, ziel: huelle }));
    const aktionsreihen = [];
    let kleinsteZeile = Infinity;
    let kleinsterAbstand = Infinity;
    for (const titel of ['Personal', 'Fahrzeuge', 'Material']) {
      const karte = zuordnungsKarte(page, titel);
      const entfernen = karte.getByRole('button', { name: 'Entfernen', exact: true });
      // Die Zeile trägt minHeight; die Schaltfläche darin ist ein eigenes Bedienziel.
      const zeile = entfernen.locator('xpath=ancestor::div[contains(@style,"space-between")][1]');
      kleinsteZeile = Math.min(kleinsteZeile, await haeltStufe(zeile, soll, `${titel}-Zuordnungszeile (${dichte})`));
      ziele.push({ name: `${titel} entfernen`, ziel: entfernen });
      ziele.push({ name: `${titel} zuordnen`, ziel: karte.locator('.ant-select') });
      if (titel === 'Personal') {
        const fuehrer = karte.getByRole('button', { name: 'Als Einheitsführer' });
        ziele.push({ name: 'Als Einheitsführer', ziel: fuehrer });
        aktionsreihen.push([fuehrer, entfernen]);
      }
      if (dichte !== 'kompakt') {
        const r = (await zeile.boundingBox())!;
        const auswahl = (await karte.locator('.ant-select').boundingBox())!;
        // Abstand ab letzter wirklicher Trefffläche, nicht ab der gepolsterten Zeilenhülle.
        const knopf = (await entfernen.boundingBox())!;
        const abstand = auswahl.y - (knopf.y + knopf.height);
        kleinsterAbstand = Math.min(kleinsterAbstand, abstand);
        expect(abstand, `${titel}: Abstand Aktion/Zuordnung ${dichte}, Zeilenhöhe ${r.height}`).toBeGreaterThanOrEqual((dichte === 'handschuh' ? 16 : 8) - SUBPIXEL);
      }
    }
    const speichern = page.getByRole('main').getByRole('button', { name: 'Speichern', exact: true });
    const aufloesen = page.getByRole('main').getByRole('button', { name: 'Auflösen', exact: true });
    const neueSprechgruppe = page.getByRole('main').getByRole('button', { name: /neue Sprechgruppe anlegen$/ });
    ziele.push({ name: 'Speichern', ziel: speichern }, { name: 'Auflösen', ziel: aufloesen }, { name: 'neue Sprechgruppe anlegen', ziel: neueSprechgruppe });
    aktionsreihen.push([speichern, aufloesen]);
    const felder = kopfFelder(page);
    const staerke = ['Führer', 'Unterführer', 'Mannschaft'].map((name) => felder.find((f) => f.name === name)!.huelle);
    aktionsreihen.push([staerke[0], staerke[1]], [staerke[1], staerke[2]]);
    aktionsreihen.push([felder.find((f) => f.name === 'Sprechgruppen')!.huelle, neueSprechgruppe]);
    expect(ziele).toHaveLength(21);
    let minimum = Infinity;
    for (const { name, ziel } of ziele) {
      const hoehe = await haeltStufe(ziel, soll, `${name} (${dichte})`);
      const breite = (await ziel.boundingBox())!.width;
      expect(breite, `${name} (${dichte}): Breite`).toBeGreaterThanOrEqual(soll - SUBPIXEL);
      minimum = Math.min(minimum, hoehe, breite);
    }
    if (dichte !== 'kompakt') {
      for (const [links, rechts] of aktionsreihen) {
        const a = (await links.boundingBox())!;
        const b = (await rechts.boundingBox())!;
        const abstand = Math.max(b.x - a.x - a.width, b.y - a.y - a.height);
        kleinsterAbstand = Math.min(kleinsterAbstand, abstand);
        expect.soft(abstand, `Aktionsabstand ${dichte}: ${links} → ${rechts}`).toBeGreaterThanOrEqual((dichte === 'handschuh' ? 16 : 8) - SUBPIXEL);
      }
    }
    // Auch die einblendbaren Sprechgruppenfelder gehören zu dieser Formularroute.
    await neueSprechgruppe.click();
    const main = page.getByRole('main');
    const bezeichnung = main.getByRole('textbox', { name: 'Neue Bezeichnung', exact: true });
    const betriebsart = main.locator('.ant-select').filter({ has: page.getByRole('combobox', { name: 'Neue Betriebsart', exact: true }) });
    const anlegen = main.getByRole('button', { name: 'Anlegen', exact: true });
    const abbrechen = main.getByRole('button', { name: 'Abbrechen', exact: true });
    for (const feld of [bezeichnung, betriebsart, anlegen, abbrechen]) {
      const hoehe = await haeltStufe(feld, soll, `Sprechgruppen-Schnellerfassung (${dichte})`);
      const breite = (await feld.boundingBox())!.width;
      expect(breite).toBeGreaterThanOrEqual(soll - SUBPIXEL);
      minimum = Math.min(minimum, hoehe, breite);
    }
    if (dichte !== 'kompakt') {
      const reihe = [bezeichnung, betriebsart, anlegen, abbrechen];
      for (let i = 1; i < reihe.length; i++) {
        const a = (await reihe[i - 1].boundingBox())!;
        const b = (await reihe[i].boundingBox())!;
        const abstand = Math.max(b.x - a.x - a.width, b.y - a.y - a.height);
        kleinsterAbstand = Math.min(kleinsterAbstand, abstand);
        expect.soft(abstand, `Sprechgruppen-Feldabstand ${dichte}, Paar ${i}`).toBeGreaterThanOrEqual((dichte === 'handschuh' ? 16 : 8) - SUBPIXEL);
      }
    }
    await abbrechen.click();
    messwerte.push(`${dichte}: ${ziele.length} Grundziele + 4 Sprechgruppenfelder, kleinste Achse ${minimum.toFixed(2)}px, Zuordnungszeile ${kleinsteZeile}px${dichte !== 'kompakt' ? `, Abstand ${kleinsterAbstand}px` : ''}`);
  }
  test.info().annotations.push({ type: 'messwert', description: messwerte.join(' | ') });
});

test('Einheit Selbstbeweis: feste Kompaktgröße fällt trotz aktiver Handschuhstufe durch', async ({ page }) => {
  await page.setViewportSize(FUEKW);
  await anmelden(page);
  const { pfad } = await einheitMitZuordnungen(page);
  await page.goto(pfad);
  await stelleDichte(page, 'handschuh');
  await detailBereit(page);
  const name = page.getByLabel('Name', { exact: true });
  await haeltStufe(name, 72, 'Handschuhfeld vor Mutation');
  await name.evaluate((el) => el.setAttribute('data-e2e-kompakt', 'true'));
  const mutation = await page.addStyleTag({ content: '[data-e2e-kompakt] { height: 30px !important; min-height: 30px !important; max-height: 30px !important; font-size: 13px !important; line-height: 1.5 !important; padding-block: 0 !important; transition: none !important; }' });
  await expect(page.locator('html')).toHaveAttribute('data-dichte', 'handschuh');
  expect((await name.boundingBox())!.height).toBe(30);
  await expect(haeltStufe(name, 72, 'Feste Kompaktgröße')).rejects.toThrow(/Feste Kompaktgröße/);
  await mutation.evaluate((el) => el.parentNode?.removeChild(el));
  // Die Wiederherstellung durchläuft wieder den normalen Dichte-Übergang.
  await expect.poll(async () => (await name.boundingBox())!.height).toBeGreaterThanOrEqual(72 - SUBPIXEL);
  await haeltStufe(name, 72, 'Handschuhfeld nach Wiederherstellung');
});
