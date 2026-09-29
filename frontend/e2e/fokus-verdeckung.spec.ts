import { expect, test, type Page } from '@playwright/test';
import {
  detailBereit,
  einheitMitZuordnungen,
  kopfFelder,
  zuordnungsKarte,
} from './einheit-fixture';
import { pruefeFokusVerdeckung, type Verdeckungsbefund } from './fokus-kern';

/**
 * Prüflisten-Zeile Z13 der Bedien-Leitlinie — WCAG 2.4.11 „Focus Not Obscured (Minimum)":
 * ein fokussiertes Ziel darf nicht VOLLSTÄNDIG von autoreneigenem Inhalt verdeckt sein.
 * Gemessen an stehenden Kopfzeilen, fixierten Spalten, angepinnten Leisten und
 * Kartenaufbauten; jsdom rechnet kein Layout, deshalb im Browser.
 *
 * Der Messkern liegt in `./fokus-kern`; sein Selbstbeweis (erster Test) ist die Gegenprobe,
 * ohne die „grün" nichts belegt.
 *
 * Seeding per `page.request` (teilt den Cookie-Jar des Kontexts).
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

async function einsatzAnlegen(page: Page, name: string): Promise<string> {
  await page.getByRole('button', { name: 'Neuer Einsatz' }).click();
  await page.getByLabel('Bezeichnung').fill(name);
  await page.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze\/\d+/);
  return page.url().match(/\/einsaetze\/(\d+)/)![1];
}

test('Selbstbeweis: der Messkern meldet eine erfundene Verdeckung', async ({ page }) => {
  // Der Messkern braucht einen Fall, der rot ist, solange er falsch rechnet — unabhängig von
  // jeder Produktfläche.
  await anmelden(page);
  await page.setViewportSize({ width: 390, height: 400 });
  await page.goto('/admin/benutzer');
  await expect(page.locator('tr.ant-table-row').first()).toBeVisible();

  await page.addStyleTag({
    content: `.e2e-verdecker { position: fixed; inset-block-start: 0; inset-inline: 0;
                                block-size: 100vh; background: #000; z-index: 2000; }`,
  });
  await page.evaluate(() =>
    document.body.append(
      Object.assign(document.createElement('div'), { className: 'e2e-verdecker' }),
    ),
  );

  const probe = await pruefeFokusVerdeckung(page, 10);
  expect(
    probe.stoppsGesamt,
    'Vorbedingung: der Durchlauf muss überhaupt irgendwo landen',
  ).toBeGreaterThan(0);
  expect(
    probe.verdeckt.length,
    `der Messkern muss eine echte Verdeckung finden (${probe.stoppsGesamt} Stopps, ` +
      `${probe.fixierteKandidaten} fixierte Kandidaten)`,
  ).toBeGreaterThan(0);
});

test('Selbstbeweis (LFH-373): Zusatzkandidaten machen einen ABSOLUTEN Verdecker sichtbar — ohne sie nicht', async ({
  page,
}) => {
  // Kartenaufbauten sind `position: absolute`, die Vorgabe des Kerns wertet nur
  // `sticky|fixed`. Belegt beide Hälften des Opt-ins: MIT `zusatzKandidaten` findet der Kern
  // die Verdeckung, OHNE nicht — die Vorgabe enthält die Option also nicht still mit.
  await anmelden(page);
  await page.setViewportSize({ width: 390, height: 400 });

  const laufMitAttrappe = async (optionen?: { zusatzKandidaten: string[] }) => {
    await page.goto('/admin/benutzer');
    await expect(page.locator('tr.ant-table-row').first()).toBeVisible();
    // Über das GANZE Dokument, sonst hinge der Befund an der Scrollposition.
    await page.evaluate(() => {
      const hoehe = document.scrollingElement!.scrollHeight;
      document.body.append(
        Object.assign(document.createElement('div'), {
          className: 'e2e-absolut-verdecker',
          style: `position:absolute;top:0;left:0;width:100%;height:${hoehe}px;background:#000;z-index:2000`,
        }),
      );
    });
    return pruefeFokusVerdeckung(page, 10, 'Tab', optionen);
  };

  const ohne = await laufMitAttrappe();
  const mit = await laufMitAttrappe({ zusatzKandidaten: ['.e2e-absolut-verdecker'] });
  expect(mit.stoppsGesamt, 'Vorbedingung: der Durchlauf muss irgendwo landen').toBeGreaterThan(0);
  expect(
    mit.verdeckt.length,
    `mit Zusatzkandidat muss der Kern die absolute Attrappe finden (${mit.stoppsGesamt} Stopps)`,
  ).toBeGreaterThan(0);
  expect(
    ohne.verdeckt,
    'ohne Zusatzkandidat bleibt der absolute Verdecker unsichtbar — die Vorgabe ist unverändert',
  ).toEqual([]);
});

test('Selbstbeweis (LFH-811): `beschnitt` meldet ein ganz abgeschnittenes Ziel — ohne die Option nicht', async ({
  page,
}) => {
  // Ein Band, das Höhe abgibt und in sich rollt, verdeckt nicht, es SCHNEIDET AB. Die Attrappe
  // ist ein Knopf in einer Hülle ohne Höhe mit `overflow: hidden`, als erstes Tabulaturziel.
  await anmelden(page);
  await page.setViewportSize({ width: 390, height: 400 });

  const laufMitAttrappe = async (optionen?: { beschnitt: boolean }) => {
    await page.goto('/admin/benutzer');
    await expect(page.locator('tr.ant-table-row').first()).toBeVisible();
    await page.evaluate(() => {
      const huelle = Object.assign(document.createElement('div'), {
        style: 'overflow:hidden;height:0',
      });
      const knopf = Object.assign(document.createElement('button'), { textContent: 'Attrappe' });
      knopf.setAttribute('data-e2e-fokus', 'attrappe');
      huelle.append(knopf);
      document.body.prepend(huelle);
      (document.activeElement as HTMLElement | null)?.blur();
    });
    return pruefeFokusVerdeckung(page, 1, 'Tab', optionen);
  };

  const ohne = await laufMitAttrappe();
  const mit = await laufMitAttrappe({ beschnitt: true });
  // Vorbedingung für BEIDE Hälften: der eine Tab landet auf der Attrappe.
  expect(ohne.besuchteZiele, 'ohne: der Tab landet auf der Attrappe').toEqual(['attrappe']);
  expect(mit.besuchteZiele, 'mit: der Tab landet auf der Attrappe').toEqual(['attrappe']);
  expect(mit.verdeckt.join('\n'), 'mit `beschnitt` findet der Kern die Attrappe').toMatch(
    /Attrappe.*abgeschnitten/,
  );
  expect(ohne.verdeckt, 'ohne `beschnitt` bleibt die Vorgabe unverändert').toEqual([]);
});

test('Katalogtabelle: Tabulaturdurchlauf hinter stehender Kopfzeile und fixierter erster Spalte', async ({
  page,
}) => {
  await anmelden(page);

  // `/admin/benutzer` statt einer kleinen Stammdatenliste: erst sechs Spalten geben der
  // fixierten Spalte einen waagerechten Bildlaufweg.
  const LAUF = Date.now();
  for (let i = 0; i < 8; i += 1) {
    const antwort = await page.request.post('/api/benutzer', {
      data: {
        anzeigename: `E2E Fokus ${LAUF}-${i}`,
        benutzername: `e2e-fokus-${LAUF}-${i}`,
        passwort: 'e2e-fokus-pw-123',
      },
    });
    expect(
      antwort.ok(),
      `Seeding Benutzer ${i}: ${antwort.status()} ${await antwort.text()}`,
    ).toBeTruthy();
  }

  // Höhe bewusst verkürzt: die Bildlaufreserve ist die Vorbedingung dieses Nachweises.
  await page.setViewportSize({ width: 390, height: 400 });
  await page.goto('/admin/benutzer');

  /**
   * MINDESTENS 9 Zeilen (8 gesät + Harness-Admin), nicht genau 9: die Benutzerliste ist
   * global und die Temp-DB lebt über den ganzen Lauf, jede Wiederholung sät acht weitere.
   * Gebraucht wird nur die Untergrenze, sie trägt die Bildlaufreserve.
   */
  // `expect.poll` statt `count()`: die Liste steht erst nach ihrem Abruf (in CI mit
  // „Received: 0" gesehen).
  await expect
    .poll(() => page.locator('tr.ant-table-row').count(), {
      message: 'Vorbedingung: mindestens 8 gesäte Zeilen + Harness-Admin',
    })
    .toBeGreaterThanOrEqual(9);

  // ── VORBEDINGUNGEN. Ohne sie ist „0 verdeckte Ziele" trivial wahr.
  const kopf = page.locator('.ant-table-sticky-holder');
  await expect(kopf).toHaveCount(1);
  await expect(kopf, 'Vorbedingung: die Kopfzeile muss überhaupt stehen').toHaveCSS(
    'position',
    'sticky',
  );
  const kopfHoehe = (await kopf.boundingBox())!.height;
  const reserve = await page.evaluate(
    () => document.documentElement.scrollHeight - window.innerHeight,
  );
  expect(
    reserve,
    `Vorbedingung: die Bildlaufreserve (${reserve}px) muss die Kopfzeile (${kopfHoehe}px) überschreiten — ` +
      'sonst kann keine Zeile unter den Kopf wandern und die Aussage ist leer',
  ).toBeGreaterThan(kopfHoehe);

  // Wirklich unter den Kopf scrollen; am Dokumentanfang trifft der Lauf die Fixierung nicht.
  await page.evaluate((z) => window.scrollTo(0, z), Math.round(reserve / 2));

  const ergebnis = await pruefeFokusVerdeckung(page, 60);
  expect(
    ergebnis.fixierteKandidaten,
    'Vorbedingung: es muss mindestens einen fixierten Knoten geben, hinter dem etwas liegen KÖNNTE',
  ).toBeGreaterThan(0);
  expect(
    ergebnis.stoppsInTabelle,
    `Vorbedingung: der Durchlauf muss überhaupt in der Tabelle landen (${ergebnis.stoppsGesamt} Stopps gesamt) — ` +
      'eine Tabelle ohne fokussierbare Zellen wäre grün, indem der Durchlauf an ihr vorbeiläuft',
  ).toBeGreaterThanOrEqual(4);

  expect(
    ergebnis.verdeckt,
    `Fokusziele vollständig verdeckt:\n${ergebnis.verdeckt.join('\n')}`,
  ).toEqual([]);

  test.info().annotations.push({
    type: 'messwert',
    description:
      `Katalogtabelle 390×400: ${ergebnis.stoppsGesamt} Stopps, davon ${ergebnis.stoppsInTabelle} ` +
      `in der Tabelle, ${ergebnis.fixierteKandidaten} fixierte Knoten, Reserve ${reserve}px, ` +
      `Kopf ${kopfHoehe}px`,
  });
});

