import { expect, test, type Page } from '@playwright/test';
import { pdfAuszug } from './pdf-kern';
import { ADMIN, ADMIN_PW, anmeldenAls } from './rollen-kern';

/**
 * Registrierliste drucken (LLH-1616, Change `iw8hjb93-registrierliste-drucken`, Spec
 * `betreuung-registrierung`, „Registrierliste drucken“, „Gesundheitsangaben nur auf Wunsch“).
 * Chromium, Firefox und WebKit prüfen die Mechanik unter Druckmedium (`DRUCK_SPECS`): Einstieg im
 * Paneel „Registrierung“, Unverträglichkeiten erst nach Wahl, der Tabellenkopf ist Kopfgruppe, ein
 * Haushalt bricht nicht, Schalter und Hinweis stehen nicht auf Papier, nichts ragt über die
 * Druckwurzel. Das PDF gibt es nur in Chromium: jeder Haushalt steht ganz auf einer Seite.
 *
 * Gesät werden zwölf Haushalte zu je vier Personen (über eine Seite), die erste Person des ersten
 * Haushalts mit der Unverträglichkeit „Erdnüsse“.
 *
 * Mutationsprobe: die Regel in `registrierlisteDruck.css` entfernt → `break-inside` des Haushalts
 * ist `auto`, rot.
 */

const A4_DRUCKBREITE = 680;
const SUBPIXEL = 1;
const HAUSHALTE = 12;
const JE_HAUSHALT = 4;

async function seede(page: Page): Promise<{ einsatzId: number; stelleId: number }> {
  const sende = async (methode: 'post' | 'patch', pfad: string, data: unknown) => {
    const a = await page.request[methode](pfad, { data });
    expect(a.ok(), `${pfad}: ${a.status()} ${await a.text()}`).toBeTruthy();
    return (await a.json()) as { id: number };
  };
  const { id: einsatzId } = await sende('post', '/api/einsaetze', {
    bezeichnung: `E2E Registrierliste ${Date.now()}`,
  });
  const basis = `/api/einsaetze/${einsatzId}/betreuung`;
  const { id: stelleId } = await sende('post', `${basis}/stellen`, {
    bezeichnung: 'Turnhalle Ost',
    art: 'notunterkunft',
    kapazitaet_personen: 150,
    belegungsart: 'namentlich',
  });
  await sende('patch', `${basis}/stellen/${stelleId}`, { status: 'in_betrieb' });
  const kostformen = ['normal', 'vegetarisch', 'saeugling_kleinkind', 'vegan'];
  for (let h = 1; h <= HAUSHALTE; h++) {
    await sende('post', `${basis}/stellen/${stelleId}/registrierungen`, {
      personen: Array.from({ length: JE_HAUSHALT }, (_, i) => ({
        name: `Haus${h}`,
        vorname: `P${i + 1}`,
        kostform: kostformen[i],
        ...(h === 1 && i === 0 ? { unvertraeglichkeiten: 'Erdnüsse' } : {}),
      })),
    });
  }
  return { einsatzId, stelleId };
}

/** Druck wie die Person: der Knopf löst `beforeprint` aus (`emulateMedia` feuert es nicht). */
async function drucke(page: Page) {
  await page.evaluate(() => {
    window.print = () => {
      window.dispatchEvent(new Event('beforeprint'));
    };
  });
  await page.getByRole('button', { name: /Drucken/ }).click();
  await page.emulateMedia({ media: 'print' });
}

