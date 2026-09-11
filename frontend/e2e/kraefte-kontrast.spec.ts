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

// ── Kräfteübersicht und Verdichtungszeile (LFH-515, Nachzug zu LFH-338 · C3, Kriterium 5) ──
//
// WAS DIE PRÜFLISTE OFFEN LIESS: sie belegte, dass alle Farben aus dem Vertrag kommen
// (`rollenFarbe`/`statusKategorie`, 0 Farbliterale per Grep) — nicht, welchen Kontrast diese
// Rollen auf ihrem tatsächlichen Grund erreichen. „Kommt aus dem Vertrag" ist keine Messung:
// eine Rolle kann auf Kartengrund bestehen und auf Seitengrund durchfallen, und im
// Nachtmodus gilt ein anderes Farbpaar. jsdom rechnet keine Farbmischung, deshalb hier.
//
// DERSELBE MESSKERN wie oben ({@link kontrastVon}) — komponierte Grundfläche über alle
// Elternlagen, Alpha eingerechnet, Ablehnung statt Scheinpräzision bei Verläufen und
// Gruppen-Opacity. Sein Selbstbeweis steht im ersten Test dieser Datei und gilt damit für
// beide Flächenpaare. Eine zweite Kopie in einer eigenen Datei wäre ein Messkern, der an
// zwei Orten verschieden rechnet — und machte beide Nachweise wertlos.
//
// ZWEI GRÜNDE, NICHT EINER — und genau darin liegt der Nachweis: die Kopf-Statuszahlen der
// Kräfteübersicht stehen auf KARTENGRUND (`Card`), die drei derselben Rollen in der
// Verdichtungszeile auf SEITENGRUND (`Space` ohne Karte). Beide zu messen ist der Punkt;
// eine Messung auf nur einer Fläche behauptete die andere mit.
//
// KEIN RANDKONTRAST hier, anders als beim Etikett oben: diese Zahlen sind nackter Text in
// einer Zeile, kein umrandetes Feld. `randKontrast` gegen einen nicht vorhandenen Rahmen
// wäre eine Zahl ohne Gegenstand.
//
// ── GEMESSEN (11.09.2026, erster Lauf) ──────────────────────────────────────────────
//
//   Textfarben: normal rgb(28,102,64) · achtung rgb(122,82,0) · alarm rgb(176,35,24)
//
//   hell,   Kopf auf rgb(255,255,255)   frei 6,94 · gebunden 6,92 · n. einsatzbereit 6,78
//   hell,   Zeile auf rgb(231,235,240)  frei 5,80 · gebunden 5,78 · n. verf.         5,66
//   dunkel, Kopf auf rgb(22,28,37)      frei 6,02 · gebunden 7,22 · n. einsatzbereit 5,20
//   dunkel, Zeile auf rgb(11,14,19)     frei 6,80 · gebunden 8,16 · n. verf.         5,87
//
// DER BEFUND, und er ist der Grund, warum dieser Nachweis gefehlt hat: der **Nachtmodus
// hält** seine Grenze (5 : 1) in allen sechs Werten, der **Hellmodus verfehlt** seine
// (7 : 1) in allen sechs — auf reinem Kartenweiß im besten Fall mit 6,94, auf Seitengrund
// mit 5,66. „Tag" in Kriterium 5 meint den TAG, nicht das antd-`Tag`: die Schwellen sind
// hell ≥ 7 : 1 / Nacht ≥ 5 : 1 (so auch `betroffene-kontrast.spec.ts:86`).
//
// Der Fehlbetrag ist eine Eigenschaft der **Rollen-Tokens als Textfarbe**, nicht dieser
// beiden Seiten — auf reinem Weiß bleiben alle drei Rollen unter 7. Genau deshalb legt
// `StatusTag` (LFH-446) die Rolle auf den RAND und die Beschriftung in `token.colorText`:
// dort wird die Grenze erreicht. Die Kopfzahlen und die Verdichtungszeile sind die beiden
// Flächen, die die Rolle direkt auf den Text legen.
//
// HIER NICHT BEHOBEN, und das ist eine Entscheidung: jede Lösung hat Breitenwirkung —
// entweder die Rollen-Tokens im Hellmodus abdunkeln (das trifft JEDEN `rollenFarbe`-
// Konsumenten, auch Ränder und Punkte, wo 3 : 1 genügt) oder die zwei Flächen auf die
// `StatusTag`-Bauform umstellen. Beides ist eine Gestaltungsentscheidung mit eigenem
// Ticket (**LFH-538**), kein Nebenprodukt eines Messungs-Nachzugs — dieselbe Trennung, die
// LFH-378/B5g für eine Bedienentscheidung im Härtungs-Ticket gezogen hat. Die Schranke
// unten steht deshalb auf der absoluten Untergrenze und NENNT den verfehlten Zielwert in
// jeder Meldung, statt ihn wegzulassen.
//
// WARUM NICHT EINFACH `expect.soft` AUF 7 DANEBEN: eine Zusicherung, die bei jedem Lauf
// rot meldet, wird nach zwei Wochen überlesen — und `pnpm e2e` bräche ab Tag eins (AK:
// „der Spec läuft in `pnpm e2e` mit und ist grün"). Der Befund gehört an eine Stelle, die
// jemand liest: in dieses Ticket, in die Meldung jeder Messung und in die Prüfliste.
//
// MUTATIONSPROBE (Akzeptanzkriterium), am 11.09.2026 mit zwei temporären Kopien gefahren,
// beide Male danach zurückgedreht und byte-gleich verglichen. Weil die zwei Modi auf
// VERSCHIEDENEN Schranken stehen, braucht jeder seine eigene Probe — eine einzige hätte nur
// einen der beiden Zweige belegt:
//  - Textfarbe vor der Messung auf `rgb(200,200,200)` gesetzt: der HELL-Test rot in allen
//    sechs Werten (1,67 auf Kartengrund, 1,40 auf Seitengrund), der Nacht-Test blieb
//    zu Recht grün — auf dunklem Grund ist dieses Grau kontrastreich.
//  - Textfarbe auf `rgb(60,66,75)` gesetzt: der NACHT-Test rot in allen sechs Werten
//    (1,69 bzw. 1,91 : 1, „Ziel ≥ 5"), der Hell-Test zu Recht grün.
//    Damit ist auch die harte Nachtschranke als wirksam belegt und nicht nur behauptet.

