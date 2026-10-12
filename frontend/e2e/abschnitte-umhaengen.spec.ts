import { expect, test, type Locator, type Page } from '@playwright/test';
import { FUEKW, anmelden, einsatzAnlegen, post } from './fuehrungsorganisation-kern';

/**
 * Umhängen in der Gliederung (LFH-1212): was jsdom nicht belegt. Der Zug läuft mit echter Maus
 * über dnd-kit und `ZugPointerSensor`, der erste Klick danach kommt an (Gegenprobe LFH-519), das
 * Menü „Verschieben unter …“ erreicht dasselbe ohne Ziehen und gibt den Fokus zurück, ein zweiter
 * Arbeitsplatz sieht den Umhang im Sammelbanner statt unter dem Zeiger, und das Organigramm zeigt
 * die neue Struktur.
 *
 * Mutationsproben in `pages/EinsatzabschnittePage.tsx`: statt `zufluss.stand.gezeigt` den frischen
 * Baum zeigen → am zweiten Arbeitsplatz springt der Knoten unter dem Zeiger (Vergleich der
 * `boundingBox`); `focusAbschnitt` leeren → der Fokus steht nach dem Dialog nicht am Auslöser;
 * `useNewGesture` überall `true` liefern lassen → das Enter aus dem Menü schließt den Dialog.
 */

test.use({ viewport: FUEKW });

const NORD = 'Umhang Nord';
const SUED = 'Umhang Süd';
const OST = 'Umhang Nord-Ost';
const MITTE = 'Umhang Mitte';
const WEST = 'Umhang West';

async function seede(page: Page) {
  const einsatzId = await einsatzAnlegen(page, `E2E Umhängen ${Date.now()}`);
  const nord = await post(page, einsatzId, 'abschnitte', { name: NORD });
  const sued = await post(page, einsatzId, 'abschnitte', { name: SUED });
  const ost = await post(page, einsatzId, 'abschnitte', { name: OST, ueber_abschnitt_id: nord });
  return { einsatzId, nord, sued, ost };
}

async function oeffneGliederung(page: Page, einsatzId: string) {
  await page.goto(`/einsaetze/${einsatzId}/einsatzabschnitte`);
  await expect(page.getByRole('tree').getByText(OST, { exact: true })).toBeVisible();
}

/** Über-Abschnitt laut Server — die Wahrheit, nicht die Anzeige. */
async function ueberAbschnitt(page: Page, einsatzId: string, id: number) {
  const antwort = await page.request.get(`/api/einsaetze/${einsatzId}/abschnitte`);
  const liste = (await antwort.json()) as { id: number; ueber_abschnitt_id: number | null }[];
  return liste.find((a) => a.id === id)?.ueber_abschnitt_id ?? null;
}

/** Mausgeste vom Griff auf das Ziel, in Schritten, damit dnd-kit die Bewegung sieht. */
async function ziehe(page: Page, quelle: Locator, ziel: Locator) {
  const a = (await quelle.boundingBox())!;
  const b = (await ziel.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 16 });
  await page.mouse.up();
}

const ziel = (page: Page, id: number) =>
  page.locator(`[data-lfh="gliederung-ziel"][data-abschnitt="${id}"]`);
const griff = (page: Page, id: number) => page.locator(`[data-drag="drag-abschnitt-${id}"]`);

/** Die Spalte eines obersten Abschnitts im Organigramm enthält den Unterabschnitt. */
async function erwarteImOrganigramm(page: Page, einsatzId: string, oben: string, unter: string) {
  await page.goto(`/einsaetze/${einsatzId}/einsatzabschnitte?ansicht=organigramm`);
  await page.mouse.move(0, 0);
  const org = page.getByRole('region', { name: 'Organigramm' });
  await expect(org.getByRole('link', { name: oben, exact: true })).toBeVisible();
  // Die Klappknöpfe stehen in der Werkzeugzeile über der Region.
  const aufklappen = page.getByRole('button', { name: 'Alle aufklappen' });
  if (await aufklappen.isEnabled()) await aufklappen.click();
  const spalte = org
    .locator('[data-lfh="org-spalte"]')
    .filter({ has: page.getByRole('link', { name: oben, exact: true }) });
  await expect(spalte.getByRole('link', { name: unter, exact: true })).toBeVisible();
}

