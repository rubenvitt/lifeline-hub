import { expect, test, type Page } from '@playwright/test';

// Browser-Smoke des Katalogtabellen-Primitivs am schmalen Schirm (LFH-329 · B1).
//
// Warum hier und nicht in Vitest: jsdom rechnet KEIN Layout — dort sind alle Breiten 0,
// eine wirkungslose Fixierung oder ein überragender Container fielen nie auf. Die
// Unit-Tests pinnen die DOM-Struktur, dieser Spec die einzige Aussage, die zählt:
// die Tabelle scrollt in sich, drückt die Seite nicht breit, und die Kopfzeile steht.
//
// Bewusst NICHT gemessen wird der Seitencontainer (`components/AdminPage.tsx`) oder der
// Seitenkörper: beide tragen Kopfleiste und Seitenrinne mit, die andere Arbeitspakete
// dieses Bandes gerade umbauen — der Spec wäre dann fremdverschuldet rot. Gemessen wird
// ausschliesslich DOM, das dieses Paket selbst erzeugt.

const BREITE = 390;
const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

test.use({ viewport: { width: BREITE, height: 844 } });

async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill(ADMIN);
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

/**
 * x-Positionen der fixierten und einer nicht-fixierten Zelle DERSELBEN Datenzeile,
 * dazu der verbleibende waagerechte Bildlaufweg.
 *
 * Gemessen wird an der Körperzelle (`td`), nicht an der Kopfzelle (`th`): mit
 * `sticky` zieht antd Kopf und Körper in zwei getrennte Bildlaufbereiche und
 * gleicht sie per Skript ab. Eine Messung am Kopf träte gegen diesen Abgleich an
 * und wäre ein Wettlauf.
 *
 * RELATIV ZUM BILDLAUFCONTAINER, nicht in Sichtfeld-Koordinaten. Die Fixierung
 * sagt „die Zelle bleibt am linken Rand IHRES Containers stehen" — wo dieser
 * Container im Sichtfeld liegt, ist eine andere Frage und gehört anderen
 * Paketen. Absolut gemessen wackelte die Zusicherung: bei `--repeat-each=5` fiel
 * ein Lauf mit 62,3 → 51,4 px, weil sich die Seite zwischen den beiden Messungen
 * noch um 10,8 px zurechtrückte — der Container wanderte mitsamt seiner
 * fixierten Zelle, die Fixierung selbst war tadellos. Relativ gemessen ist der
 * Wert in allen Läufen 0.
 */
async function zellenX(page: Page) {
  return page.evaluate(() => {
    const koerper = document.querySelector('.ant-table-body')!;
    const zeile = document.querySelector('tr.ant-table-row')!;
    const fix = zeile.querySelector('td.ant-table-cell-fix-start')!;
    const nicht = zeile.querySelector('td:not(.ant-table-cell-fix-start)')!;
    const bezug = koerper.getBoundingClientRect().x;
    return {
      fix: fix.getBoundingClientRect().x - bezug,
      nichtFix: nicht.getBoundingClientRect().x - bezug,
      restweg: koerper.scrollWidth - koerper.clientWidth,
    };
  });
}

