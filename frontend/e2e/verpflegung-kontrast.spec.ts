import { expect, test, type Locator, type Page } from '@playwright/test';
import { kontrast, randKontrast } from './kontrast-kern';

/**
 * Kriterium 5 der Prüfliste Einsatztauglichkeit für `/einsaetze/:id/verpflegung` (LFH-634,
 * Aufgabe 6.2, Muster `abloesung-kontrast.spec.ts`): Kontrast der ZUSAMMENGESETZTEN Paare in
 * Tag und Nacht, gemessen im Browser mit dem geteilten Messkern (`kontrast-kern.ts`), ohne
 * Farbwerte aus dem Produkt zu importieren — eine schlechte Palette muss rot werden.
 *
 * GESÄT: je Einstufung ein laufendes bzw. anstehendes Zeitfenster —
 *  · „Frühstück Kontrast" UNTERDECKUNG (begonnen, Fehlmenge): eine gültige Ausgabe mit
 *    Sonderkost und Bemerkung, eine ZURÜCKGENOMMENE Ausgabe, Sonderkost-Fehlmenge „fehlt 8
 *    vegan" neben einer gedeckten Kostform;
 *  · „Mittag Kontrast" GEDECKT durch eine Ausgabe;
 *  · „Abendessen Kontrast" OFFEN (Beginn in drei Stunden) mit Sonderkost-Fehlmenge ohne Alarm.
 *
 * SCHRANKEN (Literale; Kriterium 5 und WCAG 1.4.11):
 *  · Text Tag ≥ 7 : 1, Nacht ≥ 5 : 1 — für JEDEN Text im Seiteninhalt, im Seitenkopf und in
 *    den beiden Hauptdialogen („Zeitfenster anlegen", „Ausgabe erfassen"), gefunden über den
 *    Textbaum statt über eine Selektorliste; gemessen gegen den Grund, auf dem er WIRKLICH
 *    steht (LFH-618, Regel 3: Kartenfläche, Etikett-Tönung, Dialogfläche);
 *  · der linke Rand der Karte, wo er einen Zustand trägt (gedeckt, Unterdeckung), gegen den
 *    Seitengrund und gegen die eigene Kartenfläche: ≥ 3 : 1;
 *  · der Rand des Etiketts gegen die Kartenfläche und gegen seine eigene Tönung: ≥ 3 : 1.
 *
 * DER KRITISCHE FALL — „Unterdeckung" im Tagmodus (LFH-618, Regel 1): Etikett, Fehlmenge im
 * Kennzahlenband und die Sonderkost-Fehlmenge laufen über `alarmText`, nicht über die
 * Füllfarbe `alarm` (die trägt den Tagesboden 7 : 1 nicht). Die drei Paare sind deshalb
 * NICHT nur Teil des Textbaums, sondern stehen einzeln und benannt an der Unterdeckungskarte
 * — über den Textbaum wären „8" oder „60" zwischen drei Karten nicht zuzuordnen, und eine
 * benannte Zusicherung ist die Stelle, an der die Mutationsprobe rot wird.
 *
 * ZWEI BENANNTE AUSNAHMEN, dieselben wie in `abloesung-kontrast.spec.ts`, beide Eigenschaften
 * geteilter Rollen bzw. Primitive, nicht dieser Seite; hier gilt bis dahin die absolute
 * Untergrenze 4,5 : 1 aus Kriterium 5, der Zielwert steht in jeder Meldung:
 *  · TERTIÄRTEXT (`schwach`) → LFH-643, in BEIDEN Modi: Augenbrauen (Kennzahltitel,
 *    „Sonderkost"), die Einheit „EP" hinter der Kennzahl, der Hinweis (Bemerkung) einer
 *    Ausgabenzeile (`Zeitachseneintrag`, `hinweisTon` `schwach`), `Typography type="secondary"`
 *    samt „Stand" und den Sonderkost-Hinweisen der Dialoge, Feldhilfe, Platzhalter, Ortspfad im
 *    Seitenkopf bis auf das letzte Glied;
 *  · WEISS AUF `bedien` in jedem Primärknopf (Kopfaktion, Absende-Knopf der Dialoge) → LFH-661,
 *    nur am Tag.
 * Jeder andere Text — Bezeichnung, Zeitraum, Etikett, Kennzahlwerte, Sonderkost-Zeilen,
 * Ausgabenzeile, Typwort, Knöpfe, Feldbeschriftungen, Seitentitel und Kopf-Meta — trägt den
 * vollen Boden. FALLEN DIE AUSNAHMEN, wenn LFH-643/LFH-661 landen.
 *
 * DER RAND DER OFFENEN KARTE ist KEIN Zustandsträger: „offen" trägt die Linienfarbe
 * (`ZeitfensterKarte`: `stufe === 'offen' ? rollen.linie : …`), die Bedeutung liegt am
 * neutralen Etikett. 1.4.11 ist auf ihn nicht anwendbar — gemessen und angehängt wird er
 * trotzdem, und zugesichert wird, dass er sich von den beiden Zustandsrändern UNTERSCHEIDET.
 *
 * SICHTBARER TEXT UNTER `aria-hidden`: der Textbaum überspringt ihn (er wird nicht vorgelesen,
 * aber gesehen). Die Legende der Bedarfs-Aufgliederung („Kräfte 60 · Betreute 30 · weitere 0",
 * `gedaempft`) ist so ein Fall und wird deshalb eigens gemessen, mit vollem Boden.
 *
 * NICHT GEMESSEN: Platzhalter, die Attribute eines `<input>` sind (RangePicker „Beginn"/„Ende",
 * DatePicker „jetzt") — sie sind kein Textknoten, und der Messkern kennt kein `::placeholder`.
 *
 * MUTATIONSPROBE (Aufgabe 6.2, am 24.09.2026 lokal gefahren, nicht committet): `alarmText` →
 * `alarm` an DREI Stellen — der Alarm-Text in `components/instrument/statusFlaeche.ts`
 * (Etikett „Unterdeckung"), `zahlFarbe` für den Ton `alarm` in
 * `components/instrument/Kennzahl.tsx` (Fehlmenge im Kennzahlenband) und die Farbe von
 * `sonderkost-fehlt` in `verpflegung/ZeitfensterKarte.tsx`. Ergebnis: der TAGLAUF rot an allen
 * drei benannten Zusicherungen — „Unterdeckung: Etikett" 5,52 : 1 (auf `alarmFlaeche`),
 * „Unterdeckung: Fehlmenge" 6,78 : 1 (auf Weiß, der Fläche der Kennzahlzelle), „Unterdeckung:
 * Sonderkost-Fehlmenge" 6,21 : 1 (auf `paneel`) — und an denselben drei Wortlauten im
 * Textbaum; sonst nichts. Der Nachtlauf blieb grün: nachts ist `alarmText` wertgleich mit
 * `alarm` (#ff6b6b), er KANN diese Mutation nicht sehen. Danach zurückgesetzt.
 */

