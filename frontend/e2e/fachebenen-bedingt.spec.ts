import { expect, test } from '@playwright/test';

// LFH-594: bedingte Anfragen am Fachebenen-Endpunkt. Der Server liefert `ETag` +
// `Cache-Control: private, no-cache`; den Rest macht der HTTP-Cache des Browsers: er schickt
// beim nächsten Abruf `If-None-Match`, bekommt `304` ohne Body und reicht dem Aufrufer die
// gespeicherte Antwort als 200 durch. `apiGet` (`src/api/client.ts`) ruft `fetch` ohne
// `cache`-Option — genau diesen Weg nimmt der Test, ohne `page.route` (ein `fulfill` liefe am
// HTTP-Cache vorbei und bewiese nichts).
//
// Die Aussage „ein 304 leert die Ebene nicht" steht hier: die zweite Antwort, die der
// Aufrufer sieht, ist Byte für Byte die erste. Ein Browser, der das 304 als leeren Body
// durchreichte, machte den Vergleich rot.
//
// Netzfrei: KRITIS kommt aus dem lokalen Bestand; ohne Bestand ist die Antwort ein stabiler
// Offline-Umschlag, es läuft kein externer Abruf.

const PFAD = '/api/karte/fachebenen/kritis?bbox=6.9,50.9,7.0,51.0';

test('zweiter Abruf einer Fachebene ist 304 auf der Leitung und voll beim Aufrufer', async ({
  page,
}) => {
  await page.goto('/login');
  await expect(page.getByLabel('Benutzername')).toBeVisible();

  // Playwrights `response.status()` meldet für eine revalidierte Antwort den zusammengeführten
  // Stand (200). Den Status auf der Leitung zeigt nur das Rohereignis von Chromium; dazu der
  // Anfragekopf, um die Kette „Browser fragt bedingt → Server sagt 304" zu belegen.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  // Chromium darf die ExtraInfo-Ereignisse vor oder nach dem Hauptereignis feuern; deshalb
  // wird erst beim Prüfen zusammengesetzt, nicht beim Eintreffen.
  const kritisIds = new Set<string>();
  const antworten: Array<{ id: string; status: number }> = [];
  const kopfJe = new Map<string, string | null>();
  cdp.on('Network.requestWillBeSent', (e) => {
    if (e.request.url.includes('/api/karte/fachebenen/kritis')) kritisIds.add(e.requestId);
  });
  cdp.on('Network.requestWillBeSentExtraInfo', (e) => {
    const h = Object.fromEntries(
      Object.entries(e.headers).map(([k, v]) => [k.toLowerCase(), String(v)]),
    );
    kopfJe.set(e.requestId, h['if-none-match'] ?? null);
  });
  cdp.on('Network.responseReceivedExtraInfo', (e) => {
    antworten.push({ id: e.requestId, status: e.statusCode });
  });
  const leitung = () =>
    antworten
      .filter((a) => kritisIds.has(a.id))
      .map((a) => ({ status: a.status, ifNoneMatch: kopfJe.get(a.id) ?? null }));

  const abruf = (pfad: string) =>
    page.evaluate(async (p) => {
      const res = await fetch(p, { credentials: 'same-origin' });
      return { status: res.status, etag: res.headers.get('etag'), text: await res.text() };
    }, pfad);

  const erst = await abruf(PFAD);
  expect(erst.status).toBe(200);
  expect(erst.etag, 'Antwort trägt einen ETag').toBeTruthy();
  expect(JSON.parse(erst.text)).toMatchObject({ quelle: 'kritis' });

  const zweit = await abruf(PFAD);
  // Der Aufrufer sieht 200 mit dem gespeicherten Stand — nie einen leeren Body.
  expect(zweit.status).toBe(200);
  expect(zweit.text).toBe(erst.text);

  // Auf der Leitung war der zweite Abruf ein 304: der Browser hat nachgefragt, statt neu zu laden.
  await expect.poll(leitung).toEqual([
    { status: 200, ifNoneMatch: null },
    { status: 304, ifNoneMatch: erst.etag },
  ]);
});
