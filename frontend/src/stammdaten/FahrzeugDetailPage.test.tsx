import { http, HttpResponse } from 'msw';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Route, Routes, useNavigate } from 'react-router';
import { meHandler, server } from '../test/server';
import { globalKeys } from '../api/queryKeys';
import { renderMitProviders } from '../test/utils';
import FahrzeugDetailPage from './FahrzeugDetailPage';
import FahrzeugeTab from './FahrzeugeTab';
import { fahrzeugDetailPfad } from './stammdatenDetail';
import { adminFixture } from '../test/fixtures';

/**
 * Die Fahrzeug-Detailroute (LFH-346).
 *
 * Zugesichert: der Datensatz aus der LISTEN-Query (kein neuer Endpunkt), der selbst erzeugte
 * Nicht-gefunden-Fall, der gesperrte statt verschwundene Speichern-Knopf ohne Recht — und
 * dass der Listenpfad ohne id die Liste zeigt.
 */

const admin = adminFixture();
const nichtAdmin = adminFixture({ system_rolle: 'keiner' });

const fahrzeug = {
  id: 7,
  funkrufname: 'Florian 1',
  fahrzeugtyp: 'LF 20',
  traegerorganisation: 'FF Musterstadt',
  kennzeichen: 'XX-AB 1',
  opta: 'FL MUS 01',
  standort: 'Wache Mitte',
  fms_issi: '12345',
  sondersignal: true,
  tragenkapazitaet: 2,
  staerke: { fuehrer: 0, unterfuehrer: 1, mannschaft: 8 },
  bemerkung: 'Reserve',
  dienststatus: 'in_dienst',
  angelegt_at: '2026-05-26 10:00:00',
  demo: false,
};

/** Zweiter Datensatz derselben Route — Ziel des Detail→Detail-Wechsels. */
const fahrzeugZwei = {
  ...fahrzeug,
  id: 8,
  funkrufname: 'Florian 2',
  opta: 'FL MUS 08',
  bemerkung: 'Zweiter',
};

function handler(
  benutzer = admin,
  fahrzeuge: unknown[] = [fahrzeug],
  onPatch: (b: unknown) => void = () => {},
) {
  server.use(
    meHandler(benutzer),
    http.get('/api/fahrzeuge', () => HttpResponse.json(fahrzeuge)),
    http.get('/api/fahrzeug-vorschlaege', () =>
      HttpResponse.json({
        fahrzeugtyp: ['LF 20'],
        traegerorganisation: ['FF Musterstadt'],
        standort: ['Wache Mitte'],
      }),
    ),
    http.patch('/api/fahrzeuge/7', async ({ request }) => {
      onPatch(await request.json());
      return HttpResponse.json(fahrzeug);
    }),
  );
}

/**
 * ECHTE Routen-Umgebung statt eines nackten Komponenten-Renders: die Aussage „der Pfad ohne
 * id zeigt weiterhin die Liste" ist eine Aussage über die Routen-Auflösung und wäre an einer
 * direkt gerenderten Komponente gar nicht stellbar.
 */
function renderRoute(pfad: string) {
  return renderMitProviders(
    <Routes>
      <Route path="/admin/stammdaten/fahrzeuge" element={<FahrzeugeTab />} />
      <Route path="/admin/stammdaten/fahrzeuge/:fahrzeugId" element={<FahrzeugDetailPage />} />
    </Routes>,
    { route: pfad },
  );
}

/**
 * Ein Detail→Detail-Sprung. Er steht NEBEN den `Routes`, damit der Klick die Route wechselt,
 * ohne den Baum neu aufzubauen — genau der Fall, für den `key={id}` am `<Form>` steht.
 */
function NaechstesFahrzeug() {
  const navigate = useNavigate();
  return <button onClick={() => navigate(fahrzeugDetailPfad(8))}>Nächstes Fahrzeug</button>;
}

function renderMitWechsel() {
  handler(admin, [fahrzeug, fahrzeugZwei]);
  return renderMitProviders(
    <>
      <NaechstesFahrzeug />
      <Routes>
        <Route path="/admin/stammdaten/fahrzeuge/:fahrzeugId" element={<FahrzeugDetailPage />} />
      </Routes>
    </>,
    { route: fahrzeugDetailPfad(7) },
  );
}