test('Gliederung: ein Abschnitt per Zeiger auf einen anderen wird sein Unterabschnitt', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await anmelden(page);
  const { einsatzId, sued, ost } = await seede(page);
  await oeffneGliederung(page, einsatzId);

  await ziehe(page, griff(page, ost), ziel(page, sued));

  await expect(page.getByText(`„${OST}“ unter „${SUED}“ verschoben`)).toBeVisible();
  await expect.poll(() => ueberAbschnitt(page, einsatzId, ost)).toBe(sued);

  // Kein Klickverlust (Gegenprobe LFH-519): der ERSTE Klick nach dem Zug wählt den Abschnitt.
  // Süd, nicht Nord: Nord steht als Vorwahl schon im Detail, ein verlorener Klick bliebe grün.
  await expect(page.getByRole('region', { name: `Abschnitt: ${NORD}` })).toBeVisible();
  await page.getByRole('tree').getByText(SUED, { exact: true }).click();
  await expect(page.getByRole('region', { name: `Abschnitt: ${SUED}` })).toBeVisible();

  await erwarteImOrganigramm(page, einsatzId, SUED, OST);
});

/**
 * Nach einem Umhang klappt der neue Über-Abschnitt auf, und antds Baum zeichnet den verschobenen
 * Knoten für die Animation ein zweites Mal. Teilten sich beide die dnd-kit-ID, nähme die Kopie beim
 * Aushängen die Anmeldung des stehenden Knotens mit: sein Griff zöge nicht mehr (der Druck
 * markierte Text), sein Ziel nähme nichts an.
 *
 * Mutationsprobe in `einsatzabschnitte/GliederungDrag.tsx`: `useInstanzId` liefert nur `basis` →
 * der zweite Zug auf „Umhang West“ ändert nichts, der dritte startet nicht.
 */
test('Gliederung: der verschobene Abschnitt zieht wieder und nimmt selbst einen Zug an', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await anmelden(page);
  // Süd hat keine Kinder, erst der Umhang klappt es auf; Mitte steht zwischen Süd und West, so
  // rückt West in der Folge des Baums nach vorn (nur dann bleibt sein Knoten eingehängt).
  const { einsatzId, nord, sued, ost } = await seede(page);
  await post(page, einsatzId, 'abschnitte', { name: MITTE });
  const west = await post(page, einsatzId, 'abschnitte', { name: WEST });
  await oeffneGliederung(page, einsatzId);
  // Erst nach der Aufklapp-Animation: die Kopie steht so lange neben dem Knoten. Der Toast kommt
  // mit dem neuen Baum, der Server allein sagt nichts über die Anzeige.
  const umgehaengt = async (text: string) => {
    await expect(page.getByText(text)).toBeVisible();
    await expect(page.locator('.ant-tree-treenode-motion')).toHaveCount(0);
    await expect(griff(page, west)).toHaveCount(1);
  };

  await ziehe(page, griff(page, west), ziel(page, sued));
  await umgehaengt(`„${WEST}“ unter „${SUED}“ verschoben`);
  expect(await ueberAbschnitt(page, einsatzId, west)).toBe(sued);

  // Der verschobene Abschnitt als Ziel.
  await ziehe(page, griff(page, ost), ziel(page, west));
  await umgehaengt(`„${OST}“ unter „${WEST}“ verschoben`);
  expect(await ueberAbschnitt(page, einsatzId, ost)).toBe(west);

  // Der verschobene Abschnitt als Zug, zurück auf die oberste Ebene. Die Wurzelzone steht nur
  // während eines Zugs: ihr Erscheinen belegt, dass er begonnen hat.
  const a = (await griff(page, west).boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 8, a.y + a.height / 2 + 8, { steps: 4 });
  const wurzel = page.locator('[data-lfh="gliederung-wurzel"]');
  await expect(wurzel).toBeVisible();
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('');
  const w = (await wurzel.boundingBox())!;
  await page.mouse.move(w.x + w.width / 2, w.y + w.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect.poll(() => ueberAbschnitt(page, einsatzId, west)).toBeNull();
  // Nord-Ost hängt weiter unter West und zieht mit; Nord bleibt oben.
  expect(await ueberAbschnitt(page, einsatzId, ost)).toBe(west);
  expect(await ueberAbschnitt(page, einsatzId, nord)).toBeNull();
});

