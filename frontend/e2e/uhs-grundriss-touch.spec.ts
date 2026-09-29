import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * UHS-Grundriss unter Berührungsbedienung.
 *
 * DRAG BEI 1024, KLICKWEG BEI 390 PX: unter `lg` bricht `pages/uhs/Grundriss.tsx` in drei
 * Reiter um, mit `destroyOnHidden` — ohne die Prop bliebe eine einmal besuchte Pane montiert.
 * Personenliste (Quelle) und Platzkarte (Ziel) liegen dann in verschiedenen Reitern, das
 * Droppable existiert nicht, während die Quelle sichtbar ist. Ein Drag-Test bei 390 px wäre
 * ein Test gegen eine bewusste Entwurfsentscheidung.
 *
 * POINTER-EVENTS VON HAND: Playwright kann per `touchscreen` nur tippen, ein Drag über
 * `page.mouse` wäre `pointerType: 'mouse'`. dnd-kits `PointerSensor` hört auf Pointer Events,
 * also werden sie einzeln mit `pointerType: 'touch'` abgesetzt. FALLE: dnd-kit vermisst seine
 * Droppables in einem Effekt NACH dem Drag-Start und rechnet die Kollision nur bei einer
 * Koordinatenänderung neu — kommen alle Bewegungen in einem Tick, bleibt `over` null und es
 * fliegt kein Request. Deshalb je Schritt ein doppeltes `requestAnimationFrame`.
 *
 * Seeding per `page.request`: der Scroll-Fall braucht gut vierzig Personen.
 */
const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

/** Führungs-Tablet: 1024–1280 px, Touch. Beide Seitenspalten stehen hier nebeneinander. */
const TABLET = { width: 1024, height: 900 };
/** Mobil: ~390 px, einhändig. Hier greift die Reiter-Weiche. */
const HANDSCHIRM = { width: 390, height: 844 };

/** Der Belegungs-Endpunkt: `uhs-belegung`, NICHT `belegung`. */
const BELEGUNG = /\/api\/einsaetze\/\d+\/personen\/\d+\/uhs-belegung$/;
/** Die Personen-LISTE. Das `(\?|$)` grenzt sie gegen `…/personen/7/uhs-belegung` ab. */
const PERSONEN_LISTE = /\/api\/einsaetze\/\d+\/personen(\?|$)/;

