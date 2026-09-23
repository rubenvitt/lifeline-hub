import { expect, test, type Locator, type Page } from '@playwright/test';
import { kontrast, randKontrast } from './kontrast-kern';

/**
 * Kriterium 5 der Prüfliste Einsatztauglichkeit für `/einsaetze/:id/abloesung` (LFH-646,
 * Nachzug zu LFH-635): Kontrast der ZUSAMMENGESETZTEN Paare in Tag und Nacht.
 *
 * Die Seite nutzt nur Tokens — das ist entlastend, aber kein Beleg: ein Token, der auf
 * `paneel` trägt, muss auf `alarmFlaeche` nicht tragen. Gemessen wird deshalb im Browser mit
 * dem geteilten Messkern (`kontrast-kern.ts`), ohne Farbwerte aus dem Produkt zu importieren.
 *
 * GESÄT: je Einstufung eine Schicht über `beginn_at` + `rhythmus_minuten` — überfällig (seit
 * 40 min), Vorwarnung (in 15 min, Vorwarnzeit 30 min), planmäßig (in 6 h) — und eine
 * vollzogene Schicht mit ablösender Einheit. Deren Folgeschicht ist die vierte laufende Karte,
 * sie selbst steht unter „Abgelöst" mit Augenbraue, „Abgelöst durch …" und Rücknahme-Knopf.
 *
 * SCHRANKEN (Literale; Kriterium 5 und WCAG 1.4.11):
 *  · Text Tag ≥ 7 : 1, Nacht ≥ 5 : 1 — für JEDEN Text im Seiteninhalt, gefunden über den
 *    Textbaum statt über eine Selektorliste: die übersähe das nächste Textstück;
 *  · der linke Rand der Karte, wo er einen Zustand trägt (überfällig, Vorwarnung), gegen den
 *    Seitengrund, vor dem er als Kante steht, und gegen die eigene Kartenfläche: ≥ 3 : 1;
 *  · der Rand des Etiketts gegen die Kartenfläche und gegen seine eigene Tönung: ≥ 3 : 1.
 *
 * DREI BENANNTE AUSNAHMEN, alle drei keine Eigenheit dieser Seite, sondern Eigenschaften
 * geteilter Rollen bzw. Primitive — dort liegt jeweils das Ticket, hier gilt bis dahin die
 * absolute Untergrenze 4,5 : 1 aus Kriterium 5, der Zielwert steht in jeder Meldung:
 *  · TERTIÄRTEXT (`schwach`: Augenbrauen, `Typography type="secondary"`, Feldhilfe,
 *    Platzhalter) — Tag 5,33 auf `grund`, 5,84 auf `paneel`, hier zuerst gemessen 5,20 auf
 *    `alarmFlaeche` und 6,37 als Platzhalter auf Weiß; nachts 4,81 auf der Dialogfläche.
 *    Welcher Boden für diese Textstufe gilt, entscheidet LFH-643; die Prüfliste von LFH-618
 *    hat die Frage ausdrücklich dorthin gelegt („eine globale Textstufe gehört nicht neben
 *    einen Rollen-Fix"). Gilt in BEIDEN Modi.
 *  · WEISS AUF `bedien` in jedem Primärknopf (Kopfaktion, Absende-Knopf der Dialoge) — Tag
 *    6,59 (`theme/tokens.ts`), nachts hält er. → LFH-661. Nur am Tag.
 *  · DER SEITENKOPF (`EinsatzSeite`: Brotkrumen, „Stand") — geteiltes Primitiv jeder
 *    Einsatzseite, am Tag derselbe Tertiärton (5,33). Nur am Tag.
 * Jeder andere Text — Einheit, Etikett, Abstand, Zeit, Nebenknöpfe, Feldbeschriftungen —
 * trägt den vollen Boden. FALLEN DIE AUSNAHMEN, wenn LFH-643/LFH-661 landen.
 *
 * DER RAND DER PLANMÄSSIGEN UND DER ABGELÖSTEN KARTE ist KEIN Zustandsträger: planmäßig heißt
 * „nichts zu tun", die Karte trägt dort die Linienfarbe (Kopfkommentar `AbloesungKarte`,
 * `abloesungEinstufung.planmaessig` bewusst `neutral`). 1.4.11 ist auf ihn nicht anwendbar —
 * gemessen und angehängt wird er trotzdem, und zugesichert wird, dass er sich von den beiden
 * Zustandsrändern UNTERSCHEIDET: fiele er mit einem zusammen, trüge er eine Bedeutung, die er
 * nicht hat.
 */

