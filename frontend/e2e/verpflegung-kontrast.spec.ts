import { expect, test, type Locator, type Page } from '@playwright/test';
import { kontrast, randKontrast } from './kontrast-kern';

/**
 * Kriterium 5 der Prüfliste für `/einsaetze/:id/verpflegung`: Kontrast der ZUSAMMENGESETZTEN
 * Paare in Tag und Nacht, mit dem geteilten Messkern (`kontrast-kern.ts`) und ohne Farbwerte
 * aus dem Produkt — eine schlechte Palette muss rot werden.
 *
 * GESÄT: „Frühstück Kontrast" in UNTERDECKUNG (gültige Ausgabe mit Sonderkost und Bemerkung,
 * eine zurückgenommene, Sonderkost-Fehlmenge „fehlt 8 vegan"), „Mittag Kontrast" GEDECKT,
 * „Abendessen Kontrast" OFFEN (Beginn in drei Stunden, Fehlmenge ohne Alarm).
 *
 * SCHRANKEN (Literale): Text Tag ≥ 7 : 1, Nacht ≥ 5 : 1 für JEDEN Text in Inhalt, Seitenkopf
 * und den beiden Hauptdialogen — über den Textbaum gefunden, gegen den Grund gemessen, auf dem
 * er WIRKLICH steht. Zustandstragende Kartenränder und Etikettränder ≥ 3 : 1 (WCAG 1.4.11).
 *
 * DER KRITISCHE FALL „Unterdeckung" am Tag: Etikett, Fehlmenge im Kennzahlenband und
 * Sonderkost-Fehlmenge laufen über `alarmText`, nicht über `alarm` (trägt den Tagesboden nicht).
 * Die drei Paare stehen einzeln und benannt — im Textbaum wären „8" oder „60" nicht zuzuordnen.
 * Nachts ist `alarmText` wertgleich mit `alarm`.
 *
 * KEINE AUSNAHME: Tertiärtext (`schwach`, LFH-643) und die Beschriftung des Primärknopfs (Weiß
 * auf `bedien`, LFH-661) tragen den vollen Boden (Specs `textstufen-kontrast`,
 * `farbrollen-kontrast`).
 *
 * Der Rand der OFFENEN Karte trägt keinen Zustand (Linienfarbe) — gemessen und angehängt, und
 * zugesichert, dass er sich von den Zustandsrändern unterscheidet. Sichtbarer Text unter
 * `aria-hidden` (Legende der Bedarfs-Aufgliederung) überspringt der Textbaum; er wird eigens
 * gemessen. Nicht gemessen: Platzhalter-Attribute von `<input>` (kein Textknoten).
 */

const TEXT = { light: 7, dark: 5 } as const;
const ZUSTAND = 3;

const KARTEN = [
  { stufe: 'unterdeckung', name: 'Frühstück Kontrast', wort: 'Unterdeckung' },
  { stufe: 'gedeckt', name: 'Mittag Kontrast', wort: 'gedeckt' },
  { stufe: 'offen', name: 'Abendessen Kontrast', wort: 'offen' },
] as const;

async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill('admin');
  await page.getByLabel('Passwort').fill(process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw');
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

async function post<T = { id: number }>(page: Page, pfad: string, data?: unknown): Promise<T> {
  const r = await page.request.post(pfad, { data });
  expect(r.ok(), `${pfad}: ${r.status()} ${await r.text()}`).toBeTruthy();
  return (await r.json()) as T;
}

/** Karte über das Präfix ihres zugänglichen Namens — dahinter steht der Zeitraum. */
const karteZu = (page: Page, name: string) =>
  page.getByRole('article', { name: new RegExp(`^Zeitfenster ${name} `) });

interface Textknoten {
  ziel: Locator;
  text: string;
}

/** Jedes SICHTBARE Element unter `wurzel` mit eigenem Text, als Locator über eine Messmarke.
 *  Unsichtbares wird übersprungen (die Dialoge tragen eingeklappte Felder per `forceRender`),
 *  die Bereiche werden deshalb vorher AUFGEKLAPPT. */
async function textknoten(wurzel: Locator): Promise<Textknoten[]> {
  const funde = await wurzel.evaluate((w) => {
    for (const alt of document.querySelectorAll('[data-kontrastprobe]'))
      alt.removeAttribute('data-kontrastprobe');
    const liste: { text: string }[] = [];
    for (const el of [w, ...w.querySelectorAll('*')]) {
      if (el.closest('[aria-hidden="true"]')) continue;
      if (!el.checkVisibility()) continue;
      const eigen = [...el.childNodes]
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent ?? '')
        .join('')
        .trim();
      if (!eigen) continue;
      el.setAttribute('data-kontrastprobe', String(liste.length));
      liste.push({ text: eigen });
    }
    return liste;
  });
  return funde.map((f, i) => ({ ...f, ziel: wurzel.locator(`[data-kontrastprobe="${i}"]`) }));
}

