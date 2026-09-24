import { expect, test, type Locator, type Page } from '@playwright/test';
import { pruefeFokusVerdeckung } from './fokus-kern';
import { kontrast, randKontrast } from './kontrast-kern';

/**
 * Browser-Nachweise für die Prüfliste der Betreuungsseite `/einsaetze/:id/betreuung`
 * (LFH-677, Nachzug zu LFH-639; Prüfliste `2026-09-23-lfh-639-pruefliste.md`, Zeilen T1-5,
 * T1-13 und T2-13). Muster: `verpflegung-kontrast.spec.ts` (Kriterium 5) und
 * `dokumente.spec.ts` (Kriterium 13). Fixture-Namen tragen kein „Betreuung" — die Palette
 * sucht Module und Einsätze gemeinsam (design.md D10 e).
 *
 * ═══ KRITERIUM 5 — Kontrast der ZUSAMMENGESETZTEN Paare, Tag und Nacht ═══════════════════
 *
 * GESÄT, damit jede Tönung der Seite vorkommt:
 *  · vier Bezirke, je ein Räumungszustand (angeordnet, läuft, geräumt, aufgehoben), mit
 *    geschätztem Stand („≈ 212"), gezähltem Stand und ohne Stand („keine Meldung"), ohne
 *    Abschnitt („—" im Sekundärfeld);
 *  · sechs Stellen: 135 / 150 („fast voll", achtung), 150 / 150 („voll", alarm),
 *    160 / 150 („überbelegt", alarm), eine vorbereitete ohne Meldung („keine Meldung",
 *    frei „—"), eine ohne Kapazität (Kapazität und frei „—") und eine geschlossene.
 *
 * SCHRANKEN (Literale; Kriterium 5 und WCAG 1.4.11):
 *  · Text Tag ≥ 7 : 1, Nacht ≥ 5 : 1 — für JEDEN sichtbaren Text in Seitenkopf, Seiteninhalt,
 *    im geöffneten Zeilenmenü und in vier Dialogen („Stelle bearbeiten" mit
 *    Leermeldungs-Hinweis, „Evakuierungsbezirk anlegen", „Stand melden", „Stornieren"),
 *    gefunden über den Textbaum statt über eine Selektorliste und gemessen gegen den Grund, auf
 *    dem er WIRKLICH steht (LFH-618, Regel 3). Das Menü liegt als Portal außerhalb des
 *    Seiteninhalts und wird deshalb eigens geöffnet;
 *  · der Rand jedes Etiketts, das einen Zustand trägt, gegen die Fläche darum und gegen seine
 *    eigene Tönung: ≥ 3 : 1. Neutrale Etiketten (vorbereitet, geschlossen, aufgehoben) tragen
 *    ihre Aussage allein im Wort; ihr Rand wird gemessen und angehängt, aber nicht gepinnt.
 *
 * DIE KRITISCHEN PAARE — im Tagmodus fällt die Füllfarbe unter den Boden, der Text muss über
 * `achtungText`/`alarmText` laufen (LFH-618, Regel 1): „angeordnet", „läuft" und „fast voll"
 * (achtung), „voll" und „überbelegt" (alarm). Sie stehen einzeln und benannt, nicht nur im
 * Textbaum — dort wären sie zwischen den Karten und Zeilen nicht zuzuordnen, und eine
 * benannte Zusicherung ist die Stelle, an der die Mutationsprobe rot wird.
 *
 * DER GEWÄHLTE RADIO-KNOPF („geschlossen", „geschätzt", „gezählt") ist tragend. Er stand am
 * Tag in `bedien` auf Weiß bei 6,59 : 1 — im ersten Lauf dieses Specs gemessen und in
 * LFH-677 behoben: `src/index.css` setzt den TEXT des gewählten Knopfs und des Knopfs
 * unter dem Zeiger auf `--lfh-bedien-text` (Regel aus LFH-650), Rand und Flächen bleiben.
 *
 * DREI BENANNTE AUSNAHMEN — Eigenschaften geteilter Rollen, nicht dieser Seite; bis dahin gilt
 * die absolute Untergrenze 4,5 : 1 aus Kriterium 5, der Zielwert steht in jeder Meldung:
 *  · TERTIÄRTEXT (`schwach`) → LFH-643, in BEIDEN Modi. Hier: „keine Meldung" und „—" in der
 *    Stellentabelle (`Typography type="secondary"`, `StellenBlock.tsx`), der Tabellenkopf, die
 *    Augenbrauen (Blockköpfe „Evakuierung"/„Betreuungsstellen", Feldetiketten der
 *    Bezirkskarte), die Feldhilfen der Dialoge (`.ant-form-item-extra`), Platzhalter und der
 *    Ortspfad im Seitenkopf bis auf sein letztes Glied;
 *  · WEISS AUF `bedien` in jedem Primärknopf → LFH-661, nur am Tag;
 *  · ROT AM TAG → LFH-693, zwei Paare, getrennt geführt: der Menüeintrag „Stornieren"
 *    (roter Text auf der Menüfläche) und der gefüllte rote Knopf im Storno-Dialog (Weiß auf
 *    `alarm`, in der LFH-634-Prüfliste Befund S3).
 * Jeder andere Text — Bezeichnungen, „≈ 212 · von 380 geplant", „keine Meldung · von ≈ 640
 * geplant" (Karte), Etiketten, Kopfzahlen, der Leermeldungs-Hinweis, Feldbeschriftungen —
 * trägt den vollen Boden. FALLEN DIE AUSNAHMEN, wenn LFH-643/661/693 landen.
 *
 * MUTATIONSPROBE (24.09.2026, lokal gefahren, nicht committet): `achtungText` → `achtung` und
 * `alarmText` → `alarm` in `components/instrument/statusFlaeche.ts` — der Taglauf wird an
 * allen fünf benannten Etiketten rot („angeordnet", „läuft", „fast voll" 6,02 : 1; „voll",
 * „überbelegt" 5,52 : 1) und an denselben Wortlauten im Textbaum. Die Radio-Regel in
 * `index.css` entfernt → „geschlossen", „geschätzt", „gezählt" rot mit 6,59 : 1. Danach
 * zurückgesetzt.
 *
 * ═══ KRITERIUM 13 — Fokus nie verdeckt (WCAG 2.4.11) ════════════════════════════════════
 *
 * TABELLE: zwanzig gesäte Stellen, Seite halb gescrollt, Durchlauf VORWÄRTS UND RÜCKWÄRTS.
 * Vorwärts rollt der Browser jedes Ziel an den unteren Rand; unter die OBEN stehende
 * Kopfzeile gerät es so nie. Erst der Rückwärtslauf legt die Ziele an den oberen Rand, an
 * die stehende Kopfzeile der `KatalogTabelle` — `stoppsAnTabellenkopf` belegt, dass das auch
 * wirklich geschah. Gemessen im Fükw (1366 × 600, kompakt) und bei 390 px im Handschuh-Betrieb,
 * wo zusätzlich die fixierte Kennungsspalte neben den Aktionsknöpfen steht.
 *
 * DER BEFUND, den dieser Rückwärtslauf zuerst lieferte (24.09.2026): im Fükw lagen
 * „Belegung melden" und der Dreipunkt (30 px) bei y = 0 VOLLSTÄNDIG hinter der Kopfzeile,
 * zwei Zeilen, vier Stopps. Behoben im Primitiv (`setzeKopfFreiraum` in `KatalogTabelle.tsx`
 * plus `scroll-margin-top` in `theme/sprache.css`) — also für jede Katalogtabelle, nicht nur
 * hier. Mutationsprobe: die CSS-Regel entfernt → derselbe Befund kehrt zurück (4 verdeckt).
 * Bei 390 px im Handschuh-Betrieb war der Knopf (72 px) höher als die Kopfzeile und nie ganz
 * verdeckt.
 *
 * DIALOGE: jeder Dialog der Seite bei 390 × 844 px im Handschuh-Betrieb, „Weitere Angaben"
 * aufgeklappt. Die Ziele werden GENERISCH markiert (jedes tabbare, sichtbare Element im
 * Dialog; je Radiogruppe nur das gewählte Radio, weil der Browser die übrigen überspringt),
 * und der Durchlauf muss jedes davon besuchen — sonst wäre „0 verdeckt" trivial wahr.
 */

