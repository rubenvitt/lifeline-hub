import { expect, test, type Page } from '@playwright/test';
import { waehleIn } from './auswahl-kern';
import { anmeldenAlsAdmin } from './rollen-kern';

/**
 * UHS-Tablet (LFH-892, Subtask LFH-1024; Spec `feldgeraet-bedienung` und `funktionsansichten`):
 * ein Tablet mit grobem Zeiger bei 1024 × 768 startet auf der Patientenliste seiner UHS, nimmt
 * einen Patienten in deren Wartebereich auf, sieht die Person der anderen UHS nicht, bedient den
 * Grundriss ohne Platzbearbeitung und zeigt nach dem Widerruf „Kopplung beendet“, ohne dass
 * jemand neu lädt: der Server schließt den Einsatzstrom, der Client prüft die Sitzung.
 *
 * Seeding als Admin über die API, die Gerätesitzung in einem eigenen Kontext (eigener
 * Cookie-Jar). Kein `networkidle` (LFH-385).
 *
 * Mutationsprobe: in `GeraeteLayout` `useEinsatzLiveStream` entfernt → der letzte Schritt bleibt
 * auf der Patientenliste stehen (rot).
 */

async function anlegen<T = { id: number }>(page: Page, pfad: string, data?: unknown): Promise<T> {
  const antwort = await page.request.post(pfad, data === undefined ? {} : { data });
  expect(antwort.ok(), `${pfad}: ${antwort.status()} ${await antwort.text()}`).toBeTruthy();
  return (await antwort.json()) as T;
}

/** Die Sichtungs-Auswahlfläche über ihre Beschriftung (wie `personen-aufnahme.spec.ts`). */
function skFlaeche(page: Page, label: string) {
  return page.locator('#sichtung').getByRole('radio', { name: new RegExp(`^${label},`) });
}