const TEXT = { light: 7, dark: 5 } as const;
/** Absolute Untergrenze aus Kriterium 5 („nie < 4,5 : 1"), für die drei Ausnahmen oben. */
const BODEN = 4.5;
const ZUSTAND = 3;

/** Tertiärtext: die Augenbraue der Zeitspalte, antds Sekundärtext, die Paneel-Augenbraue,
 *  Feldhilfe und Platzhalter. Enumeriert, damit JEDER andere Text den vollen Boden trägt. */
const TERTIAER = [
  '[data-lfh="abloesung-zeit"] + span',
  '.ant-typography-secondary',
  '[data-lfh="paneel"] > div:first-child > :is(h2, h3, h4, h5, h6)',
  // Die Feldhilfe der Dialoge („Leer: jetzt") — antds `colorTextDescription`.
  '.ant-form-item-extra',
  '.ant-select-placeholder',
].join(', ');

const KARTEN = [
  { stufe: 'ueberfaellig', einheit: 'Florian Kontrast 1', beginnVorMin: 400, wort: 'überfällig' },
  {
    stufe: 'vorwarnung',
    einheit: 'Florian Kontrast 2',
    beginnVorMin: 345,
    wort: 'Ablösung bald fällig',
  },
  { stufe: 'planmaessig', einheit: 'Florian Kontrast 3', beginnVorMin: 0, wort: 'planmäßig' },
] as const;
const ABGELOEST = 'Florian Kontrast 4';
const FOLGE = 'Florian Kontrast 5';

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

interface Textknoten {
  ziel: Locator;
  text: string;
  tertiaer: boolean;
  primaer: boolean;
}

/** Jedes Element unter `wurzel` mit eigenem, sichtbarem Text — als Locator über eine
 *  Messmarke, dazu ob es zu einer der Ausnahmen (Tertiärtext, Primärknopf) gehört. */