test('Gliederung: „Verschieben unter …“ hängt per Tastatur um und gibt den Fokus zurück', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await anmelden(page);
  const { einsatzId, nord, ost } = await seede(page);
  await oeffneGliederung(page, einsatzId);
  await page.getByRole('tree').getByText(OST, { exact: true }).click();

  const ausloeser = page.getByRole('button', { name: `Weitere Aktionen zu Abschnitt ${OST}` });
  await ausloeser.focus();
  await page.keyboard.press('Enter');
  // Das Menü nimmt den Fokus selbst (`MenueAusloeser`, `autoFocus`); die Pfeiltasten heben einen
  // Eintrag hervor, Enter wählt ihn (Muster `etb-chronologie.spec.ts`, LFH-683).
  const menue = page.locator('.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]');
  await expect(menue).toBeVisible();
  const aktiv = menue.locator('.ant-dropdown-menu-item-active');
  await page.keyboard.press('ArrowDown');
  if (!(await aktiv.textContent())?.includes('Verschieben')) await page.keyboard.press('ArrowUp');
  await expect(aktiv).toHaveText('Verschieben unter …');
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: `„${OST}“ verschieben unter …` });
  await expect(dialog.getByRole('button', { name: `${NORD} (jetziger Ort)` })).toBeDisabled();
  // Das Enter aus dem Menü schließt den Dialog nicht und wählt kein Ziel (`useNewGesture`); der
  // Fokus steht danach im ersten
  // wählbaren Ziel „Oberste Ebene“.
  await expect(dialog.getByRole('button', { name: 'Oberste Ebene' })).toBeFocused();
  expect(await ueberAbschnitt(page, einsatzId, ost)).toBe(nord);
  await page.keyboard.press('Enter');

  await expect(page.getByText(`„${OST}“ auf die oberste Ebene verschoben`)).toBeVisible();
  await expect.poll(() => ueberAbschnitt(page, einsatzId, ost)).toBeNull();
  await expect(ausloeser).toBeFocused();

  // Rückgängig im Toast: derselbe PATCH zurück.
  await page.getByRole('button', { name: 'Rückgängig' }).click();
  await expect.poll(() => ueberAbschnitt(page, einsatzId, ost)).toBe(nord);
});

test('Gliederung: ein Umhang am anderen Arbeitsplatz wartet unter dem Zeiger im Sammelbanner', async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  await anmelden(page);
  const { einsatzId, sued, ost } = await seede(page);

  // Der zweite Arbeitsplatz zielt mit der Maus in die Gliederung.
  const zweiter = await context.newPage();
  await oeffneGliederung(zweiter, einsatzId);
  const bereich = zweiter.locator('[data-lfh="gliederung-bereich"]');
  const box = (await bereich.boundingBox())!;
  await zweiter.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await zweiter.mouse.move(box.x + box.width / 2 + 2, box.y + box.height / 2 + 2);
  await expect(zweiter.getByText('Live pausiert')).toBeVisible();
  const vorher = await zweiter.getByRole('tree').getByText(OST, { exact: true }).boundingBox();

  const antwort = await page.request.patch(`/api/einsaetze/${einsatzId}/abschnitte/${ost}`, {
    data: { ueber_abschnitt_id: sued },
  });
  expect(antwort.ok()).toBeTruthy();

  await expect(zweiter.getByText('1 umgehängt')).toBeVisible();
  // Nicht unter dem Zeiger: der Knoten steht, wo er stand.
  expect(await zweiter.getByRole('tree').getByText(OST, { exact: true }).boundingBox()).toEqual(
    vorher,
  );

  await zweiter.getByRole('button', { name: /anzeigen/ }).click();
  await expect(zweiter.getByText('1 umgehängt')).toHaveCount(0);
});