test('Datensicht-Tabellenzweig: Tabulaturdurchlauf hinter Werkzeugzeile, Kopfzeile und fixierter Spalte', async ({
  page,
}) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Fokus B2 ${Date.now()}`);
  for (let i = 0; i < 12; i += 1) {
    const antwort = await page.request.post(`/api/einsaetze/${einsatzId}/personal`, {
      data: {
        adhoc: {
          name: `Kirchgassner-Wohlfahrt, Maximiliane ${i}`,
          funktion: 'Abschnittsleitung Technische Hilfeleistung',
          traegerorganisation: 'Freiwillige Feuerwehr Musterstadt-Nordwest',
        },
      },
    });
    expect(
      antwort.ok(),
      `Seeding Kraft ${i}: ${antwort.status()} ${await antwort.text()}`,
    ).toBeTruthy();
  }

  // 1366 px, damit der TABELLENZWEIG läuft (`form="auto"` schaltet unter `md` auf Karten);
  // Höhe verkürzt für die Bildlaufreserve.
  await page.setViewportSize({ width: 1366, height: 520 });
  await page.goto(`/einsaetze/${einsatzId}/personal`);

  // Belegt, dass hier wirklich der Tabellenzweig gemessen wird und nicht der Kartenzweig.
  await expect(page.locator('.ant-table')).toHaveCount(1);
  await expect(page.locator('[data-lfh="datensicht-karte"]')).toHaveCount(0);
  await expect(page.locator('tr.ant-table-row')).toHaveCount(12);

  const kopf = page.locator('.ant-table-sticky-holder');
  await expect(kopf).toHaveCSS('position', 'sticky');
  const kopfHoehe = (await kopf.boundingBox())!.height;
  const reserve = await page.evaluate(
    () => document.documentElement.scrollHeight - window.innerHeight,
  );
  expect(
    reserve,
    `Vorbedingung: Bildlaufreserve (${reserve}px) über Kopfhöhe (${kopfHoehe}px)`,
  ).toBeGreaterThan(kopfHoehe);
  await page.evaluate((z) => window.scrollTo(0, z), Math.round(reserve / 2));

  const ergebnis = await pruefeFokusVerdeckung(page, 60);
  expect(ergebnis.fixierteKandidaten, 'Vorbedingung: fixierte Knoten vorhanden').toBeGreaterThan(0);
  // Höher als in der Katalogtabelle: Spaltenschalter, Suchfeld, Filter und Sortierauslöser
  // kommen als Fokusziele dazu. Eine zu niedrige Schwelle ließe einen streifenden Lauf durch.
  expect(
    ergebnis.stoppsInTabelle,
    `Vorbedingung: Durchlauf muss in der Tabelle landen (${ergebnis.stoppsGesamt} Stopps gesamt)`,
  ).toBeGreaterThanOrEqual(8);

  expect(
    ergebnis.verdeckt,
    `Fokusziele vollständig verdeckt:\n${ergebnis.verdeckt.join('\n')}`,
  ).toEqual([]);

  test.info().annotations.push({
    type: 'messwert',
    description:
      `Datensicht 1366×520: ${ergebnis.stoppsGesamt} Stopps, davon ${ergebnis.stoppsInTabelle} ` +
      `in der Tabelle, ${ergebnis.fixierteKandidaten} fixierte Knoten, Reserve ${reserve}px, ` +
      `Kopf ${kopfHoehe}px`,
  });
});

/**
 * Die sticky Speicherleiste der Einstellungs-Sektionen: eine am unteren Rand verankerte
 * Leiste über einem langen Formular. „Verhalten" ist der scharfe Fall — das letzte von neun
 * Feldern steht unmittelbar über der Leiste.
 */
test('Einstellungen: Tabulaturdurchlauf unter der sticky Speicherleiste', async ({ page }) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `Fokus Einstellungen ${Date.now()}`);

  // Ohne Bildlaufreserve klebt die Leiste am Seitenende statt über dem Inhalt.
  await page.setViewportSize({ width: 390, height: 420 });
  await page.goto(`/einsaetze/${einsatzId}/einstellungen/verhalten`);
  await expect(page.getByLabel('Präfix ETB')).toBeVisible();

  const reserve = await page.evaluate(
    () => document.documentElement.scrollHeight - document.documentElement.clientHeight,
  );
  expect(reserve, 'Vorbedingung: die Seite muss überhaupt scrollen').toBeGreaterThan(0);

  const ergebnis = await pruefeFokusVerdeckung(page, 40);

  expect(
    ergebnis.fixierteKandidaten,
    'Vorbedingung: die sticky Speicherleiste muss im Baum stehen',
  ).toBeGreaterThanOrEqual(1);

  expect(
    ergebnis.stoppsGesamt,
    'Vorbedingung: der Durchlauf muss die Formularfelder erreichen',
  ).toBeGreaterThanOrEqual(8);

  expect(
    ergebnis.verdeckt,
    `Fokusziele vollständig verdeckt:\n${ergebnis.verdeckt.join('\n')}`,
  ).toEqual([]);

  test.info().annotations.push({
    type: 'messwert',
    description:
      `Einstellungen/verhalten 390×420: ${ergebnis.stoppsGesamt} Stopps, ` +
      `${ergebnis.fixierteKandidaten} fixierte Knoten, Reserve ${reserve}px`,
  });
});

/** Besuchsnachweise gehören zur Route, allgemeine Stopps zählen auch die Navigation. */
async function einheitFokusBereit(page: Page, dichte: string) {
  await anmelden(page);
  const { pfad } = await einheitMitZuordnungen(page);
  await page.evaluate((wert) => localStorage.setItem('lifeline-hub.dichte', wert), dichte);
  await page.goto(pfad);
  await expect(page.locator('html')).toHaveAttribute('data-dichte', dichte);
  await detailBereit(page);
  const ziele = kopfFelder(page).map(({ name, fokus }) => ({ name, fokus }));
  for (const name of ['Speichern', 'Auflösen']) {
    ziele.push({ name, fokus: page.getByRole('main').getByRole('button', { name, exact: true }) });
  }
  ziele.push({
    name: 'neue Sprechgruppe anlegen',
    fokus: page.getByRole('main').getByRole('button', { name: /neue Sprechgruppe anlegen$/ }),
  });
  for (const titel of ['Personal', 'Fahrzeuge', 'Material']) {
    const karte = zuordnungsKarte(page, titel);
    ziele.push({
      name: `${titel} entfernen`,
      fokus: karte.getByRole('button', { name: 'Entfernen', exact: true }),
    });
    ziele.push({ name: `${titel} zuordnen`, fokus: karte.getByRole('combobox') });
  }
  ziele.push({
    name: 'Als Einheitsführer',
    fokus: zuordnungsKarte(page, 'Personal').getByRole('button', { name: 'Als Einheitsführer' }),
  });
  for (const { name, fokus } of ziele) {
    await expect(fokus, name).toHaveCount(1);
    await fokus.evaluate((el, kennung) => el.setAttribute('data-e2e-fokus', kennung), name);
  }
  const leiste = page
    .getByRole('button', { name: 'Speichern', exact: true })
    .locator('xpath=ancestor::div[@style][contains(@style,"sticky")][1]');
  await expect(leiste).toHaveCount(1);
  await expect(leiste).toHaveCSS('position', 'sticky');
  await leiste.evaluate((el) => el.classList.add('e2e-einheit-leiste'));
  const reserve = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  expect(reserve).toBeGreaterThan((await leiste.boundingBox())!.height);
  return { ziele: ziele.map(({ name }) => name), leiste };
}

for (const viewport of [
  { width: 1366, height: 520 },
  { width: 390, height: 420 },
]) {
  for (const dichte of ['kompakt', 'handschuh']) {
    test(`Einheit: alle Formular- und Zuordnungsziele frei bei ${viewport.width}px, ${dichte}`, async ({
      page,
    }) => {
      test.setTimeout(90_000);
      await page.setViewportSize(viewport);
      const { ziele, leiste } = await einheitFokusBereit(page, dichte);
      await page.getByRole('main').getByRole('link', { name: 'Einheiten', exact: true }).focus();
      // Die Leiste steht während der Formulareingabe tatsächlich im Viewport.
      await page.getByLabel('Name', { exact: true }).focus();
      await expect(leiste).toBeInViewport();
      await page.getByRole('main').getByRole('link', { name: 'Einheiten', exact: true }).focus();
      const befund = await pruefeFokusVerdeckung(page, 60);
      expect(
        befund.besuchteZiele.sort(),
        'Jedes benannte Feld, jede Leisten- und Zuordnungsaktion muss per Tab besucht werden',
      ).toEqual(ziele.sort());
      expect(befund.fixierteKandidaten).toBeGreaterThan(0);
      expect(befund.verdeckt, befund.verdeckt.join('\n')).toEqual([]);
      test.info().annotations.push({
        type: 'messwert',
        description: `${viewport.width}px ${dichte}: ${befund.besuchteZiele.length} verschiedene Routenziele, ${befund.stoppsGesamt} Stopps, ${befund.verdeckt.length} Verdeckungen`,
      });
    });
  }
}

for (const { dichte, boden, abstand } of [
  { dichte: 'komfortabel', boden: 48, abstand: 8 },
  { dichte: 'handschuh', boden: 72, abstand: 16 },
]) {
  test(`Einheit: geöffnete Sprechgruppenfelder bei 390px, ${dichte}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 420 });
    const { ziele } = await einheitFokusBereit(page, dichte);
    await page.getByRole('button', { name: /neue Sprechgruppe anlegen$/ }).click();
    const bezeichnung = page.getByRole('textbox', { name: 'Neue Bezeichnung', exact: true });
    const betriebsart = page.getByRole('combobox', { name: 'Neue Betriebsart', exact: true });
    await bezeichnung.fill('Messgruppe');
    await betriebsart.click();
    // AntD virtualisiert role=option in einen unsichtbaren ARIA-Hilfsknoten.
    await page
      .locator('.ant-select-dropdown:visible .ant-select-item-option-content')
      .filter({ hasText: /^TMO$/ })
      .click();
    const ergaenzt = [
      { name: 'Neue Bezeichnung', fokus: bezeichnung, huelle: bezeichnung },
      {
        name: 'Neue Betriebsart',
        fokus: betriebsart,
        huelle: page.locator('.ant-select').filter({ has: betriebsart }),
      },
      ...['Anlegen', 'Abbrechen'].map((name) => ({
        name,
        fokus: page.getByRole('button', { name, exact: true }),
        huelle: page.getByRole('button', { name, exact: true }),
      })),
    ];
    await expect(ergaenzt[2].fokus).toBeEnabled();
    const kaesten = [];
    for (const { name, fokus, huelle } of ergaenzt) {
      await fokus.evaluate((el, wert) => el.setAttribute('data-e2e-fokus', wert), name);
      const kasten = (await huelle.boundingBox())!;
      expect(Math.min(kasten.width, kasten.height), `${name}, ${dichte}`).toBeGreaterThanOrEqual(
        boden - 0.5,
      );
      kaesten.push(kasten);
    }
    for (let i = 1; i < kaesten.length; i++) {
      const a = kaesten[i - 1];
      const b = kaesten[i];
      expect(
        Math.max(b.x - a.x - a.width, b.y - a.y - a.height),
        `Feldabstand ${dichte}, Paar ${i}`,
      ).toBeGreaterThanOrEqual(abstand - 0.5);
    }
    const breite = await page.evaluate(() => ({
      inhalt: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
    }));
    expect(
      breite.inhalt,
      `Kein horizontaler Überlauf bei geöffneter Schnellerfassung ${dichte}`,
    ).toBeLessThanOrEqual(breite.viewport);
    await page.getByRole('main').getByRole('link', { name: 'Einheiten', exact: true }).focus();
    const befund = await pruefeFokusVerdeckung(page, 60);
    expect(befund.besuchteZiele.sort()).toEqual(
      [
        ...ziele.filter((name) => name !== 'neue Sprechgruppe anlegen'),
        ...ergaenzt.map(({ name }) => name),
      ].sort(),
    );
    expect(befund.fixierteKandidaten).toBeGreaterThan(0);
    expect(befund.verdeckt, befund.verdeckt.join('\n')).toEqual([]);
    test.info().annotations.push({
      type: 'messwert',
      description: `390px ${dichte}, Sprechgruppen offen: ${befund.besuchteZiele.length} Routenziele, ${befund.verdeckt.length} Verdeckungen, 4 Ziele ≥${boden}px, Abstände ≥${abstand}px, kein horizontaler Überlauf`,
    });
  });
}

