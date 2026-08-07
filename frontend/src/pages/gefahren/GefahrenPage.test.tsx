import { StrictMode } from 'react';
import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/server';
import { neuerQueryClient, renderMitProviders } from '../../test/utils';
import { setzeViewportBreite } from '../../test/viewport';
import GefahrenPage, { gebietszeileStil } from './GefahrenPage';
import { dichten } from '../../theme/tokens';
import { einsatzKeys } from '../../api/queryKeys';
import { formatiereDatenstand } from '../../components/Datenstand';

const einsatz = {
  id: 1, bezeichnung: 'Lage', stichwort: null, status: 'aktiv', begonnen_at: '', abgeschlossen_at: null,
  abgeschlossen_von: null, einsatzart: 'realeinsatz', einsatznummer_intern: null, angelegt_at: '',
  leitstellen_nr: null, einsatzort: null, einsatzort_lat: null, einsatzort_lon: null, meldende_stelle: null,
  sachverhalt: null, anzahl_betroffene_initial: null, meine_rolle: 'einsatzleitung',
};
const gebiet = { id: 7, einsatz_id: 1, label: 'Nord', zonen_ids: [9], hoechste_warnstufe: 'hoch' };

function handlers(gebiete: unknown[] = [gebiet], matrix: unknown[] = []) {
  return [
    http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz)),
    http.get('/api/einsaetze/1/gefahrengebiete', () => HttpResponse.json(gebiete)),
    http.get('/api/einsaetze/1/gefahrengebiete/7/matrix', () => HttpResponse.json(matrix)),
  ];
}
function renderPage() {
  return renderMitProviders(
    <Routes><Route path="/einsaetze/:id/gefahren" element={<GefahrenPage />} /></Routes>,
    { route: '/einsaetze/1/gefahren' },
  );
}