const TEXT = { light: 7, dark: 5 } as const;
/** Absolute Untergrenze aus Kriterium 5 („nie < 4,5 : 1"), für die drei Ausnahmen oben. */
const BODEN = 4.5;
const ZUSTAND = 3;

const FUEKW = { width: 1366, height: 600 };
const HANDSCHIRM = { width: 390, height: 844 };
const DICHTE_SCHLUESSEL = 'lifeline-hub.dichte';

/**
 * Tertiärtext, enumeriert — ausschließlich über Selektoren, die den TRÄGER selbst treffen,
 * nie einen Container: `closest()` senkte sonst still den Boden für alles darin.
 */
const TERTIAER = [
  '.ant-typography-secondary',
  // Augenbraue (`schwach`): Blockköpfe „Evakuierung"/„Betreuungsstellen" und die
  // Feldetiketten der Bezirkskarte („Evakuiert", „Stand", „Abschnitt").
  '.lfh-augenbraue',
  // Kopf der Stellentabelle — antds Tabellenkopf läuft in `schwach` (wie in
  // `dokumente.spec.ts` als geerbte Rolle geführt). Die Kopfzelle IST der Träger: sie hält
  // den Titel als eigenen Textknoten (bzw. im Titel-`span` der sortierbaren Spalte) und
  // sonst nur `aria-hidden`-Zeichen für Sortierung und Filter.
  '.ant-table-thead > tr > th',
  '.ant-form-item-extra',
  '.ant-select-placeholder',
  '.lfh-seitenkopf__pfad li:not(:last-child)',
].join(', ');

const BEZIRKE = [
  {
    name: 'Deichweg 1–9',
    plan: { plan_personen: 640, plan_erhebung: 'geschaetzt' },
    stand: null,
    raeumung: 'angeordnet',
    wort: 'angeordnet',
    rolle: 'achtung',
  },
  {
    name: 'Uferstraße 12–40',
    plan: { plan_personen: 380, plan_erhebung: 'gezaehlt' },
    stand: { evakuiert: 212, erhebung: 'geschaetzt' },
    raeumung: 'laeuft',
    wort: 'läuft',
    rolle: 'achtung',
  },
  {
    name: 'Mühlenweg 2–18',
    plan: { plan_personen: 150, plan_erhebung: 'gezaehlt' },
    stand: { evakuiert: 150, erhebung: 'gezaehlt' },
    raeumung: 'geraeumt',
    wort: 'geräumt',
    rolle: 'normal',
  },
  {
    name: 'Am Hafen 3',
    plan: { plan_personen: 90, plan_erhebung: 'geschaetzt' },
    stand: null,
    raeumung: 'aufgehoben',
    wort: 'aufgehoben',
    rolle: 'neutral',
  },
] as const;

