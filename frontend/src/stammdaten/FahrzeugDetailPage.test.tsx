import { http, HttpResponse } from 'msw';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Route, Routes, useNavigate } from 'react-router';
import { server } from '../test/server';
import { globalKeys } from '../api/queryKeys';
import { renderMitProviders } from '../test/utils';
import FahrzeugDetailPage from './FahrzeugDetailPage';
import FahrzeugeTab from './FahrzeugeTab';
import { fahrzeugDetailPfad } from './stammdatenDetail';

/**
 * LFH-346 · A7 — die Fahrzeug-Detailroute.
 *
 * Gemessen wird, was diese Seite zusichert: den Datensatz aus der LISTEN-Query (kein neuer
 * Endpunkt), den selbst erzeugten Nicht-gefunden-Fall, den gesperrten statt verschwundenen
 * Speichern-Knopf ohne Recht — und dass der Listenpfad ohne id weiterhin die Liste zeigt.
 */

const admin = {
  id: 1,
  anzeigename: 'Admin',
  benutzername: 'admin',
  system_rolle: 'admin',
  org_rolle: 'keine',
  aktiv: true,
  erstellt_at: '2026-05-26 10:00:00',
};
const nichtAdmin = { ...admin, system_rolle: 'keiner' };

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
    http.get('/api/auth/me', () => HttpResponse.json(benutzer)),
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
 * Ein Detail→Detail-Sprung, wie ihn ein künftiger „nächstes Fahrzeug"-Link auslöste. Er steht
 * NEBEN den `Routes`, damit der Klick die Route wechselt, ohne den Baum neu aufzubauen — genau
 * der Fall, für den `key={id}` am `<Form>` steht.
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
    // Die sieben Felder, die aus der Schnellerfassung hierher gewandert sind.
    expect(screen.getByLabelText('OPTA')).toHaveValue('FL MUS 01');
    expect(screen.getByLabelText('Standort')).toHaveValue('Wache Mitte');
    expect(screen.getByLabelText('FMS-ISSI')).toHaveValue('12345');
    expect(screen.getByLabelText('Bemerkung')).toHaveValue('Reserve');
    expect(screen.getByRole('switch', { name: 'Sonder-/Wegerecht' })).toBeChecked();
    expect(screen.getByLabelText('Tragenkapazität')).toHaveValue('2');
    // Die Soll-Stärke ist EIN Formularfeld mit drei Zahlen (Backend-CHECK „alle drei oder
    // keiner", `src/routes/fahrzeug.rs:267`) — deshalb drei Eingaben, ein `Form.Item`.
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
   * M16 (LFH-345 · C10): fehlende Berechtigung wird ERKLÄRT, nicht stumm weggeschaltet. Der
   * Knopf steht gesperrt da — ein fehlender Knopf ist von „diese Seite kann das gar nicht"
   * nicht zu unterscheiden. Die Gegenaussage („mit Recht ist er bedienbar") gehört dazu,
   * sonst bliebe der Test auch bei einem dauerhaft gesperrten Knopf grün.
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
   * Ein laufender Entwurf überlebt eine FREMDE Änderung (LFH-342 · C7). Die Listen-Query
   * wird auch von Änderungen invalidiert, die jemand anders ausgelöst hat; ein Effekt, der
   * bei jeder Query-Änderung `setFieldsValue` ruft, ersetzte den gerade getippten Text ohne
   * Vorwarnung. Deshalb seedet die Seite NUR beim Mount.
   *
   * Der Abrufzähler ist hier nicht Beiwerk: ohne ihn wäre die Behauptung trivial grün,
   * solange der Refetch noch gar nicht gelandet ist.
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
     * Gewartet wird auf die ÜBERSCHRIFT, nicht auf den Abrufzähler: der zählt im
     * MSW-Handler hoch, also bevor React die neuen Daten überhaupt gerendert hat — eine
     * Behauptung an dieser Stelle liefe dem Effekt davon, den sie widerlegen soll.
     * Die Überschrift liest direkt aus der Query; steht dort der fremde Funkrufname, ist
     * der neue Stand im Baum und ein Seeding-Effekt hätte längst gefeuert. (Per
     * Mutationsprobe belegt: mit wieder eingebautem Effekt färbt genau diese Zeile rot.)
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
   * `key={id}` am `<Form>` (Review-Befund LFH-346 · C11): antds `initialValues` wird genau
   * EINMAL beim Mount gelesen. Hängt dieselbe Seite auf einen anderen Datensatz um, trüge das
   * Formular ohne den Schlüssel die Werte des vorigen — der Nutzer bearbeitete Fahrzeug 8 mit
   * den Feldern von Fahrzeug 7 und schriebe sie beim Speichern fest.
   *
   * Die Überschrift ist die Positivprobe: sie liest direkt aus der Query, ist also auch ohne
   * Schlüssel richtig. Erst sie macht eine rote Feldzeile zur Aussage über das Seeding statt
   * über eine ausgebliebene Navigation.
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
