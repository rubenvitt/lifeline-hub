import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * UHS-Grundriss unter Berührungsbedienung (LFH-341 · C6, AK 1 und AK 2).
 *
 * ── WARUM DER DRAG BEI 1024 UND DER KLICKWEG BEI 390 PX GEPRÜFT WIRD ────────────────────
 *
 * Das ist keine Bequemlichkeit, sondern folgt aus dem Bau. Unter `lg` (992 px) bricht
 * `pages/uhs/Grundriss.tsx` in drei Reiter um — „Fläche | Wartebereich | Transport", die
 * Fläche voran — und zwar mit **`destroyOnHidden`**: der inaktive Reiter steht wirklich nicht
 * im Baum. Die Prop ist dafür nötig und nicht bloss Zierde (gemessen im Abschluss-Review):
 * antds Vorgabe reicht `destroyOnHidden ?? destroyInactiveTabPane` durch, beide `undefined`
 * ergeben `removeOnLeave: false` — eine einmal BESUCHTE Pane bliebe montiert, nur mit
 * `display: none`. Damit liegen bei 390 px die Personenliste (Quelle) und die Platzkarte
 * (Ziel) in verschiedenen Reitern; das Droppable existiert gar nicht, während die Quelle
 * sichtbar ist.
 *
 * Ein Drag-Test bei 390 px könnte deshalb **nicht grün werden** — nicht weil etwas kaputt
 * wäre, sondern weil die Geste dort strukturell keine ist. Wer ihn dennoch hinzufügt,
 * schreibt einen Test gegen eine bewusste Entwurfsentscheidung.
 *
 * Deshalb die Aufteilung:
 *   * **1024 px** (Kontext „Führungs-Tablet") — dort stehen beide Spalten nebeneinander,
 *     dort ist der Drag der gemeinte Weg, dort wird er unter Touch belegt.
 *   * **390 px** (Kontext „mobil") — dort ist der Klickweg aus LFH-367/B5g der einzige Weg,
 *     dort wird er unter echtem Touch-Tap belegt, samt Rückweg über das Platzaktionen-Menü.
 *
 * ── WARUM DIE POINTER-EVENTS VON HAND KOMMEN ────────────────────────────────────────────
 *
 * Playwright hat keine Touch-Drag-API: `page.touchscreen` kann tippen, nicht ziehen. Ein
 * Drag über `page.mouse` wäre `pointerType: 'mouse'` und belegte genau das nicht, was hier
 * zu belegen ist. dnd-kits `PointerSensor` hört auf Pointer Events — die drei Ereignisse
 * werden deshalb einzeln mit `pointerType: 'touch'` abgesetzt.
 *
 * GEMESSEN, und die Falle, an der der erste Anlauf hing: die Bewegungen dürfen NICHT in
 * einem synchronen Rutsch kommen. dnd-kit vermisst seine Droppables (`MeasuringStrategy`)
 * in einem Effekt NACH dem Drag-Start und rechnet die Kollision nur bei einer
 * Koordinatenänderung neu. Feuern alle Bewegungen in einem Tick, ist beim letzten
 * `pointermove` noch nichts vermessen, danach ändert sich nichts mehr — `over` bleibt
 * `null`, `onDragEnd` kehrt früh zurück und es fliegt kein einziger Request. Der Test war
 * rot, obwohl der Drag lief (das Overlay stand). Deshalb liegt zwischen den Schritten je
 * ein doppeltes `requestAnimationFrame`. Ein Maus-Drag über `page.mouse.move(..., {steps})`
 * hat das Problem nicht, weil Playwright die Schritte ohnehin über Frames verteilt.
 *
 * ── SEEDING PER `page.request` ──────────────────────────────────────────────────────────
 *
 * Die Session ist Cookie-basiert (`api/client.ts`, `credentials: 'same-origin'`, kein
 * CSRF-Header), `page.request` teilt den Cookie-Jar des Kontexts. Der Scroll-Fall braucht
 * gut vierzig Personen — über die Schnellerfassung wären das ~80 Interaktionen und der Test
 * bestünde zu neun Zehnteln aus Aufbau. Muster aus `betroffene-schmal.spec.ts`.
 */
const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

/** Führungs-Tablet: 1024–1280 px, Touch. Beide Seitenspalten stehen hier nebeneinander. */
const TABLET = { width: 1024, height: 900 };
/** Mobil: ~390 px, einhändig. Hier greift die Reiter-Weiche. */
const HANDSCHIRM = { width: 390, height: 844 };

/** Der Belegungs-Endpunkt. `uhs-belegung`, NICHT `belegung` — s. `api/einsatzUhs.ts`. */
const BELEGUNG = /\/api\/einsaetze\/\d+\/personen\/\d+\/uhs-belegung$/;
/** Die Personen-LISTE. Das `(\?|$)` grenzt sie gegen `…/personen/7/uhs-belegung` ab. */
const PERSONEN_LISTE = /\/api\/einsaetze\/\d+\/personen(\?|$)/;

// Touch-Kontext für die ganze Datei: erst mit `hasTouch` erlaubt Playwright `tap()`.
// Nebenwirkung, gemessen und beabsichtigt: `matchMedia('(pointer: coarse)')` trifft damit
// zu, `useViewport.zeigerIstGrob` belegt die Dichtestufe also auf „komfortabel" vor —
// genau der Kontext, für den diese Datei geschrieben ist.
test.use({ hasTouch: true });

async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill(ADMIN);
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

/** Seeding-Helfer: POST mit lauter Fehlermeldung, wenn der Aufbau scheitert. */
async function seede<T>(page: Page, pfad: string, data: unknown, was: string): Promise<T> {
  const antwort = await page.request.post(pfad, { data });
  expect(antwort.ok(), `Seeding ${was}: ${antwort.status()} ${await antwort.text()}`).toBeTruthy();
  return (await antwort.json()) as T;
}

interface Aufbau {
  einsatzId: number;
  uhsId: number;
  /** Eindeutiger Name der EINEN benannten Person — der Anker aller Zusicherungen. */
  personName: string;
}

/**
 * Legt Einsatz, Person(en), eine aktive UHS und einen freien Platz „Bett 1" an und öffnet
 * die UHS-Detailseite. Die benannte Person bleibt bewusst UNZUGEORDNET („Noch nicht
 * aufgenommen") — sie ist Quelle sowohl des Drags als auch des Klickwegs.
 *
 * `fuellPersonen` erzeugt zusätzliche namenlose Personen; sie dienen allein dazu, die linke
 * Spalte über ihre sichtbare Höhe hinauswachsen zu lassen (Scroll-Fall). Die benannte
 * Person wird ZUERST angelegt und steht deshalb oben in der Liste — sichtbar ohne Scrollen.
 */
async function setupPatientUndPlatz(page: Page, fuellPersonen = 0): Promise<Aufbau> {
  await anmelden(page);
  const stempel = Date.now();

  const einsatz = await seede<{ id: number }>(
    page,
    '/api/einsaetze',
    { bezeichnung: `E2E UHS Touch ${stempel}` },
    'Einsatz',
  );
  const einsatzId = einsatz.id;

  const personName = `TouchPat${stempel}`;
  await seede(page, `/api/einsaetze/${einsatzId}/personen`, { name: personName }, 'Person');
  for (let i = 0; i < fuellPersonen; i++) {
    await seede(page, `/api/einsaetze/${einsatzId}/personen`, {}, `Füllperson ${i}`);
  }

  const uhs = await seede<{ id: number }>(
    page,
    `/api/einsaetze/${einsatzId}/uhs`,
    { typ: 'behandlungsplatz', bezeichnung: `BHP Touch ${stempel}` },
    'UHS',
  );
  const uhsId = uhs.id;
  await seede(
    page,
    `/api/einsaetze/${einsatzId}/uhs/${uhsId}/plaetze/bulk`,
    { typ: 'bett', menge: 1 },
    'Plätze',
  );
  // Erst „aktiv" nimmt die UHS Patienten auf — eine geplante lehnt die Belegung fachlich ab.
  await seede(
    page,
    `/api/einsaetze/${einsatzId}/uhs/${uhsId}/status`,
    { status: 'aktiv' },
    'UHS-Status',
  );

  await page.goto(`/einsaetze/${einsatzId}/unfallhilfsstellen/${uhsId}`);
  await expect(page.getByText('Bett 1')).toBeVisible();
  return { einsatzId, uhsId, personName };
}

/** Die Platzkarte „Bett 1" — Drop-Ziel des Drags und Klickziel des Zuweisungswegs. */
function bett1(page: Page): Locator {
  return page.locator('[data-testid="platz-karte"]', { hasText: 'Bett 1' });
}

/**
 * Startet einen Touch-Drag auf `quelle` in Richtung `zielMitte` und lässt ihn LAUFEN —
 * ohne `pointerup`. Zehn Zwischenschritte, damit dnd-kit den 5-px-Activation-Constraint
 * sicher nimmt.
 */
async function starteTouchDrag(quelle: Locator, zielMitte: { x: number; y: number }) {
  await quelle.evaluate(async (el, ziel) => {
    // Doppeltes rAF zwischen den Schritten — s. Dateikopf: ohne das bleibt `over` null.
    const frame = () =>
      new Promise((fertig) => requestAnimationFrame(() => requestAnimationFrame(fertig)));
    const opt = (x: number, y: number) => ({
      pointerId: 1,
      pointerType: 'touch',
      isPrimary: true,
      button: 0,
      buttons: 1,
      clientX: x,
      clientY: y,
      bubbles: true,
      cancelable: true,
    });
    const r = el.getBoundingClientRect();
    const x0 = r.x + r.width / 2;
    const y0 = r.y + r.height / 2;
    const x1 = ziel.x;
    const y1 = ziel.y;
    el.dispatchEvent(new PointerEvent('pointerdown', opt(x0, y0)));
    for (let i = 1; i <= 10; i++) {
      document.dispatchEvent(
        new PointerEvent('pointermove', opt(x0 + ((x1 - x0) * i) / 10, y0 + ((y1 - y0) * i) / 10)),
      );
      await frame();
    }
  }, zielMitte);
}

/** Touch-Drag von `quelle` auf `ziel`, inklusive Loslassen über dem Ziel. */
async function ziehePerTouch(page: Page, quelle: Locator, ziel: Locator) {
  const kasten = await ziel.boundingBox();
  expect(kasten, 'Drag-Ziel muss im Layout stehen').not.toBeNull();
  const mitte = { x: kasten!.x + kasten!.width / 2, y: kasten!.y + kasten!.height / 2 };
  await starteTouchDrag(quelle, mitte);
  await page.evaluate((m) => {
    document.dispatchEvent(
      new PointerEvent('pointerup', {
        pointerId: 1,
        pointerType: 'touch',
        isPrimary: true,
        button: 0,
        clientX: m.x,
        clientY: m.y,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, mitte);
}

test.describe('UHS-Grundriss unter Touch', () => {
  test('Führungs-Tablet (1024 px): Touch-Drag auf einen Platz — und die Karte steht VOR der Server-Antwort dort', async ({
    page,
  }) => {
    await page.setViewportSize(TABLET);
    const { personName } = await setupPatientUndPlatz(page);

    // ZUSATZAUFTRAG (aus Task 6 weitergereicht): das optimistische Update des
    // DRAG-Aufrufers von `belegMut` ist in jsdom nicht belegbar — der Personen-Drop
    // braucht ein `over` aus dnd-kits Kollisionserkennung, und die beruht auf
    // `getBoundingClientRect`, das in jsdom immer {0,0,0,0} liefert. Im Browser geht es,
    // indem der Serverruf angehalten wird: in diesem Fenster muss die Karte bereits am
    // Zielplatz stehen.
    //
    // ZURÜCKGEHALTEN WIRD DIE ANFRAGE, NICHT DIE ANTWORT — und das ist der Unterschied
    // zwischen einem Beweis und einer Attrappe. Gemessen: mit bloß verzögerter ANTWORT
    // (`route.fetch()`, warten, `fulfill`) blieb dieser Test grün, obwohl `onMutate` in
    // `belegMut` abgeschaltet war. Denn `route.fetch()` schickt die Anfrage sofort los, der
    // Server schreibt die Belegung und sein Live-Ereignis (SSE) treibt eine Nachladung an —
    // die Karte steht dann am Zielplatz, ohne dass je optimistisch etwas geschehen wäre.
    // Solange die Anfrage den Server nicht erreicht, kann NUR das optimistische Update sie
    // dorthin gebracht haben.
    let anfrageDurchgelassen = false;
    await page.route(BELEGUNG, async (route) => {
      await new Promise((fertig) => setTimeout(fertig, 2500));
      anfrageDurchgelassen = true;
      await route.continue();
    });

    const platz = bett1(page);
    await expect(platz).toBeVisible();
    const belegung = page.waitForRequest((r) => r.method() === 'POST' && BELEGUNG.test(r.url()));

    await ziehePerTouch(page, page.getByText(personName).first(), platz);

    // Der Drop traf den PLATZ, nicht Wartebereich oder Transport: `platz_id` ist der
    // einzige Unterscheider — `art` ist auf allen Wegen eine Zeichenkette und bewiese nichts.
    const req = await belegung;
    const koerper = JSON.parse(req.postData() ?? '{}') as { platz_id?: number | null };
    expect(typeof koerper.platz_id, 'der Drop traf die Platzkarte').toBe('number');

    // Optimistisch: die Karte steht am Ziel, bevor der Server die Anfrage überhaupt gesehen hat.
    await expect(platz).toContainText(personName, { timeout: 1200 });
    expect(anfrageDurchgelassen, 'die Karte stand da, BEVOR der Server die Anfrage sah').toBe(
      false,
    );

    // Und nachdem der Server bestätigt hat, bleibt sie dort.
    await expect(platz).toContainText('belegt');
  });

  test('Führungs-Tablet: eine abgelehnte Zuordnung rollt die Karte auf den Ausgangsplatz zurück', async ({
    page,
  }) => {
    await page.setViewportSize(TABLET);
    const { personName } = await setupPatientUndPlatz(page);

    let abgelehnt = false;
    // Die Ablehnung kommt VERZÖGERT, damit der optimistische Zustand lange genug steht,
    // um ihn überhaupt behaupten zu können.
    await page.route(BELEGUNG, async (route) => {
      await new Promise((fertig) => setTimeout(fertig, 1200));
      // Die Marke MUSS vor dem Ausliefern stehen: sonst schlüpft die von `onSettled`
      // ausgelöste Nachladung an der Bremse unten vorbei.
      abgelehnt = true;
      await route.fulfill({
        status: 422,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'E2E: Zuordnung abgelehnt' }),
      });
    });
    // DIE BREMSE, und sie ist der Kern dieser Zusicherung: `belegMut` hängt ein
    // `onSettled: invalidate` an, das die Personenliste neu lädt. Ohne diese Bremse wäre
    // der Test auch dann grün, wenn das Zurückrollen in `onError` GELÖSCHT wäre — der
    // Refetch stellte den Serverstand ohnehin wieder her, und die Zusicherung prüfte den
    // Refetch statt das Rollback. Mit angehaltener Nachladung kann nur das Rollback selbst
    // die Karte zurückbringen. (`uhsDetail` lädt weiterhin frei nach; die Belegung wird
    // aus der PERSONENLISTE abgeleitet — `belegtAn` liest `personenInUhs`.)
    let nachladungDurchgelassen = false;
    await page.route(PERSONEN_LISTE, async (route) => {
      if (!abgelehnt || route.request().method() !== 'GET') {
        await route.continue();
        return;
      }
      // 3000, nicht mehr: Playwright wartet beim Kontextabbau auf laufende Route-Handler,
      // eine Bremse, die den Test überlebt, kostet jeden Lauf Leerlauf und kann ein
      // `route.continue()` gegen eine geschlossene Seite werfen. Die Zusicherungen unten
      // laufen mit 2500 ms — die Aussage trägt genauso.
      await new Promise((fertig) => setTimeout(fertig, 3000));
      nachladungDurchgelassen = true;
      await route.continue();
    });

    const platz = bett1(page);
    const warteliste = page.getByTestId('warteliste-scroll');
    await expect(warteliste.getByText(personName)).toBeVisible();

    await ziehePerTouch(page, page.getByText(personName).first(), platz);

    // Erst optimistisch am Ziel …
    await expect(platz, 'optimistisch am Zielplatz').toContainText(personName, { timeout: 1000 });
    // … dann zurück, weil der Server abgelehnt hat. Die Fristen sind KURZ und mit Absicht:
    // sie müssen unter der Bremse oben liegen. Gemessen — mit der Vorgabefrist (10 s) blieb
    // dieser Test grün, obwohl das Rückrollen in `onError` gelöscht war: die Zusicherung
    // wartete die Bremse einfach aus und prüfte dann die Nachladung.
    await expect(platz, 'nach der Ablehnung nicht mehr am Zielplatz').not.toContainText(
      personName,
      { timeout: 2500 },
    );
    await expect(warteliste.getByText(personName), 'zurück am Ausgangsort').toBeVisible({
      timeout: 2500,
    });
    expect(
      nachladungDurchgelassen,
      'die Nachladung stand noch — nur das Rückrollen kann es gewesen sein',
    ).toBe(false);
  });

  test('Führungs-Tablet: die Warteliste scrollt bei ANGEHALTENEM Drag weiter', async ({ page }) => {
    await page.setViewportSize(TABLET);
    // Vierzig Füllpersonen: ohne Überlänge gibt es nichts zu scrollen, und die Zusicherung
    // wäre nicht widerlegbar.
    const { personName } = await setupPatientUndPlatz(page, 40);

    const spalte = page.getByTestId('warteliste-scroll');
    const masse = await spalte.evaluate((el) => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    }));
    expect(
      masse.scrollHeight,
      `Vorbedingung: die Warteliste muss überhaupt scrollbar sein (${masse.scrollHeight} vs. ${masse.clientHeight})`,
    ).toBeGreaterThan(masse.clientHeight + 10);
    await spalte.evaluate((el) => {
      el.scrollTop = 0;
    });

    // Das AK verlangt den Scroll WÄHREND des Drags. Ein Scrolltest ohne laufenden Drag
    // prüft etwas anderes — und `touchAction !== 'none'` allein halten die beiden
    // Bestands-Zusicherungen aus B5g in `Grundriss.test.tsx` schon billiger.
    // Deshalb: pointerdown + Bewegungen, dann scrollen, ERST DANACH beenden.
    //
    // ZWEI GEMESSENE FALLEN, beide am Ort des Drags — wer hier Koordinaten ändert, liest
    // erst weiter:
    //
    //  1. **Der Auto-Scroller.** dnd-kit scrollt selbsttätig, sobald die gezogene Karte im
    //     äußeren Fünftel eines Scrollcontainers steht (Default-Schwelle 0.2, hier also
    //     120 px). Der erste Anlauf hielt den Drag 83 px unter der Oberkante: der
    //     Auto-Scroller zog unablässig nach oben und klemmte `scrollTop` auf 0. Deshalb
    //     liegen BEIDE Punkte unten im mittleren Drittel.
    //  2. **Das DragOverlay schluckt das Rad.** Es ist `position: fixed` und trägt
    //     dnd-kits eigenes `touchAction: 'none'`; liegt es unter dem Zeiger, hittestet
    //     Chromium das Rad auf ein fixiertes Element, dessen Scrollkette an der Liste
    //     VORBEI direkt aufs Dokument führt — gemessen: Spalte 0, Dokument 241. Und weil
    //     das Overlay dem Zeiger folgt, zieht ein `page.mouse.move` an die Radposition es
    //     genau dorthin. Deshalb wird die Maus ZUERST gesetzt und der Touch-Drag danach
    //     woanders angehalten; die synthetischen Ereignisse bewegen den echten Zeiger nicht.
    // Die beiden Abstände sind aus der Spaltenhöhe bei `TABLET` hergeleitet: der Grundriss
    // steht in `calc(100vh - 300px)`, bei 900 px Fensterhöhe also 600 px. Beide Punkte
    // liegen damit im mittleren Drittel. Wer `TABLET.height` ändert, rechnet sie nach —
    // die beiden Gegenproben unten melden es sonst, aber erst zur Laufzeit.
    const kasten = (await spalte.boundingBox())!;
    const radPunkt = { x: kasten.x + kasten.width / 2, y: kasten.y + 300 };
    const haltePunkt = { x: kasten.x + kasten.width / 2, y: kasten.y + 420 };
    await page.mouse.move(radPunkt.x, radPunkt.y);
    await starteTouchDrag(page.getByText(personName).first(), haltePunkt);

    // Der Drag LÄUFT — ohne diesen Beleg fiele der Test auf den billigen Scrolltest
    // zurück. Das Overlay steht nur zwischen `onDragStart` und `onDragEnd`/`onDragCancel`.
    await expect(page.getByTestId('drag-overlay'), 'der Drag läuft wirklich').toBeVisible();

    // (a) DIE TOUCH-SEITE. Kein Knoten von der gezogenen Karte bis zum Scrollcontainer
    //     sperrt den Finger. Das ist die eigentliche Aussage der B5g-Entscheidung gegen
    //     `touch-action: 'none'` — und die einzige, die überhaupt etwas über den FINGER
    //     sagt: Chromium fährt kein Compositor-Scrolling aus untrusted Touch-Events, ein
    //     synthetischer Wisch bewegte also nichts, was ein echter nicht auch bewegte.
    //     (dnd-kit setzt `touchAction: 'none'` sehr wohl — aber auf sein eigenes
    //     DragOverlay, das `position: fixed` neben der Liste schwebt und nicht in dieser
    //     Kette liegt.)
    // Der Startknoten hängt am NAMEN, nicht an der ersten Personenmarke im Container: die
    // gezogene Person steht heute zufällig oben (sie wird zuerst angelegt), und ein
    // `querySelector` auf die erste Marke wäre damit von der Anlagereihenfolge abhängig statt
    // von der Aussage. Die Mutationsprobe deckt das nicht auf — sie trifft nur das obere Ende
    // der Kette. Gegriffen wird über `data-lfh`, nicht über eine antd-Klasse (LFH-621).
    const gesperrt = await spalte.evaluate((container, name) => {
      const start = Array.from(
        container.querySelectorAll<HTMLElement>('[data-lfh="personenkarte"]'),
      ).find((karte) => karte.textContent?.includes(name));
      if (!start) throw new Error(`gezogene Karte „${name}" steht nicht in der Warteliste`);
      const treffer: string[] = [];
      let n: HTMLElement | null = start;
      while (n) {
        if (getComputedStyle(n).touchAction === 'none') treffer.push(n.className || n.tagName);
        if (n === container) break;
        n = n.parentElement;
      }
      return treffer;
    }, personName);
    expect(gesperrt, 'kein Knoten der Warteliste schaltet natives Scrollen ab').toEqual([]);

    // (b) DIE SCROLL-SEITE: der Container ist mitten im Drag noch ein lebender Scroller.
    //     Gemessen per Rad, weil das der einzige Scrollweg ist, den Playwright
    //     vertrauenswürdig auslösen kann. Davor stehen die Gegenproben zu den beiden
    //     Fallen oben — ohne sie wäre nicht zu unterscheiden, ob das Rad gescrollt hat
    //     oder der Auto-Scroller, und ob überhaupt die Liste gemeint war.
    expect(await spalte.evaluate((el) => el.scrollTop), 'vor dem Rad steht die Liste still').toBe(
      0,
    );
    const overlayKasten = (await page.getByTestId('drag-overlay').boundingBox())!;
    expect(
      radPunkt.y < overlayKasten.y || radPunkt.y > overlayKasten.y + overlayKasten.height,
      'die Radposition liegt nicht unter dem DragOverlay',
    ).toBe(true);
    await page.mouse.wheel(0, 300);
    await expect.poll(async () => spalte.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);

    // Drag ABBRECHEN statt loslassen: ein Loslassen über der Warteliste träfe deren
    // Droppable und buchte eine Zuordnung, die dieser Test nie wollte. dnd-kits
    // PointerSensor hört auf Escape.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('drag-overlay')).toHaveCount(0);
  });

  test('Mobil (390 px): gestapelte Reiter, kein Querlauf — und der Klickweg weist zu und zurück', async ({
    page,
  }) => {
    await page.setViewportSize(HANDSCHIRM);
    const { personName } = await setupPatientUndPlatz(page);

    // AK 2: kein waagerechter Überlauf. Gemessen am Dokument, nicht am Augenschein — und
    // VOR dem Öffnen eines Dialogs, dessen Hülle ihren eigenen Scrollrahmen mitbringt.
    const ueberlauf = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(ueberlauf, 'AK 2: die Seite läuft nicht waagerecht über').toBeLessThanOrEqual(1);

    // AK 2: die Seitenspalten sind Reiter, nicht Nachbarn — und die Fläche steht vorn.
    await expect(page.getByRole('tab', { name: 'Fläche' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Wartebereich' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Transport' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Fläche' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    // Die Gegenprobe zur Reiter-Weiche: mit `destroyOnHidden` steht der Wartebereich
    // WIRKLICH nicht im Baum — genau deshalb ist ein Drag hier keine Geste mehr.
    await expect(
      page.getByTestId('warteliste-scroll'),
      'kein zweiter, verborgener Zweig',
    ).toHaveCount(0);

    // AK 1: der Klickweg, hier per echtem Touch-Tap. Diese Datei läuft mit `hasTouch` und
    // damit in der Stufe „komfortabel" (Dateikopf) — dort ist die Karte seit LFH-359 das
    // EINE Bedienziel und öffnet ihr Aktionsmenü; zugewiesen wird über den ersten Eintrag.
    // Getippt wird auf die Kartenmitte: die Karte hat in dieser Form keine Aktionszeile mehr,
    // die einen Tipp abfangen könnte.
    await bett1(page).tap();
    await page.getByRole('menuitem', { name: /Patient zuweisen/ }).tap();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Patient zuweisen');
    await dialog.getByRole('combobox').tap();
    await page.locator('.ant-select-item-option').filter({ hasText: personName }).tap();
    // Die Beschriftung ist „Erfassen", nicht „Zuweisen": `Grundriss.tsx` übergibt kein
    // `erfassenText`, und der Vorgabewert der Hülle ist `'Erfassen'`
    // (`components/Erfassung.tsx`). Auf den Dialog eingegrenzt, weil dieselbe Beschriftung
    // auch an der Schnellerfassung hängt.
    await dialog.getByRole('button', { name: 'Erfassen', exact: true }).tap();

    await expect(bett1(page), 'der Klickweg hat zugewiesen').toContainText(personName);

    // AK 1, Rückweg: unter `lg` ist der Drag zurück in den Wartebereich strukturell weg
    // (das Droppable liegt in einem anderen Reiter). Der Ersatz ist der Menüeintrag — in der
    // Kartenform über einen Tipp auf die Karte selbst.
    await bett1(page).tap();
    await page.getByRole('menuitem', { name: /Zurück in den Wartebereich/ }).tap();
    await expect(bett1(page), 'der Platz ist wieder frei').not.toContainText(personName);
    await page.getByRole('tab', { name: 'Wartebereich' }).tap();
    await expect(page.getByTestId('warteliste-scroll').getByText(personName)).toBeVisible();
  });

  /**
   * LFH-359 + LFH-379: in den Berührungsstufen ist die Karte das eine Ziel und öffnet das
   * Aktionsmenü. Gemessen wird die echte `boundingBox()` — Karte UND jeder Menüeintrag halten
   * die Steuerhöhe der Stufe. Geöffnet wird PER TIPP, nicht über `toBeVisible()` auf einem
   * Knopf (ein sichtbares Ziel ist noch kein bedienbares, CLAUDE.md zu LFH-355).
   */
  for (const [dichte, soll] of [
    ['komfortabel', 48],
    ['handschuh', 72],
  ] as const) {
    test(`Berührungsstufe ${dichte}: die Karte ist das eine Ziel, Karte und Menüeinträge ≥ ${soll} px`, async ({
      page,
    }) => {
      await page.setViewportSize(TABLET);
      await setupPatientUndPlatz(page);
      await page.evaluate(
        (wert) => window.localStorage.setItem('lifeline-hub.dichte', wert),
        dichte,
      );
      await page.reload();
      await expect(page.locator('html')).toHaveAttribute('data-dichte', dichte);

      const karte = bett1(page);
      await expect(karte).toHaveAttribute('role', 'button');
      await expect(karte).toHaveAttribute('aria-haspopup', 'menu');
      // Gegenprobe: keine Knopfzeile mehr in der Karte (LFH-379: sie lief über).
      await expect(karte.getByRole('button')).toHaveCount(0);

      const kasten = await karte.boundingBox();
      expect(kasten, 'Karte steht im Layout').not.toBeNull();
      expect(kasten!.width, 'Kartenbreite').toBeGreaterThanOrEqual(soll);
      expect(kasten!.height, 'Kartenhöhe').toBeGreaterThanOrEqual(soll);
      // Die Kartengröße ist dichteunabhängig (Spec: Raster und Layout bleiben).
      expect(Math.round(kasten!.width)).toBe(140);
      expect(Math.round(kasten!.height)).toBe(116);

      await karte.tap();
      const menue = page.locator('.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]');
      await expect(menue).toHaveCount(1);
      const eintraege = menue.getByRole('menuitem');
      await expect(eintraege.first()).toContainText('Patient zuweisen');
      const zahl = await eintraege.count();
      expect(zahl, 'Zuweisen + vier Verfügbarkeiten').toBeGreaterThanOrEqual(5);
      // ERST NACH DER EINBLENDUNG MESSEN (gemessen): antds `slide-up`-Bewegung startet mit
      // `scaleY(0.8)`, die `boundingBox()` davor liest 0,8 × die Endhöhe — 38,4 statt 48 und
      // 57,6 statt 72 px, bei korrekt berechnetem Stil (`paddingBlock` + `lineHeight` =
      // `controlHeight`). Gewartet wird auf das Ende der Bewegungsklassen am Popup.
      await expect(page.locator('.ant-dropdown:not(.ant-dropdown-hidden)')).not.toHaveClass(
        /ant-slide-up-(enter|appear)/,
      );
      for (let i = 0; i < zahl; i++) {
        const k = await eintraege.nth(i).boundingBox();
        expect(k, `Menüeintrag ${i} steht im Layout`).not.toBeNull();
        expect(k!.height, `Menüeintrag ${i} (${k!.height} px)`).toBeGreaterThanOrEqual(soll - 0.5);
      }
      // Ein Tipp hat NUR das Menü geöffnet, keinen Zuweisungsdialog.
      await expect(page.getByRole('dialog')).toHaveCount(0);

      // Tastaturweg (Spec „Tastatur"): Esc schließt, Enter auf der fokussierten Karte öffnet
      // erneut, und der Fokus steht dann auf dem ERSTEN Eintrag — gemessen: ohne das
      // `autoFocus` am Dropdown bliebe er auf der Karte (`menu.autoFocus` allein reicht nicht).
      // Ein zweites Enter löst den Eintrag aus.
      await page.keyboard.press('Escape');
      await expect(karte).toHaveAttribute('aria-expanded', 'false');
      // Esc gibt den Fokus an die Karte zurück (rc-dropdown), ohne dass der Test nachhilft.
      await expect(karte).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(karte).toHaveAttribute('aria-expanded', 'true');
      await expect(eintraege.first()).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('dialog')).toContainText('Patient zuweisen');
    });
  }

  /**
   * Spec „Gesten bleiben Zusatzwege" (LFH-359): in der Kartenform ist die Karte zugleich
   * Menü-Auslöser, Drop-Ziel und — im Bearbeiten-Modus — Zug-Quelle. Ein Zug darf dabei kein
   * Menü öffnen: der Klick, der am Ende eines Zuges im Browser noch feuern kann, ginge sonst
   * an den Auslöser. Gezogen wird mit der Maus (`page.mouse`): die Frage ist, ob der
   * abschließende `click` den Auslöser erreicht, nicht die Zeigerart.
   */
  test('Kartenform (komfortabel): Layout-Zug und Personen-Zug öffnen kein Menü', async ({
    page,
  }) => {
    await page.setViewportSize(TABLET);
    const { einsatzId, uhsId, personName } = await setupPatientUndPlatz(page);
    await page.evaluate(() => window.localStorage.setItem('lifeline-hub.dichte', 'komfortabel'));
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-dichte', 'komfortabel');
    const offenesMenue = page.locator('.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]');

    // 1) Personen-Zug: erst belegen (per API, der Weg ist nicht die Frage), dann die Marke
    //    aus der Karte in den Wartebereich ziehen.
    const personen = (await (
      await page.request.get(`/api/einsaetze/${einsatzId}/personen`)
    ).json()) as { id: number; name: string | null }[];
    const person = personen.find((p) => p.name === personName)!;
    const detail = (await (
      await page.request.get(`/api/einsaetze/${einsatzId}/uhs/${uhsId}`)
    ).json()) as { plaetze: { id: number }[] };
    await seede(
      page,
      `/api/einsaetze/${einsatzId}/personen/${person.id}/uhs-belegung`,
      { art: 'eintritt', uhs_id: uhsId, platz_id: detail.plaetze[0].id },
      'Belegung',
    );
    await page.reload();
    const marke = bett1(page).locator('[data-lfh="personenkarte"]');
    await expect(marke).toContainText(personName);

    const wartebereich = page.getByRole('region', { name: /Wartebereich/ });
    const von = (await marke.boundingBox())!;
    const nach = (await wartebereich.boundingBox())!;
    await page.mouse.move(von.x + von.width / 2, von.y + von.height / 2);
    await page.mouse.down();
    await page.mouse.move(nach.x + nach.width / 2, nach.y + nach.height / 2, { steps: 16 });
    await page.mouse.up();
    await expect(wartebereich.getByText(personName)).toBeVisible();
    await expect(bett1(page)).not.toContainText(personName);
    await expect(offenesMenue, 'der Personen-Zug hat kein Menü geöffnet').toHaveCount(0);
    await expect(bett1(page)).toHaveAttribute('aria-expanded', 'false');

    // 2) Layout-Zug im Bearbeiten-Modus.
    await page.getByRole('button', { name: 'Plätze bearbeiten' }).click();
    const karte = bett1(page);
    const vorher = (await karte.boundingBox())!;
    const patch = page.waitForRequest(
      (r) => r.method() === 'PATCH' && /\/uhs\/\d+\/plaetze\/\d+$/.test(r.url()),
    );
    await page.mouse.move(vorher.x + vorher.width / 2, vorher.y + 14);
    await page.mouse.down();
    await page.mouse.move(vorher.x + vorher.width / 2 + 120, vorher.y + 14 + 60, { steps: 16 });
    await page.mouse.up();
    await patch;
    await expect(offenesMenue, 'der Layout-Zug hat kein Menü geöffnet').toHaveCount(0);
    await expect(karte).toHaveAttribute('aria-expanded', 'false');

    // Gegenprobe: ein Klick OHNE Bewegung öffnet das Menü im Bearbeiten-Modus weiterhin.
    await karte.click();
    await expect(offenesMenue).toHaveCount(1);
    await expect(offenesMenue.getByRole('menuitem').last()).toContainText('Platz löschen');
  });

  /**
   * Gemessen bei 1024 × 900: ein belegter Platz trägt im Handschuh acht Einträge à 72 px —
   * mehr, als unter oder über der Karte Platz hat. Mit antds Vorgabe (nur umklappen) stand das
   * Menü nach oben aus dem Fenster, und die Primäraktion war nicht erreichbar. Zugesichert
   * wird deshalb: JEDER Eintrag liegt vollständig im Fenster.
   */
  test('Handschuh, belegter Platz: alle Menüeinträge liegen im Fenster', async ({ page }) => {
    await page.setViewportSize(TABLET);
    const { einsatzId, uhsId, personName } = await setupPatientUndPlatz(page);
    const personen = (await (
      await page.request.get(`/api/einsaetze/${einsatzId}/personen`)
    ).json()) as { id: number; name: string | null }[];
    const person = personen.find((p) => p.name === personName)!;
    const detail = (await (
      await page.request.get(`/api/einsaetze/${einsatzId}/uhs/${uhsId}`)
    ).json()) as { plaetze: { id: number }[] };
    await seede(
      page,
      `/api/einsaetze/${einsatzId}/personen/${person.id}/uhs-belegung`,
      { art: 'eintritt', uhs_id: uhsId, platz_id: detail.plaetze[0].id },
      'Belegung',
    );
    await page.evaluate(() => window.localStorage.setItem('lifeline-hub.dichte', 'handschuh'));
    await page.reload();
    await expect(bett1(page)).toContainText(personName);

    // Kein Ziel IN der belegten Karte: dnd-kit setzt an der ziehbaren Personenmarke auch bei
    // `disabled` `role="button"` und `tabIndex` — die Kartenform nimmt beides zurück.
    await expect(bett1(page).getByRole('button')).toHaveCount(0);
    await expect(bett1(page).locator('[tabindex]:not([tabindex="-1"])')).toHaveCount(0);

    await bett1(page).tap();
    const popup = page.locator('.ant-dropdown:not(.ant-dropdown-hidden)');
    await expect(popup).not.toHaveClass(/ant-slide-up-(enter|appear)/);
    const eintraege = popup.getByRole('menuitem');
    await expect(eintraege.first()).toContainText('Verbleib / Entlassung erfassen');
    const zahl = await eintraege.count();
    expect(zahl, 'Verbleib, Person, Rückweg, vier Verfügbarkeiten, zurückweisen').toBe(8);
    for (let i = 0; i < zahl; i++) {
      await expect(eintraege.nth(i), `Eintrag ${i} liegt im Fenster`).toBeInViewport({
        ratio: 1,
      });
    }
    // Und bedienbar ist der oberste wirklich: ein Tipp öffnet den Verbleib-Dialog.
    await eintraege.first().tap();
    await expect(page.getByRole('dialog')).toContainText('Verbleib');
  });
});
