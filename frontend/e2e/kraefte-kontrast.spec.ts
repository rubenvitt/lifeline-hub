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
      if (s.opacity !== '1' || s.backgroundImage !== 'none')
        throw new Error(`Nicht ebene Fläche an ${knoten.tagName}.${knoten.className}`);
      const f = farbe(s.backgroundColor);
      lagen.push(f);
      if (f[3] === 1) break;
    }
    const grund = lagen.reverse().reduce((h, v) => mische(v, h), [0, 0, 0, 0] as Farbe);
    if (grund[3] !== 1) throw new Error('Keine opake Grundfläche gefunden');
    const luminanz = (f: Farbe) => {
      const rgb = f
        .slice(0, 3)
        .map((x) => x / 255)
        .map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
      return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
    };
    const kontrast = (v: Farbe) => {
      const a = luminanz(mische(v, grund));
      const b = luminanz(grund);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    };
    const s = getComputedStyle(el);
    return {
      text: s.color,
      rand: s.borderTopColor,
      grund: grund.slice(0, 3),
      textKontrast: kontrast(farbe(s.color)),
      randKontrast: kontrast(farbe(s.borderTopColor)),
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
const FREITEXT = [
  '#ffffff',
  '#000000',
  'transparent',
  'rgba(255, 255, 255, 0.1)',
  'oklch(95% 0.02 100)',
  'keine-gueltige-farbe',
] as const;

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

test('Kontrastmesskern: opake und transparente Farben sowie eine absichtliche Kontrastverletzung', async ({
  page,
}) => {
  await page.setContent(
    '<main style="background:rgb(255,255,255)"><span id="probe" style="color:rgba(0,0,0,.5);background:transparent;border:1px solid black">Probe</span></main>',
  );
  const ziel = page.locator('#probe');
  const halb = await kontrastVon(ziel);
  expect(halb.textKontrast).toBeGreaterThan(3.9);
  expect(halb.textKontrast).toBeLessThan(4.1);
  expect(halb.randKontrast).toBe(21);
  await ziel.evaluate((el) => {
    el.style.color = 'white';
  });
  expect((await kontrastVon(ziel)).textKontrast).toBe(1);
  await ziel.evaluate((el) => {
    el.style.color = 'black';
  });
  expect((await kontrastVon(ziel)).textKontrast).toBe(21);
});

for (const modus of ['light', 'dark']) {
  test(`Kräfte: Statuswortlaut und tragender Rand auf Karte/Tabelle im Modus ${modus}`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await anmelden(page);
    const lauf = Date.now();
    const einsatzId = await post(page, '/api/einsaetze', {
      bezeichnung: `E2E 446 Kontrast ${lauf}`,
    });
    const basis = `/api/einsaetze/${einsatzId}`;
    const faelle: {
      modul: string;
      kennung: string;
      rolle: string;
      farbe?: string;
      label?: string;
    }[] = [];
    for (const { status, rolle } of MATERIAL) {
      const kennung = `Messmaterial ${status}`;
      const id = await post(page, `${basis}/material`, {
        adhoc: { bezeichnung: kennung },
        menge: 1,
      });
      const r = await page.request.patch(`${basis}/material/${id}`, { data: { status } });
      expect(r.ok(), await r.text()).toBeTruthy();
      faelle.push({ modul: 'material', kennung, rolle });
    }
    for (const [modul, katalog, feld] of [
      ['fahrzeuge', 'fahrzeug-status', 'funkrufname'],
      ['personal', 'personal-status', 'name'],
    ] as const) {
      const neutral = `Messkraft ${modul} neutral`;
      const neutralId = await post(page, `${basis}/${modul}`, { adhoc: { [feld]: neutral } });
      // Die API-Typen erlauben einen fehlenden Status. Neue Dispositionen erhalten jedoch
      // einen Default, und PATCH kann ihn nicht löschen. Nur diesen Null-Fall als gültige
      // Wire-Antwort injizieren; alle anderen Zeilen/Statusfarben kommen aus der Test-DB.
      await page.route(`**${basis}/${modul}`, async (route) => {
        const antwort = await route.fetch();
        const zeilen = (await antwort.json()) as { id: number }[];
        await route.fulfill({
          response: antwort,
          json: zeilen.map((z) =>
            z.id === neutralId
              ? {
                  ...z,
                  status_id: null,
                  status_label: null,
                  status_kategorie: null,
                  status_farbe: null,
                }
              : z,
          ),
        });
      });
      faelle.push({ modul, kennung: neutral, rolle: 'neutral' });
      for (const [i, farbe] of FREITEXT.entries()) {
        const kennung = `Messkraft ${modul} ${i}`;
        const label = `Messstatus 446 ${lauf} ${i}`;
        const statusId = await post(page, `/api/${katalog}`, {
          label,
          kategorie: 'verfuegbar',
          farbe,
        });
        const id = await post(page, `${basis}/${modul}`, { adhoc: { [feld]: kennung } });
        const r = await page.request.patch(`${basis}/${modul}/${id}`, {
          data: { status_id: statusId },
        });
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
          const knopf = main.getByRole('button', {
            name: `Status von ${fall.kennung} ändern`,
            exact: true,
          });
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
          expect
            .soft(werte.textKontrast, kontext)
            .toBeGreaterThanOrEqual(modus === 'light' ? 7 : 5);
          expect.soft(werte.randBreite, kontext).toBeGreaterThan(0);
          expect.soft(werte.randKontrast, kontext).toBeGreaterThanOrEqual(3);
        }
      }
    }
    await test.info().attach('kontrastwerte.json', {
      body: JSON.stringify(messwerte, null, 2),
      contentType: 'application/json',
    });
  });
}

