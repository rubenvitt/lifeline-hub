import { expect, test, type Page } from '@playwright/test';
import { anmeldenAlsAdmin } from './rollen-kern';

/**
 * Fahrzeug als eigene Einheit führen und Personal der Einheit übernehmen (LLH-1073 Teil II),
 * Durchstich im Browser: aus der Zeile eines Fahrzeugs ohne Einheit eine Einheit bilden (die
 * Besatzung kommt mit, das Meldebild zeigt die Einheit mit Fahrzeug und Stärke), und die freien
 * Kräfte einer Einheit in einem Schritt als Besatzung übernehmen (die Besatzung zeigt danach Ist
 * und Soll). Gesät wird per API, gewartet auf Inhaltsanker, nie auf `networkidle` (LFH-385).
 */

/** Breit genug, dass die Fahrzeugliste alle Spalten zeigt. */
const BREIT = { width: 1700, height: 900 } as const;

type Saat = {
  einsatzId: number;
  post: (pfad: string, data: unknown) => Promise<number>;
  put: (pfad: string) => Promise<void>;
};

async function seedEinsatz(page: Page): Promise<Saat> {
  const post = async (pfad: string, data: unknown) => {
    const antwort = await page.request.post(pfad, { data });
    expect(antwort.ok(), `${pfad}: ${antwort.status()} ${await antwort.text()}`).toBeTruthy();
    return ((await antwort.json()) as { id: number }).id;
  };
  const einsatzId = await post('/api/einsaetze', {
    bezeichnung: `E2E Eigene Einheit ${Date.now()}`,
  });
  const basis = `/api/einsaetze/${einsatzId}`;
  return {
    einsatzId,
    post: (pfad, data) => post(`${basis}/${pfad}`, data),
    put: async (pfad) => {
      const antwort = await page.request.put(`${basis}/${pfad}`);
      expect(antwort.ok(), `${pfad}: ${antwort.status()} ${await antwort.text()}`).toBeTruthy();
    },
  };
}

test('Fahrzeug als eigene Einheit führen: die Besatzung kommt mit, das Meldebild zeigt die Einheit mit Fahrzeug und Stärke', async ({
  page,
}) => {
  await anmeldenAlsAdmin(page);
  const { einsatzId, post, put } = await seedEinsatz(page);
  const funkrufname = 'Florian Nachbarstadt 44/1';
  const fahrzeug = await post('fahrzeuge', { adhoc: { funkrufname } });
  for (const [name, position] of [
    ['Berta Brandt', 'unterfuehrer'],
    ['Anna Arndt', 'mannschaft'],
  ] as const) {
    const kraft = await post('personal', { adhoc: { name, staerke_position: position } });
    await put(`fahrzeuge/${fahrzeug}/besatzung/${kraft}`);
  }

  await page.setViewportSize(BREIT);
  await page.goto(`/einsaetze/${einsatzId}/fahrzeuge?ansicht=liste`);
  const region = page.getByRole('region', { name: 'Fahrzeuge im Einsatz', exact: true });
  await expect(region.getByText(funkrufname, { exact: true })).toBeVisible();
  await region.getByRole('button', { name: `Weitere Aktionen zu ${funkrufname}` }).click();
  await page.getByRole('menuitem', { name: 'Als eigene Einheit führen …' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText(`${funkrufname} als eigene Einheit führen`)).toBeVisible();
  await expect(dialog.getByLabel('Name')).toHaveValue(funkrufname);
  await expect(dialog.getByText('Besatzung: Berta Brandt, Anna Arndt')).toBeVisible();
  await dialog.getByRole('button', { name: 'Einheit bilden' }).click();
  await expect(page.getByText(`Einheit «${funkrufname}» gebildet`)).toBeVisible();
  await expect(dialog).toBeHidden();
  // Die Zeile bleibt und trägt jetzt die Einheit.
  await expect(
    region.getByRole('button', { name: `Einheit zu ${funkrufname} bearbeiten` }),
  ).toHaveText(funkrufname);

  const liste = await page.request.get(`/api/einsaetze/${einsatzId}/einheiten`);
  expect(liste.ok()).toBeTruthy();
  const einheit = ((await liste.json()) as { id: number; name: string }[]).find(
    (e) => e.name === funkrufname,
  );
  expect(einheit, 'die gebildete Einheit steht in der Liste').toBeDefined();

  await page.goto(`/einsaetze/${einsatzId}/kraefteuebersicht?einheit=${einheit!.id}`);
  const meldebild = page.getByRole('region', { name: 'Meldebild' });
  const markiert = meldebild.locator('tr.zeile-hervorgehoben');
  await expect(markiert).toContainText(funkrufname);
  // Die Besatzung zählt in der Stärke der Einheit: ein Unterführer, eine Mannschaft.
  await expect(markiert).toContainText('0/1/1//2');

  await page.goto(`/einsaetze/${einsatzId}/etb`);
  await expect(page.getByText(`Einheit «${funkrufname}» gebildet`, { exact: true })).toBeVisible();
  await expect(
    page.getByText(`Einheit «${funkrufname}»: 2 Kräfte zugeordnet: Berta Brandt, Anna Arndt`),
  ).toBeVisible();
});

test('Personal der Einheit übernehmen: vorgewählt bis zum Soll, danach zeigt die Besatzung Ist und Soll', async ({
  page,
}) => {
  await anmeldenAlsAdmin(page);
  const funkrufname = `RTW 83-${Date.now() % 100000}`;
  const stamm = await page.request.post('/api/fahrzeuge', {
    data: { funkrufname, staerke_fuehrer: 0, staerke_unterfuehrer: 1, staerke_mannschaft: 1 },
  });
  expect(stamm.ok(), `Stamm-Fahrzeug: ${stamm.status()} ${await stamm.text()}`).toBeTruthy();
  const stammId = ((await stamm.json()) as { id: number }).id;
  const { einsatzId, post, put } = await seedEinsatz(page);
  const fahrzeug = await post('fahrzeuge', { fahrzeug_id: stammId });
  const einheit = await post('einheiten', { name: 'Rettungsstaffel' });
  await put(`einheiten/${einheit}/fahrzeug/${fahrzeug}`);
  for (const [name, position] of [
    ['Ulla Ufer', 'unterfuehrer'],
    ['Ali Aksoy', null],
    ['Ben Brandt', null],
  ] as const) {
    const kraft = await post('personal', { adhoc: { name, staerke_position: position } });
    await put(`einheiten/${einheit}/personal/${kraft}`);
  }

  await page.setViewportSize(BREIT);
  await page.goto(`/einsaetze/${einsatzId}/fahrzeuge?ansicht=liste`);
  const region = page.getByRole('region', { name: 'Fahrzeuge im Einsatz', exact: true });
  await expect(region.getByText(funkrufname, { exact: true })).toBeVisible();
  await region.getByRole('button', { name: `Besatzung zu ${funkrufname}` }).click();
  const urteil = page.locator('[data-lfh="besatzung-block"] [data-lfh="besatzung-urteil"]');
  await expect(urteil).toHaveAttribute('data-urteil', 'nicht_erfasst');

  await page.getByRole('button', { name: 'Personal der Einheit übernehmen' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText(`Personal der Einheit auf ${funkrufname}`)).toBeVisible();
  // Vorschlag bis zum Soll 0/1/1: die Unterführerin und die erste ohne Position nach Name.
  await expect(dialog.getByRole('checkbox', { name: /^Ulla Ufer/ })).toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: /^Ali Aksoy/ })).toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: /^Ben Brandt/ })).not.toBeChecked();
  await dialog.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(page.getByText('2 Kräfte als Besatzung zugeordnet', { exact: true })).toBeVisible();
  await expect(dialog).toBeHidden();

  await expect(urteil).not.toHaveAttribute('data-urteil', 'nicht_erfasst');
  await expect(urteil).toContainText('Ist');
  await expect(urteil).toContainText('Soll');

  await page.goto(`/einsaetze/${einsatzId}/etb`);
  await expect(
    page.getByText(
      `Fahrzeug «${funkrufname}»: 2 Kräfte als Besatzung zugeordnet: Ulla Ufer, Ali Aksoy`,
    ),
  ).toBeVisible();
});