describe('FahrzeugDetailPage (LFH-346 · A7)', () => {
  // LFH-733: die Demo-Marke steht im Kopf, nur an markierten Datensätzen.
  it('zeigt die Demo-Marke im Kopf eines Demo-Datensatzes', async () => {
    handler(admin, [{ ...fahrzeug, demo: true }]);
    renderRoute('/admin/stammdaten/fahrzeuge/7');
    const kopf = await screen.findByRole('heading', { level: 1, name: /Florian 1/ });
    expect(within(kopf).getByText('Demo')).toBeInTheDocument();
  });

  it('zeigt ohne Marke kein „Demo“ im Kopf', async () => {
    handler();
    renderRoute('/admin/stammdaten/fahrzeuge/7');
    const kopf = await screen.findByRole('heading', { level: 1, name: 'Florian 1' });
    expect(within(kopf).queryByText('Demo')).not.toBeInTheDocument();
  });

  it('zeigt das Fahrzeug aus der Listen-Query — alle elf Felder, kein Einzel-GET', async () => {
    let abrufe = 0;
    handler();
    server.use(
      http.get('/api/fahrzeuge', () => {
        abrufe += 1;
        return HttpResponse.json([fahrzeug]);
      }),
    );
    renderRoute('/admin/stammdaten/fahrzeuge/7');

    expect(await screen.findByRole('heading', { name: 'Florian 1' })).toBeInTheDocument();
    // Die sieben Felder der Detailseite.
    expect(screen.getByLabelText('OPTA')).toHaveValue('FL MUS 01');
    expect(screen.getByLabelText('Standort')).toHaveValue('Wache Mitte');
    expect(screen.getByLabelText('FMS-ISSI')).toHaveValue('12345');
    expect(screen.getByLabelText('Bemerkung')).toHaveValue('Reserve');
    expect(screen.getByRole('switch', { name: 'Sonder-/Wegerecht' })).toBeChecked();
    expect(screen.getByLabelText('Tragenkapazität')).toHaveValue('2');
    // Die Soll-Stärke ist EIN Formularfeld mit drei Zahlen (Backend-CHECK „alle drei oder
    // keiner") — deshalb drei Eingaben, ein `Form.Item`.
    expect(screen.getByLabelText('Unterführer')).toHaveValue('1');
    expect(screen.getByLabelText('Mannschaft')).toHaveValue('8');
    // Die zweite Hälfte der „kein neuer Endpunkt"-Aussage: EIN Listenabruf, kein zweiter.
    expect(abrufe).toBe(1);
  });

  /**
   * Der 404 ist selbst erzeugt — es gibt kein serverseitiges Einzel-GET. Ohne diese Weiche
   * zeigte ein toter Deeplink ein leeres Formular, dessen Speichern einen fremden Datensatz
   * träfe. Der Rückweg gehört dazu: eine Sackgasse ohne Tür ist der halbe Fehler.
   */
  it('meldet eine unbekannte id statt ein leeres Formular zu zeigen', async () => {
    handler(admin, []);
    renderRoute('/admin/stammdaten/fahrzeuge/999');

    expect(await screen.findByText('Fahrzeug nicht gefunden')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zur Fahrzeugliste' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Funkrufname')).not.toBeInTheDocument();
  });

  it('zeigt unter dem Pfad OHNE id weiterhin die Liste, nicht die Detailseite', async () => {
    handler();
    renderRoute('/admin/stammdaten/fahrzeuge');

    expect(await screen.findByRole('button', { name: 'Fahrzeug anlegen' })).toBeInTheDocument();
    // Die Detailseite hätte die Sektionsüberschriften der Vollmaske.
    expect(screen.queryByText('Funk & Sonderrechte')).not.toBeInTheDocument();
  });

  it('speichert den vollen Feldsatz in EINEM Absenden', async () => {
    const gesendet = vi.fn();
    handler(admin, [fahrzeug], gesendet);
    const nutzer = userEvent.setup();
    renderRoute('/admin/stammdaten/fahrzeuge/7');

    await nutzer.clear(await screen.findByLabelText('OPTA'));
    await nutzer.type(screen.getByLabelText('OPTA'), 'FL MUS 02');
    await nutzer.click(screen.getByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(gesendet).toHaveBeenCalledTimes(1));
    // Ein Absenden trägt das ganze Stärke-Trio — verteilt gesendet könnte es eine vom
    // Mehrspalten-CHECK abgelehnte Kombination erzeugen.
    expect(gesendet.mock.calls[0][0]).toMatchObject({
      funkrufname: 'Florian 1',
      opta: 'FL MUS 02',
      staerke_fuehrer: 0,
      staerke_unterfuehrer: 1,
      staerke_mannschaft: 8,
      bemerkung: 'Reserve',
    });
  });

  /**
   * Fehlende Berechtigung wird ERKLÄRT, nicht stumm weggeschaltet (LFH-345). Die Gegenaussage
   * („mit Recht ist er bedienbar") gehört dazu, sonst bliebe der Test auch bei einem dauerhaft
   * gesperrten Knopf grün.
   */
  it('ohne Admin-Recht: Speichern gesperrt statt weg, mit Begründung', async () => {
    handler(nichtAdmin);
    renderRoute('/admin/stammdaten/fahrzeuge/7');

    const knopf = await screen.findByRole('button', { name: 'Speichern' });
    expect(knopf).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent(/Systemrolle/);
  });

  it('mit Admin-Recht ist derselbe Knopf bedienbar', async () => {
    handler(admin);
    renderRoute('/admin/stammdaten/fahrzeuge/7');
    expect(await screen.findByRole('button', { name: 'Speichern' })).toBeEnabled();
  });

  /**
   * Ein laufender Entwurf überlebt eine FREMDE Änderung: die Listen-Query wird auch von fremden
   * Änderungen invalidiert, und ein Effekt, der dann `setFieldsValue` ruft, ersetzte den
   * getippten Text. Deshalb seedet die Seite NUR beim Mount.
   *
   * Der Abrufzähler ist nicht Beiwerk: ohne ihn wäre die Behauptung trivial grün, solange der
   * Refetch noch nicht gelandet ist.
   */
  it('ersetzt einen getippten Entwurf NICHT, wenn die Liste neu geladen wird', async () => {
    let abrufe = 0;
    handler();
    server.use(
      http.get('/api/fahrzeuge', () => {
        abrufe += 1;
        // Ab dem zweiten Abruf steht dort ein FREMDER Wert.
        return HttpResponse.json([
          abrufe === 1 ? fahrzeug : { ...fahrzeug, funkrufname: 'Florian 9', bemerkung: 'Fremd' },
        ]);
      }),
    );
    const nutzer = userEvent.setup();
    const { client } = renderRoute('/admin/stammdaten/fahrzeuge/7');

    await nutzer.clear(await screen.findByLabelText('Bemerkung'));
    await nutzer.type(screen.getByLabelText('Bemerkung'), 'Mein Entwurf');

    await act(async () => {
      await client.invalidateQueries({ queryKey: globalKeys.fahrzeugeListe('alle') });
    });
    /*
     * Gewartet wird auf die ÜBERSCHRIFT, nicht auf den Abrufzähler: der zählt im MSW-Handler,
     * bevor React die neuen Daten gerendert hat. Die Überschrift liest direkt aus der Query;
     * steht dort der fremde Funkrufname, hätte ein Seeding-Effekt längst gefeuert.
     */
    expect(await screen.findByRole('heading', { name: 'Florian 9' })).toBeInTheDocument();
    expect(abrufe).toBe(2);

    expect(screen.getByLabelText('Bemerkung')).toHaveValue('Mein Entwurf');
  });

  it('leitet eine kaputte Route-ID auf die Liste um, statt einen leeren Datensatz zu zeigen', async () => {
    handler();
    renderRoute('/admin/stammdaten/fahrzeuge/abc');

    expect(await screen.findByRole('button', { name: 'Fahrzeug anlegen' })).toBeInTheDocument();
  });
  /**
   * `key={id}` am `<Form>`: antds `initialValues` wird genau EINMAL beim Mount gelesen. Ohne den
   * Schlüssel trüge das Formular nach dem Umhängen die Werte des vorigen Datensatzes und
   * schriebe sie beim Speichern fest.
   *
   * Die Überschrift ist die Positivprobe: sie liest direkt aus der Query. Erst sie macht eine
   * rote Feldzeile zur Aussage über das Seeding statt über eine ausgebliebene Navigation.
   */
  it('trägt nach dem Wechsel auf einen anderen Datensatz DESSEN Werte', async () => {
    const nutzer = userEvent.setup();
    renderMitWechsel();

    expect(await screen.findByRole('heading', { name: 'Florian 1' })).toBeInTheDocument();
    expect(screen.getByLabelText('OPTA')).toHaveValue('FL MUS 01');

    await nutzer.click(screen.getByRole('button', { name: 'Nächstes Fahrzeug' }));

    expect(await screen.findByRole('heading', { name: 'Florian 2' })).toBeInTheDocument();
    expect(screen.getByLabelText('OPTA')).toHaveValue('FL MUS 08');
    expect(screen.getByLabelText('Bemerkung')).toHaveValue('Zweiter');
  });
});