test('Einheit Selbstbeweis: ein Fokusziel hinter der echten sticky Aktionsleiste wird erkannt', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 520 });
  const { leiste } = await einheitFokusBereit(page, 'handschuh');
  await page.getByLabel('Name', { exact: true }).focus();
  await expect(leiste).toBeInViewport();
  await leiste.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const probe = document.createElement('button');
    probe.id = 'e2e-leistenprobe';
    probe.textContent = 'Leistenprobe';
    probe.setAttribute('data-e2e-fokus', 'Leistenprobe');
    Object.assign(probe.style, {
      position: 'fixed',
      left: `${r.left + 10}px`,
      top: `${r.top + 10}px`,
      width: '40px',
      height: '20px',
      zIndex: '0',
    });
    // Geschwister, kein Kind der Leiste: Vorfahren des Fokusziels sind keine Verdecker.
    el.before(probe);
    const start = document.createElement('button');
    start.id = 'e2e-probenstart';
    start.style.position = 'fixed';
    probe.before(start);
    start.focus({ preventScroll: true });
  });
  const verdeckt = await pruefeFokusVerdeckung(page, 1);
  expect(verdeckt.besuchteZiele).toEqual(['Leistenprobe']);
  expect(verdeckt.verdeckt).toHaveLength(1);
  expect(verdeckt.verdeckt[0]).toContain('e2e-einheit-leiste');
  // Gegenprobe am selben Ziel: die Geometrie außerhalb der Leiste muss frei sein.
  await page.locator('#e2e-leistenprobe').evaluate((el) => {
    el.style.top = '100px';
  });
  await page.locator('#e2e-probenstart').focus();
  expect((await pruefeFokusVerdeckung(page, 1)).verdeckt).toEqual([]);
});