const STELLEN = [
  { name: 'Turnhalle Ost', art: 'notunterkunft', kap: 150, belegt: 135, status: 'in_betrieb' },
  {
    name: 'Gemeindehaus Süd',
    art: 'betreuungsstelle',
    kap: 150,
    belegt: 150,
    status: 'in_betrieb',
  },
  { name: 'Schule am Markt', art: 'notunterkunft', kap: 150, belegt: 160, status: 'in_betrieb' },
  { name: 'Sporthalle West', art: 'anlaufstelle', kap: 80, belegt: null, status: 'vorbereitet' },
  { name: 'Kirchplatz', art: 'betreuungsplatz', kap: null, belegt: 12, status: 'in_betrieb' },
  { name: 'Schule Nord', art: 'anlaufstelle', kap: null, belegt: null, status: 'geschlossen' },
] as const;

/** Auslastungswort je Stelle — der zweite Kanal neben der Farbe, benannt und kritisch. */
const AUSLASTUNG = [
  { stelle: 'Turnhalle Ost', wort: 'fast voll', rolle: 'achtung' },
  { stelle: 'Gemeindehaus Süd', wort: 'voll', rolle: 'alarm' },
  { stelle: 'Schule am Markt', wort: 'überbelegt', rolle: 'alarm' },
] as const;

async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill('admin');
  await page.getByLabel('Passwort').fill(process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw');
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

async function senden<T = { id: number }>(
  page: Page,
  methode: 'post' | 'patch',
  pfad: string,
  data?: unknown,
): Promise<T> {
  const r = await page.request[methode](pfad, { data });
  expect(r.ok(), `${methode} ${pfad}: ${r.status()} ${await r.text()}`).toBeTruthy();
  return (await r.json()) as T;
}

/** Einsatz samt gesäter Lage; gibt die Einsatz-ID und die Stellen-IDs nach Namen zurück. */
async function saeLage(page: Page, name: string) {
  const { id: einsatzId } = await senden(page, 'post', '/api/einsaetze', {
    bezeichnung: `${name} ${Date.now()}`,
  });
  const basis = `/api/einsaetze/${einsatzId}/betreuung`;
  for (const b of BEZIRKE) {
    const { id } = await senden(page, 'post', `${basis}/bezirke`, {
      bezeichnung: b.name,
      ...b.plan,
    });
    if (b.stand) await senden(page, 'post', `${basis}/bezirke/${id}/staende`, b.stand);
    if (b.raeumung !== 'angeordnet')
      await senden(page, 'patch', `${basis}/bezirke/${id}`, { raeumung: b.raeumung });
  }
  const stellen: Record<string, number> = {};
  for (const s of STELLEN) {
    const { id } = await senden(page, 'post', `${basis}/stellen`, {
      bezeichnung: s.name,
      art: s.art,
      ...(s.kap != null ? { kapazitaet_personen: s.kap } : {}),
    });
    stellen[s.name] = id;
    if (s.status !== 'vorbereitet')
      await senden(page, 'patch', `${basis}/stellen/${id}`, { status: s.status });
    if (s.belegt != null)
      await senden(page, 'post', `${basis}/stellen/${id}/belegungen`, { belegt: s.belegt });
  }
  return { einsatzId, stellen };
}

/** Der Provider liest die gespeicherte Wahl beim Montieren, deshalb das Neuladen. */
async function stelleDichte(page: Page, dichte: string) {
  await page.evaluate(([schluessel, wert]) => window.localStorage.setItem(schluessel, wert), [
    DICHTE_SCHLUESSEL,
    dichte,
  ] as const);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-dichte', dichte);
}

const bezirkKarte = (page: Page, name: string) =>
  page
    .getByRole('region', { name: 'Evakuierungsbezirke' })
    .locator('[data-lfh="datensicht-karte"]')
    .filter({ hasText: name });

const stellenZeile = (page: Page, id: number) => page.locator(`tr[data-row-key="stelle-${id}"]`);

/** Öffnet ein Zeilen- oder Kartenmenü und wählt einen Eintrag. */
async function menue(page: Page, ausloeser: string, eintrag: string) {
  await page.getByRole('button', { name: ausloeser, exact: true }).click();
  await page
    .locator('.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]')
    .getByRole('menuitem', { name: eintrag })
    .click();
}

/** Wartet, bis der Dialog steht: Zoom vorbei, aufgeklappter Bereich eingeschwungen. */
async function dialogSteht(page: Page, dialog: Locator) {
  await expect(dialog).toBeVisible();
  await expect(page.locator('.ant-zoom-appear, .ant-zoom-enter')).toHaveCount(0);
  await expect(dialog.locator('.ant-motion-collapse')).toHaveCount(0);
}

/** Klappt „Weitere Angaben" auf, falls der Dialog den Bereich trägt. */
async function weitereAufklappen(page: Page, dialog: Locator) {
  const kopf = dialog.getByRole('button', { name: 'Weitere Angaben' });
  if ((await kopf.count()) === 0) return false;
  await kopf.click();
  await expect(dialog.locator('.ant-collapse-item-active')).toHaveCount(1);
  await dialogSteht(page, dialog);
  return true;
}

interface Textknoten {
  ziel: Locator;
  text: string;
  tertiaer: boolean;
  primaer: boolean;
  rotText: boolean;
  weissAufAlarm: boolean;
}

/** Jedes SICHTBARE Element unter `wurzel` mit eigenem Text (Muster Verpflegung). */
async function textknoten(wurzel: Locator): Promise<Textknoten[]> {
  const funde = await wurzel.evaluate((w, tertiaer) => {
    for (const alt of document.querySelectorAll('[data-kontrastprobe]'))
      alt.removeAttribute('data-kontrastprobe');
    const liste: {
      text: string;
      tertiaer: boolean;
      primaer: boolean;
      rotText: boolean;
      weissAufAlarm: boolean;
    }[] = [];
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
        rotText: el.closest('.ant-dropdown-menu-item-danger') != null,
        weissAufAlarm: el.closest('.ant-btn-dangerous.ant-btn-primary') != null,
      });
    }
    return liste;
  }, TERTIAER);
  return funde.map((f, i) => ({ ...f, ziel: wurzel.locator(`[data-kontrastprobe="${i}"]`) }));
}