test('Katalogtabelle bei 390 px: scrollt in sich, drückt die Seite nicht breit, Kopfzeile bleibt stehen', async ({
  page,
}) => {
  await anmelden(page);
  // Benutzerliste: sechs Spalten und ohne jede Vorarbeit mindestens eine Datenzeile
  // (der vom Harness angelegte Admin). Ein Anlegen-Dialog auf 390 px wäre zusätzliche
  // Fehlerquelle ohne Erkenntnisgewinn.
  await page.goto('/admin/benutzer');
  const zeile = page.locator('tr.ant-table-row').first();
  await expect(zeile).toBeVisible();

  const koerper = page.locator('.ant-table-body');
  const rahmen = page.locator('.ant-table').first();

  // (a) Die Tabelle ist breiter als der Schirm UND scrollt in sich. Beide Hälften sind
  //     nötig: ohne den Überhang wäre (b) trivial erfüllt und bewiese nichts.
  const masse = await koerper.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
  }));
  expect(masse.scrollWidth).toBeGreaterThan(masse.clientWidth);

  // (b) …und der Tabellenrahmen bleibt trotzdem im Schirm. Das ist die eigentliche
  //     Zusicherung: der Überhang lebt im Scrollcontainer, nicht in der Seitenbreite.
  //
  // GEMESSEN WIRD scrollWidth, NICHT clientWidth. Die frühere Fassung prüfte
  // `rahmen.clientWidth <= BREITE` und war strukturell unfähig, ihre eigene Aussage
  // zu widerlegen: `clientWidth` ist die INNERE Breite und kann die des
  // eingeschränkten Elternelements konstruktiv nie überschreiten. Per Mutationsprobe
  // belegt — nimmt man dem Primitiv sein `scroll={{ x: 'max-content' }}`, also genau
  // den Mechanismus, den dieser Spec bewacht, drückt die Seite real auf 498 px
  // (Wurzel-scrollWidth) und `.ant-table` misst 459 px Inhalt, während die geprüfte
  // clientWidth mit 326 px brav unter 390 blieb und der Test grün durchlief.
  //
  // `scrollWidth` am `.ant-table` misst den INHALT: 325 px an HEAD, 459 px ohne die
  // Scroll-Fläche. Damit fällt die Zusicherung genau dann, wenn der Überhang aus dem
  // Scrollcontainer ausbricht.
  //
  // Bewusst NICHT `documentElement.scrollWidth`: das wäre zwar ebenfalls
  // diskriminierend (390 → 498), verließe aber die Abgrenzung im Dateikopf — dieser
  // Spec misst nur DOM, das dieses Paket selbst erzeugt. Die seitenweite Aussage für
  // genau diese Route und Breite gehört `gate1-ueberlauf.spec.ts` (`/admin/benutzer`
  // bei 390 px) und ist dort gepinnt.
  const rahmenMasse = await rahmen.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
  }));
  expect(
    rahmenMasse.scrollWidth,
    `Tabelleninhalt drückt die Seite breit (scrollWidth ${rahmenMasse.scrollWidth}, clientWidth ${rahmenMasse.clientWidth})`,
  ).toBeLessThanOrEqual(BREITE);

  // (c) Die erste Spalte ist die fixierte, menschenlesbare Kennung — genau eine.
  const fixierte = page.locator('th.ant-table-cell-fix-start');
  await expect(fixierte).toHaveCount(1);
  await expect(fixierte).toHaveCSS('position', 'sticky');

  // (d) Die Kopfzeile steht wirklich fest.
  const kopf = page.locator('.ant-table-sticky-holder');
  await expect(kopf).toHaveCSS('position', 'sticky');

  // ---- (e) Wirknachweis der FIXIERTEN SPALTE: waagerecht scrollen, x-Position halten.
  //
  // Was (c) pinnt, ist die Sache selbst — ohne `fixed: 'left'` gäbe es die Klasse
  // `ant-table-cell-fix-start` nicht. Hier kommt die gemessene WIRKUNG dazu.
  //
  // FRÜHER STAND HIER NUR `await expect(fixierte).toBeVisible()`. Das belegte über die
  // Fixierung nichts: die Tabelle wurde nirgends waagerecht gescrollt, und
  // `toBeVisible` verlangt keine Überschneidung mit dem Sichtfeld — die Zusicherung
  // war auch bei abgeschalteter Fixierung grün (per Mutationsprobe belegt).
  const xVor = await zellenX(page);
  // Vorbedingung: gäbe es keinen Bildlaufweg, wäre die Messung darunter leer.
  // Gemessen 206 px (390 × 844, Benutzerliste des Harness).
  expect(xVor.restweg, 'Vorbedingung: Tabelle braucht waagerechten Bildlaufweg').toBeGreaterThan(
    50,
  );

  await koerper.evaluate((el) => el.scrollTo(300, 0));
  const xNach = await zellenX(page);

  // BEIDE Hälften sind nötig. Ohne „die nicht-fixierte Zelle ist gewandert" wäre ein
  // stillschweigend nicht ausgeführter Bildlauf grün und die Haltezusicherung trivial;
  // ohne „die fixierte hält" bewiese das Wandern nichts über die Fixierung.
  // Gemessen (relativ zum Bildlaufcontainer): nicht-fixiert 103 → −103 px, also um
  // die vollen 206 px gewandert; fixiert 0 → 0 px.
  expect(xNach.nichtFix, 'nicht-fixierte Zelle muss mitwandern').toBeLessThan(
    xVor.nichtFix - 100,
  );
  expect(
    Math.abs(xNach.fix - xVor.fix),
    `fixierte Spalte hält ihre x-Position (${xVor.fix} → ${xNach.fix})`,
  ).toBeLessThanOrEqual(1);

  // ---- (f) Wirknachweis der STEHENDEN KOPFZEILE.
  //
  // FRÜHER STAND HIER `window.scrollTo(0, 400)` und danach `y >= 0`. Beides belegte
  // nichts, und zwar aus zwei unabhängigen Gründen:
  //  - Die Benutzerliste des Harness trägt EINE Datenzeile. Bei 844 px Schirmhöhe ist
  //    das Dokument gemessene 884 px hoch, also 40 px Bildlaufreserve. Von den
  //    verlangten 400 px kamen 40 an; die Kopfzeile stand danach immer noch weit
  //    unterhalb von y = 0 und die Fixierung war nie im Spiel. Die damalige
  //    Vorbedingung `scrollY > 0` war mit diesen 40 px erfüllt und verdeckte genau das.
  //  - `y >= 0` ist auch ohne jede Fixierung wahr, solange die Kopfzeile weit genug
  //    unten startet: gemessen y = 161 px vor dem Bildlauf, nach 40 px also 121 px.
  //
  // Der Nachweis braucht Bildlaufreserve. Die BREITE bleibt bei 390 px — sie ist die
  // Frage dieses Specs —, die HÖHE wird für diesen Schritt verkürzt: 400 px ergeben
  // gemessene 484 px Reserve, und die Kopfzeile erreicht y = 0.
  await page.setViewportSize({ width: BREITE, height: 400 });
  await expect(zeile).toBeVisible();

  const kopfVor = (await kopf.boundingBox())!;
  const hoeheVor = kopfVor.height;
  // Ziel: knapp ÜBER den Startpunkt der Kopfzeile. Ohne Fixierung stünde sie danach
  // bei −20 px, mit Fixierung bei 0. Ein fester Wert (früher 400) trifft je nach
  // Startposition entweder gar nicht — zu wenig Reserve — oder zu weit: ab gemessenen
  // ~220 px ist die ganze Tabelle durchgelaufen, die Fixierung gibt die Kopfzeile
  // wieder frei (gemessen bei Ziel 240 → y = −33,5), und y wäre erneut negativ, ohne
  // dass etwas kaputt wäre. Deshalb hängt das Ziel an der gemessenen Startposition.
  const ziel = kopfVor.y + 20;
  await page.evaluate((z) => window.scrollTo(0, z), ziel);
  const erreicht = await page.evaluate(() => window.scrollY);
  expect(erreicht, 'Vorbedingung: die Seite muss so weit scrollen können').toBeCloseTo(ziel, 0);

  const rahmenNach = (await rahmen.boundingBox())!;
  // Vorbedingung: die Tabelle steht noch im Bild. Sonst wäre ein negatives y kein
  // Fixierungsfehler, sondern eine durchgelaufene Tabelle — siehe Ziel 240 oben.
  expect(
    rahmenNach.y + rahmenNach.height,
    'Vorbedingung: die Tabelle darf noch nicht durchgelaufen sein',
  ).toBeGreaterThan(hoeheVor);

  const kopfNach = (await kopf.boundingBox())!;
  // Die eigentliche Aussage: die Kopfzeile steht am oberen Rand, statt mit der Seite
  // nach oben aus dem Bild zu wandern. Ohne Fixierung stünde sie hier bei −20 px.
  expect(
    Math.abs(kopfNach.y),
    `Kopfzeile steht am oberen Rand (${kopfVor.y} → ${kopfNach.y})`,
  ).toBeLessThanOrEqual(1);
});