/**
 * Der klebende Fuß des Modulpanels (Einsatzdauer, `sticky; bottom: 0`) verdeckt kein Ziel der
 * Liste darüber. Deterministisch statt per Tabulatordurchlauf, der die Lage nur zufällig
 * trifft: die Seite wird je Schritt anders gescrollt und das Ziel frisch fokussiert.
 */
test('Modulpanel: der klebende Einsatzdauer-Fuß verdeckt kein fokussiertes Modul (1366 × 520, handschuh)', async ({
  page,
}) => {
  await anmelden(page);
  await page.setViewportSize({ width: 1366, height: 520 });
  const { pfad } = await einheitMitZuordnungen(page);
  await page.evaluate(() => localStorage.setItem('lifeline-hub.dichte', 'handschuh'));
  await page.goto(pfad);
  await expect(page.locator('html')).toHaveAttribute('data-dichte', 'handschuh');
  await detailBereit(page);
  const panel = page.locator('[data-lfh="modul-panel"]');
  const fuss = panel.locator('[data-lfh="modul-panel-fuss"]');
  await expect(fuss).toHaveCSS('position', 'sticky');
  const ziel = panel.getByRole('button', { name: /^Bereitstellungsräume/ });
  await expect(ziel).toHaveCount(1);
  const befunde: string[] = [];
  let unterDemFussGestartet = 0;
  for (let y = 0; y <= 200; y += 20) {
    await page.evaluate((wert) => {
      (document.activeElement as HTMLElement | null)?.blur();
      window.scrollTo(0, wert);
    }, y);
    // Nur Lagen, in denen das Ziel VOR dem Fokus den Fuß berührt, prüfen überhaupt etwas.
    const vorher = await ziel.evaluate(
      (el, f) => el.getBoundingClientRect().bottom > f!.getBoundingClientRect().top,
      await fuss.elementHandle(),
    );
    if (vorher) unterDemFussGestartet += 1;
    await ziel.focus();
    const m = await ziel.evaluate(
      (el, f) => ({
        unten: el.getBoundingClientRect().bottom,
        fussOben: f!.getBoundingClientRect().top,
      }),
      await fuss.elementHandle(),
    );
    if (m.unten > m.fussOben + 1) befunde.push(`Ausgangslage ${y}px: ${JSON.stringify(m)}`);
  }
  expect(unterDemFussGestartet, 'mindestens eine Lage beginnt unter dem Fuß').toBeGreaterThan(0);
  expect(befunde, befunde.join('\n')).toEqual([]);
});

// ── ETB, Gefahrenmatrix, Lagekarte, Personenkarte und -liste ─────────────────────────────

/** Stellt die Dichte über localStorage + Neuladen und hält die Wache am `<html>`. */
async function stelleDichte(page: Page, dichte: string) {
  await page.evaluate((wert) => localStorage.setItem('lifeline-hub.dichte', wert), dichte);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-dichte', dichte);
}

/**
 * Blendet den Knopf der TanStack-Query-Devtools aus: er steht nur im DEV-Build, gegen den die
 * Suite fährt, als `position: fixed` unten rechts — ein Verdecker, den es im Betrieb nicht
 * gibt. Per Init-Skript, weil `stelleDichte` neu lädt.
 */
async function ohneDevtoolsKnopf(page: Page) {
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const stil = document.createElement('style');
      stil.textContent = '[class*="tsqd-open-btn"] { display: none !important; }';
      document.head.append(stil);
    });
  });
}

/**
 * Kleinster freier Streifen zwischen der Unterkante eines angesteuerten Ziels (mit
 * `data-e2e-fokus`) und der Oberkante einer angepinnten Fußleiste. Der Kern meldet nur
 * VOLLSTÄNDIGE Verdeckung; ein halb verdecktes Ziel ist für die Bedienung aber nicht frei.
 */
async function kleinsterStreifen(page: Page, schritte: number, leiste: string): Promise<number> {
  let kleinster = Number.POSITIVE_INFINITY;
  for (let i = 0; i < schritte; i += 1) {
    await page.keyboard.press('Tab');
    const wert = await page.evaluate((sel) => {
      const fokus = document.activeElement;
      const l = document.querySelector(sel);
      if (fokus == null || l == null || !fokus.hasAttribute('data-e2e-fokus')) return null;
      return l.getBoundingClientRect().top - fokus.getBoundingClientRect().bottom;
    }, leiste);
    if (wert != null) kleinster = Math.min(kleinster, wert);
  }
  return kleinster;
}

/**
 * ETB: die angepinnte Erfassungsleiste am Seitenfuß. Vorwärts getabbt rollt der Browser jedes
 * Ziel an den unteren Rand — genau dorthin, wo die Leiste klebt.
 *
 * Start am ersten Auslöser: die Erfassung fokussiert beim Einhängen ihr Textfeld, ein nacktes
 * Tab liefe an der Zeitachse vorbei. Kleine Höhen und 16 Einträge, damit die Leiste über der
 * Zeitachse klebt statt am Seitenende.
 */
test('ETB (LFH-373): kein Zeilenauslöser verschwindet beim Tabben hinter der Erfassungsleiste', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await ohneDevtoolsKnopf(page);
  await anmelden(page);
  const antwort = await page.request.post('/api/einsaetze', {
    data: { bezeichnung: `Fokus 373 Nord ${Date.now()}` },
  });
  expect(antwort.ok(), await antwort.text()).toBeTruthy();
  const { id: einsatzId } = (await antwort.json()) as { id: number };
  const ANZAHL = 16;
  const ids: number[] = [];
  for (let n = 1; n <= ANZAHL; n += 1) {
    const eintrag = await page.request.post(`/api/einsaetze/${einsatzId}/etb`, {
      data: {
        typ: 'meldung',
        inhalt: `Probe ${n}: Lage unverändert`,
        von: 'ELW 1',
        an: 'Leitstelle',
      },
    });
    expect(eintrag.ok(), await eintrag.text()).toBeTruthy();
    ids.push(((await eintrag.json()) as { id: number }).id);
  }
  // Zwei Berichtigungen, damit die Bilanz Links trägt: unter `xl` steht sie unter der
  // Zeitachse, und die Leiste klebt auch über ihr.
  for (const ziel of ids.slice(0, 2)) {
    const b = await page.request.post(`/api/einsaetze/${einsatzId}/etb`, {
      data: {
        typ: 'berichtigung',
        inhalt: 'Berichtigung: Uhrzeit korrigiert',
        berichtigt_eintrag_id: ziel,
      },
    });
    expect(b.ok(), await b.text()).toBeTruthy();
  }
  const ZEILEN = ANZAHL + 2;

  const gemessen: string[] = [];
  const LEISTE = '.etb-erfassung-sticky';
  for (const flaeche of [
    { width: 390, height: 600 },
    { width: 1366, height: 520 },
  ]) {
    await page.setViewportSize(flaeche);
    for (const dichte of ['kompakt', 'handschuh']) {
      const lauf = `${flaeche.width}×${flaeche.height}/${dichte}`;
      await page.goto(`/einsaetze/${einsatzId}/etb`);
      await stelleDichte(page, dichte);
      const zeitachse = page.getByRole('region', { name: 'Einsatztagebuch' });
      await expect(zeitachse.getByTestId('etb-ereigniszeile')).toHaveCount(ZEILEN);
      await expect(page.locator(LEISTE)).toHaveCSS('position', 'sticky');

      const ausloeser = zeitachse.getByRole('button', { name: /^Aktionen zu Eintrag \d+$/ });
      expect(await ausloeser.count()).toBeGreaterThanOrEqual(ANZAHL);
      await ausloeser.evaluateAll((els) =>
        els.forEach((el) => el.setAttribute('data-e2e-fokus', el.getAttribute('aria-label')!)),
      );
      // Unter `xl` die Links der Bilanz mit — sie stehen dann unter der Zeitachse.
      const bilanzLinks = page
        .getByRole('complementary', { name: 'Bilanz des Tagebuchs' })
        .getByRole('link');
      const mitBilanz = flaeche.width < 1200;
      let bilanzZiele: string[] = [];
      if (mitBilanz) {
        await expect.poll(() => bilanzLinks.count()).toBeGreaterThanOrEqual(2);
        bilanzZiele = await bilanzLinks.evaluateAll((els) =>
          els.map((el, i) => {
            const kennung = `bilanz ${i}`;
            el.setAttribute('data-e2e-fokus', kennung);
            return kennung;
          }),
        );
      }
      const SCHRITTE = ZEILEN * 2 + 16;
      const { reserve, leiste } = await page.evaluate((sel) => {
        const l = document.querySelector(sel)!.getBoundingClientRect();
        return {
          reserve: document.documentElement.scrollHeight - document.documentElement.clientHeight,
          leiste: Math.round(l.height),
        };
      }, LEISTE);
      expect(
        reserve,
        `${lauf}: Vorbedingung — die Bildlaufreserve (${reserve}px) muss die Leiste (${leiste}px) übersteigen`,
      ).toBeGreaterThan(leiste);

      await page.evaluate(() => window.scrollTo(0, 0));
      await ausloeser.first().focus();
      const kern = await pruefeFokusVerdeckung(page, SCHRITTE);
      expect(
        kern.besuchteZiele.length,
        `${lauf}: Vorbedingung — der Durchlauf muss die Zeitachse ablaufen`,
      ).toBeGreaterThanOrEqual(ANZAHL - 1);
      for (const ziel of bilanzZiele) {
        expect(kern.besuchteZiele, `${lauf}: Vorbedingung — ${ziel} besucht`).toContain(ziel);
      }

      await page.evaluate(() => window.scrollTo(0, 0));
      await ausloeser.first().focus();
      const streifen = await kleinsterStreifen(page, SCHRITTE, LEISTE);

      expect(kern.verdeckt, `${lauf}: vollständig verdeckt:\n${kern.verdeckt.join('\n')}`).toEqual(
        [],
      );
      expect(
        streifen,
        `${lauf}: kleinster freier Streifen Ziel ↔ Leiste ${streifen}px, Soll > 0`,
      ).toBeGreaterThan(0);
      gemessen.push(
        `${lauf}: Leiste ${leiste}px, ${kern.besuchteZiele.length} Ziele (davon Bilanz ${bilanzZiele.length}), Streifen ≥ ${Math.round(streifen)}px`,
      );
    }
  }
  test.info().annotations.push({ type: 'messwert', description: gemessen.join(' | ') });
});

