import { expect, test, type Page } from '@playwright/test';
import { ruheUndZeiger } from './kontrast-kern';

/**
 * Gefahrrot in Ruhe UND unter dem Zeiger, Tag und Nacht (LFH-693, Spec `farbrollen-kontrast`):
 * der rote Menüeintrag, die Beschriftung des gefüllten Gefahrknopfs und die des umrandeten.
 * Textboden aus Kriterium 5 als Literal, Tag ≥ 7 : 1, Nacht ≥ 5 : 1, ohne Ausnahme. Gerechnet
 * steht dasselbe in `src/theme/gefahrKontrast.test.ts`; hier zählt, was der Browser zeichnet —
 * gerade beim Menü, das als Portal außerhalb des Seiteninhalts liegt und deshalb in keinem
 * Seiten-Spec vorkam.
 *
 * GEMESSEN:
 *  · „Löschen“ im gebündelten Aktionsmenü einer Verpflegungskarte ohne gültige Ausgabe (roter
 *    Eintrag hinter dem Trenner): unter dem Zeiger wechselt die Hinterlegung auf Rot.
 *  · „Löschen“ der Rückfrage danach (`Modal` mit `okButtonProps={{ danger: true }}`).
 *  · „Deaktivieren“ im Fahrzeug-Status-Katalog der Stammdaten (umrandet): unter dem Zeiger
 *    wechselt die Schrift, die Fläche bleibt.
 */

const TEXT = { light: 7, dark: 5 } as const;

async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill('admin');
  await page.getByLabel('Passwort').fill(process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw');
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

async function post<T = { id: number }>(page: Page, pfad: string, data?: unknown): Promise<T> {
  const r = await page.request.post(pfad, { data });
  expect(r.ok(), `${pfad}: ${r.status()} ${await r.text()}`).toBeTruthy();
  return (await r.json()) as T;
}

for (const modus of ['light', 'dark'] as const) {
  test(`Gefahrrot in Ruhe und unter dem Zeiger — ${modus}`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.addInitScript((m) => localStorage.setItem('lifeline-hub.theme', m), modus);
    await anmelden(page);

    // Ein Zeitfenster ohne Ausgabe: Erfassen + Bearbeiten + Löschen bündeln sich zum Menü.
    const { id: einsatzId } = await post(page, '/api/einsaetze', {
      bezeichnung: `E2E 693 Gefahrrot ${Date.now()}`,
    });
    const jetzt = Date.now();
    const zeit = (minuten: number) => new Date(jetzt + minuten * 60_000).toISOString();
    await post(page, `/api/einsaetze/${einsatzId}/verpflegung/zeitfenster`, {
      bezeichnung: 'Abendessen Gefahr',
      von_at: zeit(180),
      bis_at: zeit(240),
      bedarf_kraefte: 20,
      bedarf_betreute: 5,
    });

    await page.goto(`/einsaetze/${einsatzId}/verpflegung`);
    await expect(page.locator('html')).toHaveAttribute('data-theme', modus);
    const menueKnopf = page.getByRole('button', {
      name: /^Aktionen zu Zeitfenster Abendessen Gefahr /,
    });
    await expect(menueKnopf).toHaveCount(1);
    await menueKnopf.click();

    const loeschenEintrag = page.getByRole('menuitem', { name: 'Löschen', exact: true });
    // Der rote Eintrag ist der antd-Gefahreintrag, nicht ein beliebiges „Löschen“.
    await expect(loeschenEintrag).toHaveClass(/ant-dropdown-menu-item-danger/);
    await ruheUndZeiger(page, loeschenEintrag, TEXT[modus], `${modus}/Menüeintrag Löschen`);

    await loeschenEintrag.click();
    const rueckfrage = page.getByRole('dialog', {
      name: 'Zeitfenster ‚Abendessen Gefahr‘ löschen?',
    });
    const bestaetigen = rueckfrage.getByRole('button', { name: 'Löschen', exact: true });
    await expect(bestaetigen).toHaveClass(/ant-btn-dangerous/);
    await ruheUndZeiger(page, bestaetigen, TEXT[modus], `${modus}/Rückfrage Löschen`);
    await rueckfrage.getByRole('button', { name: 'Abbrechen', exact: true }).click();
    await expect(rueckfrage).toBeHidden();

    await page.goto('/admin/stammdaten/status');
    const deaktivieren = page.getByRole('button', { name: 'Deaktivieren', exact: true }).first();
    await expect(deaktivieren).toHaveClass(/ant-btn-dangerous/);
    await expect(deaktivieren).toHaveClass(/ant-btn-variant-outlined/);
    await ruheUndZeiger(page, deaktivieren, TEXT[modus], `${modus}/Deaktivieren`, 'text');
  });
}
