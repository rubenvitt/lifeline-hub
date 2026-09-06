import { expect, test, type Locator, type Page } from '@playwright/test';

/** LFH-446: echte StatusTags auf Karten-/Tabellengrund, einschließlich DB-Freitext.
 * Keine Tokenimporte: getComputedStyle liefert Vordergrund und die komponierten Flächen.
 */
async function kontrastVon(ziel: Locator) {
  await expect(ziel).toHaveCount(1);
  return ziel.evaluate((el) => {
    type Farbe = [number, number, number, number];
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const farbe = (css: string): Farbe => {
      if (!CSS.supports('color', css)) throw new Error(`Nicht auflösbare Farbe: ${css}`);
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = css;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      return [r, g, b, a / 255];
    };
    const mische = (v: Farbe, h: Farbe): Farbe => {
      const a = v[3] + h[3] * (1 - v[3]);
      if (a === 0) return [0, 0, 0, 0];
      return [0, 1, 2].map((i) => (v[i] * v[3] + h[i] * h[3] * (1 - v[3])) / a).concat(a) as Farbe;
    };
    const lagen: Farbe[] = [];
    for (let knoten: Element | null = el; knoten; knoten = knoten.parentElement) {
      const s = getComputedStyle(knoten);
      // Keine scheinpräzise Zahl für nicht modellierte Gruppen-Opacity/Gradienten.
      if (s.opacity !== '1' || s.backgroundImage !== 'none') throw new Error(`Nicht ebene Fläche an ${knoten.tagName}.${knoten.className}`);
      const f = farbe(s.backgroundColor);
      lagen.push(f);
      if (f[3] === 1) break;
    }
    const grund = lagen.reverse().reduce((h, v) => mische(v, h), [0, 0, 0, 0] as Farbe);
    if (grund[3] !== 1) throw new Error('Keine opake Grundfläche gefunden');
    const luminanz = (f: Farbe) => {
      const rgb = f.slice(0, 3).map((x) => x / 255).map((x) => x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
      return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
    };
    const kontrast = (v: Farbe) => {
      const a = luminanz(mische(v, grund));
      const b = luminanz(grund);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    };
    const s = getComputedStyle(el);
    return {
      text: s.color, rand: s.borderTopColor, grund: grund.slice(0, 3),
      textKontrast: kontrast(farbe(s.color)), randKontrast: kontrast(farbe(s.borderTopColor)),
      randBreite: parseFloat(s.borderTopWidth),
    };
  });
}

async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill('admin');
  await page.getByLabel('Passwort').fill(process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw');
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

async function post(page: Page, pfad: string, data: unknown): Promise<number> {
  const r = await page.request.post(pfad, { data });
  expect(r.ok(), `${pfad}: ${r.status()} ${await r.text()}`).toBeTruthy();
  return ((await r.json()) as { id: number }).id;
}

// Mit Literalen gesät: alle fünf auf diesen Kräfteseiten erreichbaren Rollen.
const MATERIAL = [
  { status: 'einsatzbereit', rolle: 'normal' },
  { status: 'im_einsatz', rolle: 'bedien' },
  { status: 'defekt', rolle: 'alarm' },
  { status: 'desinfektion_noetig', rolle: 'achtung' },
] as const;
const FREITEXT = ['#ffffff', '#000000', 'transparent', 'rgba(255, 255, 255, 0.1)', 'oklch(95% 0.02 100)', 'keine-gueltige-farbe'] as const;

/** Der dekorative Punkt muss die Eingabe erhalten; ungültiges CSS darf keine Textfarbe erben. */
async function pruefeMandantenpunkt(punkt: Locator, eingabe: string) {
  await expect(punkt).toHaveCount(1);
  await expect(punkt).toHaveAttribute('aria-hidden', 'true');
  const farben = await punkt.evaluate((el, wert) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d')!;
    const rgba = (farbe: string) => {
      ctx.clearRect(0, 0, 1, 1);
      if (CSS.supports('color', farbe)) {
        ctx.fillStyle = farbe;
        ctx.fillRect(0, 0, 1, 1);
      }
      return [...ctx.getImageData(0, 0, 1, 1).data];
    };
    const stil = getComputedStyle(el);
    const punktfarbe = el.textContent?.trim() ? stil.color : stil.backgroundColor;
    return { ist: rgba(punktfarbe), soll: rgba(wert) };
  }, eingabe);
  expect(farben.ist, `Unverfälschte Mandantenfarbe ${eingabe}`).toEqual(farben.soll);
  const kasten = (await punkt.boundingBox())!;
  expect(kasten.width).toBeGreaterThan(0);
  expect(kasten.height).toBeGreaterThan(0);
}

test('Kontrastmesskern: opake und transparente Farben sowie eine absichtliche Kontrastverletzung', async ({ page }) => {
  await page.setContent('<main style="background:rgb(255,255,255)"><span id="probe" style="color:rgba(0,0,0,.5);background:transparent;border:1px solid black">Probe</span></main>');
  const ziel = page.locator('#probe');
  const halb = await kontrastVon(ziel);
  expect(halb.textKontrast).toBeGreaterThan(3.9);
  expect(halb.textKontrast).toBeLessThan(4.1);
  expect(halb.randKontrast).toBe(21);
  await ziel.evaluate((el) => { el.style.color = 'white'; });
  expect((await kontrastVon(ziel)).textKontrast).toBe(1);
  await ziel.evaluate((el) => { el.style.color = 'black'; });
  expect((await kontrastVon(ziel)).textKontrast).toBe(21);
});

for (const modus of ['light', 'dark']) {
  test(`Kräfte: Statuswortlaut und tragender Rand auf Karte/Tabelle im Modus ${modus}`, async ({ page }) => {
    test.setTimeout(120_000);
    await anmelden(page);
    const lauf = Date.now();
    const einsatzId = await post(page, '/api/einsaetze', { bezeichnung: `E2E 446 Kontrast ${lauf}` });
    const basis = `/api/einsaetze/${einsatzId}`;
    const faelle: { modul: string; kennung: string; rolle: string; farbe?: string; label?: string }[] = [];
    for (const { status, rolle } of MATERIAL) {
      const kennung = `Messmaterial ${status}`;
      const id = await post(page, `${basis}/material`, { adhoc: { bezeichnung: kennung }, menge: 1 });
      const r = await page.request.patch(`${basis}/material/${id}`, { data: { status } });
      expect(r.ok(), await r.text()).toBeTruthy();
      faelle.push({ modul: 'material', kennung, rolle });
    }
    for (const [modul, katalog, feld] of [['fahrzeuge', 'fahrzeug-status', 'funkrufname'], ['personal', 'personal-status', 'name']] as const) {
      const neutral = `Messkraft ${modul} neutral`;
      const neutralId = await post(page, `${basis}/${modul}`, { adhoc: { [feld]: neutral } });
      // Die API-Typen erlauben einen fehlenden Status. Neue Dispositionen erhalten jedoch
      // einen Default, und PATCH kann ihn nicht löschen. Nur diesen Null-Fall als gültige
      // Wire-Antwort injizieren; alle anderen Zeilen/Statusfarben kommen aus der Test-DB.
      await page.route(`**${basis}/${modul}`, async (route) => {
        const antwort = await route.fetch();
        const zeilen = (await antwort.json()) as { id: number }[];
        await route.fulfill({ response: antwort, json: zeilen.map((z) => z.id === neutralId
          ? { ...z, status_id: null, status_label: null, status_kategorie: null, status_farbe: null }
          : z) });
      });
      faelle.push({ modul, kennung: neutral, rolle: 'neutral' });
      for (const [i, farbe] of FREITEXT.entries()) {
        const kennung = `Messkraft ${modul} ${i}`;
        const label = `Messstatus 446 ${lauf} ${i}`;
        const statusId = await post(page, `/api/${katalog}`, { label, kategorie: 'verfuegbar', farbe });
        const id = await post(page, `${basis}/${modul}`, { adhoc: { [feld]: kennung } });
        const r = await page.request.patch(`${basis}/${modul}/${id}`, { data: { status_id: statusId } });
        expect(r.ok(), await r.text()).toBeTruthy();
        faelle.push({ modul, kennung, rolle: 'normal', farbe, label });
      }
    }
    await page.evaluate((m) => localStorage.setItem('lifeline-hub.theme', m), modus);
    const messwerte = [];
    for (const breite of [1366, 390]) {
      await page.setViewportSize({ width: breite, height: 844 });
      for (const modul of ['material', 'fahrzeuge', 'personal']) {
        await page.goto(`/einsaetze/${einsatzId}/${modul}`);
        await expect(page.locator('html')).toHaveAttribute('data-theme', modus);
        const main = page.getByRole('main');
        const fallmenge = faelle.filter((f) => f.modul === modul);
        const zweig = breite === 390 ? '[data-lfh="datensicht-karte"]' : 'tr.ant-table-row';
        await expect(main.locator(zweig)).toHaveCount(fallmenge.length);
        for (const fall of fallmenge) {
          const knopf = main.getByRole('button', { name: `Status von ${fall.kennung} ändern`, exact: true });
          const etikett = knopf.locator('.ant-tag');
          await expect(etikett).toHaveAttribute('data-rolle', fall.rolle);
          // Kein Hovergrund aus einer vorausgehenden Interaktion in die Messung mischen.
          await page.mouse.move(0, 0);
          const werte = await kontrastVon(etikett);
          if (fall.farbe) {
            const signatur = etikett.locator('[data-lfh="mandantenfarbe"]');
            await pruefeMandantenpunkt(signatur, fall.farbe);
            // Beliebiger Freitext darf nur die Dekoration beeinflussen. Das Löschen des
            // Farbpunktes verändert deshalb weder Text- noch Rahmenkontrast.
            await signatur.evaluate((el) => el.remove());
            expect(await kontrastVon(etikett)).toEqual(werte);
            await knopf.click();
            const menue = page.getByRole('menuitem', { name: fall.label, exact: true });
            await expect(menue).toBeVisible();
            await pruefeMandantenpunkt(menue.locator('[aria-hidden="true"]'), fall.farbe);
            await page.keyboard.press('Escape');
            await expect(menue).not.toBeVisible();
          }
          const kontext = `${modus}, ${breite}px, ${fall.kennung}, ${fall.farbe ?? fall.rolle}: ${JSON.stringify(werte)}`;
          messwerte.push({ modus, breite, ...fall, ...werte });
          expect.soft(werte.textKontrast, kontext).toBeGreaterThanOrEqual(modus === 'light' ? 7 : 5);
          expect.soft(werte.randBreite, kontext).toBeGreaterThan(0);
          expect.soft(werte.randKontrast, kontext).toBeGreaterThanOrEqual(3);
        }
      }
    }
    await test.info().attach('kontrastwerte.json', { body: JSON.stringify(messwerte, null, 2), contentType: 'application/json' });
  });
}