/** Einsatz mit zwei Gefahrengebieten per API (Karte braucht WebGL, `POST …/zonen` nicht). */
async function matrixEinsatz(page: Page): Promise<number> {
  const antwort = await page.request.post('/api/einsaetze', {
    data: { bezeichnung: `Fokus 373 Sued ${Date.now()}` },
  });
  expect(antwort.ok(), await antwort.text()).toBeTruthy();
  const { id } = (await antwort.json()) as { id: number };
  for (const [i, label] of ['Sektor Sued 1', 'Sektor Sued 2'].entries()) {
    const x = 10 + i / 20;
    const zone = await page.request.post(`/api/einsaetze/${id}/zonen`, {
      data: {
        typ: 'gefahrengebiet',
        geometrie_typ: 'Polygon',
        geometrie: JSON.stringify({
          type: 'Polygon',
          coordinates: [
            [
              [x, 50],
              [x + 0.01, 50],
              [x + 0.01, 50.01],
              [x, 50.01],
              [x, 50],
            ],
          ],
        }),
        label,
      },
    });
    expect(zone.ok(), await zone.text()).toBeTruthy();
  }
  return id;
}

/**
 * Gefahrenmatrix: stehende Kopfzeile und fixierte Spalte „Gefahr" gegenüber 58 Zell-Auslösern.
 * Hier trägt JEDE Spalte ein Fokusziel: beim Sprung zur ersten Zelle der nächsten Zeile rollt
 * der Container nach links, und der Browser richtet das Ziel unter der fixierten Spalte aus.
 *
 * Vorbedingung „die Tabelle läuft waagerecht über", sonst ist „0 verdeckt" trivial wahr.
 * Rückwärts eigens, weil nur `Shift+Tab` Ziele unter die oben stehende Kopfzeile rollt;
 * `stoppsAnTabellenkopf` belegt, dass der Lauf sie erreicht hat.
 */
test('Gefahrenmatrix (LFH-373): keine Zelle verschwindet beim Tabben unter der fixierten Spalte oder der Kopfzeile', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await ohneDevtoolsKnopf(page);
  await anmelden(page);
  const einsatzId = await matrixEinsatz(page);
  const gemessen: string[] = [];

  for (const flaeche of [
    { width: 390, height: 400 },
    { width: 1024, height: 768 },
  ]) {
    await page.setViewportSize(flaeche);
    for (const dichte of ['kompakt', 'handschuh']) {
      const lauf = `${flaeche.width}×${flaeche.height}/${dichte}`;
      await page.goto(`/einsaetze/${einsatzId}/gefahren`);
      await stelleDichte(page, dichte);
      const zellen = page.getByRole('button', { name: /^Bewertung / });
      await expect(zellen).toHaveCount(58);
      await zellen.evaluateAll((els) =>
        els.forEach((el) => el.setAttribute('data-e2e-fokus', el.getAttribute('aria-label')!)),
      );
      await expect(page.locator('.ant-table-sticky-holder')).toHaveCSS('position', 'sticky');
      const huelle = await page
        .locator('.ant-table-body')
        .evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
      expect(
        huelle.sw,
        `${lauf}: Vorbedingung — die Matrix muss waagerecht überlaufen (${huelle.sw} ≤ ${huelle.cw})`,
      ).toBeGreaterThan(huelle.cw);

      await page.evaluate(() => window.scrollTo(0, 0));
      await zellen.first().focus();
      const vor = await pruefeFokusVerdeckung(page, 62);
      // 57: der Kern zählt nach jedem Tab, die Startzelle selbst ist also nie dabei.
      expect(vor.besuchteZiele.length, `${lauf}: vorwärts alle übrigen 57 Zellen besucht`).toBe(57);
      expect(vor.verdeckt, `${lauf} vorwärts:\n${vor.verdeckt.join('\n')}`).toEqual([]);

      await zellen.last().focus();
      const rueck = await pruefeFokusVerdeckung(page, 62, 'Shift+Tab');
      expect(rueck.besuchteZiele.length, `${lauf}: rückwärts alle übrigen 57 Zellen besucht`).toBe(
        57,
      );
      expect(rueck.verdeckt, `${lauf} rückwärts:\n${rueck.verdeckt.join('\n')}`).toEqual([]);
      // Vorbedingung: auf dem Handschirm rollt die Matrix senkrecht, der Rückwärtslauf MUSS an
      // der Kopfzeile vorbeikommen. Bei 1024 × 768 passt die Matrix in `kompakt` ins Fenster.
      if (flaeche.width < 768) {
        expect(
          rueck.stoppsAnTabellenkopf,
          `${lauf}: Vorbedingung — rückwärts an der Kopfzeile`,
        ).toBeGreaterThan(0);
      }

      gemessen.push(
        `${lauf}: Überlauf ${huelle.sw}/${huelle.cw}, rückwärts an der Kopfzeile ${rueck.stoppsAnTabellenkopf}`,
      );
    }
  }
  test.info().annotations.push({ type: 'messwert', description: gemessen.join(' | ') });
});

/** Kandidaten der Kartenaufbauten für den Kern (`position: absolute`, Opt-in). */
const KARTEN_AUFBAUTEN = [
  '[data-lfh="karten-fuss"] > *',
  '[data-lfh="karten-knoepfe"]',
  '[data-lfh="karten-ueberlagerung-links"]',
];

const KARTENKNOEPFE = [
  'Hineinzoomen',
  'Herauszoomen',
  'Nach Norden ausrichten',
  'Messen',
  'Zeichenwerkzeuge',
];

/** Ab `lg` (992) sitzt der Leisten-Umschalter unten im Knopfblock. */
const LG = 992;

/**
 * Knopfblock gegen jedes Fußband, als Rechteckschnitt. Liefert die Überschneidungen als Text;
 * leer heißt: keine.
 */
