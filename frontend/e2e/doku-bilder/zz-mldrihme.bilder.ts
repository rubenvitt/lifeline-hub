// Wegwerf-Spec für die PR-Bilder von LLH-2104; wird im nächsten Commit wieder entfernt.
import { expect, fotografiere, test } from './kern';
import { GRUNDKARTE, oeffneKarte } from './lagekarte-kern';

const aus = process.env.PR_NINA_AUS === '1';

test('Ebenenbaum Fachebenen', async ({ page }) => {
  await oeffneKarte(page);
  // Die Fixture-Config kennt das neue Feld nicht; den echten Wert des Backends durchreichen.
  const echt = (await (await page.request.get('/api/map/config')).json()) as {
    fachebenen_abgeschaltet: string[];
  };
  expect(echt.fachebenen_abgeschaltet).toEqual(aus ? ['nina'] : []);
  await page.route('**/api/map/config', (route) =>
    route.fulfill({
      json: {
        karten_bau_verfuegbar: false,
        offline_regionen: [],
        offline_verfuegbar: false,
        online_styles: [{ name: GRUNDKARTE.name, typ: 'vektor', url: GRUNDKARTE.stil }],
        fachebenen_abgeschaltet: echt.fachebenen_abgeschaltet,
      },
    }),
  );
  await page.reload();
  const kopf = page.getByRole('button', { name: /^Fachebenen/ });
  if ((await kopf.getAttribute('aria-expanded')) !== 'true') await kopf.click();
  const koerper = page.locator(`[id="${await kopf.getAttribute('aria-controls')}"]`);
  const zu = koerper.locator('button[aria-expanded="false"]');
  while ((await zu.count()) > 0) await zu.first().click();
  const nina = page.getByRole('switch', { name: 'Amtliche Warnungen (NINA)' });
  if (aus) await expect(nina).toHaveCount(0);
  else await expect(nina).toBeVisible();
  await page.mouse.move(0, 0);
  await fotografiere(koerper.locator('xpath=..'), 'lagekarte', aus ? 'zz-nina-aus' : 'zz-nina-an');
});