// ── Meldebild und Verdichtungszeile (LFH-515, Nachzug zu LFH-338 · C3, Kriterium 5) ──
//
// DERSELBE MESSKERN wie oben ({@link kontrastVon}) — komponierte Grundfläche über alle
// Elternlagen, Alpha eingerechnet, Ablehnung statt Scheinpräzision bei Verläufen und
// Gruppen-Opacity. Eine zweite Kopie in einer eigenen Datei wäre ein Messkern, der an zwei
// Orten verschieden rechnet.
//
// ZWEI FLÄCHEN, NICHT EINE:
//
// (1) DAS STATUSBAND DES MELDEBILDS (Neuentwurf S6, 21.09.2026). Bis dahin standen hier die
//     Kopf-Statuszahlen der Kräfteübersicht als Rollenfarbe auf KARTENGRUND — und verfehlten
//     im Hellmodus die 7 : 1 in allen Werten (LFH-538, Messwerte 11.09.2026: 6,78–6,94). Das
//     Band stellt seine Zellen seit der Nacharbeit vom 22.09.2026 auf die NEUTRALE Fläche
//     (`flaeche`) und trägt den Ton nur im 8-px-Quadrat und in der Zahl; die Zahlfarbe
//     steht in `components/instrument/Kennzahl.tsx` (`zahlFarbe`; Tag: normalText 9,18 ·
//     achtungText 9,22 · alarmText 8,96 seit LFH-618, vorher wich der Tag auf `text` aus;
//     Wort `gedaempft` 8,42; Nacht: 10,92 · 11,75 · 6,77, Wort 7,27). Deshalb
//     wird hier in BEIDEN Modi der Zielwert HART zugesichert — für diese Fläche ist LFH-538
//     mit dem Umbau eingelöst.
//
// (2) DIE VERDICHTUNGSZEILE der Kräfte-Modulseiten auf SEITENGRUND: unverändert Rolle auf
//     Text, im Hellmodus weiter unter 7 (LFH-538 offen) — dort steht die absolute
//     Untergrenze, der Zielwert steht in jeder Meldung. `soft`, damit ein Lauf alle Werte
//     meldet statt am ersten abzubrechen.
//
// KEIN RANDKONTRAST: beides sind Textflächen ohne Rahmen; der Farbpunkt im Band ist Zierde
// neben einem Code UND einem Wort, kein alleiniger Bedeutungsträger.

/** Absolute Untergrenze aus Kriterium 5 („nie < 4,5 : 1"), als Literal. */
const BODEN = 4.5;
/** Zielwert je Modus aus Kriterium 5 (hell ≥ 7 : 1, Nacht ≥ 5 : 1), als Literale. */
const ZIEL = { light: 7, dark: 5 } as const;

/** Die drei Statusrollen, wie sie in der Verdichtungszeile ausgeschrieben stehen. */
const ZEILEN_ZAHLEN = [/^\d+ frei$/, /^\d+ gebunden$/, /^\d+ n\. verf\.$/];

/** Die drei Kategorien des Fahrzeugkatalogs und der Ton, den das Band ihnen gibt. */
const BAND_TOENE = [
  { kategorie: 'verfuegbar', ton: 'normal' },
  { kategorie: 'gebunden', ton: 'achtung' },
  { kategorie: 'nicht_verfuegbar', ton: 'alarm' },
] as const;

