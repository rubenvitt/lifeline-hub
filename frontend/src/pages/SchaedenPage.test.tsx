import { http, HttpResponse } from 'msw';
import { act, fireEvent, isInaccessible, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes, useNavigate } from 'react-router';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import { einsatzKeys } from '../api/queryKeys';
import SchaedenPage from './SchaedenPage';

class FakeEventSource {
  url: string; closed = false;
  constructor(url: string) { this.url = url; }
  addEventListener() {} removeEventListener() {} close() { this.closed = true; }
}
beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEventSource);
  sessionStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

// Normaler Benutzer (kein System-Admin): so prüft der Beobachter-Test die EINSATZ-Rolle,
// nicht den admin-globalen Zweig (LFH-234). Admin-global ist in schreibrecht.test.ts abgedeckt.
const nutzer = { id: 1, anzeigename: 'Nutzer', system_rolle: 'keiner', org_rolle: 'fuehrungskraft' };
const einsatzAktiv = {
  id: 1, bezeichnung: 'Lage', status: 'aktiv', meine_rolle: 'einsatzleitung',
  org_id: 5, org_name: 'DRK Musterstadt',
};
const einsatzBeobachter = {
  id: 1, bezeichnung: 'Lage', status: 'aktiv', meine_rolle: 'beobachter',
  org_id: 5, org_name: 'DRK Musterstadt',
};

const einePerson = {
  id: 42, einsatz_id: 1, registrier_nr: 7, status: 'betroffen', name: 'Meier', vorname: 'Anna',
};
const eineEinsatzkraft = { id: 99, einsatz_id: 1, name: 'Schulz', funktion: 'Sanitäter' };

function basisSchaden(overrides: Record<string, unknown> = {}) {
  return {
    id: 10, einsatz_id: 1, registrier_nr: 1, status: 'offen', typ: 'sachschaden',
    ausmass: 'gering', ort: 'Hauptstr. 17', beschreibung: '',
    lat: null, lon: null,
    geschaedigt_person_id: null, geschaedigt_personal_id: null, geschaedigt_organisation_id: null,
    geschaedigt_kontakt: null,
    uebergeben_an: null, uebergeben_at: null, abschluss_grund: null, abschluss_at: null,
    erfasst_at: '2026-05-29 10:00:00', erfasst_von: 1, geaendert_at: '2026-05-29 10:00:00', geaendert_von: 1,
    storniert_at: null, storniert_von: null,
    geschaedigt_registrier_nr: null, geschaedigt_storniert_at: null,
    geschaedigt_personal_name: null, geschaedigt_organisation_name: null,
    ...overrides,
  };
}

function render(einsatzObj: object, schaeden: object[], personen: object[] = [], personal: object[] = []) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(nutzer)),
    http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzObj)),
    http.get('/api/einsaetze/1/schaeden', () => HttpResponse.json(schaeden)),
    // Quellen der Geschädigt-Combobox (mounten beim Öffnen der Formulare):
    http.get('/api/einsaetze/1/personen', () => HttpResponse.json(personen)),
    http.get('/api/einsaetze/1/personal', () => HttpResponse.json(personal)),
  );
  return renderMitProviders(
    <AuthProvider>
      <Routes>
        <Route path="/einsaetze/:id/schaeden" element={<SchaedenPage />} />
        <Route path="/einsaetze/:id/schaeden/:schadenId" element={<div>SCHADEN-DETAIL</div>} />
        <Route path="/einsaetze/:id/personen" element={<div>Personen-Modul</div>} />
      </Routes>
    </AuthProvider>,
    { route: '/einsaetze/1/schaeden' },
  );
}

function SchadenEinsatzWechsel() {
  const navigate = useNavigate();
  return <button onClick={() => navigate('/einsaetze/2/schaeden')}>Zu Einsatz B</button>;
}

/** Rendert SchaedenPage mit konfigurierbarer Route (z.B. mit Query-Params). */
function renderSchaedenPage(route: string) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(nutzer)),
    http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzAktiv)),
    http.get('/api/einsaetze/1/schaeden', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/personen', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/personal', () => HttpResponse.json([])),
  );
  return renderMitProviders(
    <AuthProvider>
      <Routes>
        <Route path="/einsaetze/:id/schaeden" element={<SchaedenPage />} />
      </Routes>
    </AuthProvider>,
    { route },
  );
}

/** Rendert SchaedenPage mit wählbarem Einsatz-Objekt und Route. */
function renderSchaedenPageMitEinsatz(einsatzObj: object, route: string) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(nutzer)),
    http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzObj)),
    http.get('/api/einsaetze/1/schaeden', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/personen', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/personal', () => HttpResponse.json([])),
  );
  return renderMitProviders(
    <AuthProvider>
      <Routes>
        <Route path="/einsaetze/:id/schaeden" element={<SchaedenPage />} />
      </Routes>
    </AuthProvider>,
    { route },
  );
}

/** antd-Dropdown-Option im Portal anhand des Anzeige-Labels treffen (Tabellenzellen
 *  tragen denselben Text → über `.ant-select-item-option` abgrenzen). */
async function waehleOption(label: string) {
  const option = (await screen.findAllByText(label)).find((el) => el.closest('.ant-select-item-option'));
  expect(option).toBeTruthy();
  await userEvent.click(option!);
}