async function textknoten(wurzel: Locator): Promise<Textknoten[]> {
  const funde = await wurzel.evaluate((w, tertiaer) => {
    // Marken eines früheren Aufrufs räumen, sonst träfe dieselbe Nummer zwei Knoten.
    for (const alt of document.querySelectorAll('[data-kontrastprobe]'))
      alt.removeAttribute('data-kontrastprobe');
    const liste: { text: string; tertiaer: boolean; primaer: boolean }[] = [];
    for (const el of [w, ...w.querySelectorAll('*')]) {
      if (el.closest('[aria-hidden="true"]')) continue;
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

test('Randmessung: Rand gegen innen und außen, keine Breite und Durchscheinen werden abgelehnt', async ({
  page,
}) => {
  await page.setContent(
    '<main style="background:rgb(255,255,255)"><div id="probe" style="background:rgb(0,0,0);border-left:3px solid rgb(255,255,255);border-top:0 solid black">Probe</div></main>',
  );
  const probe = page.locator('#probe');
  const weissAufSchwarz = await randKontrast(probe, 'left');
  expect(weissAufSchwarz.gegenInnen).toBe(21);
  expect(weissAufSchwarz.gegenAussen).toBe(1);
  expect(weissAufSchwarz.breite).toBe(3);
  await expect(randKontrast(probe, 'top')).rejects.toThrow(/keine Breite/);
  await probe.evaluate((el) => {
    el.style.borderLeftColor = 'rgba(255, 255, 255, 0.5)';
  });
  await expect(randKontrast(probe, 'left')).rejects.toThrow(/Durchscheinender Rand/);
});

for (const modus of ['light', 'dark'] as const) {
  test(`Ablösung: Schichtkarten, Vorgaben und Kopf — Text und Rand im Modus ${modus}`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1366, height: 900 });
    await anmelden(page);
    const einsatzId = await post(page, '/api/einsaetze', {
      bezeichnung: `E2E 646 Kontrast ${Date.now()}`,
    });
    const basis = `/api/einsaetze/${einsatzId}`;
    const jetzt = Date.now();
    // Ein Abschnitt, damit das Vorgaben-Paneel eine Zeile trägt statt des Leerzustands.
    const abschnitt_id = await post(page, `${basis}/abschnitte`, { name: 'Deichwache Kontrast' });
    for (const k of KARTEN) {
      const einheit = await post(page, `${basis}/einheiten`, { name: k.einheit, abschnitt_id });
      await post(page, `${basis}/abloesungen`, {
        einheit_id: einheit,
        rhythmus_minuten: 360,
        beginn_at: new Date(jetzt - k.beginnVorMin * 60_000).toISOString(),
      });
    }
    const alt = await post(page, `${basis}/einheiten`, { name: ABGELOEST, abschnitt_id });
    const neu = await post(page, `${basis}/einheiten`, { name: FOLGE, abschnitt_id });
    const schicht = await post(page, `${basis}/abloesungen`, {
      einheit_id: alt,
      rhythmus_minuten: 360,
      beginn_at: new Date(jetzt - 380 * 60_000).toISOString(),
    });
    const v = await page.request.post(`${basis}/abloesungen/${schicht}/vollzug`, {
      data: { abloesende_einheit_id: neu },
    });
    expect(v.ok(), `Vollzug: ${v.status()} ${await v.text()}`).toBeTruthy();

    await page.evaluate((m) => localStorage.setItem('lifeline-hub.theme', m), modus);
    await page.goto(`/einsaetze/${einsatzId}/abloesung`);
    await expect(page.locator('html')).toHaveAttribute('data-theme', modus);
    await expect(page.locator('[data-lfh="abloesung-karte"]')).toHaveCount(KARTEN.length + 1);
    // Kein Hovergrund einer vorausgehenden Interaktion in die Messung mischen.
    await page.mouse.move(0, 0);

    const messwerte: Record<string, unknown>[] = [];
    const raender: Record<string, string> = {};

    // (1) Ränder und Etikett je Einstufung.
    for (const k of KARTEN) {
      const karte = page.getByRole('article', { name: `Schicht ${k.einheit}`, exact: true });
      await expect(karte).toHaveAttribute('data-einstufung', k.stufe);

      const rand = await randKontrast(karte, 'left');
      raender[k.stufe] = rand.rand.join();
      messwerte.push({ modus, karte: k.stufe, art: 'kartenrand', ...rand });
      if (k.stufe !== 'planmaessig') {
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
    }
    // Planmäßig trägt keinen Zustand am Rand — dann darf er auch keinem gleichen.
    expect(raender.planmaessig).not.toBe(raender.ueberfaellig);
    expect(raender.planmaessig).not.toBe(raender.vorwarnung);

    // (2) Jeder Text — Seiteninhalt und Seitenkopf, in beiden Ansichten.
    const inhalt = page.locator('[data-lfh="seiten-inhalt"]');
    const kopf = page.locator('[data-lfh="seitenkopf"]');
    const gemessen: [string, string | null][] = [];
    const messeTexte = async (
      wurzel: Locator,
      flaeche: 'inhalt' | 'kopf' | 'dialog',
      ansicht: string,
    ) => {
      await page.mouse.move(0, 0);
      const knoten = await textknoten(wurzel);
      // Ein Dialog blendet mit Opacity ein; der Messkern lehnt das ab, statt scheinpräzise
      // zu rechnen. Erst messen, wenn der erste Knoten eben steht.
      await expect(async () => {
        await kontrast(knoten[0].ziel);
      }).toPass({ timeout: 10_000 });
      for (const { ziel, text, tertiaer, primaer } of knoten) {
        const m = await kontrast(ziel);
        const tag = modus === 'light';
        const ausnahme = tertiaer
          ? 'Tertiärtext → LFH-643'
          : tag && primaer
            ? 'Weiß auf bedien → LFH-661'
            : tag && flaeche === 'kopf'
              ? 'Seitenkopf, Tertiärton → LFH-643'
              : null;
        const schranke = ausnahme ? BODEN : TEXT[modus];
        const kontext = `${modus}, ${ansicht}, ${flaeche}, „${text}": ${m.verhaeltnis.toFixed(2)} : 1 (Ziel ≥ ${TEXT[modus]}, Schranke ≥ ${schranke}${ausnahme ? `, ${ausnahme}` : ''}) ${JSON.stringify(m)}`;
        messwerte.push({ modus, ansicht, flaeche, art: 'text', wortlaut: text, ausnahme, ...m });
        gemessen.push([text, ausnahme]);
        expect.soft(m.verhaeltnis, kontext).toBeGreaterThanOrEqual(schranke);
      }
    };
    await expect(inhalt.getByText('Deichwache Kontrast', { exact: true })).toBeVisible();
    await messeTexte(kopf, 'kopf', 'laufend');
    await messeTexte(inhalt, 'inhalt', 'laufend');

    // (3) Die Erfassungsdialoge (Prüfliste Fläche 2) — zwei stellvertretend, beide auf der
    // `ErfassungsModal`-Hülle: „Schicht beginnen" aus dem Kopf und der Vollzug mit Feldhilfe.
    for (const [ausloeser, titel] of [
      [kopf.getByRole('button', { name: 'Schicht beginnen', exact: true }), 'Schicht beginnen'],
      [
        page
          .getByRole('article', { name: `Schicht ${KARTEN[0].einheit}`, exact: true })
          .getByRole('button', { name: 'Ablösung vollziehen', exact: true }),
        `Ablösung ${KARTEN[0].einheit} vollziehen`,
      ],
    ] as const) {
      await ausloeser.click();
      const dialog = page.getByRole('dialog', { name: titel });
      await expect(dialog).toBeVisible();
      await messeTexte(dialog, 'dialog', titel);
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
    }
    await inhalt.getByText('Abgelöst', { exact: true }).click();
    const abgeloest = page.getByRole('article', { name: `Schicht ${ABGELOEST}`, exact: true });
    await expect(abgeloest).toContainText(`Abgelöst durch ${FOLGE}`);
    const randAbgeloest = await randKontrast(abgeloest, 'left');
    messwerte.push({ modus, karte: 'abgeloest', art: 'kartenrand', ...randAbgeloest });
    await messeTexte(inhalt, 'inhalt', 'abgelöst');

    // Die Probe hat die Texte wirklich gesehen — sonst wäre ein grüner Lauf leer. Und die
    // tragenden liefen OHNE Ausnahme: eine zu weit gefasste Ausnahme-Liste senkte sonst still
    // den Boden für genau die Paare, um die es geht.
    const pruefeGesehen = (pflicht: string | RegExp, tragend: boolean) => {
      const treffer = [...gemessen].filter(([t]) =>
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
      ...KARTEN.flatMap((k) => [k.einheit, k.wort]),
      /^seit \d+ min$/,
      /^in 1\d min$/,
      `${ABGELOEST}`,
      'Ablösung vollziehen',
      'Vollzug zurücknehmen',
      'Deichwache Kontrast',
      'Im Einsatz seit',
      'Zeitpunkt',
    ])
      pruefeGesehen(tragend, true);
    for (const ausnahme of ['fällig', 'abgelöst', `Abgelöst durch ${FOLGE}`, 'Leer: jetzt'])
      pruefeGesehen(ausnahme, false);

    await test.info().attach('kontrastwerte.json', {
      body: JSON.stringify(messwerte, null, 2),
      contentType: 'application/json',
    });
  });
}