async function knopfblockUeberFuss(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const block = document.querySelector('[data-lfh="karten-knoepfe"]');
    if (!block) return ['kein Knopfblock im Baum'];
    const b = block.getBoundingClientRect();
    return Array.from(document.querySelectorAll('[data-lfh="karten-fuss"] > *'))
      .map((band) => {
        const r = band.getBoundingClientRect();
        const x = Math.min(b.right, r.right) - Math.max(b.left, r.left);
        const y = Math.min(b.bottom, r.bottom) - Math.max(b.top, r.top);
        return x > 0.5 && y > 0.5
          ? `${band.getAttribute('data-lfh') ?? band.className}: ${Math.round(x)}×${Math.round(y)}px`
          : null;
      })
      .filter((t): t is string => t != null);
  });
}

/**
 * Lagekarte: Knopfblock oben rechts, Überlagerung links, Fußbänder unten — alle
 * `position: absolute` über der Karte, der Fuß später im DOM. Drei Belege, weil jeder allein
 * zu wenig sagt: der Kern (mit den Aufbauten als Zusatzkandidaten), der Rechteckschnitt
 * Knopfblock ↔ Fußband (auch Teilüberdeckung) und die Trefferprobe je Knopf
 * (`click({ trial: true })` — `toBeVisible()` belegt keine Klickbarkeit).
 */
test('Lagekarte (LFH-373): Kartenknöpfe liegen nie unter den Fußbändern', async ({ page }) => {
  test.setTimeout(300_000);
  await ohneDevtoolsKnopf(page);
  await anmelden(page);
  const antwort = await page.request.post('/api/einsaetze', {
    data: { bezeichnung: `Fokus 373 Ost ${Date.now()}` },
  });
  expect(antwort.ok(), await antwort.text()).toBeTruthy();
  const { id: einsatzId } = (await antwort.json()) as { id: number };
  for (const bezeichnung of ['Stand A', 'Stand B']) {
    const stand = await page.request.post(`/api/einsaetze/${einsatzId}/lage-snapshots`, {
      data: { bezeichnung },
    });
    expect(stand.ok(), await stand.text()).toBeTruthy();
  }

  const gemessen: string[] = [];
  for (const lage of [
    { width: 390, height: 844, leiste: false, dichte: 'kompakt' },
    { width: 390, height: 844, leiste: false, dichte: 'handschuh' },
    { width: 390, height: 844, leiste: true, dichte: 'handschuh' },
    { width: 1024, height: 768, leiste: false, dichte: 'handschuh' },
  ]) {
    const lauf = `${lage.width}×${lage.height}${lage.leiste ? ' mit Leiste' : ''}/${lage.dichte}`;
    await page.setViewportSize({ width: lage.width, height: lage.height });
    await page.goto(`/einsaetze/${einsatzId}/lagekarte`);
    // Die Leisten-Wahl ist gemerkt: gesetzt statt geklickt, sonst erbte eine Lage die der vorigen.
    await page.evaluate((offen) => {
      localStorage.setItem('lfh:lagekarte:zeitachse-eingeklappt', '0');
      localStorage.removeItem('lfh:lagekarte:leiste-offen:ab-lg');
      if (offen) localStorage.setItem('lfh:lagekarte:leiste-offen:unter-lg', '1');
      else localStorage.removeItem('lfh:lagekarte:leiste-offen:unter-lg');
    }, lage.leiste);
    await stelleDichte(page, lage.dichte);
    await expect(page.getByTestId('kartenflaeche').locator('canvas.maplibregl-canvas')).toHaveCount(
      1,
      { timeout: 60_000 },
    );
    if (lage.leiste) {
      await expect(page.getByRole('complementary', { name: 'Kartenleiste' })).toBeVisible();
    }
    // Vorbedingung: die Zeitachse steht ausgeklappt — sonst wäre der Test still wertlos statt rot.
    await expect(page.getByRole('button', { name: 'Zeitachse ausblenden' })).toBeVisible();

    const knoepfe = page.locator('[data-lfh="karten-knoepfe"]');
    const ueberschnitt = await knopfblockUeberFuss(page);
    expect(ueberschnitt, `${lauf}: Knopfblock überschneidet Fußband`).toEqual([]);

    // Der Umschalter ist ab `lg` der unterste Knopf, also der dem Fuß nächste.
    for (const name of lage.width >= LG ? [...KARTENKNOEPFE, 'Leiste ausblenden'] : KARTENKNOEPFE) {
      await knoepfe
        .getByRole('button', { name, exact: true })
        .click({ trial: true, timeout: 5_000 });
    }

    await knoepfe.getByRole('button', { name: 'Hineinzoomen', exact: true }).focus();
    const kern = await pruefeFokusVerdeckung(page, 14, 'Tab', {
      zusatzKandidaten: KARTEN_AUFBAUTEN,
      region: '[data-lfh="kartenspalte"]',
    });
    expect(
      kern.stoppsInRegion,
      `${lauf}: Vorbedingung — der Lauf muss durch die Kartenspalte gehen`,
    ).toBeGreaterThanOrEqual(5);
    expect(kern.verdeckt, `${lauf}:\n${kern.verdeckt.join('\n')}`).toEqual([]);
    gemessen.push(`${lauf}: ${kern.stoppsInRegion} Stopps in der Kartenspalte, frei`);
  }
  test.info().annotations.push({ type: 'messwert', description: gemessen.join(' | ') });
});

/**
 * Personenkarte: dieselbe `KartenUeberlagerung` wie die Lagekarte, aber ohne Kartenfuß. Die
 * Aufbauten gehen als Zusatzkandidaten in den Kern.
 */
test('Personenkarte (LFH-373): kein Fokusziel liegt unter den Kartenaufbauten', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await ohneDevtoolsKnopf(page);
  await anmelden(page);
  const antwort = await page.request.post('/api/einsaetze', {
    data: { bezeichnung: `Fokus 373 West ${Date.now()}` },
  });
  expect(antwort.ok(), await antwort.text()).toBeTruthy();
  const { id: einsatzId } = (await antwort.json()) as { id: number };
  for (const [i, name] of ['Einzeln West', 'Fern West'].entries()) {
    const person = await page.request.post(`/api/einsaetze/${einsatzId}/personen`, {
      data: { name, antreff_lat: 53 + i * 0.3, antreff_lon: 8.8 + i * 0.5 },
    });
    expect(person.ok(), await person.text()).toBeTruthy();
  }

  // Dichte ZUERST, dann die Ansicht (LFH-770): `?ansicht=karte` ist ein Auftrag, den die
  // Personenseite anwendet und aus der URL räumt (apply-then-clean, `PersonenPage`). Das
  // Neuladen in `stelleDichte` lüde sonst die GERÄUMTE Adresse — je nachdem, ob der Effekt vor
  // dem `reload` lief, die Zeilenansicht ohne Karte, und das Canvas käme nie.
  await stelleDichte(page, 'handschuh');
  const gemessen: string[] = [];
  for (const flaeche of [
    { width: 390, height: 844 },
    { width: 1366, height: 768 },
  ]) {
    const lauf = `${flaeche.width}×${flaeche.height}/handschuh`;
    await page.setViewportSize(flaeche);
    await page.goto(`/einsaetze/${einsatzId}/personen?ansicht=karte`);
    await expect(page.locator('html')).toHaveAttribute('data-dichte', 'handschuh');
    const karte = page.locator('[data-lfh="betroffene-karte"]');
    await expect(karte.locator('canvas.maplibregl-canvas')).toHaveCount(1, { timeout: 60_000 });
    const knoepfe = karte.locator('[data-lfh="karten-knoepfe"]');
    await expect(knoepfe.getByRole('button', { name: 'Hineinzoomen', exact: true })).toBeVisible();
    for (const name of ['Hineinzoomen', 'Herauszoomen', 'Nach Norden ausrichten']) {
      await knoepfe
        .getByRole('button', { name, exact: true })
        .click({ trial: true, timeout: 5_000 });
    }

    await knoepfe.getByRole('button', { name: 'Hineinzoomen', exact: true }).focus();
    const kern = await pruefeFokusVerdeckung(page, 10, 'Tab', {
      zusatzKandidaten: KARTEN_AUFBAUTEN,
      region: '[data-lfh="betroffene-karte"]',
    });
    expect(
      kern.stoppsInRegion,
      `${lauf}: Vorbedingung — der Lauf muss durch die Karte gehen`,
    ).toBeGreaterThanOrEqual(2);
    expect(kern.verdeckt, `${lauf}:\n${kern.verdeckt.join('\n')}`).toEqual([]);
    gemessen.push(`${lauf}: ${kern.stoppsInRegion} Stopps in der Karte, frei`);
  }
  test.info().annotations.push({ type: 'messwert', description: gemessen.join(' | ') });
});