// Touch-Kontext: erst mit `hasTouch` erlaubt Playwright `tap()`. Damit trifft
// `(pointer: coarse)` zu, und die Dichte ist per Vorgabe „komfortabel" — gewollt.
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
 * Legt Einsatz, Person(en), eine aktive UHS und einen freien Platz „Bett 1" an und öffnet die
 * UHS-Detailseite. Die benannte Person bleibt UNZUGEORDNET — Quelle von Drag und Klickweg —
 * und steht als erste angelegte oben in der Liste. `fuellPersonen` lässt die linke Spalte
 * über ihre Höhe wachsen (Scroll-Fall).
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

    // Das optimistische Update des Drag-Aufrufers ist in jsdom nicht belegbar (dnd-kits
    // Kollision braucht echte Rechtecke). Hier wird die ANFRAGE zurückgehalten, nicht die
    // Antwort: mit `route.fetch()` erreichte die Anfrage den Server, dessen SSE-Ereignis lud
    // nach, und der Test blieb auch ohne `onMutate` grün. Solange die Anfrage den Server nicht
    // erreicht, kann nur das optimistische Update die Karte an den Zielplatz gebracht haben.
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

    // Der Drop traf den PLATZ: `platz_id` ist der einzige Unterscheider.
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
    // Die Ablehnung kommt VERZÖGERT, damit der optimistische Zustand lange genug steht.
    await page.route(BELEGUNG, async (route) => {
      await new Promise((fertig) => setTimeout(fertig, 1200));
      // Die Marke MUSS vor dem Ausliefern stehen, sonst schlüpft die Nachladung aus
      // `onSettled` an der Bremse unten vorbei.
      abgelehnt = true;
      await route.fulfill({
        status: 422,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'E2E: Zuordnung abgelehnt' }),
      });
    });
    // DIE BREMSE ist der Kern: `belegMut` lädt in `onSettled` die Personenliste nach, und ein
    // Refetch stellte den Serverstand auch ohne Rollback in `onError` wieder her. Mit
    // angehaltener Nachladung kann nur das Rollback die Karte zurückbringen (die Belegung
    // wird aus der Personenliste abgeleitet).
    let nachladungDurchgelassen = false;
    await page.route(PERSONEN_LISTE, async (route) => {
      if (!abgelehnt || route.request().method() !== 'GET') {
        await route.continue();
        return;
      }
      // Nicht länger: Playwright wartet beim Kontextabbau auf laufende Route-Handler.
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
    // … dann zurück. Die Fristen liegen mit Absicht unter der Bremse: mit der Vorgabefrist
    // wartete die Zusicherung die Bremse aus und prüfte die Nachladung statt des Rollbacks.
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
    // Vierzig Füllpersonen: ohne Überlänge gibt es nichts zu scrollen.
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

    // Gescrollt wird WÄHREND eines laufenden Drags: pointerdown + Bewegungen, dann scrollen,
    // erst danach beenden. Zwei Fallen am Ort des Drags:
    //  1. Der Auto-Scroller von dnd-kit scrollt, sobald die Karte im äußeren Fünftel des
    //     Containers steht, und klemmte `scrollTop` auf 0. Deshalb liegen beide Punkte im
    //     mittleren Drittel (hergeleitet aus der Spaltenhöhe bei `TABLET`, `calc(100vh - 300px)`).
    //  2. Das DragOverlay (`position: fixed`, `touchAction: 'none'`) schluckt das Rad, wenn es
    //     unter dem Zeiger liegt — die Scrollkette führt dann aufs Dokument. Deshalb wird die
    //     Maus ZUERST gesetzt und der Touch-Drag woanders angehalten.
    const kasten = (await spalte.boundingBox())!;
    const radPunkt = { x: kasten.x + kasten.width / 2, y: kasten.y + 300 };
    const haltePunkt = { x: kasten.x + kasten.width / 2, y: kasten.y + 420 };
    await page.mouse.move(radPunkt.x, radPunkt.y);
    await starteTouchDrag(page.getByText(personName).first(), haltePunkt);

    // Der Drag LÄUFT (das Overlay steht nur zwischen Start und Ende) — sonst wäre das der
    // billige Scrolltest.
    await expect(page.getByTestId('drag-overlay'), 'der Drag läuft wirklich').toBeVisible();

    // (a) DIE TOUCH-SEITE: kein Knoten von der gezogenen Karte bis zum Scrollcontainer sperrt
    //     den Finger (`touch-action: none`). Chromium scrollt nicht aus untrusted Touch-Events,
    //     ein synthetischer Wisch bewiese also nichts. dnd-kits eigenes `none` am DragOverlay
    //     liegt nicht in dieser Kette. Der Startknoten hängt am NAMEN, nicht an der ersten
    //     Personenmarke — sonst hinge die Aussage an der Anlagereihenfolge.
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

    // (b) DIE SCROLL-SEITE: der Container ist mitten im Drag noch ein lebender Scroller,
    //     per Rad gemessen. Die Gegenproben davor trennen Rad von Auto-Scroller und Liste von
    //     Dokument.
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

    // Drag ABBRECHEN statt loslassen — ein Loslassen über der Warteliste buchte eine
    // Zuordnung. dnd-kits PointerSensor hört auf Escape.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('drag-overlay')).toHaveCount(0);
  });

  test('Mobil (390 px): gestapelte Reiter, kein Querlauf — und der Klickweg weist zu und zurück', async ({
    page,
  }) => {
    await page.setViewportSize(HANDSCHIRM);
    const { personName } = await setupPatientUndPlatz(page);

    // Kein waagerechter Überlauf, am Dokument gemessen — vor dem Öffnen eines Dialogs mit
    // eigenem Scrollrahmen.
    const ueberlauf = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(ueberlauf, 'AK 2: die Seite läuft nicht waagerecht über').toBeLessThanOrEqual(1);

    // Die Seitenspalten sind Reiter, nicht Nachbarn — und die Fläche steht vorn.
    await expect(page.getByRole('tab', { name: 'Fläche' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Wartebereich' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Transport' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Fläche' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    // Mit `destroyOnHidden` steht der Wartebereich WIRKLICH nicht im Baum.
    await expect(
      page.getByTestId('warteliste-scroll'),
      'kein zweiter, verborgener Zweig',
    ).toHaveCount(0);

    // Der Klickweg per echtem Touch-Tap. In „komfortabel" ist die Karte das EINE Bedienziel
    // und öffnet ihr Aktionsmenü; zugewiesen wird über den ersten Eintrag.
    await bett1(page).tap();
    await page.getByRole('menuitem', { name: /Patient zuweisen/ }).tap();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Patient zuweisen');
    await dialog.getByRole('combobox').tap();
    await page.locator('.ant-select-item-option').filter({ hasText: personName }).tap();
    // „Erfassen" ist der Vorgabetext der Erfassungshülle. Auf den Dialog eingegrenzt, weil
    // dieselbe Beschriftung auch an der Schnellerfassung hängt.
    await dialog.getByRole('button', { name: 'Erfassen', exact: true }).tap();

    await expect(bett1(page), 'der Klickweg hat zugewiesen').toContainText(personName);

    // Rückweg: unter `lg` gibt es keinen Drag in den Wartebereich; der Ersatz ist der
    // Menüeintrag.
    await bett1(page).tap();
    await page.getByRole('menuitem', { name: /Zurück in den Wartebereich/ }).tap();
    await expect(bett1(page), 'der Platz ist wieder frei').not.toContainText(personName);
    await page.getByRole('tab', { name: 'Wartebereich' }).tap();
    await expect(page.getByTestId('warteliste-scroll').getByText(personName)).toBeVisible();
  });

  /**
   * In den Berührungsstufen ist die Karte das eine Ziel und öffnet das Aktionsmenü. Karte UND
   * jeder Menüeintrag halten die Steuerhöhe der Stufe (echte `boundingBox()`); geöffnet wird
   * PER TIPP — ein sichtbares Ziel ist noch kein bedienbares.
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
      // Gegenprobe: keine Knopfzeile in der Karte.
      await expect(karte.getByRole('button')).toHaveCount(0);

      const kasten = await karte.boundingBox();
      expect(kasten, 'Karte steht im Layout').not.toBeNull();
      expect(kasten!.width, 'Kartenbreite').toBeGreaterThanOrEqual(soll);
      expect(kasten!.height, 'Kartenhöhe').toBeGreaterThanOrEqual(soll);
      // Die Kartengröße ist dichteunabhängig.
      expect(Math.round(kasten!.width)).toBe(140);
      expect(Math.round(kasten!.height)).toBe(116);

      await karte.tap();
      const menue = page.locator('.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]');
      await expect(menue).toHaveCount(1);
      const eintraege = menue.getByRole('menuitem');
      await expect(eintraege.first()).toContainText('Patient zuweisen');
      const zahl = await eintraege.count();
      expect(zahl, 'Zuweisen + vier Verfügbarkeiten').toBeGreaterThanOrEqual(5);
      // Erst nach der Einblendung messen: antds `slide-up` startet mit `scaleY(0.8)`.
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

      // Tastaturweg: Esc schließt, Enter auf der Karte öffnet erneut, und der Fokus steht auf
      // dem ERSTEN Eintrag (ohne `autoFocus` am Dropdown bliebe er auf der Karte). Ein zweites
      // Enter löst den Eintrag aus.
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
   * In der Kartenform ist die Karte zugleich Menü-Auslöser, Drop-Ziel und im Bearbeiten-Modus
   * Zug-Quelle. Der Klick, der am Ende eines Zuges noch feuern kann, darf kein Menü öffnen.
   * Gezogen wird mit der Maus: die Frage ist der abschließende `click`, nicht die Zeigerart.
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

    // 1) Personen-Zug: per API belegen, dann die Marke in den Wartebereich ziehen.
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
   * Ein belegter Platz trägt im Handschuh acht Einträge à 72 px — mehr, als über oder unter
   * der Karte Platz hat; mit antds Vorgabe stand das Menü aus dem Fenster. Zugesichert: JEDER
   * Eintrag liegt vollständig im Fenster.
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

    // Kein Ziel IN der belegten Karte: dnd-kit setzt an der Personenmarke auch bei `disabled`
    // `role="button"` und `tabIndex`, die Kartenform nimmt beides zurück.
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