for (const modus of ['light', 'dark'] as const) {
  test(`Meldebild: Statusband und Verdichtungszeile im Modus ${modus}`, async ({ page }) => {
    test.setTimeout(90_000);
    await anmelden(page);
    const einsatzId = await post(page, '/api/einsaetze', {
      bezeichnung: `E2E 515 Kontrast ${Date.now()}`,
    });
    const basis = `/api/einsaetze/${einsatzId}`;
    // Ohne Daten rendert die Verdichtungszeile `null` (Datenriegel) und das Band nur einen
    // Leerzustand — die Messung liefe ins Nichts.
    await post(page, `${basis}/personal`, { adhoc: { name: 'Messkraft 515' } });

    // Je Kategorie ein Fahrzeug mit einem Katalogstatus dieser Kategorie — sonst stünde im
    // Band nur der Default-Status neuer Dispositionen, und zwei der drei Töne blieben
    // ungemessen.
    const katalogAntwort = await page.request.get('/api/fahrzeug-status');
    expect(katalogAntwort.ok(), await katalogAntwort.text()).toBeTruthy();
    const katalog = (await katalogAntwort.json()) as { id: number; kategorie: string }[];
    for (const [i, { kategorie }] of BAND_TOENE.entries()) {
      const status = katalog.find((k) => k.kategorie === kategorie);
      expect(status, `Katalog ohne Status der Kategorie ${kategorie}`).toBeDefined();
      const id = await post(page, `${basis}/fahrzeuge`, {
        adhoc: { funkrufname: `Florian Musterstadt 3/44-${i + 1}` },
      });
      const r = await page.request.patch(`${basis}/fahrzeuge/${id}`, {
        data: { status_id: status!.id },
      });
      expect(r.ok(), await r.text()).toBeTruthy();
    }

    await page.evaluate((m) => localStorage.setItem('lifeline-hub.theme', m), modus);

    const messwerte: Record<string, unknown>[] = [];

    async function pruefe(ziel: Locator, flaeche: string, beschreibung: string, schranke: number) {
      await page.mouse.move(0, 0);
      const werte = await kontrastVon(ziel);
      const kontext = `${modus}, ${flaeche}, ${beschreibung}: Text ${werte.text} auf rgb(${werte.grund}) = ${werte.textKontrast.toFixed(2)} : 1 (Ziel ≥ ${ZIEL[modus]}, absolute Untergrenze ${BODEN})`;
      messwerte.push({ modus, flaeche, beschreibung, ...werte });
      expect.soft(werte.textKontrast, kontext).toBeGreaterThanOrEqual(schranke);
    }

    // (1) STATUSBAND — Zahl und Wort je Ton, auf der neutralen Zellfläche (Nacharbeit
    // 22.09.2026: der Ton steht nur noch im Quadrat und in der Zahl). Die Zellen sind seit
    // dem Umbau `Kennzahl`-Bausteine: Marke `kennzahl` mit `data-ton`, Zahl `kennzahl-wert`,
    // das Wort ist die Notiz (`kennzahl-notiz`).
    await page.goto(`/einsaetze/${einsatzId}/kraefteuebersicht`);
    await expect(page.locator('html')).toHaveAttribute('data-theme', modus);
    await expect(page.getByRole('region', { name: 'Meldebild' })).toHaveCount(1);
    const band = page.getByRole('region', { name: 'Fahrzeuge je Status' });
    for (const { ton } of BAND_TOENE) {
      // `.first()` ist hier KEINE Mittelung: mehrere Katalogstatus derselben Kategorie
      // tragen dieselbe Fläche und dieselbe Textfarbe, das Paar ist also eines.
      const zelle = band.locator(`[data-lfh="kennzahl"][data-ton="${ton}"]`).first();
      await expect(zelle, `Bandzelle mit Ton ${ton}`).toHaveCount(1);
      await pruefe(
        zelle.locator('[data-lfh="kennzahl-wert"]'),
        'Statusband',
        `Zahl ${ton}`,
        ZIEL[modus],
      );
      await pruefe(
        zelle.locator('[data-lfh="kennzahl-notiz"]'),
        'Statusband',
        `Wort ${ton}`,
        ZIEL[modus],
      );
    }

    // (2) SEITENGRUND — dieselben drei Rollen in der Verdichtungszeile.
    await page.goto(`/einsaetze/${einsatzId}/fahrzeuge`);
    await expect(page.locator('html')).toHaveAttribute('data-theme', modus);
    await expect(page.getByRole('link', { name: 'Meldebild', exact: true })).toHaveCount(1);
    for (const m of ZEILEN_ZAHLEN) {
      const ziel = page.getByRole('main').getByText(m);
      await expect(ziel, `Verdichtungszeile ${m}: genau ein Knoten`).toHaveCount(1);
      await pruefe(
        ziel,
        'Verdichtungszeile (Seitengrund)',
        String(m),
        modus === 'dark' ? ZIEL.dark : BODEN,
      );
    }

    // Die Gründe müssen sich unterscheiden — sonst hat (2) nur (1) wiederholt.
    const gruende = new Set(messwerte.map((w) => String(w.grund)));
    expect(
      gruende.size,
      `Band- und Seitengrund sind verschiedene Flächen: ${[...gruende]}`,
    ).toBeGreaterThan(1);

    await test.info().attach('kontrastwerte.json', {
      body: JSON.stringify(messwerte, null, 2),
      contentType: 'application/json',
    });
  });
}