/**
 * Bedien-Leitlinie, Kriterium 2 (Prüfliste LLH-1073 Teil II): im Handschuh-Modus ist jedes
 * Kästchen der Häkchenliste 72 px hoch und steht mindestens 16 px vom nächsten; am Finger
 * (`komfortabel`) 48 px und 8 px. Gemessen am Handy, wo der Dialog die ganze Breite nimmt.
 */
for (const { dichte, hoehe, abstand } of [
  { dichte: 'komfortabel', hoehe: 48, abstand: 8 },
  { dichte: 'handschuh', hoehe: 72, abstand: 16 },
] as const) {
  test(`Personal der Einheit übernehmen · ${dichte}: Kästchen ${hoehe} px, Abstand ≥ ${abstand} px`, async ({
    page,
  }) => {
    await anmeldenAlsAdmin(page);
    const { einsatzId, post, put } = await seedEinsatz(page);
    const funkrufname = 'RTW 83-9';
    const fahrzeug = await post('fahrzeuge', { adhoc: { funkrufname } });
    const einheit = await post('einheiten', { name: 'Rettungsstaffel' });
    await put(`einheiten/${einheit}/fahrzeug/${fahrzeug}`);
    for (const name of ['Ali Aksoy', 'Ben Brandt', 'Ulla Ufer']) {
      const kraft = await post('personal', { adhoc: { name } });
      await put(`einheiten/${einheit}/personal/${kraft}`);
    }
    await page.addInitScript((d) => localStorage.setItem('lifeline-hub.dichte', d), dichte);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/einsaetze/${einsatzId}/fahrzeuge`);
    await expect(page.locator('html')).toHaveAttribute('data-dichte', dichte);
    await page.getByRole('button', { name: `Besatzung zu ${funkrufname}` }).click();
    await page.getByRole('button', { name: 'Personal der Einheit übernehmen' }).click();
    const kaestchen = page.getByRole('dialog').locator('label.ant-checkbox-wrapper');
    await expect(kaestchen).toHaveCount(3);
    const boxen = await kaestchen.evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return { oben: r.top, unten: r.bottom, hoehe: r.height };
      }),
    );
    for (const b of boxen) expect(b.hoehe, 'Höhe eines Kästchens').toBeGreaterThanOrEqual(hoehe);
    for (let i = 1; i < boxen.length; i += 1)
      expect(boxen[i].oben - boxen[i - 1].unten, 'Abstand zweier Kästchen').toBeGreaterThanOrEqual(
        abstand,
      );
  });
}