// ═══ Kriterium 5 ═════════════════════════════════════════════════════════════════════════

for (const modus of ['light', 'dark'] as const) {
  test(`Kontrast ${modus}: Bezirkskarten, Stellentabelle, Kopf und Dialoge`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1366, height: 900 });
    await anmelden(page);
    const { einsatzId, stellen } = await saeLage(page, 'E2E 677 Kontrast');

    await page.evaluate((m) => localStorage.setItem('lifeline-hub.theme', m), modus);
    await page.goto(`/einsaetze/${einsatzId}/betreuung`);
    await expect(page.locator('html')).toHaveAttribute('data-theme', modus);
    // Den EINGESCHWUNGENEN Stand messen: alle Karten und alle Dreipunkt-Auslöser der Tabelle
    // stehen, erst dann zeigen die Messmarken auf bleibende Knoten.
    await expect(
      page
        .getByRole('region', { name: 'Evakuierungsbezirke' })
        .locator('[data-lfh="datensicht-karte"]'),
    ).toHaveCount(BEZIRKE.length);
    await expect(page.getByRole('button', { name: /^Aktionen zu Stelle / })).toHaveCount(
      STELLEN.length,
    );
    // Ein Nachladen blendet den Block über `.ant-spin-container` ab; der Messkern lehnt jede
    // Opacity ab. Erst messen, wenn kein Container mehr gedimmt ist (gemessen: 0,90 mitten im
    // Übergang).
    await expect
      .poll(() =>
        page
          .locator('.ant-spin-container')
          .evaluateAll((alle) => alle.filter((e) => getComputedStyle(e).opacity !== '1').length),
      )
      .toBe(0);
    await page.mouse.move(0, 0);

    const messwerte: Record<string, unknown>[] = [];
    const tag = modus === 'light';

    /** Etikett: Wort, Rolle, Text gegen die eigene Tönung, Rand gegen außen und innen. */
    const pruefeEtikett = async (etikett: Locator, wo: string, wort: string, rolle: string) => {
      await expect(etikett).toHaveText(wort);
      await expect(etikett).toHaveAttribute('data-rolle', rolle);
      const m = await kontrast(etikett);
      messwerte.push({ modus, wo, art: 'etikett', wortlaut: wort, rolle, ...m });
      expect
        .soft(
          m.verhaeltnis,
          `${modus}, ${wo}: Etikett „${wort}" ${m.verhaeltnis.toFixed(2)} : 1 (Soll ≥ ${TEXT[modus]}) ${JSON.stringify(m)}`,
        )
        .toBeGreaterThanOrEqual(TEXT[modus]);
      const rand = await randKontrast(etikett, 'top');
      messwerte.push({ modus, wo, art: 'etikettrand', wortlaut: wort, rolle, ...rand });
      if (rolle === 'neutral') return;
      const kontext = `${modus}, ${wo}: Rand „${wort}" ${JSON.stringify(rand)}`;
      expect
        .soft(rand.gegenAussen, `${kontext} gegen Fläche darum`)
        .toBeGreaterThanOrEqual(ZUSTAND);
      expect
        .soft(rand.gegenInnen, `${kontext} gegen eigene Tönung`)
        .toBeGreaterThanOrEqual(ZUSTAND);
    };

    // (1) Räumungs-Etiketten der Bezirkskarten — „angeordnet" und „läuft" sind kritisch.
    for (const b of BEZIRKE) {
      const etikett = bezirkKarte(page, b.name).locator('.ant-tag');
      await expect(etikett).toHaveCount(1);
      await pruefeEtikett(etikett, `Bezirk ${b.name}`, b.wort, b.rolle);
    }

    // (2) Status- und Auslastungsetiketten der Stellentabelle — „fast voll", „voll" und
    // „überbelegt" sind kritisch. Die Zeile trägt zwei Etiketten: Status und Auslastung.
    for (const a of AUSLASTUNG) {
      const zeile = stellenZeile(page, stellen[a.stelle]);
      const etiketten = zeile.locator('.ant-tag');
      await expect(etiketten).toHaveCount(2);
      await pruefeEtikett(etiketten.nth(0), `Stelle ${a.stelle}`, 'in Betrieb', 'normal');
      await pruefeEtikett(etiketten.nth(1), `Stelle ${a.stelle}`, a.wort, a.rolle);
    }
    for (const [stelle, wort] of [
      ['Sporthalle West', 'vorbereitet'],
      ['Schule Nord', 'geschlossen'],
    ] as const) {
      const etikett = stellenZeile(page, stellen[stelle]).locator('.ant-tag');
      await expect(etikett).toHaveCount(1);
      await pruefeEtikett(etikett, `Stelle ${stelle}`, wort, 'neutral');
    }

    // (3) Jeder Text — Seitenkopf, Seiteninhalt und drei Dialoge.
    const kopf = page.locator('[data-lfh="seitenkopf"]');
    const inhalt = page.locator('[data-lfh="seiten-inhalt"]');
    const gemessen: [string, string, string | null][] = [];
    const messeTexte = async (wurzel: Locator, flaeche: string) => {
      await page.mouse.move(0, 0);
      const knoten = await textknoten(wurzel);
      // Ein Dialog blendet mit Opacity ein; der Messkern lehnt das ab. Erst messen, wenn der
      // erste Knoten eben steht.
      await expect(async () => {
        await kontrast(knoten[0].ziel);
      }).toPass({ timeout: 10_000 });
      for (const { ziel, text, tertiaer, primaer, rotText, weissAufAlarm } of knoten) {
        const m = await kontrast(ziel);
        const ausnahme = tertiaer
          ? 'Tertiärtext → LFH-643'
          : tag && rotText
            ? 'Rot als Text → LFH-693'
            : tag && weissAufAlarm
              ? 'Weiß auf alarm → LFH-693'
              : tag && primaer
                ? 'Weiß auf bedien → LFH-661'
                : null;
        const schranke = ausnahme ? BODEN : TEXT[modus];
        const kontext = `${modus}, ${flaeche}, „${text}": ${m.verhaeltnis.toFixed(2)} : 1 (Ziel ≥ ${TEXT[modus]}, Schranke ≥ ${schranke}${ausnahme ? `, ${ausnahme}` : ''}) ${JSON.stringify(m)}`;
        messwerte.push({ modus, flaeche, art: 'text', wortlaut: text, ausnahme, ...m });
        gemessen.push([flaeche, text, ausnahme]);
        expect.soft(m.verhaeltnis, kontext).toBeGreaterThanOrEqual(schranke);
      }
    };
    await messeTexte(kopf, 'kopf');
    await messeTexte(inhalt, 'inhalt');

    // „Stelle bearbeiten" an der belegten Stelle, Status auf „geschlossen": erst dann stehen
    // Leermeldungs-Hinweis und Häkchen im Dialog (design.md D4).
    await menue(page, 'Aktionen zu Stelle Gemeindehaus Süd', 'Bearbeiten (Status, Kapazität)');
    const bearbeiten = page.getByRole('dialog', { name: 'Stelle bearbeiten: Gemeindehaus Süd' });
    await dialogSteht(page, bearbeiten);
    await bearbeiten.getByText('geschlossen', { exact: true }).click();
    const hinweis = bearbeiten.locator('.ant-alert');
    await expect(hinweis).toHaveCount(1);
    await expect(hinweis).toContainText('Die Stelle ist mit 150 Personen belegt.');
    await expect(bearbeiten.getByRole('checkbox')).toBeVisible();
    await weitereAufklappen(page, bearbeiten);
    await messeTexte(bearbeiten, 'Stelle bearbeiten');
    await page.keyboard.press('Escape');
    await expect(bearbeiten).toBeHidden();

    for (const [ausloeser, titel] of [
      [
        kopf.getByRole('button', {
          name: 'Evakuierungsbezirk anlegen',
          exact: true,
        }),
        'Evakuierungsbezirk anlegen',
      ],
      [
        page.getByRole('button', { name: 'Stand melden für Bezirk Uferstraße 12–40' }),
        'Stand melden: Uferstraße 12–40',
      ],
    ] as const) {
      await ausloeser.click();
      const dialog = page.getByRole('dialog', { name: titel });
      await dialogSteht(page, dialog);
      await weitereAufklappen(page, dialog);
      await messeTexte(dialog, titel);
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
    }

    // Das gebündelte Zeilenmenü liegt als Portal AUSSERHALB des Seiteninhalts — der Textbaum
    // oben sieht es nicht (die Lücke, die LFH-693 an `abloesung-kontrast.spec.ts` benennt).
    await page
      .getByRole('button', { name: 'Aktionen zu Stelle Turnhalle Ost', exact: true })
      .click();
    const offen = page.locator('.ant-dropdown:not(.ant-dropdown-hidden)');
    await expect(offen.getByRole('menuitem', { name: 'Stornieren' })).toBeVisible();
    await expect(page.locator('.ant-slide-up-appear, .ant-slide-up-enter')).toHaveCount(0);
    await messeTexte(offen, 'Zeilenmenü');
    await offen.getByRole('menuitem', { name: 'Stornieren' }).click();
    const storno = page.getByRole('dialog', { name: 'Betreuungsstelle Turnhalle Ost stornieren?' });
    await dialogSteht(page, storno);
    await messeTexte(storno, 'Stornieren');
    await page.keyboard.press('Escape');
    await expect(storno).toBeHidden();

    // Die Probe hat die Texte wirklich gesehen — sonst wäre ein grüner Lauf leer. Und die
    // tragenden liefen OHNE Ausnahme: eine zu weit gefasste Ausnahme-Liste senkte sonst still
    // den Boden für genau die Paare, um die es geht.
    const pruefeGesehen = (flaeche: string | null, pflicht: string | RegExp, tragend: boolean) => {
      const treffer = gemessen.filter(
        ([f, t]) =>
          (flaeche == null || f === flaeche) &&
          (typeof pflicht === 'string' ? t === pflicht : pflicht.test(t)),
      );
      expect(
        treffer.length,
        `Text ${String(pflicht)} in ${flaeche ?? 'irgendwo'} gemessen`,
      ).toBeGreaterThan(0);
      const mitAusnahme = treffer.filter(([, , a]) => a != null).length;
      if (tragend) expect(mitAusnahme, `Text ${String(pflicht)} ohne Ausnahme gemessen`).toBe(0);
      else
        expect(mitAusnahme, `Text ${String(pflicht)} unter der benannten Ausnahme`).toBe(
          treffer.length,
        );
    };
    for (const [flaeche, tragend] of [
      ['kopf', 'Betreuung'],
      ['kopf', /^4 Bezirke · 6 Betreuungsstellen$/],
      // Kennzahl im Blockkopf und die Sekundärfelder der Bezirkskarten, mit „≈" und
      // „keine Meldung" als zweitem Kanal.
      ['inhalt', /^≈ 362 · von 1\s170 geplant · 1 ohne Meldung$/],
      ['inhalt', 'keine Meldung · von ≈ 640 geplant'],
      ['inhalt', '≈ 212 · von 380 geplant'],
      ['inhalt', '150 · von 150 geplant'],
      ...BEZIRKE.flatMap((b) => [
        ['inhalt', b.name],
        ['inhalt', b.wort],
      ]),
      ...STELLEN.map((s) => ['inhalt', s.name]),
      ...AUSLASTUNG.map((a) => ['inhalt', a.wort]),
      ['inhalt', 'in Betrieb'],
      ['inhalt', 'vorbereitet'],
      ['inhalt', 'geschlossen'],
      // Kopf der Stellentabelle.
      ['inhalt', /^457 untergebracht · 2 ohne Meldung$/],
      ['inhalt', 'Stand melden'],
      ['inhalt', 'Belegung melden'],
      ['inhalt', 'Betreuungsstelle anlegen'],
      // Leermeldungs-Hinweis und die Felder von „Stelle bearbeiten".
      ['Stelle bearbeiten', 'Die Stelle ist mit 150 Personen belegt.'],
      [
        'Stelle bearbeiten',
        'Geschlossen werden kann sie erst, wenn alle sie verlassen haben. Das wird als Belegung 0 gemeldet und steht im Einsatztagebuch.',
      ],
      ['Stelle bearbeiten', 'Alle haben die Stelle verlassen — Belegung 0 melden'],
      ['Stelle bearbeiten', 'Status'],
      ['Stelle bearbeiten', 'Kapazität (Personen)'],
      ['Stelle bearbeiten', 'Art'],
      ['Stelle bearbeiten', 'Weitere Angaben'],
      ['Stelle bearbeiten', 'Standort'],
      ['Stelle bearbeiten', 'Abbrechen'],
      ['Evakuierungsbezirk anlegen', 'Bezeichnung'],
      ['Stand melden: Uferstraße 12–40', 'Zeitpunkt'],
      // Der GEWÄHLTE Radio-Knopf: am Tag lag er in `bedien` bei 6,59 : 1 — seit LFH-677
      // läuft sein Text über `--lfh-bedien-text` (`src/index.css`), tragend.
      ['Stelle bearbeiten', 'geschlossen'],
      ['Evakuierungsbezirk anlegen', 'geschätzt'],
      ['Stand melden: Uferstraße 12–40', 'gezählt'],
      ['Zeilenmenü', 'Bearbeiten (Status, Kapazität)'],
      ['Stornieren', 'Betreuungsstelle Turnhalle Ost stornieren?'],
      ['Stornieren', 'Abbrechen'],
    ] as const)
      pruefeGesehen(flaeche, tragend, true);
    for (const [flaeche, ausnahme] of [
      // Sekundärtext der Stellentabelle: „keine Meldung" (Sporthalle West, Schule Nord) und
      // „—" (frei, Kapazität, Stand, Abschnitt).
      ['inhalt', 'keine Meldung'],
      ['inhalt', '—'],
      // Augenbrauen: Blockköpfe und Feldetiketten der Bezirkskarte; dazu der Tabellenkopf.
      ['inhalt', 'Evakuierung'],
      ['inhalt', 'Betreuungsstellen'],
      ['inhalt', 'Evakuiert'],
      ['inhalt', 'Kapazität'],
      [
        'Stelle bearbeiten',
        'Leer: keine Kapazität — dann wird keine Zahl freier Plätze ausgewiesen.',
      ],
      [
        'Evakuierungsbezirk anlegen',
        'Straßenzug oder Bezirksnummer — keine Namen von Bewohnern. Die Bezeichnung steht im Einsatztagebuch.',
      ],
      [
        'Stand melden: Uferstraße 12–40',
        'Leer: jetzt. Eine nachgetragene ältere Meldung ändert den aktuellen Stand nicht.',
      ],
    ] as const)
      pruefeGesehen(flaeche, ausnahme, false);
    // Am Tag unter einer Ausnahme, nachts tragend: Rot als Text und Weiß auf `alarm`
    // (LFH-693), Weiß auf `bedien` im Primärknopf (LFH-661).
    for (const [flaeche, nurTagsAusnahme] of [
      ['Zeilenmenü', 'Stornieren'],
      ['Stornieren', 'Stornieren'],
      ['Stelle bearbeiten', 'Speichern'],
      ['kopf', 'Evakuierungsbezirk anlegen'],
    ] as const)
      pruefeGesehen(flaeche, nurTagsAusnahme, !tag);

    await testInfo.attach(`kontrastwerte-${modus}.json`, {
      body: JSON.stringify(messwerte, null, 2),
      contentType: 'application/json',
    });
  });
}