/** Modal-Dialog isolieren (auf der List-only-Seite gibt es nur die Schnellerfassung). */
async function modalDialog() {
  return (await screen.findAllByRole('dialog'))[0];
}

/**
 * Wartet, bis die Dialogfelder aus dem Baum verschwunden sind — die Sonde für „geschlossen"
 * (die Hülle rendert mit `destroyOnHidden`).
 *
 * Der Anstoß in der Schleife ist nötig, nicht dekorativ: antd fährt den Dialog mit einer
 * Schließbewegung aus, und jsdom feuert dafür von sich aus kein Ende-Ereignis. Ohne das
 * Ereignis bleibt das Modal für immer in `ant-zoom-leave-active` stehen (gemessen), die Felder
 * werden nie abgeräumt — ein `not.toBeInTheDocument` liefe in den Timeout, obwohl die Anwendung
 * korrekt schließt. Gemessen beendet `transitionend` die Bewegung, `animationend` NICHT (trotz
 * des `ant-zoom`-Klassennamens); beide zu feuern kostet nichts und überlebt einen Wechsel.
 * Geprüft wird am Ende nur Verhalten — die Felder sind weg —, kein Klassenname.
 */
async function warteBisDialogWeg() {
  await vi.waitFor(() => {
    const modal = document.querySelector<HTMLElement>('.ant-modal');
    if (modal) {
      fireEvent.transitionEnd(modal);
      fireEvent.animationEnd(modal);
    }
    // ÜBER DIE ROLLE, nicht über `queryByLabelText('Ort')` (LFH-340 · C5): seit die Liste
    // über `Datensicht` läuft, trägt auch die Spalte „Ort" diesen zugänglichen Namen — der
    // Kopfzellen-Knoten stünde dann für immer im Dokument und die Warteschleife liefe in
    // den Timeout, obwohl der Dialog längst zu ist. Ein `<th>` ist keine `textbox`.
    expect(screen.queryByRole('textbox', { name: 'Ort' })).not.toBeInTheDocument();
  });
}

/** Die drei Pflichtfelder der Schnellerfassung füllen (Typ, Ausmaß, Ort). */
async function fuelleSchaden(dialog: HTMLElement, typ: string, ausmass: string, ort: string) {
  await userEvent.click(within(dialog).getAllByRole('combobox')[0]); // Typ
  await waehleOption(typ);
  await userEvent.click(within(dialog).getAllByRole('combobox')[1]); // Ausmaß
  await waehleOption(ausmass);
  await userEvent.type(within(dialog).getByLabelText('Ort'), ort);
}

async function oeffneWeitereAngaben(dialog: HTMLElement) {
  const schalter = within(dialog).getByRole('button', { name: /Weitere Angaben/ });
  if (schalter.getAttribute('aria-expanded') === 'false') await userEvent.click(schalter);
  // Wie im Material-Feldbudget: jsdom beendet die opacity-Animation nicht selbst.
  // Die Rolle prüft, dass der Inhalt nicht mehr aus dem Zugänglichkeitsbaum verborgen ist.
  await within(dialog).findByRole('textbox', { name: 'Koordinate' });
}

