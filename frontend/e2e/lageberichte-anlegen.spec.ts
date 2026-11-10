import { expect, test, type Page } from '@playwright/test';
import { einsatzAnlegen } from './einsatz-kern';

/**
 * Lageberichte (LLH-1064): „Neuer Lagevortrag“ legt mit EINEM POST an und öffnet den Entwurf,
 * der Pfeil wählt eine andere Vorlage, und die Übersicht zeigt den freigegebenen Stand vorn.
 * Seit LLH-1081 trägt der POST die fünf Abschnitte mit Quelle als Startinhalt (der echte Server
 * prüft die Schlüssel), „Leerer Lagevortrag“ verzichtet darauf, und im Entwurf füllt „Leere
 * Abschnitte aus dem Lagebild füllen“ nach. Seeding (Freigabe) über `page.request`, geprüft wird
 * die Oberfläche.
 */

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill(ADMIN);
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

interface AnlegenBody {
  vorlage: string;
  abschnitte?: { schluessel: string; text: string; uebernommen_at?: string }[];
}

/** Zählt die POSTs, die einen Lagebericht anlegen (nicht Fortschreiben, nicht PATCH). */
function zaehleAnlegen(page: Page, einsatzId: string): { anzahl: number; bodies: AnlegenBody[] } {
  const zaehler = { anzahl: 0, bodies: [] as AnlegenBody[] };
  page.on('request', (r) => {
    if (
      r.method() === 'POST' &&
      new URL(r.url()).pathname === `/api/einsaetze/${einsatzId}/lageberichte`
    ) {
      zaehler.anzahl += 1;
      zaehler.bodies.push(r.postDataJSON() as AnlegenBody);
    }
  });
  return zaehler;
}

/** Die Abschnitte mit Quelle im Lagevortrag zur Information, in der Reihenfolge der Vorlage. */
const MIT_QUELLE = ['gefahren_schadenlage', 'eigene_lage', 'lageentwicklung', 'fuehrungsprobleme'];

test.setTimeout(90_000);

test('„Neuer Lagevortrag“ legt mit einem POST an und öffnet den Entwurf', async ({ page }) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Lagevortrag ${Date.now()}`);
  const posts = zaehleAnlegen(page, einsatzId);

  await page.goto(`/einsaetze/${einsatzId}/lageberichte`);
  // Leerzustand mit Aktion; der Kopf trägt denselben Knopf.
  await expect(page.getByText('Noch keine Lageberichte')).toBeVisible();
  await page
    .locator('[data-lfh="seitenkopf-aktionen"]')
    .getByRole('button', { name: 'Neuer Lagevortrag' })
    .click();

  await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/lageberichte/\\d+$`));
  await expect(page.getByRole('button', { name: 'Entwurf speichern' })).toBeVisible();
  // Vorlage zur Information: ihr erster Abschnitt steht im Entwurf.
  await expect(page.getByLabel('Auftrag', { exact: true })).toBeAttached();
  await expect(page.getByLabel('Titel')).toHaveValue(/^Lageüberblick \d{4}$/);
  expect(posts.anzahl).toBe(1);
  // Kein Dialog auf dem Weg.
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // Startinhalt aus dem Lagebild im selben POST (LLH-1081), der Server hat ihn angenommen.
  expect(posts.bodies[0].abschnitte?.map((a) => a.schluessel)).toEqual(MIT_QUELLE);
  for (const a of posts.bodies[0].abschnitte ?? []) {
    expect(a.text.trim(), a.schluessel).not.toBe('');
    // Jeder übernommene Abschnitt trägt den Stand seiner Übernahme (LLH-1357).
    expect(a.uebernommen_at, a.schluessel).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  }
  await expect(page.getByRole('textbox', { name: 'Eigene Lage' })).toHaveValue(/Kräftemeldebild/);
  // Die Marke steht an den fünf Abschnitten mit Quelle, in Fassung 1 nicht auffällig.
  const marken = page.locator('[data-lfh="uebernahme-stand"]');
  await expect(marken).toHaveCount(MIT_QUELLE.length);
  await expect(marken.first()).toHaveText(/^Stand der Übernahme \d{6}[a-z]{3}\d{2}$/);
  await expect(page.getByRole('textbox', { name: 'Auftrag' })).toHaveValue('');
  // Nichts mehr leer, was eine Quelle hat: kein Sammelknopf.
  await expect(
    page.getByRole('button', { name: 'Leere Abschnitte aus dem Lagebild füllen' }),
  ).toHaveCount(0);
});