const TEXT = { light: 7, dark: 5 } as const;
/** Absolute Untergrenze aus Kriterium 5 („nie < 4,5 : 1"), für die zwei Ausnahmen oben. */
const BODEN = 4.5;
const ZUSTAND = 3;

/**
 * Tertiärtext, enumeriert — und zwar ausschließlich über Selektoren, die den TRÄGER selbst
 * treffen, nie einen Container: `closest()` senkte sonst still den Boden für alles darin.
 */
const TERTIAER = [
  '.ant-typography-secondary',
  // Augenbraue (`schwach`): Kennzahltitel, „Sonderkost".
  '.lfh-augenbraue',
  // Einheit „EP" hinter dem Kennzahlwert (`Kennzahl`, `monoStil(12)` in `schwach`).
  '[data-lfh="kennzahl-wert"] + span',
  // Hinweiszeile eines Zeitachseneintrags (Bemerkung der Ausgabe): dritte Zeile der
  // Inhaltsspalte, `hinweisTon` `schwach` (`Zeitachseneintrag`, Vorgabe).
  '[data-lfh-eintrag="zeitachse"] > div:nth-child(3) > div:nth-child(3)',
  // Die Feldhilfe der Dialoge — antds `colorTextDescription`.
  '.ant-form-item-extra',
  '.ant-select-placeholder',
  // Der Ortspfad im Seitenkopf bis auf sein letztes Glied (`EinsatzSeite`).
  '.lfh-seitenkopf__pfad li:not(:last-child)',
].join(', ');

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
  tertiaer: boolean;
  primaer: boolean;
}

/** Jedes SICHTBARE Element unter `wurzel` mit eigenem Text — als Locator über eine
 *  Messmarke, dazu ob es zu einer der Ausnahmen (Tertiärtext, Primärknopf) gehört.
 *  Anders als bei der Ablösung wird Unsichtbares übersprungen: die Dialoge tragen ihre
 *  eingeklappten Felder per `forceRender` im Baum, und ein unsichtbarer Text hätte einen
 *  Kontrast, den niemand sieht. Die Bereiche werden deshalb vor der Messung AUFGEKLAPPT. */