/**
 * Rückwärts getabbte Ziele, deren MITTELPUNKT unter einer stehenden Tabellenkopfzeile liegt.
 * Strenger als der Kern mit Absicht: ein halb verdecktes Ziel ließe den Kern (nur
 * VOLLSTÄNDIGE Verdeckung) grün, auch ohne den Kopf-Freiraum der Katalogtabellen.
 */
async function mittelpunktUnterKopf(page: Page, schritte: number): Promise<string[]> {
  const befunde: string[] = [];
  for (let i = 0; i < schritte; i += 1) {
    await page.keyboard.press('Shift+Tab');
    const befund = await page.evaluate(() => {
      const f = document.activeElement as HTMLElement | null;
      const kopf = document.querySelector('.ant-table-sticky-holder');
      if (!f || !kopf || kopf.contains(f) || !f.closest('.ant-table-tbody')) return null;
      const r = f.getBoundingClientRect();
      const am = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return am && kopf.contains(am)
        ? `${(f.getAttribute('aria-label') ?? f.textContent ?? '').trim().slice(0, 24)} bei y ${Math.round(r.top)}`
        : null;
    });
    if (befund) befunde.push(befund);
  }
  return befunde;
}

/**
 * Personenliste: Tabellenzweig der `Datensicht` mit stehender Kopfzeile. Vorwärts UND
 * rückwärts, weil nur rückwärts ein Ziel unter die Kopfzeile rollt. Unter `md` stehen Karten,
 * deshalb 1024 und 1366 px.
 */
test('Personenliste (LFH-373): kein Fokusziel verschwindet hinter der stehenden Kopfzeile', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await ohneDevtoolsKnopf(page);
  await anmelden(page);
  const antwort = await page.request.post('/api/einsaetze', {
    data: { bezeichnung: `Fokus 373 Liste ${Date.now()}` },
  });
  expect(antwort.ok(), await antwort.text()).toBeTruthy();
  const { id: einsatzId } = (await antwort.json()) as { id: number };
  const ANZAHL = 14;
  for (let n = 1; n <= ANZAHL; n += 1) {
    const person = await page.request.post(`/api/einsaetze/${einsatzId}/personen`, {
      data: { name: `Person ${String(n).padStart(2, '0')}` },
    });
    expect(person.ok(), await person.text()).toBeTruthy();
  }

  const gemessen: string[] = [];
  for (const flaeche of [
    { width: 1024, height: 600 },
    { width: 1366, height: 520 },
  ]) {
    await page.setViewportSize(flaeche);
    for (const dichte of ['kompakt', 'handschuh']) {
      const lauf = `${flaeche.width}×${flaeche.height}/${dichte}`;
      await page.goto(`/einsaetze/${einsatzId}/personen`);
      await stelleDichte(page, dichte);
      const zeilen = page.locator('tr.ant-table-row');
      await expect(zeilen).toHaveCount(ANZAHL);
      await expect(page.locator('.ant-table-sticky-holder')).toHaveCSS('position', 'sticky');
      const reserve = await page.evaluate(
        () => document.documentElement.scrollHeight - document.documentElement.clientHeight,
      );
      expect(reserve, `${lauf}: Vorbedingung — die Seite muss scrollen`).toBeGreaterThan(0);

      await zeilen.first().locator('a, button, [tabindex="0"]').first().focus();
      const vor = await pruefeFokusVerdeckung(page, ANZAHL * 3);
      expect(vor.stoppsInTabelle, `${lauf}: vorwärts durch die Tabelle`).toBeGreaterThanOrEqual(
        ANZAHL - 1,
      );
      expect(vor.verdeckt, `${lauf} vorwärts:\n${vor.verdeckt.join('\n')}`).toEqual([]);

      await zeilen.last().locator('a, button, [tabindex="0"]').last().focus();
      const rueck = await pruefeFokusVerdeckung(page, ANZAHL * 3, 'Shift+Tab');
      expect(
        rueck.stoppsAnTabellenkopf,
        `${lauf}: Vorbedingung — rückwärts muss der Lauf die Kopfzeile erreichen`,
      ).toBeGreaterThan(0);
      expect(rueck.verdeckt, `${lauf} rückwärts:\n${rueck.verdeckt.join('\n')}`).toEqual([]);

      await zeilen.last().locator('a, button, [tabindex="0"]').last().focus();
      const mittelpunkt = await mittelpunktUnterKopf(page, ANZAHL * 3);
      expect(mittelpunkt, `${lauf}: Mittelpunkt unter der Kopfzeile`).toEqual([]);
      gemessen.push(
        `${lauf}: ${vor.stoppsInTabelle} Tabellenstopps vorwärts, ${rueck.stoppsAnTabellenkopf} an der Kopfzeile rückwärts`,
      );
    }
  }
  test.info().annotations.push({ type: 'messwert', description: gemessen.join(' | ') });
});

// ── LFH-811: Fokus in jedem Kartenmodus unter `lg` ────────────────────────────────────────────
//
// Unter `lg` trägt während eines Kartenmodus ein Band im Kartenfuß die Bedienung
// (`ZeichnenSteuerung`, `PlatzierSteuerung`, `MessSteuerung`), gestapelt mit der ausgeklappten
// Zeitachse. Zwei Wege, ein Fokusziel zu verlieren, und der Kern sieht beide nur per Opt-in:
//  - Überdeckung durch Knopfblock, linke Überlagerung oder ein anderes Band. Die Bänder sind
//    Flow-Geschwister im absolut positionierten Fuß (nie selbst absolut, LFH-355), weder
//    `sticky` noch `fixed` — deshalb über `zusatzKandidaten` (`KARTEN_AUFBAUTEN`).
//  - Abschneiden: die Zeitachse gibt Höhe ab und rollt in sich (`bandStil(…, nachgiebig)`), der
//    Fuß endet an der Karte — also `beschnitt`.
// Dichte `handschuh`: die höchsten Bänder, die meiste Stauchung.

const MODUS_BILD = 'Lageplan Fokusprobe';
/** 1 × 1-PNG, wie in `lagekarte-touch.spec.ts`. */
const MODUS_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
/** Tabulaturziel: aktiv und nicht per `tabindex="-1"` ausgenommen (Segmentleiste: roving). */
const TABSTOPP =
  'button:not([disabled]):not([tabindex="-1"]), input:not([disabled]):not([tabindex="-1"]), [tabindex="0"]';
/** Kleinster sichtbarer Anteil über beide Richtungen, als „sichtbar/Zielhöhe px“. */
function rest(...laeufe: Verdeckungsbefund[]): string {
  const reste = laeufe.flatMap((l) => (l.kleinsterRestInRegion ? [l.kleinsterRestInRegion] : []));
  if (reste.length === 0) return '—';
  const r = reste.reduce((a, b) => (b.sichtbar / b.ziel < a.sichtbar / a.ziel ? b : a));
  return `${Math.round(r.sichtbar)}/${Math.round(r.ziel)} px`;
}

/** Das Modusband: jedes Kind des Fußes außer Zeitachse und Maßstab. */
const MODUSBAND =
  '[data-lfh="karten-fuss"] > :not([data-lfh="zeitachse"]):not([data-lfh="massstab"])';

interface Kartenmodus {
  name: string;
  /** Adresszusatz, mit dem die Karte geöffnet wird. */
  query?: (saat: { schadenId: number }) => string;
  /** Vor dem Öffnen gesetzte `localStorage`-Einträge. */
  speicher?: Record<string, string>;
  betreten?: (page: Page, breit768: boolean) => Promise<void>;
}