test('„Leerer Lagevortrag“ legt ohne Startinhalt an, der Entwurf füllt leere Abschnitte nach', async ({
  page,
}) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Lagevortrag leer ${Date.now()}`);
  const posts = zaehleAnlegen(page, einsatzId);

  await page.goto(`/einsaetze/${einsatzId}/lageberichte`);
  await expect(page.getByText('Noch keine Lageberichte')).toBeVisible();
  await page.getByRole('button', { name: 'Andere Vorlage wählen' }).click();
  await page
    .locator('.ant-dropdown:not(.ant-dropdown-hidden)')
    .getByRole('menuitem', { name: 'Leerer Lagevortrag' })
    .click();

  await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/lageberichte/\\d+$`));
  expect(posts.anzahl).toBe(1);
  expect(posts.bodies[0].vorlage).toBe('lagebericht');
  expect(posts.bodies[0].abschnitte).toBeUndefined();

  const eigeneLage = page.getByRole('textbox', { name: 'Eigene Lage' });
  await expect(eigeneLage).toHaveValue('');
  // Ein Abschnitt mit Quelle von Hand vorweg: die Sammelfüllung lässt ihn stehen.
  const probleme = page.getByRole('textbox', { name: 'Besondere (Führungs-)Probleme' });
  await probleme.fill('Von Hand');
  await page.getByRole('button', { name: 'Leere Abschnitte aus dem Lagebild füllen' }).click();
  await expect(eigeneLage).toHaveValue(/Kräftemeldebild/);
  await expect(probleme).toHaveValue('Von Hand');
  // Ohne Quelle bleiben von Hand: Auftrag und die Medienlage (i6k6mzed, design.md D6).
  await expect(page.getByRole('textbox', { name: 'Auftrag' })).toHaveValue('');
  await expect(page.getByRole('textbox', { name: 'Medienlage' })).toHaveValue('');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Leere Abschnitte aus dem Lagebild füllen' }),
  ).toHaveCount(0);
  // Gespeichert wird wie jede Änderung des Entwurfs.
  await page.getByRole('button', { name: 'Entwurf speichern' }).click();
  await expect(page.getByText(/^zuletzt gespeichert \d{4}/)).toBeVisible();
});

interface PatchBody {
  abschnitte: { schluessel: string; text: string }[];
}

test('von Hand gefüllte Lageentwicklung übersteht die Sammelfüllung und wird gespeichert (LLH-1607)', async ({
  page,
}) => {
  // Der Klick auf die Sammelfüllung blurrt den Editor: der Autosave startet mit ihm. Seine Quittung
  // setzte das Formular auf den Stand VOR dem PATCH zurück, und kam die Füllung vor dem Refetch,
  // schloss sie den Riegel und hielt den alten Stand fest (`entwurf/useEntwurfVerlustschutz.ts`).
  // Der Test legt diese Reihenfolge fest, statt auf sie zu hoffen: die Abrufe der Quellen warten
  // auf die Antwort des PATCH, der Refetch des Berichts auf die Füllung.
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Lagevortrag LLH-1607 ${Date.now()}`);
  await page.goto(`/einsaetze/${einsatzId}/lageberichte`);
  await expect(page.getByText('Noch keine Lageberichte')).toBeVisible();
  await page.getByRole('button', { name: 'Andere Vorlage wählen' }).click();
  await page
    .locator('.ant-dropdown:not(.ant-dropdown-hidden)')
    .getByRole('menuitem', { name: 'Leerer Lagevortrag' })
    .click();
  await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/lageberichte/\\d+$`));
  const berichtPfad = new URL(page.url()).pathname.replace(/^\/einsaetze/, '/api/einsaetze');

  const patches: PatchBody[] = [];
  page.on('request', (r) => {
    if (r.method() === 'PATCH' && new URL(r.url()).pathname === berichtPfad) {
      patches.push(r.postDataJSON() as PatchBody);
    }
  });
  let patchZurueck: () => void = () => {};
  const patchAntwort = new Promise<void>((r) => (patchZurueck = r));
  page.on('response', (r) => {
    if (r.request().method() === 'PATCH' && new URL(r.url()).pathname === berichtPfad) {
      patchZurueck();
    }
  });
  let fuellungDa: () => void = () => {};
  const fuellung = new Promise<void>((r) => (fuellungDa = r));
  let reihenfolgeFest = false;
  await page.route(
    (u) => u.pathname.startsWith(`/api/einsaetze/${einsatzId}/`),
    async (route) => {
      const anfrage = route.request();
      const pfad = new URL(anfrage.url()).pathname;
      if (reihenfolgeFest && anfrage.method() === 'GET' && !pfad.endsWith('/live')) {
        await (pfad === berichtPfad ? fuellung : patchAntwort);
      }
      await route.continue();
    },
  );

  const eigeneLage = page.getByRole('textbox', { name: 'Eigene Lage' });
  const lageentwicklung = page.getByRole('textbox', { name: 'Lageentwicklung' });
  await expect(eigeneLage).toHaveValue('');
  await lageentwicklung.fill('Von Hand');
  reihenfolgeFest = true;
  await page.getByRole('button', { name: 'Leere Abschnitte aus dem Lagebild füllen' }).click();
  await expect(eigeneLage).toHaveValue(/Kräftemeldebild/);
  expect(patches).toHaveLength(1);
  // Erst jetzt darf der Refetch nach der Quittung durch; danach ist das Verlustfenster vorbei.
  const refetch = page.waitForResponse(
    (r) => r.request().method() === 'GET' && new URL(r.url()).pathname === berichtPfad,
  );
  fuellungDa();
  await refetch;
  reihenfolgeFest = false;
  await expect(page.getByText('ungespeicherte Änderungen')).toBeVisible();
  await expect(lageentwicklung).toHaveValue('Von Hand');

  // „Entwurf speichern“ schickt die eigene Fassung mit beiden Abschnitten.
  const vorher = patches.length;
  await page.getByRole('button', { name: 'Entwurf speichern' }).click();
  await expect(page.getByText(/^zuletzt gespeichert \d{4}/)).toBeVisible();
  expect(patches.length).toBeGreaterThan(vorher);
  const text = (b: PatchBody, s: string) => b.abschnitte.find((a) => a.schluessel === s)?.text;
  const letzter = patches[patches.length - 1];
  expect(text(letzter, 'lageentwicklung')).toBe('Von Hand');
  expect(text(letzter, 'eigene_lage')).toMatch(/Kräftemeldebild/);

  // Auch der Server hat beides.
  await page.reload();
  await expect(eigeneLage).toHaveValue(/Kräftemeldebild/);
  await expect(lageentwicklung).toHaveValue('Von Hand');
});