for (const modus of ['light', 'dark'] as const) {
  test(`Verpflegung: Zeitfensterkarten, Kopf und Dialoge — Text und Rand im Modus ${modus}`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1366, height: 900 });
    await anmelden(page);
    const { id: einsatzId } = await post(page, '/api/einsaetze', {
      bezeichnung: `E2E 634 Kontrast ${Date.now()}`,
    });
    const basis = `/api/einsaetze/${einsatzId}/verpflegung`;
    const jetzt = Date.now();
    const zeit = (minuten: number) => new Date(jetzt + minuten * 60_000).toISOString();

    // Unterdeckung: 90 EP Bedarf, 30 gültig ausgegeben, eine zurückgenommene Ausgabe.
    const fruehstueck = await post(page, `${basis}/zeitfenster`, {
      bezeichnung: 'Frühstück Kontrast',
      von_at: zeit(-40),
      bis_at: zeit(80),
      bedarf_kraefte: 60,
      bedarf_betreute: 30,
      sonderkost: { vegetarisch: 10, vegan: 12 },
    });
    await post(page, `${basis}/zeitfenster/${fruehstueck.id}/ausgaben`, {
      menge: 30,
      zeitpunkt_at: zeit(-35),
      ort: 'Feldküche Nord',
      sonderkost: { vegetarisch: 10, vegan: 4 },
      bemerkung: 'Rest folgt mit der zweiten Tour',
    });
    const falsch = await post<{ ausgabe_id: number }>(
      page,
      `${basis}/zeitfenster/${fruehstueck.id}/ausgaben`,
      { menge: 25, zeitpunkt_at: zeit(-30), ort: 'Deichweg' },
    );
    await post(page, `${basis}/ausgaben/${falsch.ausgabe_id}/zuruecknehmen`);
    // Gedeckt: 40 EP Bedarf, 40 ausgegeben.
    const mittag = await post(page, `${basis}/zeitfenster`, {
      bezeichnung: 'Mittag Kontrast',
      von_at: zeit(-10),
      bis_at: zeit(110),
      bedarf_kraefte: 30,
      bedarf_betreute: 10,
    });
    await post(page, `${basis}/zeitfenster/${mittag.id}/ausgaben`, {
      menge: 40,
      zeitpunkt_at: zeit(-5),
      ort: 'Feldküche Süd',
    });
    // Offen: Beginn in drei Stunden, keine Ausgabe, Sonderkost-Fehlmenge ohne Alarm.
    await post(page, `${basis}/zeitfenster`, {
      bezeichnung: 'Abendessen Kontrast',
      von_at: zeit(180),
      bis_at: zeit(240),
      bedarf_kraefte: 50,
      bedarf_betreute: 20,
      sonderkost: { vegan: 6 },
    });

    await page.evaluate((m) => localStorage.setItem('lifeline-hub.theme', m), modus);
    await page.goto(`/einsaetze/${einsatzId}/verpflegung`);
    await expect(page.locator('html')).toHaveAttribute('data-theme', modus);
    await expect(page.locator('[data-lfh="verpflegung-karte"]')).toHaveCount(KARTEN.length);
    // Den EINGESCHWUNGENEN Stand messen: das Menü an der Unterdeckungskarte hängt an den
    // Modul-Overrides, die nach dem ersten Bild eintreffen — vorher zeigten Messmarken ins Leere.
    await expect(
      karteZu(page, 'Frühstück Kontrast').getByRole('button', {
        name: /^Aktionen zu Zeitfenster Frühstück Kontrast /,
      }),
    ).toHaveCount(1);
    await page.mouse.move(0, 0);

    const messwerte: Record<string, unknown>[] = [];
    const raender: Record<string, string> = {};

    // (1) Ränder und Etikett je Einstufung.
    for (const k of KARTEN) {
      const karte = karteZu(page, k.name);
      await expect(karte).toHaveAttribute('data-einstufung', k.stufe);
      // `data-alarm` nur bei Unterdeckung — außerhalb fehlt das Attribut ganz.
      if (k.stufe === 'unterdeckung') await expect(karte).toHaveAttribute('data-alarm', 'true');
      else await expect(karte).not.toHaveAttribute('data-alarm');

      const rand = await randKontrast(karte, 'left');
      raender[k.stufe] = rand.rand.join();
      messwerte.push({ modus, karte: k.stufe, art: 'kartenrand', ...rand });
      if (k.stufe !== 'offen') {
        const kontext = `${modus}, ${k.stufe}, Kartenrand ${JSON.stringify(rand)}`;
        expect
          .soft(rand.gegenAussen, `${kontext} gegen Seitengrund`)
          .toBeGreaterThanOrEqual(ZUSTAND);
        expect
          .soft(rand.gegenInnen, `${kontext} gegen Kartenfläche`)
          .toBeGreaterThanOrEqual(ZUSTAND);
      }

      const etikett = karte.locator('.ant-tag');
      await expect(etikett).toHaveCount(1);
      await expect(etikett).toHaveText(k.wort);
      const tagRand = await randKontrast(etikett, 'top');
      messwerte.push({ modus, karte: k.stufe, art: 'etikettrand', ...tagRand });
      const kontext = `${modus}, ${k.stufe}, Etikettrand ${JSON.stringify(tagRand)}`;
      expect
        .soft(tagRand.gegenAussen, `${kontext} gegen Kartenfläche`)
        .toBeGreaterThanOrEqual(ZUSTAND);
      expect
        .soft(tagRand.gegenInnen, `${kontext} gegen eigene Tönung`)
        .toBeGreaterThanOrEqual(ZUSTAND);

      // Legende der Aufgliederung: sichtbar, aber `aria-hidden` — der Textbaum sähe sie nicht.
      const legende = karte.locator('[data-lfh="aufgliederung"] + div');
      await expect(legende).toHaveCount(1);
      const m = await kontrast(legende);
      messwerte.push({ modus, karte: k.stufe, art: 'legende', ...m });
      expect
        .soft(
          m.verhaeltnis,
          `${modus}, ${k.stufe}, Aufgliederungslegende: ${m.verhaeltnis.toFixed(2)} : 1 ${JSON.stringify(m)}`,
        )
        .toBeGreaterThanOrEqual(TEXT[modus]);
    }
    // Offen trägt keinen Zustand am Rand — dann darf er auch keinem gleichen.
    expect(raender.offen).not.toBe(raender.gedeckt);
    expect(raender.offen).not.toBe(raender.unterdeckung);

    // (2) Der kritische Fall, benannt und an der Unterdeckungskarte gescopt.
    const unter = karteZu(page, 'Frühstück Kontrast');
    const fehlmenge = unter.locator(
      '[data-lfh="kennzahl"][data-ton="alarm"] [data-lfh="kennzahl-wert"]',
    );
    await expect(fehlmenge).toHaveCount(1);
    await expect(fehlmenge).toHaveText('60');
    const skFehlt = unter.locator('li[data-kostform="vegan"] [data-lfh="sonderkost-fehlt"]');
    await expect(skFehlt).toHaveText('fehlt 8 vegan');
    for (const [was, ziel] of [
      ['Etikett', unter.locator('.ant-tag')],
      ['Fehlmenge', fehlmenge],
      ['Sonderkost-Fehlmenge', skFehlt],
    ] as const) {
      const m = await kontrast(ziel);
      messwerte.push({ modus, karte: 'unterdeckung', art: `kritisch: ${was}`, ...m });
      expect
        .soft(
          m.verhaeltnis,
          `${modus}, Unterdeckung: ${was}: ${m.verhaeltnis.toFixed(2)} : 1 (Soll ≥ ${TEXT[modus]}) ${JSON.stringify(m)}`,
        )
        .toBeGreaterThanOrEqual(TEXT[modus]);
    }

    // (3) Jeder Text — Seitenkopf, Seiteninhalt und die beiden Hauptdialoge.
    const inhalt = page.locator('[data-lfh="seiten-inhalt"]');
    const kopf = page.locator('[data-lfh="seitenkopf"]');
    const gemessen: string[] = [];
    const messeTexte = async (wurzel: Locator, flaeche: string) => {
      await page.mouse.move(0, 0);
      const knoten = await textknoten(wurzel);
      // Ein Dialog blendet mit Opacity ein; erst messen, wenn der erste Knoten steht.
      await expect(async () => {
        await kontrast(knoten[0].ziel);
      }).toPass({ timeout: 10_000 });
      for (const { ziel, text } of knoten) {
        const m = await kontrast(ziel);
        const kontext = `${modus}, ${flaeche}, „${text}": ${m.verhaeltnis.toFixed(2)} : 1 (Schranke ≥ ${TEXT[modus]}) ${JSON.stringify(m)}`;
        messwerte.push({ modus, flaeche, art: 'text', wortlaut: text, ...m });
        gemessen.push(text);
        expect.soft(m.verhaeltnis, kontext).toBeGreaterThanOrEqual(TEXT[modus]);
      }
    };
    await messeTexte(kopf, 'kopf');
    await messeTexte(inhalt, 'inhalt');

    for (const [ausloeser, titel, bereich, bereichsFeld] of [
      [
        kopf.getByRole('button', { name: 'Zeitfenster anlegen', exact: true }),
        'Zeitfenster anlegen',
        'Weitere Personen und Sonderkost',
        'Weitere Personen (EP)',
      ],
      [
        unter.getByRole('button', { name: /^Ausgabe erfassen zu Frühstück Kontrast / }),
        'Ausgabe erfassen: Frühstück Kontrast',
        'Weitere Angaben',
        'Bemerkung',
      ],
    ] as const) {
      await ausloeser.click();
      const dialog = page.getByRole('dialog', { name: titel });
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: bereich }).click();
      await expect(dialog.getByLabel(bereichsFeld, { exact: true })).toBeVisible();
      // Das Aufklappen animiert Höhe UND Opacity; erst messen, wenn die Bewegung vorbei ist.
      await expect(dialog.locator('.ant-collapse-panel')).toHaveCount(1);
      await expect(dialog.locator('.ant-collapse-panel')).not.toHaveClass(/ant-motion-collapse/);
      await messeTexte(dialog, titel);
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
    }

    // Die Probe hat die Texte wirklich gesehen — sonst wäre ein grüner Lauf trivial wahr.
    const pruefeGesehen = (pflicht: string | RegExp) => {
      const treffer = gemessen.filter((t) =>
        typeof pflicht === 'string' ? t === pflicht : pflicht.test(t),
      );
      expect(treffer.length, `Text ${String(pflicht)} gemessen`).toBeGreaterThan(0);
    };
    for (const tragend of [
      ...KARTEN.flatMap((k) => [k.name, k.wort]),
      /^\d\d\.\d\d\. \d\d:\d\d–(\d\d\.\d\d\. )?\d\d:\d\d$/,
      'fehlt 8 vegan',
      'fehlt 6 vegan',
      'Bedarf 12 · ausgegeben 4',
      // Deckungszeile im Dialog „Ausgabe erfassen“: dort die einzige Angabe der Fehlmenge.
      /^Bedarf \d+ · ausgegeben \d+ · fehlt \d+ EP$/,
      'vegan',
      '30 EP',
      'zurückgenommen',
      'Ausgabe',
      'Ausgabe erfassen',
      'Bedarf bearbeiten',
      'Zurücknehmen',
      'Verpflegung',
      /^3 Zeitfenster · 1 mit Unterdeckung$/,
      /^laufend & anstehend \(3\)$/,
      // Dialoge, samt je einem Feld aus dem aufgeklappten Bereich.
      'Bezeichnung',
      'Zeitraum',
      'Einsatzkräfte (EP)',
      'Betreute (EP)',
      'Weitere Personen und Sonderkost',
      'Weitere Personen (EP)',
      'Säugling/Kleinkind',
      'Menge (EP)',
      'Ort',
      'Zeitpunkt',
      'Weitere Angaben',
      'Nachforderung',
      'Bemerkung',
      // Primärknöpfe: Kopfknopf und Absende-Knöpfe der Dialoge (LFH-661).
      'Zeitfenster anlegen',
      'Anlegen',
      'Erfassen',
      // Tertiärtext (`schwach`), bis LFH-643 unter einer Ausnahme.
      'Sonderkost',
      'Bedarf',
      'EP',
      'Rest folgt mit der zweiten Tour',
      'Leer: jetzt',
      'Sonderkost ist ein Teil der Menge, kein Zuschlag.',
    ])
      pruefeGesehen(tragend);

    await test.info().attach('kontrastwerte.json', {
      body: JSON.stringify(messwerte, null, 2),
      contentType: 'application/json',
    });
  });
}
