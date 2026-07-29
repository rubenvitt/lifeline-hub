import { http, HttpResponse } from 'msw';
import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router';
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
beforeEach(() => vi.stubGlobal('EventSource', FakeEventSource));
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
    expect(screen.queryByLabelText('Ort')).not.toBeInTheDocument();
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

describe('SchaedenPage', () => {
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
    await fuelleSchaden(dialog, 'Umweltschaden', 'groß', 'Hauptstr. 17');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern und nächste' }));

    await vi.waitFor(() => expect(koerper).toHaveLength(1));
    // Der Datensatz ist angekommen (Zähler der Hülle) …
    expect(await screen.findByText('Erfasst: 1')).toBeInTheDocument();
    // … der Dialog steht weiter offen, und der Ort hat das Speichern überlebt (Wertübernahme).
    expect(screen.getByLabelText('Ort')).toHaveValue('Hauptstr. 17');
  });

  /**
   * „Geschädigt" ist kein `Form.Item`, sondern lokaler State des Modals — die Hülle leert beim
   * Serien-Speichern das Formular, diesen Wert kann sie nicht kennen. Läge der Reset nur an
   * `onFertig` (das beim Serien-Speichern NIE läuft), wanderte die Zuordnung des ersten
   * Schadens still auf den zweiten: ein falscher Datensatz, keine Kosmetik.
   *
   * Geprüft werden BEIDE Absendungen. Nur `koerper[1] === null` wäre auch grün, wenn die
   * Zuordnung nie angekommen wäre — erst die 42 in `koerper[0]` macht daraus „geleert".
   */
  it('Serien-Speichern trägt den Geschädigten NICHT in den nächsten Schaden', async () => {
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
    await fuelleSchaden(dialog, 'Sachschaden', 'gering', 'Hauptstr. 17');
    await userEvent.click(within(dialog).getAllByRole('combobox')[2]); // Geschädigt
    await waehleOption('R-007 · Anna Meier');
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
    expect(koerper[1].geschaedigt_person_id).toBeNull();
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