test('der Pfeil legt einen freien Bericht an, die Übersicht zeigt ihn in Arbeit', async ({
  page,
}) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Lagevortrag Pfeil ${Date.now()}`);
  const posts = zaehleAnlegen(page, einsatzId);

  await page.goto(`/einsaetze/${einsatzId}/lageberichte`);
  await expect(page.getByText('Noch keine Lageberichte')).toBeVisible();
  await page.getByRole('button', { name: 'Andere Vorlage wählen' }).click();
  const menue = page.locator('.ant-dropdown:not(.ant-dropdown-hidden)');
  await expect(menue.getByRole('menuitem')).toHaveText([
    'Leerer Lagevortrag',
    'Lagevortrag zur Entscheidung',
    'Freier Bericht',
  ]);
  await menue.getByRole('menuitem', { name: 'Freier Bericht' }).click();

  await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/lageberichte/\\d+$`));
  await expect(page.getByLabel('Titel')).toHaveValue(/^Bericht \d{4}$/);
  expect(posts.anzahl).toBe(1);

  await page.goto(`/einsaetze/${einsatzId}/lageberichte`);
  const inArbeit = page.getByRole('region', { name: 'In Arbeit' });
  await expect(inArbeit.getByRole('link', { name: /^Bericht \d{4}$/ })).toBeVisible();
  await expect(inArbeit.getByText('0/1 Abschnitte')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Aktueller Lagevortrag' })).toHaveCount(0);
});

test('die Übersicht zeigt die jüngste Freigabe vorn, Fortschreiben öffnet die neue Fassung', async ({
  page,
}) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Lagevortrag Stand ${Date.now()}`);
  const E = `/api/einsaetze/${einsatzId}/lageberichte`;
  const angelegt = await page.request.post(E, {
    data: {
      vorlage: 'lagebericht',
      titel: 'Lageüberblick 0900',
      abschnitte: [
        { schluessel: 'zusammenfassung', text: 'Lage in der Unterstadt angespannt.' },
        // Übernommen vor der Freigabe (LLH-1357): die Fortschreibung zeigt ihn als Vorfassung.
        {
          schluessel: 'eigene_lage',
          text: 'Kräftemeldebild',
          uebernommen_at: '2026-01-01 08:00:00',
        },
      ],
    },
  });
  expect(angelegt.ok(), await angelegt.text()).toBe(true);
  const { id } = (await angelegt.json()) as { id: number };
  const frei = await page.request.post(`${E}/${id}/freigeben`);
  expect(frei.ok(), await frei.text()).toBe(true);

  await page.goto(`/einsaetze/${einsatzId}/lageberichte`);
  const aktuell = page.getByRole('region', { name: 'Aktueller Lagevortrag' });
  await expect(aktuell.getByRole('heading', { name: 'Lageüberblick 0900' })).toBeVisible();
  await expect(aktuell.getByText('Lage in der Unterstadt angespannt.')).toBeVisible();
  await expect(page.getByRole('region', { name: 'In Arbeit' })).toContainText(
    'Kein Entwurf in Arbeit',
  );

  await aktuell.getByRole('button', { name: 'Fortschreiben' }).click();
  await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/lageberichte/\\d+$`));
  await expect(page).not.toHaveURL(new RegExp(`/lageberichte/${id}$`));
  await expect(page.getByRole('button', { name: 'Freigeben' })).toBeVisible();
  // Der Stand der Übernahme kommt mit und ist auffällig: er stammt aus der Vorfassung.
  const marke = page.locator('[data-lfh="uebernahme-stand"]');
  await expect(marke).toHaveCount(1);
  await expect(marke).toHaveText(/Stand der Übernahme 01\d{4}jan26 · aus der Vorfassung/);
});