describe('SchaedenPage', () => {
  /**
   * LFH-340 · C5. Die Schadensseite war die einzige der drei Betroffenen-Listen, die den
   * Seitenrahmen von Hand baute (eigenes `padding: 16` auf die 24 px des Layouts,
   * `Title level={4}` ohne Breadcrumb, ohne Einsatz-Status, ohne Schreibrecht-Hinweis).
   * Geprüft wird deshalb nicht „ein Kopf ist da", sondern dass er aus `EinsatzSeite` kommt:
   * Breadcrumb UND Status-Tag UND die Abwesenheit eines zweiten Überschriftenknotens.
   */
  it('trägt den gemeinsamen Modulkopf: Breadcrumb, Einsatz-Status, eine Überschrift', async () => {
    render(einsatzAktiv, [basisSchaden()]);
    expect(await screen.findByRole('link', { name: 'Einsätze' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 4, name: /Schäden/ })).toBeInTheDocument();
    expect(screen.getAllByRole('heading')).toHaveLength(1);
    expect(screen.getByText('aktiv')).toBeInTheDocument();
  });

  it('weist Beobachter im Kopf auf die fehlende Schreibberechtigung hin', async () => {
    render({ ...einsatzBeobachter, status: 'abgeschlossen' }, [basisSchaden()]);
    expect(await screen.findByText(/nur Ansicht/)).toBeInTheDocument();
  });

  /**
   * Die Liste läuft über `Datensicht` statt über eine handgebaute `KatalogTabelle`. Beleg
   * sind die drei Dinge, die das Primitiv mitbringt und der Handbau nicht hatte: die
   * „seit"-Spalte, das Suchfeld und der Spaltenschalter.
   */
  it('rendert die Liste über das Datensicht-Primitiv mit „seit"-Spalte und Suche', async () => {
    render(einsatzAktiv, [basisSchaden()]);
    expect(await screen.findByRole('columnheader', { name: /seit/ })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('S-Nr., Ort, Beschreibung')).toBeInTheDocument();
    const werkzeuge = document.querySelector('[data-lfh="datensicht-werkzeuge"]') as HTMLElement;
    expect(within(werkzeuge).getByRole('button', { name: /^Spalten/ })).toBeInTheDocument();
  });

  it('sucht über Registriernummer, Ort und Beschreibung', async () => {
    render(einsatzAktiv, [
      basisSchaden({ id: 10, registrier_nr: 1, ort: 'Hauptstr. 17', beschreibung: 'Dachziegel' }),
      basisSchaden({ id: 11, registrier_nr: 2, ort: 'Bahnweg 3', beschreibung: 'Ölspur' }),
    ]);
    await screen.findByText('S-001');
    await userEvent.type(screen.getByPlaceholderText('S-Nr., Ort, Beschreibung'), 'Ölspur');
    expect(await screen.findByText('S-002')).toBeInTheDocument();
    // Die Gegenhälfte: ohne sie wäre der Fall auch grün, wenn die Suche gar nichts filterte.
    expect(screen.queryByText('S-001')).not.toBeInTheDocument();
  });

  /**
   * Verortungsstand (LFH-340 · C5, Befund M39). Beide Hälften sind Pflicht: eine Aussage
   * allein wäre auch grün, wenn die Spalte in jeder Zeile dasselbe zeigte.
   */
  it('zeigt in der Liste, ob ein Schaden verortet ist', async () => {
    render(einsatzAktiv, [
      basisSchaden({ id: 10, registrier_nr: 1, lat: 52.1, lon: 8.5 }),
      basisSchaden({ id: 11, registrier_nr: 2 }),
    ]);
    await screen.findByText('S-001');
    expect(screen.getByRole('columnheader', { name: /Verortet/ })).toBeInTheDocument();
    expect(screen.getByLabelText('verortet')).toBeInTheDocument();
    expect(screen.getByLabelText('nicht verortet')).toBeInTheDocument();
  });

  it.each([true, false])('Erfassung mit Koordinate=%s aktualisiert den Verortungsstand der Liste', async (mitKoordinate) => {
    const schaeden: object[] = [];
    let gesendet: Record<string, unknown> = {};
    server.use(http.post('/api/einsaetze/1/schaeden', async ({ request }) => {
      gesendet = await request.json() as Record<string, unknown>;
      // Nur das tatsächlich versandte Paar kommt beim nächsten Listen-GET zurück.
      // Eine feste verortete Response würde einen vergessenen Request-Wert verdecken.
      const angelegt = basisSchaden({
        typ: gesendet.typ, ausmass: gesendet.ausmass, ort: gesendet.ort,
        lat: gesendet.lat ?? null, lon: gesendet.lon ?? null,
      });
      schaeden.push(angelegt);
      return HttpResponse.json(angelegt, { status: 201 });
    }));
    render(einsatzAktiv, schaeden);
    await userEvent.click(await screen.findByRole('button', { name: 'Schnellerfassung' }));
    const dialog = await modalDialog();
    await fuelleSchaden(dialog, 'Sachschaden', 'gering', 'Hauptstr. 17');
    if (mitKoordinate) {
      await oeffneWeitereAngaben(dialog);
      await userEvent.type(within(dialog).getByPlaceholderText('Koordinate eingeben'), '52.1, 8.5');
    }
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
    await warteBisDialogWeg();

    const zeile = await screen.findByRole('row', { name: /S-001/ });
    expect(within(zeile).getByLabelText(mitKoordinate ? 'verortet' : 'nicht verortet')).toBeInTheDocument();
    expect(within(zeile).queryByLabelText(mitKoordinate ? 'nicht verortet' : 'verortet')).not.toBeInTheDocument();
    if (mitKoordinate) {
      expect(gesendet).toMatchObject({ lat: 52.1, lon: 8.5 });
    } else {
      expect(gesendet.lat ?? null).toBeNull();
      expect(gesendet.lon ?? null).toBeNull();
    }
    expect(gesendet).not.toHaveProperty('koordinaten');
  });

  it('Feldbudget: zeigt vier Kernfelder und zählt die optionalen Angaben nur aufgeklappt', async () => {
    render(einsatzAktiv, []);
    await userEvent.click(await screen.findByRole('button', { name: 'Schnellerfassung' }));
    const dialog = await modalDialog();
    const sichtbareFelder = () => [...dialog.querySelectorAll<HTMLElement>('.ant-form-item')]
      .filter((feld) => !isInaccessible(feld));
    expect(sichtbareFelder()).toHaveLength(4);
    expect(within(dialog).queryByPlaceholderText('Koordinate eingeben')).not.toBeInTheDocument();

    const weitereAngaben = within(dialog).getByRole('button', { name: /Weitere Angaben/ });
    expect(weitereAngaben).toHaveAttribute('aria-expanded', 'false');
    await oeffneWeitereAngaben(dialog);
    expect(within(dialog).getByRole('textbox', { name: 'Koordinate' })).toBeInTheDocument();
    expect(sichtbareFelder()).toHaveLength(6);
    await userEvent.type(within(dialog).getByPlaceholderText('Koordinate eingeben'), '52.1, 8.5');

    const panel = within(dialog).getByRole('textbox', { name: 'Koordinate' })
      .closest('.ant-collapse-panel')!;
    await userEvent.click(weitereAngaben);
    await vi.waitFor(() => {
      // Wie beim Dialog-Ende: jsdom liefert keinen CSS-Übergang. Collapse akzeptiert
      // nur das Ende der Höhenanimation; danach muss der Inhalt tatsächlich verborgen sein.
      const ende = new window.Event('transitionend', { bubbles: true });
      Object.defineProperty(ende, 'propertyName', { value: 'height' });
      fireEvent(panel, ende);
      expect(sichtbareFelder()).toHaveLength(4);
    });
    await oeffneWeitereAngaben(dialog);
    expect(within(dialog).getByPlaceholderText('Koordinate eingeben')).toHaveValue('52.10000, 8.50000');
  });

  it('zeigt offene Schäden mit S-Nummer, Typ und Ausmaß', async () => {
    render(einsatzAktiv, [
      basisSchaden(),
      basisSchaden({ id: 11, registrier_nr: 2, status: 'abgeschlossen', abschluss_grund: 'behoben' }),
    ]);
    expect(await screen.findByText('S-001')).toBeInTheDocument();
    expect(screen.getByText('Hauptstr. 17')).toBeInTheDocument();
    // abgeschlossen ist in der Default-Sicht „Offen" nicht sichtbar:
    expect(screen.queryByText('S-002')).not.toBeInTheDocument();
  });

  it('filtert per Tab auf Abgeschlossen', async () => {
    render(einsatzAktiv, [
      basisSchaden(),
      basisSchaden({ id: 11, registrier_nr: 2, status: 'abgeschlossen', abschluss_grund: 'behoben' }),
    ]);
    await screen.findByText('S-001');
    await userEvent.click(screen.getByRole('tab', { name: 'Abgeschlossen' }));
    expect(await screen.findByText('S-002')).toBeInTheDocument();
  });

  it('versteckt Schreib-Buttons für Beobachter', async () => {
    render(einsatzBeobachter, [basisSchaden()]);
    await screen.findByText('S-001');
    expect(screen.queryByRole('button', { name: 'Schnellerfassung' })).not.toBeInTheDocument();
  });

  it('Zeilen-Klick navigiert auf die Schaden-Detailseite', async () => {
    render(einsatzAktiv, [basisSchaden({ id: 10, registrier_nr: 1 })]);
    await userEvent.click((await screen.findAllByText('Hauptstr. 17'))[0]);
    expect(await screen.findByText('SCHADEN-DETAIL')).toBeInTheDocument();
  });

  it('Schnellerfassung schickt Pflichtfelder', async () => {
    let body: Record<string, unknown> = {};
    server.use(
      http.post('/api/einsaetze/1/schaeden', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(basisSchaden(), { status: 201 });
      }),
    );
    render(einsatzAktiv, []);
    await userEvent.click(await screen.findByRole('button', { name: 'Schnellerfassung' }));
    const dialog = await modalDialog();
    // Typ + Ausmaß sind Pflicht ohne Default → beide antd-Selects bedienen, dann Ort tippen.
    await userEvent.click(within(dialog).getAllByRole('combobox')[0]); // Typ
    await waehleOption('Umweltschaden');
    await userEvent.click(within(dialog).getAllByRole('combobox')[1]); // Ausmaß
    await waehleOption('groß');
    await userEvent.type(within(dialog).getByLabelText('Ort'), 'Hauptstr. 17');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
    await vi.waitFor(() => expect(body.typ).toBe('umweltschaden'));
    expect(body.ausmass).toBe('gross');
    expect(body.ort).toBe('Hauptstr. 17');
  });

  /**
   * SERIENMODUS (LFH-332 · B4) — Partnerpaar mit dem Fall darunter.
   *
   * „Der Dialog bleibt offen" allein belegte nichts: der Fall wäre genauso grün, wenn sich der
   * Dialog ÜBERHAUPT NIE schlösse. Erst der zweite Fall mit derselben Sonde macht daraus eine
   * Aussage über die Verzweigung Serien-Speichern ↔ Einzel-Erfassen.
   *
   * Sonde ist das Ortsfeld, nicht die Dialog-Rolle: die Hülle rendert mit `destroyOnHidden`,
   * die Felder sind also genau so lange im Baum, wie der Dialog offen ist — während der
   * Modal-Rahmen selbst über seine Schließ-Animation hinweg stehen bleibt.
   */
  it('„Speichern und nächste" lässt den Dialog offen und behält den Ort', async () => {
    const koerper: Record<string, unknown>[] = [];
    server.use(
      http.post('/api/einsaetze/1/schaeden', async ({ request }) => {
        koerper.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json(basisSchaden(), { status: 201 });
      }),
    );
    render(einsatzAktiv, []);
    await userEvent.click(await screen.findByRole('button', { name: 'Schnellerfassung' }));
    const dialog = await modalDialog();
    // Der Schalter steht per Vorgabe AUS (30.07.2026) — ohne ihn gäbe es keine Übernahme.
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Werte behalten' }));
    await fuelleSchaden(dialog, 'Umweltschaden', 'groß', 'Hauptstr. 17');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern und nächste' }));

    await vi.waitFor(() => expect(koerper).toHaveLength(1));
    await vi.waitFor(() => expect(
      sessionStorage.getItem('lfh:erfassung:1:schaden:ort'),
    ).toBe('Hauptstr. 17'));
    // Der Datensatz ist angekommen (Zähler der Hülle) …
    expect(await screen.findByText('Erfasst: 1')).toBeInTheDocument();
    // … der Dialog steht weiter offen, und der Ort hat das Speichern überlebt (Wertübernahme).
    // Über die Rolle: „Ort" ist seit dem Umbau auf `Datensicht` auch ein Spaltenkopf,
    // `getByLabelText` fände zwei Knoten (dieselbe Kollision wie in `warteBisDialogWeg`).
    expect(screen.getByRole('textbox', { name: 'Ort' })).toHaveValue('Hauptstr. 17');
  });

  /**
   * „Geschädigt" liegt außerhalb des Form-Stores im lokalen State — die Hülle leert beim
   * Serien-Speichern das Formular, diesen Wert kann sie nicht kennen. Läge der Reset nur an
   * `onFertig` (das beim Serien-Speichern NIE läuft), wanderte die Zuordnung des ersten
   * Schadens still auf den zweiten: ein falscher Datensatz, keine Kosmetik.
   *
   * Geprüft werden BEIDE Absendungen. Nur `koerper[1] === null` wäre auch grün, wenn die
   * Zuordnung nie angekommen wäre — erst die 42 in `koerper[0]` macht daraus „geleert".
   */
  it('Serien-Speichern trägt Geschädigten und Koordinate NICHT in den nächsten Schaden', async () => {
    const koerper: Record<string, unknown>[] = [];
    server.use(
      http.post('/api/einsaetze/1/schaeden', async ({ request }) => {
        koerper.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json(basisSchaden(), { status: 201 });
      }),
    );
    render(einsatzAktiv, [], [einePerson], [eineEinsatzkraft]);
    await userEvent.click(await screen.findByRole('button', { name: 'Schnellerfassung' }));
    const dialog = await modalDialog();
    // „Werte behalten" AN: der Test prüft am Ende, dass der Ort mitwandert (Übernahme)
    // und der Geschädigte NICHT (lokaler State, den die Hülle nicht kennt). Ohne den
    // Schalter fiele die erste Hälfte weg und die zweite bewiese nichts mehr.
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Werte behalten' }));
    await fuelleSchaden(dialog, 'Sachschaden', 'gering', 'Hauptstr. 17');
    await oeffneWeitereAngaben(dialog);
    await userEvent.click(within(dialog).getAllByRole('combobox')[2]); // Geschädigt
    await waehleOption('R-007 · Anna Meier');
    await userEvent.type(within(dialog).getByPlaceholderText('Koordinate eingeben'), '52.1, 8.5');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern und nächste' }));
    await vi.waitFor(() => expect(koerper).toHaveLength(1));

    // Zweiter Schaden: Typ und Ausmaß neu wählen, Ort ist übernommen, Geschädigt unberührt.
    await userEvent.click(within(dialog).getAllByRole('combobox')[0]);
    await waehleOption('Umweltschaden');
    await userEvent.click(within(dialog).getAllByRole('combobox')[1]);
    await waehleOption('groß');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anlegen' }));

    await vi.waitFor(() => expect(koerper).toHaveLength(2));
    expect(koerper[0].geschaedigt_person_id).toBe(42);
    expect(koerper[0]).toMatchObject({ lat: 52.1, lon: 8.5 });
    expect(koerper[1].geschaedigt_person_id).toBeNull();
    expect(koerper[1].lat).toBeNull();
    expect(koerper[1].lon).toBeNull();
    expect(koerper[1].ort).toBe('Hauptstr. 17');
  });

  it('„Anlegen" schließt den Dialog', async () => {
    const koerper: Record<string, unknown>[] = [];
    server.use(
      http.post('/api/einsaetze/1/schaeden', async ({ request }) => {
        koerper.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json(basisSchaden(), { status: 201 });
      }),
    );
    render(einsatzAktiv, []);
    await userEvent.click(await screen.findByRole('button', { name: 'Schnellerfassung' }));
    const dialog = await modalDialog();
    await fuelleSchaden(dialog, 'Umweltschaden', 'groß', 'Hauptstr. 17');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anlegen' }));

    await vi.waitFor(() => expect(koerper).toHaveLength(1));
    await warteBisDialogWeg();
  });

  it('merkt den Ort nach Erfolg fürs Wiederöffnen, ohne die eigene Organisation vorzuwählen', async () => {
    let versuche = 0;
    server.use(http.post('/api/einsaetze/1/schaeden', () => {
      versuche += 1;
      return HttpResponse.json(basisSchaden(), { status: 201 });
    }));
    render(einsatzAktiv, []);
    await userEvent.click(await screen.findByRole('button', { name: 'Schnellerfassung' }));
    const ersterDialog = await modalDialog();
    await oeffneWeitereAngaben(ersterDialog);
    expect(within(ersterDialog).getAllByRole('combobox')[2]).toHaveValue('');
    await fuelleSchaden(ersterDialog, 'Sachschaden', 'gering', 'Hauptstr. 17');
    await userEvent.type(within(ersterDialog).getByPlaceholderText('Koordinate eingeben'), '52.1, 8.5');
    await userEvent.click(within(ersterDialog).getByRole('button', { name: 'Anlegen' }));
    await vi.waitFor(() => expect(versuche).toBe(1));
    await warteBisDialogWeg();

    await userEvent.click(screen.getByRole('button', { name: 'Schnellerfassung' }));
    const zweiterDialog = await modalDialog();
    await oeffneWeitereAngaben(zweiterDialog);
    await vi.waitFor(() => expect(within(zweiterDialog).getByLabelText('Ort')).toHaveValue('Hauptstr. 17'));
    expect(within(zweiterDialog).getByRole('checkbox', { name: 'Werte behalten' })).not.toBeChecked();
    expect(within(zweiterDialog).getAllByRole('combobox')[2]).toHaveValue('');
    expect(within(zweiterDialog).getByPlaceholderText('Koordinate eingeben')).toHaveValue('');
  });

  it('merkt den Ort bei einem fehlgeschlagenen Schaden nicht und lässt den Wortlaut stehen', async () => {
    let versuche = 0;
    server.use(http.post('/api/einsaetze/1/schaeden', () => {
      versuche += 1;
      return HttpResponse.json({ error: 'Schaden abgelehnt' }, { status: 500 });
    }));
    render(einsatzAktiv, []);
    await userEvent.click(await screen.findByRole('button', { name: 'Schnellerfassung' }));
    const dialog = await modalDialog();
    await fuelleSchaden(dialog, 'Sachschaden', 'gering', 'Fehlerort Schaden');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anlegen' }));

    await vi.waitFor(() => expect(versuche).toBe(1));
    expect(within(dialog).getByLabelText('Ort')).toHaveValue('Fehlerort Schaden');
    expect(sessionStorage.getItem('lfh:erfassung:1:schaden:ort')).toBeNull();
  });

  it('merkt den Ort nach Schließen während des POST nicht', async () => {
    let postGestartet!: () => void;
    let antwortFreigeben!: () => void;
    let postBeantwortet = false;
    const postStart = new Promise<void>((resolve) => { postGestartet = resolve; });
    const antwortGate = new Promise<void>((resolve) => { antwortFreigeben = resolve; });
    render(einsatzAktiv, []);
    server.use(
      http.get('/api/einsaetze/1/schaeden', () => HttpResponse.json(
        postBeantwortet ? [basisSchaden({ id: 99, ort: 'Abbruchort Schaden' })] : [],
      )),
      http.post('/api/einsaetze/1/schaeden', async () => {
        postGestartet();
        await antwortGate;
        postBeantwortet = true;
        return HttpResponse.json(basisSchaden({ id: 99, ort: 'Abbruchort Schaden' }), { status: 201 });
      }),
    );

    await userEvent.click(await screen.findByRole('button', { name: 'Schnellerfassung' }));
    const dialog = await modalDialog();
    await fuelleSchaden(dialog, 'Sachschaden', 'gering', 'Abbruchort Schaden');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
    await postStart;
    await userEvent.click(screen.getByRole('button', { name: /Close|Schliessen|Schließen/i }));
    await warteBisDialogWeg();
    await act(async () => { antwortFreigeben(); });
    await screen.findByText('Abbruchort Schaden');

    expect(sessionStorage.getItem('lfh:erfassung:1:schaden:ort')).toBeNull();
  });

  it('setzt beim Einsatzwechsel alle Schadenwerte zurück und lädt nur den B-Sitzungsort', async () => {
    sessionStorage.setItem('lfh:erfassung:1:schaden:ort', 'Schadenort A');
    sessionStorage.setItem('lfh:erfassung:2:schaden:ort', 'Schadenort B');
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(nutzer)),
      http.get('/api/einsaetze/:einsatzId', ({ params }) => {
        const id = Number(params.einsatzId);
        return HttpResponse.json({ ...einsatzAktiv, id, bezeichnung: `Lage ${id}` });
      }),
      http.get('/api/einsaetze/:einsatzId/schaeden', () => HttpResponse.json([])),
      http.get('/api/einsaetze/:einsatzId/personen', ({ params }) =>
        HttpResponse.json(params.einsatzId === '1' ? [einePerson] : [])),
      http.get('/api/einsaetze/:einsatzId/personal', () => HttpResponse.json([])),
    );
    renderMitProviders(
      <AuthProvider>
        <Routes>
          <Route
            path="/einsaetze/:id/schaeden"
            element={<><SchadenEinsatzWechsel /><SchaedenPage /></>}
          />
        </Routes>
      </AuthProvider>,
      { route: '/einsaetze/1/schaeden' },
    );

    await userEvent.click(await screen.findByRole('button', { name: 'Schnellerfassung' }));
    const dialogA = await modalDialog();
    await vi.waitFor(() => expect(within(dialogA).getByLabelText('Ort')).toHaveValue('Schadenort A'));
    await userEvent.click(within(dialogA).getAllByRole('combobox')[0]);
    await waehleOption('Sachschaden');
    await userEvent.click(within(dialogA).getAllByRole('combobox')[1]);
    await waehleOption('gering');
    await userEvent.type(within(dialogA).getByLabelText('Beschreibung'), 'Nur Einsatz A');
    await oeffneWeitereAngaben(dialogA);
    await userEvent.click(within(dialogA).getAllByRole('combobox')[2]);
    await waehleOption('R-007 · Anna Meier');
    await userEvent.type(within(dialogA).getByPlaceholderText('Koordinate eingeben'), '52.1, 8.5');
    await userEvent.click(screen.getByRole('button', { name: 'Zu Einsatz B' }));

    const dialogB = await modalDialog();
    await vi.waitFor(() => expect(within(dialogB).getByLabelText('Ort')).toHaveValue('Schadenort B'));
    expect(within(dialogB).getAllByRole('combobox')[0]).toHaveValue('');
    expect(within(dialogB).getAllByRole('combobox')[1]).toHaveValue('');
    expect(within(dialogB).getByLabelText('Beschreibung')).toHaveValue('');
    await oeffneWeitereAngaben(dialogB);
    expect(within(dialogB).getAllByRole('combobox')[2]).toHaveValue('');
    expect(within(dialogB).getByPlaceholderText('Koordinate eingeben')).toHaveValue('');
  });

  it('Schnellerfassung: Betroffene Person aus Combobox → geschaedigt_person_id', async () => {
    let body: Record<string, unknown> = {};
    server.use(
      http.post('/api/einsaetze/1/schaeden', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(basisSchaden(), { status: 201 });
      }),
    );
    render(einsatzAktiv, [], [einePerson], [eineEinsatzkraft]);
    await userEvent.click(await screen.findByRole('button', { name: 'Schnellerfassung' }));
    const dialog = await modalDialog();
    await userEvent.click(within(dialog).getAllByRole('combobox')[0]); // Typ
    await waehleOption('Sachschaden');
    await userEvent.click(within(dialog).getAllByRole('combobox')[1]); // Ausmaß
    await waehleOption('gering');
    await userEvent.type(within(dialog).getByLabelText('Ort'), 'Hauptstr. 17');
    // Geschädigt-Combobox (3.) öffnen und die betroffene Person wählen.
    await oeffneWeitereAngaben(dialog);
    await userEvent.click(within(dialog).getAllByRole('combobox')[2]);
    await waehleOption('R-007 · Anna Meier');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
    await vi.waitFor(() => expect(body.geschaedigt_person_id).toBe(42));
    expect(body.geschaedigt_personal_id).toBeNull();
    expect(body.geschaedigt_organisation_id).toBeNull();
    expect(body.geschaedigt_kontakt).toBeNull();
  });

  it('Schnellerfassung: Einsatzkraft aus Combobox → geschaedigt_personal_id', async () => {
    let body: Record<string, unknown> = {};
    server.use(
      http.post('/api/einsaetze/1/schaeden', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(basisSchaden(), { status: 201 });
      }),
    );
    render(einsatzAktiv, [], [einePerson], [eineEinsatzkraft]);
    await userEvent.click(await screen.findByRole('button', { name: 'Schnellerfassung' }));
    const dialog = await modalDialog();
    await userEvent.click(within(dialog).getAllByRole('combobox')[0]);
    await waehleOption('Sachschaden');
    await userEvent.click(within(dialog).getAllByRole('combobox')[1]);
    await waehleOption('gering');
    await userEvent.type(within(dialog).getByLabelText('Ort'), 'Hauptstr. 17');
    await oeffneWeitereAngaben(dialog);
    await userEvent.click(within(dialog).getAllByRole('combobox')[2]);
    await waehleOption('Schulz · Sanitäter');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
    await vi.waitFor(() => expect(body.geschaedigt_personal_id).toBe(99));
    expect(body.geschaedigt_person_id).toBeNull();
    expect(body.geschaedigt_organisation_id).toBeNull();
    expect(body.geschaedigt_kontakt).toBeNull();
  });

  it('Schnellerfassung: Freitext → externer Kontakt (geschaedigt_kontakt)', async () => {
    let body: Record<string, unknown> = {};
    server.use(
      http.post('/api/einsaetze/1/schaeden', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(basisSchaden(), { status: 201 });
      }),
    );
    render(einsatzAktiv, [], [einePerson], [eineEinsatzkraft]);
    await userEvent.click(await screen.findByRole('button', { name: 'Schnellerfassung' }));
    const dialog = await modalDialog();
    await userEvent.click(within(dialog).getAllByRole('combobox')[0]);
    await waehleOption('Sachschaden');
    await userEvent.click(within(dialog).getAllByRole('combobox')[1]);
    await waehleOption('gering');
    await userEvent.type(within(dialog).getByLabelText('Ort'), 'Hauptstr. 17');
    // In die Geschädigt-Combobox tippen → synthetische „extern"-Option erscheint.
    await oeffneWeitereAngaben(dialog);
    const geschaedigt = within(dialog).getAllByRole('combobox')[2];
    await userEvent.click(geschaedigt);
    await userEvent.type(geschaedigt, 'Familie Krause');
    const externOption = (await screen.findAllByText(/Als externen Kontakt/)).find((el) =>
      el.closest('.ant-select-item-option'),
    );
    expect(externOption).toBeTruthy();
    await userEvent.click(externOption!);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
    await vi.waitFor(() => expect(body.geschaedigt_kontakt).toBe('Familie Krause'));
    expect(body.geschaedigt_person_id).toBeNull();
    expect(body.geschaedigt_personal_id).toBeNull();
    expect(body.geschaedigt_organisation_id).toBeNull();
  });

  it('öffnet via ?neu=1 die Schadens-Erfassung', async () => {
    renderSchaedenPage('/einsaetze/1/schaeden?neu=1');
    expect(await screen.findByText('Schaden erfassen')).toBeInTheDocument();
  });

  it('öffnet via ?neu=1 die Erfassungsmaske NICHT für Beobachter', async () => {
    renderSchaedenPageMitEinsatz(einsatzBeobachter, '/einsaetze/1/schaeden?neu=1');
    // Tabelle muss laden (Seite ist gerendert)
    await screen.findByText('Keine Schäden in dieser Sicht');
    expect(screen.queryByText('Schaden erfassen')).not.toBeInTheDocument();
  });

  it('verlinkt eine geschädigte Person auf ihre Detailseite (LFH-25)', async () => {
    render(einsatzAktiv, [basisSchaden({ id: 1, geschaedigt_person_id: 50, geschaedigt_registrier_nr: 7 })]);
    const link = await screen.findByRole('link', { name: /R-007/ });
    expect(link).toHaveAttribute('href', '/einsaetze/1/personen/50');
  });

  it('verlinkt jede Schaden-Registriernummer nativ und lässt Modifier-Klicks nicht zur Zeile hochsteigen', async () => {
    render(einsatzAktiv, [
      basisSchaden({ id: 10, registrier_nr: 1 }),
      basisSchaden({ id: 11, registrier_nr: 3 }),
    ]);
    const link = await screen.findByRole('link', { name: 'S-001' });
    const links = screen.getAllByRole('link', { name: /^S-00[13]$/ });
    expect(links).toHaveLength(2);
    expect(screen.getAllByRole('link', { name: 'S-001' })).toHaveLength(1);
    expect(screen.getAllByRole('link', { name: 'S-003' })).toHaveLength(1);
    expect(link).toHaveAttribute('href', '/einsaetze/1/schaeden/10');

    const modifierKlick = new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true });
    fireEvent(link, modifierKlick);

    expect(modifierKlick.defaultPrevented).toBe(false);
    expect(screen.queryByText('SCHADEN-DETAIL')).not.toBeInTheDocument();
  });

  it('verlinkt eine geschädigte Einsatzkraft auf die Personal-Liste (LFH-25)', async () => {
    render(einsatzAktiv, [basisSchaden({ id: 2, geschaedigt_personal_id: 99, geschaedigt_personal_name: 'Schulz' })]);
    const link = await screen.findByRole('link', { name: /Schulz/ });
    expect(link).toHaveAttribute('href', '/einsaetze/1/personal?personal=99');
  });

  it('verlinkt eine stornierte Geschädigt-Person NICHT (bleibt grauer Text)', async () => {
    render(einsatzAktiv, [basisSchaden({
      id: 3, geschaedigt_person_id: 50, geschaedigt_registrier_nr: 7,
      geschaedigt_storniert_at: '2026-05-30 10:00:00',
    })]);
    expect(await screen.findByText(/Geschädigt \(storniert\): R-007/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /R-007/ })).not.toBeInTheDocument();
  });

  /**
   * Partnerpaar zu AK4 (LFH-331 · B3). Die negative Hälfte allein belegte nichts — sie wäre
   * auch grün, wenn der Umbau den Leertext bloß umformuliert hätte. Erst der Fall darunter
   * mit demselben Literal macht sie zu einer Aussage über die Zustandsweiche.
   */
  it('zeigt bei gescheitertem Abruf den Fehler und NICHT den Leertext', async () => {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(nutzer)),
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzAktiv)),
      http.get('/api/einsaetze/1/schaeden', () => new HttpResponse(null, { status: 500 })),
      http.get('/api/einsaetze/1/personen', () => HttpResponse.json([])),
      http.get('/api/einsaetze/1/personal', () => HttpResponse.json([])),
    );
    renderMitProviders(
      <AuthProvider>
        <Routes>
          <Route path="/einsaetze/:id/schaeden" element={<SchaedenPage />} />
        </Routes>
      </AuthProvider>,
      { route: '/einsaetze/1/schaeden' },
    );

    expect(await screen.findByRole('button', { name: 'Erneut abrufen' })).toBeInTheDocument();
    expect(screen.getByText('Schäden konnten nicht geladen werden')).toBeInTheDocument();
    expect(screen.queryByText('Keine Schäden in dieser Sicht')).not.toBeInTheDocument();
  });

  it('zeigt bei leerer Menge den Leertext und KEINEN Fehler', async () => {
    render(einsatzAktiv, []);

    expect(await screen.findByText('Keine Schäden in dieser Sicht')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Erneut abrufen' })).not.toBeInTheDocument();
  });

  /**
   * Veralteter Stand = `isError` MIT Zeilen im Zwischenspeicher (D5) — nicht `isFetching`,
   * nicht `isStale`. Der Ablauf ist der echte: geglückter Abruf, dann gescheiterte
   * Aktualisierung. Ein bloß vorbefüllter Zwischenspeicher ließe offen, ob TanStack nach
   * einem HINTERGRUND-Fehlschlag überhaupt auf `error` stellt statt auf `success` zu bleiben.
   */
  it('meldet den veralteten Stand, wenn die Aktualisierung mit Zeilen im Cache scheitert', async () => {
    const { client } = render(einsatzAktiv, [basisSchaden()]);
    await screen.findByText('S-001');

    server.use(http.get('/api/einsaetze/1/schaeden', () => new HttpResponse(null, { status: 500 })));
    await client.refetchQueries({ queryKey: einsatzKeys.schaeden(1) });

    expect(
      await screen.findByText(/Angezeigter Stand konnte nicht aktualisiert werden/),
    ).toBeInTheDocument();
    // Die Zeile aus dem Zwischenspeicher bleibt stehen — der Fehler verdrängt sie NICHT.
    expect(screen.getByText('S-001')).toBeInTheDocument();
    expect(screen.queryByText('Schäden konnten nicht geladen werden')).not.toBeInTheDocument();
  });
});