test('LFH-1024: Tablet nimmt auf, kennt nur die eigene UHS und endet beim Widerruf', async ({
  page,
  browser,
}) => {
  await anmeldenAlsAdmin(page);
  const einsatz = await anlegen(page, '/api/einsaetze', {
    bezeichnung: `E2E Tablet ${Date.now()}`,
  });
  const e = einsatz.id;
  const nord = await anlegen(page, `/api/einsaetze/${e}/uhs`, {
    typ: 'behandlungsplatz',
    bezeichnung: 'UHS Nord',
  });
  const sued = await anlegen(page, `/api/einsaetze/${e}/uhs`, {
    typ: 'behandlungsplatz',
    bezeichnung: 'UHS Süd',
  });
  for (const u of [nord, sued]) {
    await anlegen(page, `/api/einsaetze/${e}/uhs/${u.id}/status`, { status: 'aktiv' });
  }
  // Eine Person der anderen UHS: das Tablet darf sie nicht sehen.
  await anlegen(page, `/api/einsaetze/${e}/personen`, {
    name: 'Fremdling',
    sichtung: 'sk3',
    uhs_id: sued.id,
  });
  const kopplung = await anlegen<{ kopplung: { id: number }; code: { code: string } }>(
    page,
    `/api/einsaetze/${e}/geraete`,
    { ansicht: 'uhs-tablet', uhs_id: nord.id, bezeichnung: 'Tablet 1' },
  );

  const kontext = await browser.newContext({
    viewport: { width: 1024, height: 768 },
    hasTouch: true,
  });
  const tablet = await kontext.newPage();
  try {
    await tablet.goto(`/koppeln#${kopplung.code.code}`);
    await tablet.getByRole('button', { name: 'Gerät koppeln' }).click();

    // Start: die Patientenliste der eigenen UHS, „Patient aufnehmen“ als Primäraktion.
    await expect(tablet).toHaveURL(new RegExp(`/geraet/${e}/patienten$`));
    expect(await tablet.evaluate(() => window.matchMedia('(pointer: coarse)').matches)).toBe(true);
    await expect(tablet.getByRole('heading', { level: 1, name: 'Patienten' })).toBeVisible();
    await expect(tablet.getByRole('button', { name: 'Patient aufnehmen' })).toBeVisible();
    await expect(
      tablet.getByText('Noch keine Patienten in dieser Unfallhilfsstelle'),
    ).toBeVisible();
    await expect(tablet.getByText('Fremdling')).toHaveCount(0);

    // Aufnahme aus der Navigation am unteren Rand: landet im Wartebereich der eigenen UHS.
    const nav = tablet.getByRole('navigation', { name: 'Gerätenavigation' });
    await nav.getByRole('link', { name: 'Aufnahme' }).click();
    await expect(tablet).toHaveURL(new RegExp(`/geraet/${e}/aufnahme\\?uhs=${nord.id}$`));
    await skFlaeche(tablet, 'SK II').click();
    await tablet.getByRole('button', { name: 'Speichern und nächste' }).click();
    await expect(tablet.getByText(/Erfasst als R-\d{3} · SK II · im Wartebereich/)).toBeVisible();

    await nav.getByRole('link', { name: 'Patienten' }).click();
    await expect(tablet.getByText('Wartebereich').first()).toBeVisible();
    await expect(tablet.getByText('Fremdling')).toHaveCount(0);

    // Grundriss: belegen und Verfügbarkeit ja, Plätze bearbeiten und UHS verwalten nein.
    await nav.getByRole('link', { name: 'Grundriss' }).click();
    await expect(tablet).toHaveURL(new RegExp(`/geraet/${e}/uhs/${nord.id}$`));
    await expect(tablet.getByRole('heading', { level: 1, name: /UHS Nord/ })).toBeVisible();
    await expect(tablet.getByRole('button', { name: 'Plätze bearbeiten' })).toHaveCount(0);
    await expect(tablet.getByRole('button', { name: 'Auflösen' })).toHaveCount(0);
    // Keine Reiterleiste für Material, Bewegungen und Dateien. Die Reiter des Grundrisses selbst
    // stehen: bei 1024 px passt die Fläche nicht neben beide Seitenspalten (`dreiSpaltenPassen`).
    await expect(tablet.getByRole('tablist', { name: /Material|Bewegungen|Dateien/ })).toHaveCount(
      0,
    );
    await expect(tablet.getByRole('tab', { name: 'Fläche' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    // Widerruf durch die Einsatzleitung: das Tablet endet von selbst, ohne Neuladen.
    await anlegen(page, `/api/einsaetze/${e}/geraete/${kopplung.kopplung.id}/widerrufen`);
    await expect(tablet).toHaveURL(/\/kopplung-beendet$/);
    await expect(tablet.getByRole('heading', { name: 'Kopplung beendet' })).toBeVisible();
    await expect(tablet.getByText('UHS Nord')).toHaveCount(0);
  } finally {
    await kontext.close();
  }
});

/**
 * Bediener am Gerät (LFH-1046, Spec `geraete-kopplung`): am Tablet nennt die Sichtung eine
 * Person aus dem Einsatzpersonal; der Verlauf zeigt sie, das ETB nennt Gerät, Stelle und Person.
 *
 * Mutationsprobe: in `SichtungDialog` `<BestaetigtVonFeld>` entfernt → das Feld fehlt (rot).
 */
test('LFH-1046: Tablet bestätigt eine Sichtung namentlich', async ({ page, browser }) => {
  await anmeldenAlsAdmin(page);
  const e = (await anlegen(page, '/api/einsaetze', { bezeichnung: `E2E Bediener ${Date.now()}` }))
    .id;
  const nord = await anlegen(page, `/api/einsaetze/${e}/uhs`, {
    typ: 'behandlungsplatz',
    bezeichnung: 'UHS Nord',
  });
  await anlegen(page, `/api/einsaetze/${e}/uhs/${nord.id}/status`, { status: 'aktiv' });
  await anlegen(page, `/api/einsaetze/${e}/personal`, {
    adhoc: { name: 'Dr. A. Muster', funktion: 'Notärztin' },
  });
  const person = await anlegen(page, `/api/einsaetze/${e}/personen`, {
    name: 'Patient',
    uhs_id: nord.id,
  });
  const kopplung = await anlegen<{ code: { code: string } }>(page, `/api/einsaetze/${e}/geraete`, {
    ansicht: 'uhs-tablet',
    uhs_id: nord.id,
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

    await tablet.goto(`/geraet/${e}/patienten/${person.id}`);
    // Nachsichten im Patientenkopf, ohne Dialog (LLH-1094).
    const kopf = tablet.getByRole('region', { name: 'Patientenkopf' });
    await kopf.getByRole('button', { name: /^Sichten, bisher ungesichtet|^Nachsichten/ }).click();
    const paneel = tablet.getByRole('region', { name: 'Sichtung erfassen' });
    await paneel.getByRole('radio', { name: /^SK II,/ }).click();
    await waehleIn(
      paneel.getByRole('combobox', { name: 'Bestätigt von' }),
      'Dr. A. Muster · Notärztin',
    );
    await paneel.getByRole('button', { name: 'Übernehmen' }).click();
    await expect(paneel).toHaveCount(0);
    await expect(kopf.locator('[data-lfh="sichtung-zeit"]')).toContainText(
      'bestätigt: Dr. A. Muster',
    );
  } finally {
    await kontext.close();
  }

  const etb = (await (await page.request.get(`/api/einsaetze/${e}/etb`)).json()) as {
    typ: string;
    inhalt: string;
    erfasser_name: string;
  }[];
  const eintrag = etb.find((x) => x.typ === 'system' && x.inhalt.includes('Sichtung SK II'));
  expect(eintrag?.inhalt).toMatch(/, bestätigt: Dr\. A\. Muster$/);
  expect(eintrag?.erfasser_name).toBe('UHS Nord · Tablet 1');
});

/**
 * Bediener am Gerät auch für Verletzungen (Change `y18v58dt-pat-kern`, Spec `geraete-kopplung`,
 * „Namentliche Bestätigung am Gerät“): am Tablet markiert jemand eine Verletzung am Körperschema
 * und nennt unter „Bestätigt von“ die Notärztin. Der Server speichert Name und Kennung am
 * Eintrag, der Verlauf nennt sie, Erfasser bleibt das Gerät; ins ETB kommt keine Verletzung.
 *
 * Mutationsprobe: in `Koerperschema.tsx` `<BestaetigtVonFeld>` entfernt → das Feld fehlt (rot).
 */
test('Tablet markiert eine Verletzung mit „Bestätigt von“', async ({ page, browser }) => {
  await anmeldenAlsAdmin(page);
  const e = (
    await anlegen(page, '/api/einsaetze', { bezeichnung: `E2E Verletzung Gerät ${Date.now()}` })
  ).id;
  const nord = await anlegen(page, `/api/einsaetze/${e}/uhs`, {
    typ: 'behandlungsplatz',
    bezeichnung: 'UHS Nord',
  });
  await anlegen(page, `/api/einsaetze/${e}/uhs/${nord.id}/status`, { status: 'aktiv' });
  await anlegen(page, `/api/einsaetze/${e}/personal`, {
    adhoc: { name: 'Dr. A. Muster', funktion: 'Notärztin' },
  });
  const person = await anlegen(page, `/api/einsaetze/${e}/personen`, {
    name: 'Patient',
    geschlecht: 'weiblich',
    sichtung: 'sk2',
    uhs_id: nord.id,
  });
  const kopplung = await anlegen<{ code: { code: string } }>(page, `/api/einsaetze/${e}/geraete`, {
    ansicht: 'uhs-tablet',
    uhs_id: nord.id,
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

    await tablet.goto(`/geraet/${e}/patienten/${person.id}`);
    const kopf = tablet.getByRole('region', { name: 'Patientenkopf' });
    await kopf.getByRole('button', { name: 'Verletzung markieren' }).click();
    const paneel = tablet.getByRole('region', { name: 'Verletzung markieren' });
    await expect(tablet.getByRole('dialog')).toHaveCount(0);
    // Erster Tipp: die Region; die Wahl der Art trägt „Bestätigt von“ ohne Vorauswahl.
    await paneel.getByRole('button', { name: 'Unterarm links, vorn' }).click();
    const wahl = paneel.getByRole('group', { name: 'Verletzung an Unterarm links, vorn' });
    const bestaetigt = wahl.getByRole('combobox', { name: 'Bestätigt von' });
    await expect(bestaetigt).toHaveValue('');
    await waehleIn(bestaetigt, 'Dr. A. Muster · Notärztin');
    // Zweiter Tipp: die Art speichert.
    await wahl.getByRole('radio', { name: 'Fraktur-Verdacht' }).click();
    await expect(
      paneel.getByRole('button', {
        name: 'Verletzung 1, Unterarm links, vorn · Fraktur-Verdacht',
      }),
    ).toBeVisible();
    // Der Verlauf nennt die bestätigende Person an der Verletzung.
    await expect(tablet.getByText('· bestätigt: Dr. A. Muster')).toBeVisible();
  } finally {
    await kontext.close();
  }

  const detail = (await (
    await page.request.get(`/api/einsaetze/${e}/personen/${person.id}`)
  ).json()) as {
    verletzungen: { region: string; bestaetigt_name?: string }[];
  };
  expect(detail.verletzungen).toHaveLength(1);
  expect(detail.verletzungen[0]).toMatchObject({
    region: 'unterarm_l',
    bestaetigt_name: 'Dr. A. Muster',
  });
  const etb = (await (await page.request.get(`/api/einsaetze/${e}/etb`)).json()) as {
    inhalt: string;
  }[];
  expect(etb.some((x) => /Unterarm|Fraktur/.test(x.inhalt))).toBe(false);
});

/** Backend-Zeit „YYYY-MM-DD HH:MM:SS“ (UTC) in Millisekunden. */
const ms = (zeit: string) => Date.parse(`${zeit.replace(' ', 'T')}Z`);

/**
 * Ohne Netz am Tablet (LLH-1138, Change `y18v58dt-pat-kern`, design.md D8; Specs
 * `feldgeraet-bedienung` „Nachsichtung ohne Netz“, `personen-detail` „Nachsichtung am Tablet ohne
 * Netz“, `personen-verlauf`): Nachsichtung, Verbleib und Notiz gehen ohne Netz in die
 * Warteschlange, der Kopf und die Notizzeile quittieren „Offline vorgemerkt“. Mit dem Netz geht
 * jeder Eintrag genau einmal hinaus und steht mit seiner Erfassungszeit im Verlauf, nicht mit der
 * Zeit der Übertragung.
 *
 * Mutationsprobe: in `Patientenkopf` `networkMode: 'always'` der Sichtung entfernt → TanStack hält
 * die Mutation an, „Offline vorgemerkt“ erscheint nie (rot).
 */
test('LLH-1138: Tablet sichtet nach, erfasst Verbleib und Notiz ohne Netz', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  await anmeldenAlsAdmin(page);
  const e = (await anlegen(page, '/api/einsaetze', { bezeichnung: `E2E Offline ${Date.now()}` }))
    .id;
  const nord = await anlegen(page, `/api/einsaetze/${e}/uhs`, {
    typ: 'behandlungsplatz',
    bezeichnung: 'UHS Nord',
  });
  await anlegen(page, `/api/einsaetze/${e}/uhs/${nord.id}/status`, { status: 'aktiv' });
  const person = await anlegen(page, `/api/einsaetze/${e}/personen`, {
    name: 'Patient',
    sichtung: 'sk3',
    uhs_id: nord.id,
  });
  const kopplung = await anlegen<{ code: { code: string } }>(page, `/api/einsaetze/${e}/geraete`, {
    ansicht: 'uhs-tablet',
    uhs_id: nord.id,
    bezeichnung: 'Tablet 1',
  });

  const kontext = await browser.newContext({
    viewport: { width: 1024, height: 768 },
    hasTouch: true,
  });
  const tablet = await kontext.newPage();
  const posts: string[] = [];
  tablet.on('request', (r) => {
    const pfad = new URL(r.url()).pathname;
    if (r.method() === 'POST' && /\/personen\/\d+\/(sichtung|verbleib|notizen)$/.test(pfad)) {
      posts.push(pfad.split('/').pop()!);
    }
  });
  try {
    await tablet.goto(`/koppeln#${kopplung.code.code}`);
    await tablet.getByRole('button', { name: 'Gerät koppeln' }).click();
    await expect(tablet).toHaveURL(new RegExp(`/geraet/${e}/patienten$`));
    // Geladen wird online: ohne Netz geht nur, was im Speicher des Tabs steht (D8).
    await tablet.goto(`/geraet/${e}/patienten/${person.id}`);
    const kopf = tablet.getByRole('region', { name: 'Patientenkopf' });
    await expect(kopf.getByRole('button', { name: /^Nachsichten, aktuell SK III/ })).toBeVisible();

    const offlineAb = Date.now();
    await kontext.setOffline(true);

    // Nachsichtung im Kopf.
    await kopf.getByRole('button', { name: /^Nachsichten/ }).click();
    const sichtung = tablet.getByRole('region', { name: 'Sichtung erfassen' });
    await sichtung.getByRole('radio', { name: /^SK II,/ }).click();
    await sichtung.getByRole('button', { name: 'Übernehmen' }).click();
    await expect(sichtung).toHaveCount(0);
    const quittung = kopf.getByRole('region', { name: 'Offline vorgemerkt' });
    await expect(quittung).toContainText('Sichtung SK II');
    // Der Kopf zeigt weiter den Serverstand.
    await expect(kopf.getByRole('button', { name: /^Nachsichten, aktuell SK III/ })).toBeVisible();

    // Verbleib als Paneel.
    await kopf.getByRole('button', { name: 'Verbleib erfassen' }).click();
    const verbleib = tablet.getByRole('region', { name: 'Verbleib erfassen' });
    await waehleIn(verbleib.getByRole('combobox', { name: 'Art' }), 'Transport');
    await verbleib.getByLabel('Ziel').fill('KH Mitte');
    await verbleib.getByRole('button', { name: 'Verbleib erfassen' }).click();
    await expect(verbleib).toHaveCount(0);
    await expect(quittung).toContainText('Verbleib Transport → KH Mitte');

    // Notiz über die Eingabezeile.
    const notizZeile = kopf.locator('[data-lfh="notiz-zeile"]');
    await notizZeile.getByRole('textbox', { name: 'Verlaufsnotiz' }).fill('Infusion läuft');
    await notizZeile.getByRole('button', { name: 'Notiz anlegen' }).click();
    await expect(notizZeile.locator('[data-lfh="notiz-vorgemerkt"]')).toContainText(
      'Infusion läuft',
    );
    await expect(notizZeile.getByRole('textbox', { name: 'Verlaufsnotiz' })).toHaveValue('');
    expect(posts).toEqual([]);

    // Ein paar Sekunden ohne Netz: die Erfassungszeit liegt messbar vor der Übertragung.
    await tablet.waitForTimeout(2_500);
    const offlineBis = Date.now();
    await kontext.setOffline(false);

    // Die Warteschlange sendet; die Quittungen gehen, der Verlauf trägt die Einträge.
    await expect(quittung).toHaveCount(0, { timeout: 30_000 });
    await expect(notizZeile.locator('[data-lfh="notiz-vorgemerkt"]')).toHaveCount(0);
    await expect(kopf.getByRole('button', { name: /^Nachsichten, aktuell SK II/ })).toBeVisible();
    await expect(kopf.locator('[data-lfh="letzte-notiz"]')).toContainText('Infusion läuft');
    expect([...posts].sort()).toEqual(['notizen', 'sichtung', 'verbleib']);

    // Genau einmal, mit der Erfassungszeit von unterwegs (Sekunden des Servers, daher ± 1 s).
    const detail = (await (
      await page.request.get(`/api/einsaetze/${e}/personen/${person.id}`)
    ).json()) as {
      sichtungen: { kategorie: string; gesichtet_at: string; eingegangen_at?: string | null }[];
      verbleib: {
        art: string;
        ziel: string | null;
        zeitpunkt_at: string;
        eingegangen_at?: string | null;
      }[];
      notizen: { text: string; erfasst_at: string; eingegangen_at?: string | null }[];
    };
    const sk2 = detail.sichtungen.filter((s) => s.kategorie === 'sk2');
    const transporte = detail.verbleib.filter((v) => v.ziel === 'KH Mitte');
    const notizen = detail.notizen.filter((n) => n.text === 'Infusion läuft');
    expect([sk2.length, transporte.length, notizen.length]).toEqual([1, 1, 1]);
    for (const [erfasst, eingang] of [
      [sk2[0].gesichtet_at, sk2[0].eingegangen_at],
      [transporte[0].zeitpunkt_at, transporte[0].eingegangen_at],
      [notizen[0].erfasst_at, notizen[0].eingegangen_at],
    ] as const) {
      expect(ms(erfasst)).toBeGreaterThanOrEqual(offlineAb - 1_000);
      expect(ms(erfasst)).toBeLessThanOrEqual(offlineBis);
      expect(ms(eingang!)).toBeGreaterThanOrEqual(offlineBis - 1_000);
      expect(ms(eingang!) - ms(erfasst)).toBeGreaterThanOrEqual(1_000);
    }
  } finally {
    await kontext.close();
  }
});