// ═══ Kriterium 13 — Tabelle ══════════════════════════════════════════════════════════════

for (const [viewport, dichte] of [
  [FUEKW, 'kompakt'],
  [HANDSCHIRM, 'handschuh'],
] as const) {
  test(`Fokus nie verdeckt: Stellentabelle halb gescrollt, vorwärts und rückwärts, ${viewport.width} px ${dichte}`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(150_000);
    await page.setViewportSize(viewport);
    await anmelden(page);
    const { id: einsatzId } = await senden(page, 'post', '/api/einsaetze', {
      bezeichnung: `E2E 677 Fokus ${Date.now()}`,
    });
    const basis = `/api/einsaetze/${einsatzId}/betreuung`;
    for (let i = 1; i <= 20; i += 1) {
      const { id } = await senden(page, 'post', `${basis}/stellen`, {
        bezeichnung: `Turnhalle ${String(i).padStart(2, '0')}`,
        art: 'notunterkunft',
        kapazitaet_personen: 100,
      });
      await senden(page, 'post', `${basis}/stellen/${id}/belegungen`, { belegt: 40 + i });
    }
    await page.goto(`/einsaetze/${einsatzId}/betreuung`);
    await stelleDichte(page, dichte);
    await expect(page.getByRole('button', { name: /^Belegung melden für / })).toHaveCount(20);

    const berichte: string[] = [];
    for (const taste of ['Tab', 'Shift+Tab'] as const) {
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      const reserve = await page.evaluate(
        () => document.documentElement.scrollHeight - innerHeight,
      );
      expect(
        reserve,
        'Vorbedingung: die Seite muss scrollen, sonst wandert nichts unter den Kopf',
      ).toBeGreaterThan(200);
      await page.evaluate((z) => window.scrollTo(0, z), Math.round(reserve / 2));

      const befund = await pruefeFokusVerdeckung(page, 140, taste);
      berichte.push(
        `${taste}: ${befund.stoppsGesamt} Stopps, davon ${befund.stoppsInTabelle} in der Tabelle, ` +
          `${befund.stoppsBeruehrt} berühren eine stehende Fläche, davon ${befund.stoppsAnTabellenkopf} die Kopfzeile, ` +
          `${befund.fixierteKandidaten} fixierte Kandidaten, ` +
          `${befund.verdeckt.length} verdeckt${befund.verdeckt.length ? `\n  ${befund.verdeckt.join('\n  ')}` : ''}`,
      );
      expect
        .soft(befund.fixierteKandidaten, `${taste}: Vorbedingung, es gibt einen fixierten Knoten`)
        .toBeGreaterThan(0);
      expect
        .soft(
          befund.stoppsInTabelle,
          `${taste}: Vorbedingung, der Durchlauf erreicht die Tabelle (${befund.stoppsGesamt} Stopps)`,
        )
        .toBeGreaterThanOrEqual(30);
      expect.soft(befund.verdeckt, `${taste}:\n${befund.verdeckt.join('\n')}`).toEqual([]);
      if (taste === 'Shift+Tab')
        expect
          .soft(
            befund.stoppsAnTabellenkopf,
            'Vorbedingung: rückwärts gerät mindestens ein Ziel an die stehende Kopfzeile',
          )
          .toBeGreaterThan(0);
    }
    await testInfo.attach('Fokus-Verdeckung Tabelle', {
      body: `${viewport.width}px ${dichte}\n${berichte.join('\n')}`,
      contentType: 'text/plain',
    });
  });
}