async function textknoten(wurzel: Locator): Promise<Textknoten[]> {
  const funde = await wurzel.evaluate((w, tertiaer) => {
    for (const alt of document.querySelectorAll('[data-kontrastprobe]'))
      alt.removeAttribute('data-kontrastprobe');
    const liste: { text: string; tertiaer: boolean; primaer: boolean }[] = [];
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
      liste.push({
        text: eigen,
        tertiaer: el.closest(tertiaer) != null,
        primaer: el.closest('.ant-btn-primary') != null,
      });
    }
    return liste;
  }, TERTIAER);
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
    // Den EINGESCHWUNGENEN Stand messen: „Nachfordern" (und damit das Menü an der
    // Unterdeckungskarte) hängt an den Modul-Overrides, die nach dem ersten Bild eintreffen.
    // Vorher trüge die Karte zwei Knöpfe, deren Messmarken danach ins Leere zeigten.
    await expect(
      karteZu(page, 'Frühstück Kontrast').getByRole('button', {
        name: /^Aktionen zu Zeitfenster Frühstück Kontrast /,
      }),
    ).toHaveCount(1);
    await page.mouse.move(0, 0);

    const messwerte: Record<string, unknown>[] = [];
    const raender: Record<string, string> = {};
    const tag = modus === 'light';

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
    const gemessen: [string, string | null][] = [];
    const messeTexte = async (wurzel: Locator, flaeche: string) => {
      await page.mouse.move(0, 0);
      const knoten = await textknoten(wurzel);
      // Ein Dialog blendet mit Opacity ein; der Messkern lehnt das ab, statt scheinpräzise
      // zu rechnen. Erst messen, wenn der erste Knoten eben steht.
      await expect(async () => {
        await kontrast(knoten[0].ziel);
      }).toPass({ timeout: 10_000 });
      for (const { ziel, text, tertiaer, primaer } of knoten) {
        const m = await kontrast(ziel);
        const ausnahme = tertiaer
          ? 'Tertiärtext → LFH-643'
          : tag && primaer
            ? 'Weiß auf bedien → LFH-661'
            : null;
        const schranke = ausnahme ? BODEN : TEXT[modus];
        const kontext = `${modus}, ${flaeche}, „${text}": ${m.verhaeltnis.toFixed(2)} : 1 (Ziel ≥ ${TEXT[modus]}, Schranke ≥ ${schranke}${ausnahme ? `, ${ausnahme}` : ''}) ${JSON.stringify(m)}`;
        messwerte.push({ modus, flaeche, art: 'text', wortlaut: text, ausnahme, ...m });
        gemessen.push([text, ausnahme]);
        expect.soft(m.verhaeltnis, kontext).toBeGreaterThanOrEqual(schranke);
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
      // Das Aufklappen animiert Höhe UND Opacity (`ant-motion-collapse`); der Messkern lehnt
      // Opacity ab. Erst messen, wenn die Bewegung vorbei ist.
      await expect(dialog.locator('.ant-collapse-panel')).toHaveCount(1);
      await expect(dialog.locator('.ant-collapse-panel')).not.toHaveClass(/ant-motion-collapse/);
      await messeTexte(dialog, titel);
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
    }

    // Die Probe hat die Texte wirklich gesehen — sonst wäre ein grüner Lauf leer. Und die
    // tragenden liefen OHNE Ausnahme: eine zu weit gefasste Ausnahme-Liste senkte sonst still
    // den Boden für genau die Paare, um die es geht.
    const pruefeGesehen = (pflicht: string | RegExp, tragend: boolean) => {
      const treffer = gemessen.filter(([t]) =>
        typeof pflicht === 'string' ? t === pflicht : pflicht.test(t),
      );
      expect(treffer.length, `Text ${String(pflicht)} gemessen`).toBeGreaterThan(0);
      if (tragend)
        expect(
          treffer.filter(([, ausnahme]) => ausnahme),
          `Text ${String(pflicht)} ohne Ausnahme gemessen`,
        ).toEqual([]);
    };
    for (const tragend of [
      ...KARTEN.flatMap((k) => [k.name, k.wort]),
      /^\d\d\.\d\d\. \d\d:\d\d–(\d\d\.\d\d\. )?\d\d:\d\d$/,
      'fehlt 8 vegan',
      'fehlt 6 vegan',
      'Bedarf 12 · ausgegeben 4',
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
    ])
      pruefeGesehen(tragend, true);
    for (const ausnahme of [
      'Sonderkost',
      'Bedarf',
      'EP',
      'Rest folgt mit der zweiten Tour',
      'Leer: jetzt',
      'Sonderkost ist ein Teil der Menge, kein Zuschlag.',
    ])
      pruefeGesehen(ausnahme, false);

    await test.info().attach('kontrastwerte.json', {
      body: JSON.stringify(messwerte, null, 2),
      contentType: 'application/json',
    });
  });
}