describe('GefahrenPage', () => {
  it('listet Gefahrengebiete und zeigt die Matrix des gewählten', async () => {
    server.use(...handlers());
    renderPage();
    // „Nord" erscheint in der Liste UND als editierbarer Titel → mehrere Treffer.
    expect((await screen.findAllByText('Nord'))[0]).toBeInTheDocument();
    // Erstes Gebiet automatisch gewählt → Matrix sichtbar.
    expect(screen.getAllByText('Brand')[0]).toBeInTheDocument();
    expect(screen.getByLabelText(/^Datenstand \d{2}:\d{2}$/)).toBeInTheDocument();
  });

  it('wählt ein Gefahrengebiet mit Enter über die Auswahlzeile', async () => {
    const sued = { id: 8, einsatz_id: 1, label: 'Süd', zonen_ids: [11], hoechste_warnstufe: 'mittel' };
    server.use(
      ...handlers([gebiet, sued]),
      http.get('/api/einsaetze/1/gefahrengebiete/8/matrix', () => HttpResponse.json([])),
    );
    const user = userEvent.setup();
    renderPage();

    const zeile = await screen.findByRole('button', { name: /Süd/ });
    zeile.focus();
    await user.keyboard('{Enter}');

    expect(await screen.findByRole('heading', { level: 5 })).toHaveTextContent('Süd');
  });

  it('weist Gebietsliste und Matrix mit dem älteren erfolgreichen Stand aus', async () => {
    server.use(...handlers());
    const client = neuerQueryClient();
    const gebieteStand = new Date('2026-01-01T10:12:00Z').getTime();
    const matrixStand = new Date('2026-01-01T09:05:00Z').getTime();
    for (const key of [
      einsatzKeys.gefahrengebiete(1),
      einsatzKeys.gefahrenmatrix(1, 7),
    ]) client.setQueryDefaults(key, { staleTime: Infinity });
    client.setQueryData(einsatzKeys.gefahrengebiete(1), [gebiet], { updatedAt: gebieteStand });
    client.setQueryData(einsatzKeys.gefahrenmatrix(1, 7), [], { updatedAt: matrixStand });

    renderMitProviders(
      <Routes><Route path="/einsaetze/:id/gefahren" element={<GefahrenPage />} /></Routes>,
      { route: '/einsaetze/1/gefahren', client },
    );

    await screen.findByRole('list');
    expect(await screen.findByLabelText(
      `Datenstand ${formatiereDatenstand(matrixStand)}`,
    )).toBeInTheDocument();
    expect(screen.queryByLabelText(
      `Datenstand ${formatiereDatenstand(gebieteStand)}`,
    )).not.toBeInTheDocument();
  });

  /**
   * Leerzustand (LFH-331 · B3). Der Ort der Handlung liegt woanders: ein
   * Gefahrengebiet entsteht durch Zeichnen auf der Lagekarte. Deshalb trägt der
   * Leerzustand hier — anders als die reinen Karten-Listen — eine Primäraktion, und
   * ihr Ziel kommt aus `routing/deeplinks.ts` (`lagekartePfad`), nicht als
   * Vorlagentext von Hand.
   *
   * Die Knoten-Zusicherung ist die tragende: die Textzeile war vor dem Umbau grün.
   */
  it('zeigt Leerzustand ohne Gefahrengebiete — mit dem Weg zur Lagekarte', async () => {
    server.use(...handlers([]));
    const { container } = renderMitProviders(
      <Routes>
        <Route path="/einsaetze/:id/gefahren" element={<GefahrenPage />} />
        {/* Zielsonde: belegt, dass der Knopf wirklich auf der Lagekarten-Route landet.
            Ein Vergleich auf den String allein prüfte den Builder gegen sich selbst. */}
        <Route path="/einsaetze/:id/lagekarte" element={<div>Kartenfläche</div>} />
      </Routes>,
      { route: '/einsaetze/1/gefahren' },
    );
    expect(await screen.findByText(/keine Gefahrengebiete/i)).toBeInTheDocument();
    expect(container.querySelector('.ant-empty')).toBeNull();
    // Höchstens EINE Primäraktion (AK3) — und sie führt aus dem Leerzustand heraus.
    const knoepfe = screen.getAllByRole('button');
    expect(knoepfe).toHaveLength(1);
    expect(knoepfe[0]).toHaveTextContent('Zur Lagekarte');
    await userEvent.click(knoepfe[0]);
    expect(await screen.findByText('Kartenfläche')).toBeInTheDocument();
  });

  it('zeigt die höchste Warnstufe als Etikett, nicht als Flächenfarbe (LFH-368)', async () => {
    server.use(...handlers());
    renderPage();
    const tag = await screen.findByText('hoch');
    // Der PASTELLWERT ist die Signatur des Fehlgriffs: `warnstufeFarbe('hoch')` = '#ffa39e'
    // landete als `color=` am `<Tag>`. Der Hex-String selbst steht NICHT im `style` — antd
    // rechnet ihn beim Rendern in `rgb(...)` um (per Mutationsprobe gemessen:
    // `color: rgb(255, 163, 158)` bei `#ffa39e`) und trägt ihn als TEXTFARBE, nicht als
    // Hintergrund; die Hintergrundfläche ist ein daraus abgeleiteter Tint. Geprüft wird
    // deshalb die ABWESENHEIT des umgerechneten Werts, nicht der neue Wert — den positiv zu
    // pinnen prüfte antds Vorgaben, weil `test/utils.tsx` ein nacktes `ConfigProvider`
    // rendert (dieselbe Falle wie bei Höhen).
    expect(tag.closest('.ant-tag')!.getAttribute('style') ?? '').not.toContain('rgb(255, 163, 158)');
  });

  it('bietet „Auf Karte zeigen" mit Reverse-Deeplink auf die Lagekarte (LFH-155)', async () => {
    server.use(...handlers());
    renderPage();
    const link = await screen.findByRole('link', { name: /Auf Karte zeigen/i });
    expect(link).toHaveAttribute('href', '/einsaetze/1/lagekarte?gefahrengebiet=7');
  });

  it('korrigiert die Auswahl, wenn das gewählte Gebiet aus der Liste verschwindet', async () => {
    const nord = { id: 7, einsatz_id: 1, label: 'Nord', zonen_ids: [9], hoechste_warnstufe: 'hoch' };
    const sued = { id: 8, einsatz_id: 1, label: 'Süd', zonen_ids: [11], hoechste_warnstufe: 'mittel' };
    let aktuelle: unknown[] = [nord];
    let matrix8Angefragt = false;
    server.use(
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz)),
      http.get('/api/einsaetze/1/gefahrengebiete', () => HttpResponse.json(aktuelle)),
      http.get('/api/einsaetze/1/gefahrengebiete/7/matrix', () => HttpResponse.json([])),
      http.get('/api/einsaetze/1/gefahrengebiete/8/matrix', () => {
        matrix8Angefragt = true;
        return HttpResponse.json([]);
      }),
    );
    const client = neuerQueryClient();
    renderMitProviders(
      <Routes><Route path="/einsaetze/:id/gefahren" element={<GefahrenPage />} /></Routes>,
      { route: '/einsaetze/1/gefahren', client },
    );
    // Gebiet 7 (Nord) ist gewählt, seine Matrix gerendert.
    expect((await screen.findAllByText('Nord'))[0]).toBeInTheDocument();
    expect(screen.getAllByText('Brand')[0]).toBeInTheDocument();
    // Refetch liefert nur noch Gebiet 8 (Süd) → Auswahl fällt auf das erste zurück.
    aktuelle = [sued];
    client.invalidateQueries({ queryKey: ['gefahrengebiete', 1] });
    expect((await screen.findAllByText('Süd'))[0]).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Nord')).not.toBeInTheDocument());
    // Matrix des neu gewählten Gebiets (8) wurde geladen.
    await waitFor(() => expect(matrix8Angefragt).toBe(true));
  });

  it('?gefahrengebiet= wählt das Zielgebiet statt des ersten — auch unter StrictMode (LFH-150)', async () => {
    const nord = { id: 7, einsatz_id: 1, label: 'Nord', zonen_ids: [9], hoechste_warnstufe: 'hoch' };
    const sued = { id: 8, einsatz_id: 1, label: 'Süd', zonen_ids: [11], hoechste_warnstufe: 'mittel' };
    const client = neuerQueryClient();
    // Wie nach Navigation von der Lagekarte: einsatz + gefahrengebiete sind bereits gecached
    // (gebieteQuery.isSuccess ist beim ersten Render true).
    client.setQueryData(['einsatz', 1], einsatz);
    client.setQueryData(['gefahrengebiete', 1], [nord, sued]);
    server.use(
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz)),
      http.get('/api/einsaetze/1/gefahrengebiete', () => HttpResponse.json([nord, sued])),
      http.get('/api/einsaetze/1/gefahrengebiete/7/matrix', () => HttpResponse.json([])),
      http.get('/api/einsaetze/1/gefahrengebiete/8/matrix', () => HttpResponse.json([])),
    );
    // StrictMode wie in der echten App (main.tsx): Effekte laufen doppelt — deckt das
    // Race zwischen Default-auf-erstes-Gebiet und Deeplink-Selektion auf.
    renderMitProviders(
      <StrictMode>
        <Routes><Route path="/einsaetze/:id/gefahren" element={<GefahrenPage />} /></Routes>
      </StrictMode>,
      { route: '/einsaetze/1/gefahren?gefahrengebiet=8', client },
    );
    // FINALE Auswahl: der editierbare Titel (h5) zeigt NUR das gewählte Gebiet.
    const titel = await screen.findByRole('heading', { level: 5 });
    expect(titel).toHaveTextContent('Süd'); // NICHT 'Nord' (= Default aufs erste Gebiet)
  });

  it('setzt eine Warnstufe (PUT auf das gewählte Gebiet)', async () => {
    let put: Record<string, unknown> | null = null;
    server.use(
      ...handlers(),
      http.put('/api/einsaetze/1/gefahrengebiete/7/matrix/bewertung', async ({ request }) => {
        put = (await request.json()) as typeof put;
        return HttpResponse.json({ id: 1, gefahrengebiet_id: 7, ...put, beschreibung: null, gemeldet_von: null, aktualisiert_von: 1, erstellt_at: '', geaendert_at: '' });
      }),
    );
    renderPage();
    // Seit LFH-368/B5h trägt die Zelle EINEN Auslöser statt eines Mini-Selects; der
    // zugängliche Name nennt Zeile, Spalte und die aktuelle Stufe.
    await userEvent.click(await screen.findByRole('button', { name: 'Bewertung Brand × Menschen: keine' }));
    // Der Eintrag wird über das OFFENE Menü gegriffen — antd lässt die Portale
    // geschlossener Dropdowns im Baum stehen (Muster aus `etb/EtbTabelle.test.tsx`).
    const menue = document.querySelector<HTMLElement>('.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]');
    if (!menue) throw new Error('kein offenes Menü im Baum');
    await userEvent.click(within(menue).getByRole('menuitem', { name: /hoch/i }));
    // Auf den PUT selbst warten: es gibt keinen Select-Neuzeichnung mehr, auf die
    // sich ein Textsucher stützen könnte.
    await waitFor(() => expect(put).toMatchObject({
      gefahrentyp: 'brand', schutzobjekt: 'menschen', warnstufe: 'hoch',
    }));
  });

  it('benennt das gewählte Gefahrengebiet um (PATCH)', async () => {
    let patch: Record<string, unknown> | null = null;
    server.use(
      ...handlers(),
      http.patch('/api/einsaetze/1/gefahrengebiete/7', async ({ request }) => {
        patch = (await request.json()) as typeof patch;
        return HttpResponse.json({ id: 7, einsatz_id: 1, label: (patch as { label: string }).label, zonen_ids: [9], hoechste_warnstufe: 'hoch' });
      }),
    );
    renderPage();
    // Editierbarer Titel des gewählten Gebiets „Nord" rendert ein Edit-Control.
    await screen.findAllByText('Nord');
    // antd Typography.editable rendert genau EIN Edit-Trigger-Button (aria-label „Edit").
    const editBtn = screen.getByLabelText('Edit');
    await userEvent.click(editBtn);
    const input = await screen.findByRole('textbox');
    await userEvent.clear(input);
    await userEvent.type(input, 'Süd');
    // Das Edit-Feld ist ein <textarea>; Enter fügt sonst nur einen Umbruch ein.
    // Bestätigung robust über Enter-keyDown + Blur (löst editable.onChange aus).
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', keyCode: 13 });
    fireEvent.blur(input);
    await waitFor(() => expect(patch).toEqual({ label: 'Süd' }));
  });

  // Task 4 (LFH-368): unter `lg` stapeln Gebietsliste und Matrix, statt sich nebeneinander
  // zu quetschen. Die Behauptung ist die Flex-RICHTUNG, nicht eine Pixelbreite — jsdom
  // rechnet kein Layout. Beide Fälle zusammen sind die Behauptung: nur „column bei 800"
  // wäre auch erfüllt, wenn die Richtung fest auf `column` stünde.
  it('stapelt Gebietsliste und Matrix unter lg, statt sie nebeneinander zu quetschen', async () => {
    server.use(...handlers());
    setzeViewportBreite(800); // < lg (992)
    renderPage();
    const rahmen = (await screen.findByRole('list')).closest('[data-gefahren-rahmen]')!;
    expect(rahmen).toHaveStyle({ flexDirection: 'column' });
  });

  it('stellt sie ab lg nebeneinander', async () => {
    server.use(...handlers());
    setzeViewportBreite(1280);
    renderPage();
    const rahmen = (await screen.findByRole('list')).closest('[data-gefahren-rahmen]')!;
    expect(rahmen).toHaveStyle({ flexDirection: 'row' });
  });

  /**
   * Die Gebietszeile ist ein handgebautes Bedienziel und muss den Boden selbst tragen
   * (Abschluss-Review zu LFH-368, Konvention aus LFH-365). Die reine Funktion prüft die
   * WERTE, dieser Fall prüft, dass sie überhaupt am `<div onClick>` ankommen — genau die
   * Regression, die `Liste.tsx:171-175` benennt („kein Test sähe es"), wenn dort jemand den
   * `...style`-Spread nach vorn zöge.
   *
   * Geprüft wird die ANWESENHEIT und die REIHENFOLGE der Angaben im Inline-Style, kein Wert:
   * `test/utils.tsx` montiert ein nacktes `ConfigProvider` ohne unser Theme, jede Zahl hier
   * belegte antd-Vorgaben statt der Staffel (gemessen: `min-height: 32px; padding: 12px 16px`
   * — antds Voreinstellungen, nicht 30/48/72).
   */
  it('legt den Trefflächenboden wirklich auf die klickbare Gebietszeile', async () => {
    server.use(...handlers());
    renderPage();
    await screen.findAllByText('Nord');
    const zeile = document.querySelector<HTMLElement>('.listen-eintrag');
    if (!zeile) throw new Error('keine Listenzeile im Baum');
    const stil = zeile.getAttribute('style') ?? '';
    expect(stil).toContain('min-height');
    // Die zweite Hälfte der Konvention: die Kurzform `padding` muss NACH den Längsformen
    // `padding-block`/`padding-inline` der Liste stehen, sonst gewinnen deren kleinere Werte
    // und die Polsterung fällt still weg. Genau diese Reihenfolge sichert der Spread in
    // `Liste.tsx:171-175` zu — eine Zusicherung, die es dort selbst nicht gibt.
    expect(stil.indexOf('padding:')).toBeGreaterThan(stil.indexOf('padding-block'));
  });
});