// ═══ Kriterium 13 — Dialoge bei 390 px im Handschuh-Betrieb ═════════════════════════════

interface DialogFall {
  name: string;
  titel: string;
  oeffne: (page: Page) => Promise<void>;
  /** Nach dem Öffnen: den Dialog in seinen höchsten Zustand bringen. */
  vorbereiten?: (page: Page, dialog: Locator) => Promise<void>;
  /**
   * Gemessen höher als der Schirm (390 × 844, handschuh, aufgeklappt) — der Fall, in dem ein
   * Ziel beim Scrollen der Hülle unter eine fixierte Fläche geraten könnte. Gepinnt, damit
   * der Nachweis nicht still auf einen Dialog schrumpft, der ganz auf den Schirm passt.
   */
  scrollt?: true;
}

const DIALOGE: DialogFall[] = [
  {
    name: 'Evakuierungsbezirk anlegen',
    scrollt: true,
    titel: 'Evakuierungsbezirk anlegen',
    oeffne: (page) =>
      page.getByRole('button', { name: 'Evakuierungsbezirk anlegen', exact: true }).click(),
  },
  {
    name: 'Plangröße fortschreiben',
    scrollt: true,
    titel: 'Bezirk bearbeiten: Uferstraße 12–40',
    oeffne: (page) => menue(page, 'Aktionen zu Bezirk Uferstraße 12–40', 'Plangröße fortschreiben'),
  },
  {
    name: 'Räumung setzen',
    titel: 'Räumung: Uferstraße 12–40',
    oeffne: (page) => menue(page, 'Aktionen zu Bezirk Uferstraße 12–40', 'Räumung setzen'),
  },
  {
    name: 'Stand melden',
    scrollt: true,
    titel: 'Stand melden: Uferstraße 12–40',
    oeffne: (page) =>
      page.getByRole('button', { name: 'Stand melden für Bezirk Uferstraße 12–40' }).click(),
  },
  {
    name: 'Bezirk stornieren',
    titel: 'Bezirk Uferstraße 12–40 stornieren?',
    oeffne: (page) => menue(page, 'Aktionen zu Bezirk Uferstraße 12–40', 'Stornieren'),
  },
  {
    name: 'Betreuungsstelle anlegen',
    scrollt: true,
    titel: 'Betreuungsstelle anlegen',
    oeffne: (page) =>
      page.getByRole('button', { name: 'Betreuungsstelle anlegen', exact: true }).click(),
  },
  {
    name: 'Belegung melden',
    titel: 'Belegung melden: Gemeindehaus Süd',
    oeffne: (page) =>
      page.getByRole('button', { name: 'Belegung melden für Gemeindehaus Süd' }).click(),
  },
  {
    name: 'Stelle bearbeiten (Schließen mit Leermeldung)',
    scrollt: true,
    titel: 'Stelle bearbeiten: Gemeindehaus Süd',
    oeffne: (page) =>
      menue(page, 'Aktionen zu Stelle Gemeindehaus Süd', 'Bearbeiten (Status, Kapazität)'),
    vorbereiten: async (_page, dialog) => {
      await dialog.getByText('geschlossen', { exact: true }).click();
      await expect(dialog.locator('.ant-alert')).toHaveCount(1);
      await expect(dialog.getByRole('checkbox')).toBeVisible();
    },
  },
  {
    name: 'Stelle stornieren',
    titel: 'Betreuungsstelle Gemeindehaus Süd stornieren?',
    oeffne: (page) => menue(page, 'Aktionen zu Stelle Gemeindehaus Süd', 'Stornieren'),
  },
];