const KARTENMODI: Kartenmodus[] = [
  {
    name: 'Zone',
    betreten: async (page) => {
      await page.getByRole('button', { name: 'Zeichenwerkzeuge' }).click();
      await page.getByRole('button', { name: 'Gefahrengebiet zeichnen' }).click();
    },
  },
  {
    name: 'Platzieren',
    query: ({ schadenId }) => `?platzieren=schaden:${schadenId}`,
  },
  {
    name: 'Taktisches Zeichen',
    betreten: async (page) => {
      await page.getByRole('button', { name: 'Zeichenwerkzeuge' }).click();
      const paneel = page.locator('[data-paneel="zeichnen"]');
      await paneel.getByRole('button', { name: 'Taktisches Zeichen platzieren' }).click();
      await paneel.getByRole('button', { name: 'Platzieren', exact: true }).click();
    },
  },
  {
    name: 'Bild einpassen',
    speicher: { 'lfh:lagekarte:paneele': JSON.stringify({ bilder: true }) },
    betreten: async (page, breit768) => {
      // Bei 768 px ist die Leiste per Vorgabe offen, bei 390 px zu.
      if (!breit768) await page.getByRole('button', { name: 'Leiste einblenden' }).click();
      await page.getByRole('button', { name: `Aktionen zu ${MODUS_BILD}` }).click();
      await page.getByRole('menuitem', { name: 'Auf der Karte platzieren' }).click();
    },
  },
  {
    name: 'Messen',
    betreten: async (page) => {
      await page
        .locator('[data-lfh="karten-knoepfe"]')
        .getByRole('button', { name: 'Messen', exact: true })
        .click();
    },
  },
];

for (const viewport of [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
]) {
  test.describe(`Lagekarte bei ${viewport.width} px (LFH-811): kein Fokusziel im Kartenmodus verdeckt`, () => {
    test.use({ viewport });

    for (const modus of KARTENMODI) {
      test(`${modus.name}: Tab und Shift+Tab durch Knöpfe, Modusband und Zeitachse`, async ({
        page,
      }) => {
        test.setTimeout(180_000);
        await ohneDevtoolsKnopf(page);
        await anmelden(page);

        const einsatz = await page.request.post('/api/einsaetze', {
          data: { bezeichnung: `Fokus 811 ${Date.now()}` },
        });
        expect(einsatz.ok(), await einsatz.text()).toBeTruthy();
        const { id: einsatzId } = (await einsatz.json()) as { id: number };
        // Zwei Stände: erst dann trägt die Zeitachse ihre volle Bedienung (Leiste, Stand-Knöpfe).
        for (const bezeichnung of ['Stand A', 'Stand B']) {
          const stand = await page.request.post(`/api/einsaetze/${einsatzId}/lage-snapshots`, {
            data: { bezeichnung },
          });
          expect(stand.ok(), await stand.text()).toBeTruthy();
        }
        const schaden = await page.request.post(`/api/einsaetze/${einsatzId}/schaeden`, {
          data: { typ: 'sachschaden', ausmass: 'gering', ort: 'Fokusprobe Keller' },
        });
        expect(schaden.ok(), await schaden.text()).toBeTruthy();
        const { id: schadenId } = (await schaden.json()) as { id: number };
        const bild = await page.request.post(
          `/api/einsaetze/${einsatzId}/karte/hintergrundbilder`,
          {
            multipart: {
              datei: { name: 'plan.png', mimeType: 'image/png', buffer: MODUS_PNG },
              ecken: JSON.stringify([
                [8.796, 53.08],
                [8.804, 53.08],
                [8.804, 53.075],
                [8.796, 53.075],
              ]),
              name: MODUS_BILD,
            },
          },
        );
        expect(bild.ok(), await bild.text()).toBeTruthy();

        // Dichte ZUERST: `stelleDichte` lädt neu, und `?platzieren=` ist ein Auftrag, den die Karte
        // anwendet und aus der Adresse räumt — ein Neuladen danach liefe ohne Modus.
        await stelleDichte(page, 'handschuh');
        await page.evaluate((speicher) => {
          localStorage.setItem('lfh:lagekarte:zeitachse-eingeklappt', '0');
          localStorage.removeItem('lfh:lagekarte:leiste-offen:unter-lg');
          localStorage.removeItem('lfh:lagekarte:leiste-offen:ab-lg');
          for (const [schluessel, wert] of Object.entries(speicher)) {
            localStorage.setItem(schluessel, wert);
          }
        }, modus.speicher ?? {});
        await page.goto(`/einsaetze/${einsatzId}/lagekarte${modus.query?.({ schadenId }) ?? ''}`);
        await expect(page.locator('html')).toHaveAttribute('data-dichte', 'handschuh');
        await expect(
          page.getByTestId('kartenflaeche').locator('canvas.maplibregl-canvas'),
        ).toHaveCount(1, { timeout: 60_000 });
        await modus.betreten?.(page, viewport.width >= 768);

        // Vorbedingungen: der Modus läuft, die Leiste ist zu, die Zeitachse steht ausgeklappt
        // daneben, und das Modusband ist ein direktes Kind des Fußes — nur dann sieht es der Kern.
        await expect(page.locator(MODUSBAND)).toHaveCount(1);
        await expect(page.locator('#lagekarte-leiste')).toBeHidden();
        await expect(page.getByRole('button', { name: 'Zeitachse ausblenden' })).toBeVisible();
        const bandStopps = await page.locator(MODUSBAND).evaluate((band, sel) => {
          const stopps = Array.from(band.querySelectorAll<HTMLElement>(sel));
          stopps.forEach((el, i) => el.setAttribute('data-e2e-fokus', `band-${i}`));
          return stopps.length;
        }, TABSTOPP);
        expect(bandStopps, 'Vorbedingung: das Modusband trägt Tabulaturziele').toBeGreaterThan(0);
        const hoehen = await page.evaluate((bandSel) => {
          const r = (sel: string) => document.querySelector(sel)!.getBoundingClientRect();
          const karte = r('[data-testid="kartenflaeche"]');
          return {
            karte: Math.round(karte.height),
            zeitachse: Math.round(r('[data-lfh="zeitachse"]').height),
            bandOben: Math.round(r(bandSel).top - karte.top),
          };
        }, MODUSBAND);

        const optionen = {
          zusatzKandidaten: KARTEN_AUFBAUTEN,
          region: '[data-lfh="zeitachse"]',
          beschnitt: true,
        };
        const alleBandStopps = Array.from({ length: bandStopps }, (_, i) => `band-${i}`).sort();

        // Vorwärts ab dem Knopfblock: der Fuß steht im DOM dahinter.
        await page
          .locator('[data-lfh="karten-knoepfe"]')
          .getByRole('button', { name: 'Hineinzoomen', exact: true })
          .focus();
        const vor = await pruefeFokusVerdeckung(page, 30, 'Tab', optionen);
        expect([...vor.besuchteZiele].sort(), 'vorwärts: jedes Ziel im Modusband besucht').toEqual(
          alleBandStopps,
        );
        expect(vor.stoppsInRegion, 'vorwärts: durch die Zeitachse').toBeGreaterThan(0);
        expect(vor.verdeckt, `vorwärts:\n${vor.verdeckt.join('\n')}`).toEqual([]);

        // Rückwärts ab dem letzten Ziel im Fuß.
        await page.locator('[data-lfh="karten-fuss"]').evaluate((fuss, sel) => {
          const stopps = fuss.querySelectorAll<HTMLElement>(sel);
          stopps[stopps.length - 1].focus();
        }, TABSTOPP);
        const rueck = await pruefeFokusVerdeckung(page, 30, 'Shift+Tab', optionen);
        expect(
          [...rueck.besuchteZiele].sort(),
          'rückwärts: jedes Ziel im Modusband besucht',
        ).toEqual(alleBandStopps);
        expect(rueck.stoppsInRegion, 'rückwärts: durch die Zeitachse').toBeGreaterThan(0);
        expect(rueck.verdeckt, `rückwärts:\n${rueck.verdeckt.join('\n')}`).toEqual([]);

        test.info().annotations.push({
          type: 'messwert',
          description:
            `${viewport.width}×${viewport.height}/handschuh ${modus.name}: Karte ${hoehen.karte} px, ` +
            `Zeitachse ${hoehen.zeitachse} px, Band ${hoehen.bandOben} px unter der Kartenoberkante, ` +
            `${bandStopps} Bandziele, ${vor.stoppsInRegion}/${rueck.stoppsInRegion} Zeitachsenstopps vor/rück, ` +
            `kleinster sichtbarer Rest eines Zeitachsenziels ${rest(vor, rueck)}, keines ganz verdeckt`,
        });
      });
    }
  });
}