/**
 * Trefflächenboden der Gebietszeile — die Werte (Abschluss-Review zu LFH-368 · B5h).
 *
 * Schablone: `pages/lagekarte/Sidebar.test.tsx:602-637`. Geprüft wird die REINE FUNKTION gegen
 * die Dichtestufen aus `theme/tokens.ts`, nicht ein gerendertes Pixel — jsdom rechnet kein
 * Layout, und ein gerenderter Wert käme aus dem nackten `ConfigProvider` von `test/utils.tsx`.
 *
 * Die Böden stehen als LITERALE da. Aus dem Token zurückgelesen prüften sie den Token gegen sich
 * selbst und blieben grün, egal welche Zahl dort steht.
 */
describe('GefahrenPage: Bedienziel-Boden der Gebietsliste', () => {
  const tokenFuer = (stufe: keyof typeof dichten) => ({
    controlHeight: dichten[stufe].zeilenhoehe,
    paddingSM: dichten[stufe].abstand.sm,
    padding: dichten[stufe].abstand.md,
  });

  it('trägt den Boden aus controlHeight — 30 / 48 / 72 px', () => {
    expect(gebietszeileStil(tokenFuer('kompakt')).minHeight).toBe(30);
    expect(gebietszeileStil(tokenFuer('komfortabel')).minHeight).toBe(48);
    expect(gebietszeileStil(tokenFuer('handschuh')).minHeight).toBe(72);
  });

  /**
   * Die eigentliche Aussage: der Wert ZIEHT MIT. Ein dichteblindes `minHeight: 72` bestünde alle
   * drei Böden oben und fällt allein hier — deshalb stehen beide Fälle da, einer allein belegte
   * nichts.
   */
  it('wächst über die Dichtestufen, statt auf einer Stufe zu kleben', () => {
    const hoehen = (['kompakt', 'komfortabel', 'handschuh'] as const).map(
      (s) => gebietszeileStil(tokenFuer(s)).minHeight,
    );
    expect(hoehen[0]).toBeLessThan(hoehen[1]);
    expect(hoehen[1]).toBeLessThan(hoehen[2]);
  });

  /**
   * ZWEI Angaben, nicht eine: die Polsterung allein trüge den Boden nicht (grob 54 px im
   * Handschuh-Betrieb gegen die geforderten 72), muss aber da sein und ebenfalls mitziehen —
   * sonst klebt der Text an der Kante. Auch hier LITERALE.
   */
  it('trägt neben der Höhe eine mitziehende Polsterung', () => {
    expect(gebietszeileStil(tokenFuer('kompakt')).padding).toBe('7px 11px');
    expect(gebietszeileStil(tokenFuer('handschuh')).padding).toBe('16px 26px');
  });
});
