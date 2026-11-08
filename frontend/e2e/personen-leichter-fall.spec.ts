import { expect, test, type Page } from '@playwright/test';
import { anmeldenAlsAdmin } from './rollen-kern';

/**
 * Leichter Fall in einem Schritt (LLH-1572, Spec `betroffene-erfassung`): „Versorgt und entlassen“
 * in höchstens drei Griffen — öffnen, Anlass, „Entlassen“ — in der Betroffenenliste und am
 * UHS-Tablet, dort auch ohne Netz vorgemerkt. Der Server schreibt Person, Verbleib und EINEN
 * ETB-Eintrag; ein POST, keine Folgeaufrufe.
 *
 * Mutationsprobe: in `LeichterFallModal` `entlassen: true` aus `leichterFallZuEingabe` entfernt →
 * die Person steht ohne Verbleib, beide Fälle rot.
 */

async function anlegen<T = { id: number }>(page: Page, pfad: string, data?: unknown): Promise<T> {
  const antwort = await page.request.post(pfad, data === undefined ? {} : { data });
  expect(antwort.ok(), `${pfad}: ${antwort.status()} ${await antwort.text()}`).toBeTruthy();
  return (await antwort.json()) as T;
}

interface PersonWire {
  id: number;
  registrier_nr: number;
  status: string;
  aktuelle_verbleib_art: string | null;
  aktuelle_sichtung: string | null;
  aktuelle_uhs_id: number | null;
  anlass: string | null;
}

async function personen(page: Page, e: number): Promise<PersonWire[]> {
  const antwort = await page.request.get(`/api/einsaetze/${e}/personen`);
  expect(antwort.ok()).toBeTruthy();
  return (await antwort.json()) as PersonWire[];
}

async function etbTexte(page: Page, e: number): Promise<string[]> {
  const antwort = await page.request.get(`/api/einsaetze/${e}/etb`);
  expect(antwort.ok()).toBeTruthy();
  return ((await antwort.json()) as { inhalt: string }[]).map((x) => x.inhalt);
}

test('LLH-1572: Liste — versorgt und entlassen in drei Griffen, ein ETB-Eintrag', async ({
  page,
}) => {
  await anmeldenAlsAdmin(page);
  const { id: e } = await anlegen(page, '/api/einsaetze', {
    bezeichnung: `E2E Leichter Fall ${Date.now()}`,
  });
  await page.goto(`/einsaetze/${e}/personen`);

  const posts: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().includes(`/api/einsaetze/${e}/personen`))
      posts.push(r.url());
  });

  // Griff 1, 2, 3.
  await page.getByRole('button', { name: 'Versorgt und entlassen' }).click();
  const dialog = page.getByRole('dialog', { name: 'Versorgt und entlassen' });
  await dialog.getByRole('radio', { name: 'Allergie / Insektenstich' }).click();
  await dialog.getByRole('button', { name: 'Entlassen' }).click();

  await expect(page.getByText(/^Entlassen als R-\d{3}$/)).toBeVisible();
  await expect.poll(async () => (await personen(page, e)).length).toBe(1);
  const [p] = await personen(page, e);
  expect(p).toMatchObject({
    status: 'betroffen',
    aktuelle_verbleib_art: 'entlassung',
    aktuelle_sichtung: null,
    anlass: 'allergie',
  });
  expect(posts.filter((u) => u.endsWith(`/api/einsaetze/${e}/personen`))).toHaveLength(1);
  const reg = `R-${String(p.registrier_nr).padStart(3, '0')}`;
  const zurPerson = (await etbTexte(page, e)).filter((t) => t.includes(reg));
  expect(zurPerson).toEqual([`Person ${reg} versorgt und entlassen`]);
});

test('LLH-1572: UHS-Tablet ohne Netz — vorgemerkt, mit Netz einmal angelegt und entlassen', async ({
  page,
  browser,
}) => {
  await anmeldenAlsAdmin(page);
  const { id: e } = await anlegen(page, '/api/einsaetze', {
    bezeichnung: `E2E Leichter Fall Tablet ${Date.now()}`,
  });
  const uhs = await anlegen(page, `/api/einsaetze/${e}/uhs`, {
    typ: 'behandlungsplatz',
    bezeichnung: 'UHS Bühne',
  });
  await anlegen(page, `/api/einsaetze/${e}/uhs/${uhs.id}/status`, { status: 'aktiv' });
  const kopplung = await anlegen<{ code: { code: string } }>(page, `/api/einsaetze/${e}/geraete`, {
    ansicht: 'uhs-tablet',
    uhs_id: uhs.id,
    bezeichnung: 'Tablet 1',
  });

  const kontext = await browser.newContext({
    viewport: { width: 1024, height: 768 },
    hasTouch: true,
  });
  const tablet = await kontext.newPage();
  try {
    await tablet.goto(`/koppeln#${kopplung.code.code}`);
    await tablet.getByRole('button', { name: 'Gerät koppeln' }).click();
    await expect(tablet).toHaveURL(new RegExp(`/geraet/${e}/patienten$`));

    await tablet.getByRole('button', { name: 'Versorgt und entlassen' }).click();
    const dialog = tablet.getByRole('dialog', { name: 'Versorgt und entlassen' });
    await expect(dialog.getByRole('textbox', { name: 'Fundort' })).toHaveValue('UHS Bühne');
    await kontext.setOffline(true);
    await dialog.getByRole('radio', { name: 'Hitze / Kälte' }).click();
    await dialog.getByRole('button', { name: 'Kühlung' }).click();
    await dialog.getByRole('button', { name: 'Entlassen' }).click();
    await expect(tablet.getByText('Offline vorgemerkt · R-…')).toBeVisible();
    expect(await personen(page, e)).toEqual([]);

    await kontext.setOffline(false);
    await expect.poll(async () => (await personen(page, e)).length, { timeout: 20_000 }).toBe(1);
    const [p] = await personen(page, e);
    expect(p).toMatchObject({
      status: 'betroffen',
      aktuelle_verbleib_art: 'entlassung',
      aktuelle_uhs_id: null,
      anlass: 'hitze_kaelte',
    });
    const reg = `R-${String(p.registrier_nr).padStart(3, '0')}`;
    const zurPerson = (await etbTexte(page, e)).filter((t) => t.includes(reg));
    expect(zurPerson).toEqual([`Person ${reg}: in UHS Bühne versorgt und entlassen`]);
  } finally {
    await kontext.close();
  }
});
