import { expect, test, type Page } from '@playwright/test';

/**
 * Ablösung, Teil II von LLH-1128: „Ohne Schicht“, Vererbung und „beendet“ gegen den echten
 * Server.
 *
 * Gesät wird ein Verband „Zug Nord“ mit der Untereinheit „Trupp Nord“ und eine einzelne Einheit
 * „Florian Süd“; alle drei treffen per Nachtrag ein. Der Einsatz hat keine Vorgabe, also beginnt
 * keine Schicht von selbst. Der Zug bekommt seine Schicht über die API, der Trupp erbt sie.
 *
 * Geprüft wird, was jsdom nicht sieht: die Menge aus Einheitenliste, Zeitachse und
 * `erbende_einheiten` des Servers, der vorbelegte Dialog bis zur angelegten Schicht, und dass eine
 * Entlassung die Schicht unter „Vergangen“ → „Beendet“ führt.
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

/** Drahtformat des Servers: UTC ohne Zonenkennung. */
function draht(minutenVorher: number): string {
  return new Date(Date.now() - minutenVorher * 60_000).toISOString().slice(0, 19).replace('T', ' ');
}

test('Ablösung: Einheiten ohne Schicht, vorbelegter Beginn, Vererbung und Ende mit der Entlassung', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1366, height: 900 });
  await anmelden(page);

  const neu = await page.request.post('/api/einsaetze', {
    data: { bezeichnung: `E2E Ohne Schicht ${Date.now()}` },
  });
  expect(neu.ok(), `Seeding Einsatz: ${neu.status()}`).toBeTruthy();
  const einsatzId = ((await neu.json()) as { id: number }).id;
  const basis = `/api/einsaetze/${einsatzId}`;
  const sende = async (methode: 'post' | 'put', pfad: string, data: unknown, was: string) => {
    const antwort = await page.request[methode](`${basis}/${pfad}`, { data });
    expect(
      antwort.ok(),
      `Seeding ${was}: ${antwort.status()} ${await antwort.text()}`,
    ).toBeTruthy();
    return (await antwort.json()) as { id: number };
  };
  // Ohne Vorgabe beginnt mit dem Eintreffen keine Schicht (Spec `kraefte-abloesung`).
  await sende('put', 'abloesungen/schichtmodell', { schichtmodell: null }, 'keine Vorgabe');
  const zug = await sende('post', 'einheiten', { name: 'Zug Nord' }, 'Zug');
  const trupp = await sende(
    'post',
    'einheiten',
    { name: 'Trupp Nord', ueber_einheit_id: zug.id },
    'Trupp',
  );
  const sued = await sende('post', 'einheiten', { name: 'Florian Süd' }, 'Florian Süd');
  for (const [e, vor] of [
    [zug, 120],
    [trupp, 120],
    [sued, 60],
  ] as const) {
    await sende(
      'post',
      `einheiten/${e.id}/zeitachse`,
      { art: 'eintreffen', zeitpunkt_at: draht(vor) },
      'Eintreffen',
    );
  }
  await sende('post', 'abloesungen', { einheit_id: zug.id, rhythmus_minuten: 360 }, 'Schicht Zug');

  await page.goto(`/einsaetze/${einsatzId}/abloesung`);
  const zugKarte = page.getByRole('article', { name: 'Schicht Zug Nord' });
  await expect(zugKarte.locator('[data-lfh="abloesung-erben"]')).toHaveText(
    'gilt auch für: Trupp Nord',
  );
  const ohne = page.getByRole('radio', { name: /^Ohne Schicht/ });
  await expect(ohne).toHaveText('Ohne Schicht (1)');
  await expect(page.getByText('1 laufend · 0 fällig · 1 ohne Schicht')).toBeVisible();

  await ohne.click();
  const bereich = page.getByRole('region', { name: 'Einheiten ohne Schicht' });
  // Der Trupp erbt die Schicht des Zugs und steht nicht da.
  await expect(bereich.getByRole('article')).toHaveCount(1);
  const karte = bereich.getByRole('article', { name: 'Florian Süd ohne Schicht' });
  await expect(karte.getByText('eingetroffen')).toBeVisible();

  await karte.getByRole('button', { name: 'Schicht beginnen für Florian Süd' }).click();
  const dialog = page.getByRole('dialog', { name: 'Schicht beginnen' });
  await expect(dialog.getByTitle('Florian Süd', { exact: true })).toBeVisible();
  // Ohne Wahl: „Im Einsatz seit“ nennt das Eintreffen aus der Zeitachse.
  await expect(dialog.getByRole('textbox', { name: 'Im Einsatz seit' })).toHaveAttribute(
    'placeholder',
    /^Eintreffen /,
  );
  await dialog.getByRole('textbox', { name: 'Rhythmus' }).fill('6');
  await dialog.getByRole('button', { name: 'Schicht beginnen' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Keine Einheit ohne Schicht')).toBeVisible();
  await expect(ohne).toHaveText('Ohne Schicht (0)');
  await expect(page.getByRole('radio', { name: /^Laufend/ })).toHaveText('Laufend (2)');

  // Die Entlassung des Zugs beendet seine Schicht; der Trupp erbt nichts mehr und steht jetzt
  // ohne Schicht da (er hat seine eigene offene Periode).
  await sende(
    'post',
    `einheiten/${zug.id}/zeitachse`,
    { art: 'entlassung', zeitpunkt_at: draht(1) },
    'Entlassung Zug',
  );
  await expect(ohne).toHaveText('Ohne Schicht (1)');
  await page.getByRole('radio', { name: 'Vergangen' }).click();
  await page.getByRole('radio', { name: 'Beendet' }).click();
  const beendet = page
    .getByRole('region', { name: 'Beendete Schichten' })
    .getByRole('article', { name: 'Schicht Zug Nord' });
  await expect(beendet.locator('[data-lfh="abloesung-ende"]')).toHaveText(
    /^beendet · entlassen \d{4,6}$/,
  );
});