for (const fall of DIALOGE) {
  test(`Fokus nie verdeckt im Dialog „${fall.name}" bei 390 px, handschuh`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    await page.setViewportSize(HANDSCHIRM);
    await anmelden(page);
    const { einsatzId } = await saeLage(page, 'E2E 677 Dialogfokus');
    await page.goto(`/einsaetze/${einsatzId}/betreuung`);
    await stelleDichte(page, 'handschuh');
    await expect(page.getByRole('button', { name: /^Aktionen zu Stelle / })).toHaveCount(
      STELLEN.length,
    );

    await fall.oeffne(page);
    const dialog = page.getByRole('dialog', { name: fall.titel });
    await dialogSteht(page, dialog);
    await fall.vorbereiten?.(page, dialog);
    const aufgeklappt = await weitereAufklappen(page, dialog);

    // Jedes Ziel, das der Browser per Tab anläuft, generisch markiert.
    const ziele = await dialog.evaluate((d) => {
      const namen: string[] = [];
      const kandidaten = d.querySelectorAll<HTMLElement>(
        'a[href], button, input, select, textarea, [tabindex]',
      );
      for (const el of kandidaten) {
        if (el.tabIndex < 0) continue;
        if ((el as HTMLButtonElement).disabled) continue;
        if (el.closest('[aria-hidden="true"]')) continue;
        if (el instanceof HTMLInputElement && el.type === 'hidden') continue;
        // Aus einer Radiogruppe mit Wahl läuft der Browser nur das gewählte Radio an.
        if (el instanceof HTMLInputElement && el.type === 'radio' && !el.checked) continue;
        // Der Radio-Knopf trägt ein 0 × 0-`input`; sichtbar ist seine Hülle (wie im Kern).
        const flaeche = el.closest('.ant-radio-button-wrapper') ?? el;
        if (!flaeche.checkVisibility()) continue;
        const r = flaeche.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const name = `ziel-${namen.length}:${(el.getAttribute('aria-label') ?? el.textContent ?? el.getAttribute('type') ?? el.tagName).trim().slice(0, 24)}`;
        el.setAttribute('data-e2e-fokus', name);
        namen.push(name);
      }
      return namen;
    });
    expect(
      ziele.length,
      `mindestens Schließen, ein Feld/Knopf und Absenden: ${ziele.join(' | ')}`,
    ).toBeGreaterThanOrEqual(3);
    // Schließkreuz und Absende-Knopf gehören zu den Zielen — sonst wäre die Markierung leer
    // an der Stelle, die zählt.
    await expect(dialog.locator('.ant-modal-close[data-e2e-fokus]')).toHaveCount(1);
    await expect(dialog.locator('button.ant-btn-primary[data-e2e-fokus]')).toHaveCount(1);

    // Jede Radiogruppe steht mit genau EINEM Ziel in der Liste — dem gewählten Radio.
    const gruppen = await dialog.locator('.ant-radio-group').count();
    await expect(dialog.locator('input[type="radio"][data-e2e-fokus]')).toHaveCount(gruppen);

    await dialog.locator('[data-e2e-fokus]').first().focus();
    const befund = await pruefeFokusVerdeckung(page, ziele.length * 2 + 4);
    const scrollt = await page
      .locator('.ant-modal-wrap')
      .filter({ has: dialog })
      .evaluate((w) => w.scrollHeight > w.clientHeight);
    await testInfo.attach('Fokus-Verdeckung Dialog', {
      body:
        `${fall.name}, 390px handschuh: ${ziele.length} Ziele${aufgeklappt ? ' (Weitere Angaben aufgeklappt)' : ''}, ` +
        `${befund.stoppsGesamt} Stopps, ${befund.besuchteZiele.length} besucht, ${befund.fixierteKandidaten} fixierte Kandidaten, ` +
        `${befund.verdeckt.length} verdeckt, Dialog scrollt: ${scrollt}\n${ziele.join('\n')}`,
      contentType: 'text/plain',
    });
    expect(befund.besuchteZiele.sort(), 'jedes Dialogziel muss per Tab besucht werden').toEqual(
      [...ziele].sort(),
    );
    expect(befund.fixierteKandidaten, 'Vorbedingung: es gibt fixierte Flächen').toBeGreaterThan(0);
    if (fall.scrollt)
      expect(scrollt, 'Vorbedingung: der Dialog ist höher als der Schirm').toBe(true);
    expect(befund.verdeckt, befund.verdeckt.join('\n')).toEqual([]);
  });
}