test('Registrierliste: Einstieg im Paneel, Gesundheitsangaben nur nach Wahl, Haushalt bricht nicht', async ({
  page,
  browserName,
}) => {
  test.setTimeout(180_000);
  await anmeldenAls(page, ADMIN, ADMIN_PW);
  const { einsatzId, stelleId } = await seede(page);
  await page.setViewportSize({ width: A4_DRUCKBREITE, height: 900 });

  // Einstieg im Paneel „Registrierung“ der Detailseite.
  await page.goto(`/einsaetze/${einsatzId}/betreuung/${stelleId}`);
  await page
    .getByRole('region', { name: 'Registrierung', exact: true })
    .getByRole('link', { name: 'Registrierliste drucken' })
    .click();
  await expect(page).toHaveURL(new RegExp(`/betreuung/${stelleId}/registrierliste/druck$`));

  const wurzel = page.locator('[data-lfh="druckwurzel"]');
  const tabelle = wurzel.getByRole('table', { name: 'Registrierte Personen' });
  await expect(tabelle.locator('[data-lfh="registrierliste-haushalt"]')).toHaveCount(HAUSHALTE);
  await expect(wurzel.getByRole('table', { name: 'Kostformen' })).toContainText(
    `gesamt${HAUSHALTE * JE_HAUSHALT}`,
  );
  await expect(wurzel).not.toContainText('Erdnüsse');
  await expect(wurzel.locator('[data-lfh="druckkopf"]')).not.toContainText('Gesundheitsangaben');

  // Bewusst gewählt: die Fassung mit Unverträglichkeiten, die Wahl reist in der Adresse.
  await page.getByRole('switch', { name: 'Unverträglichkeiten mitdrucken' }).click();
  await expect(page).toHaveURL(/registrierliste\/druck\?unvertraeglichkeiten=1$/);
  await expect(tabelle.getByRole('row', { name: /^R-\d{3} Haus1, P1 / })).toContainText('Erdnüsse');
  await expect(wurzel.locator('[data-lfh="druckkopf"]')).toContainText('Gesundheitsangaben');

  await drucke(page);
  const lage = await page.evaluate(() => {
    const w = document.querySelector('[data-lfh="druckwurzel"]')!.getBoundingClientRect();
    const zellen = Array.from(document.querySelectorAll('[data-lfh="druckwurzel"] :is(td, th)'));
    const tab = document.querySelector('[data-lfh="registrierliste"]')!;
    return {
      wurzelRechts: w.right,
      zellenRechts: Math.max(...zellen.map((z) => z.getBoundingClientRect().right)),
      kopf: getComputedStyle(tab.querySelector('thead')!).display,
      haushaltBricht: getComputedStyle(tab.querySelector('[data-lfh="registrierliste-haushalt"]')!)
        .breakInside,
      zeileBricht: getComputedStyle(tab.querySelector('tbody tr')!).breakInside,
      schalter: document.querySelector('[role="switch"]')!.getClientRects().length,
      hinweis: document.querySelector('[data-testid="druck-hinweis"]')!.getClientRects().length,
    };
  });
  expect(lage.kopf, 'Tabellenkopf als Kopfgruppe').toBe('table-header-group');
  expect(lage.haushaltBricht, 'ein Haushalt bricht nicht über die Seite').toBe('avoid');
  expect(lage.zeileBricht, 'eine Zeile bricht nicht').toBe('avoid');
  expect(lage.schalter, 'Schalter nicht auf Papier').toBe(0);
  expect(lage.hinweis, 'Protokollhinweis nicht auf Papier').toBe(0);
  expect(
    lage.zellenRechts,
    `keine Zelle über der Druckwurzel (Zelle ${lage.zellenRechts}px, Wurzel ${lage.wurzelRechts}px)`,
  ).toBeLessThanOrEqual(lage.wurzelRechts + SUBPIXEL);

  if (browserName !== 'chromium') {
    test.info().annotations.push({ type: 'nur-chromium', description: 'Seiten im PDF' });
    await page.emulateMedia({ media: null });
    return;
  }
  const seiten = await pdfAuszug(await page.pdf({ format: 'A4', preferCSSPageSize: true }));
  test.info().annotations.push({ type: 'messwert', description: `${seiten.length} Seiten` });
  expect(seiten.length, 'die Liste läuft über mehr als eine Seite').toBeGreaterThanOrEqual(2);
  // Ohne Leerraum verglichen: `pdfAuszug` fügt die Textstücke ohne Trenner zusammen, und wie der
  // Druck sie schneidet, hängt von Schrift und Umgebung ab (in der CI fand „H-1 ·“ nichts, lokal
  // schon). Deshalb weder Leerraum noch der Trennpunkt: der Kopf eines Haushalts ist das erste
  // Vorkommen seiner Bezugsperson „HausN, P1“.
  const ohneLeerraum = seiten.map((s) => s.text.replace(/\s/g, ''));
  const seiteVon = (text: string) => ohneLeerraum.findIndex((t) => t.includes(text));
  for (let h = 1; h <= HAUSHALTE; h++) {
    const kopf = seiteVon(`Haus${h},P1`);
    expect(kopf, `Kopf von H-${h} im PDF`).toBeGreaterThanOrEqual(0);
    expect(seiteVon(`Haus${h},P${JE_HAUSHALT}`), `H-${h} ganz auf einer Seite`).toBe(kopf);
  }
  await page.emulateMedia({ media: null });
});