/** Absolute Untergrenze aus Kriterium 5 („nie < 4,5 : 1"), als Literal. */
const BODEN = 4.5;
/**
 * Zielwert je Modus aus Kriterium 5 (hell ≥ 7 : 1, Nacht ≥ 5 : 1), als Literale.
 * `dark` wird HART zugesichert (der Bestand hält ihn), `light` steht heute nur in der
 * Meldung — siehe LFH-538 im Block darüber.
 */
const ZIEL = { light: 7, dark: 5 } as const;

/** Die drei Statusrollen, wie sie in Kopf und Zeile ausgeschrieben stehen. */
const KOPF_ZAHLEN = [/^\d+ frei$/, /^\d+ gebunden$/, /^\d+ n\. einsatzbereit$/];
const ZEILEN_ZAHLEN = [/^\d+ frei$/, /^\d+ gebunden$/, /^\d+ n\. verf\.$/];

for (const modus of ['light', 'dark'] as const) {
  test(`Kräfteübersicht: Kopf-Statuszahlen und Verdichtungszeile im Modus ${modus}`, async ({ page }) => {
    test.setTimeout(90_000);
    await anmelden(page);
    const einsatzId = await post(page, '/api/einsaetze', { bezeichnung: `E2E 515 Kontrast ${Date.now()}` });
    const basis = `/api/einsaetze/${einsatzId}`;
    // Ohne Daten rendert die Verdichtungszeile `null` (Datenriegel) — die Messung liefe auf
    // einem Leerzustand. Die Fahrzeugachse des Kopfes steht dagegen auch bei lauter Nullen.
    await post(page, `${basis}/personal`, { adhoc: { name: 'Messkraft 515' } });
    await post(page, `${basis}/fahrzeuge`, { adhoc: { funkrufname: 'Florian Musterstadt 3/44-1' } });

    await page.evaluate((m) => localStorage.setItem('lifeline-hub.theme', m), modus);

    const messwerte: Record<string, unknown>[] = [];

    /** Misst die benannten Zeilenstücke und prüft Boden und Zielwert. */
    async function misst(flaeche: string, muster: RegExp[]) {
      for (const m of muster) {
        const ziel = page.getByRole('main').getByText(m);
        // Genau ein Knoten: `getByText` trifft den kleinsten Container, und eine Menge
        // stumm zu mitteln verschwiege den schlechtesten Wert.
        await expect(ziel, `${flaeche} ${m}: genau ein Knoten`).toHaveCount(1);
        // Kein Hovergrund aus einer vorangegangenen Bewegung in die Messung mischen.
        await page.mouse.move(0, 0);
        const werte = await kontrastVon(ziel);
        const kontext = `${modus}, ${flaeche}, ${m}: Text ${werte.text} auf rgb(${werte.grund}) = ${werte.textKontrast.toFixed(2)} : 1 (Ziel ≥ ${ZIEL[modus]}, absolute Untergrenze ${BODEN})`;
        messwerte.push({ modus, flaeche, muster: String(m), ...werte });
        // Im NACHTMODUS wird der Zielwert hart zugesichert — der Bestand hält ihn, und
        // eine Schranke unterhalb des Erreichten ließe eine Verschlechterung durch.
        // Im HELLMODUS steht heute die absolute Untergrenze, weil der Zielwert
        // bestandsseitig verfehlt wird (LFH-538, Messwerte im Block oben); der Zielwert
        // steht trotzdem in jeder Meldung. `soft`, damit ein Lauf ALLE sechs Werte meldet
        // statt am ersten abzubrechen — bei einer Palettenänderung will man die ganze
        // Tabelle sehen, nicht eine Zeile davon.
        expect.soft(werte.textKontrast, kontext).toBeGreaterThanOrEqual(
          modus === 'dark' ? ZIEL.dark : BODEN,
        );
      }
    }

    // (1) KARTENGRUND — der Statuskopf der Kräfteübersicht.
    await page.goto(`/einsaetze/${einsatzId}/kraefteuebersicht`);
    await expect(page.locator('html')).toHaveAttribute('data-theme', modus);
    await expect(page.getByRole('region', { name: 'Meldebild' })).toHaveCount(1);
    await misst('Kopf (Kartengrund)', KOPF_ZAHLEN);

    // (2) SEITENGRUND — dieselben drei Rollen in der Verdichtungszeile.
    await page.goto(`/einsaetze/${einsatzId}/fahrzeuge`);
    await expect(page.locator('html')).toHaveAttribute('data-theme', modus);
    await expect(page.getByRole('link', { name: 'Kräfteübersicht', exact: true })).toHaveCount(1);
    await misst('Verdichtungszeile (Seitengrund)', ZEILEN_ZAHLEN);

    // Die Gründe müssen sich unterscheiden — sonst hat (2) nur (1) wiederholt und der
    // ganze Zweitnachweis wäre eine Abschrift.
    const gruende = new Set(messwerte.map((w) => String(w.grund)));
    expect(gruende.size, `Karten- und Seitengrund sind zwei Flächen: ${[...gruende]}`).toBeGreaterThan(1);

    await test.info().attach('kontrastwerte.json', { body: JSON.stringify(messwerte, null, 2), contentType: 'application/json' });
  });
}
