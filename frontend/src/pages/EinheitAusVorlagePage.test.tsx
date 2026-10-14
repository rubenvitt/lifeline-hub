import { describe, expect, it } from 'vitest';
import { http, HttpResponse, type HttpHandler } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { einsatzFixture, freigabenFixture } from '../test/fixtures';
import type {
  AusVorlageEingabe,
  EinsatzAnzeige,
  VorlageVorschau,
  VorschauFahrzeug,
  VorschauKnoten,
  VorschauPersonal,
} from '../api/types';
import { EINHEIT_NAME_MAX } from '../api/eingabegrenzen';
import EinheitAusVorlagePage from './EinheitAusVorlagePage';

/**
 * Seite „Einheit aus Vorlage bilden“ (LLH-1049, Spec `einheit-vorlagen`, „Seite zum Bilden aus
 * der Vorlage“ und „Rückmeldung der Seite“): Kopf, Baum mit Zustandswörtern und Häkchen,
 * Absenden mit Zusammenfassung, Gründe an der Zeile und der Sprung danach.
 */

const fz = (fahrzeug_id: number, funkrufname: string, extra: Partial<VorschauFahrzeug> = {}) =>
  ({ fahrzeug_id, funkrufname, fahrzeugtyp: null, zustand: 'neu', ...extra }) as VorschauFahrzeug;
const ps = (personal_id: number, name: string, extra: Partial<VorschauPersonal> = {}) =>
  ({ personal_id, name, zustand: 'neu', ...extra }) as VorschauPersonal;
const knoten = (
  vorlage_id: number,
  name: string,
  typ_label: string,
  fahrzeuge: VorschauFahrzeug[],
  personal: VorschauPersonal[],
  ueber_vorlage_id?: number,
) =>
  ({
    vorlage_id,
    ueber_vorlage_id,
    name,
    typ_id: 1,
    typ_label,
    soll_eigen: false,
    fahrzeuge,
    personal,
  }) as VorschauKnoten;

/** Der Demo-„Sanitätszug Musterstadt“; Abweichungen je Stamm-ID. */
function sanitaetszug(
  fahrzeuge: Partial<Record<number, Partial<VorschauFahrzeug>>> = {},
  personal: Partial<Record<number, Partial<VorschauPersonal>>> = {},
  modul: Partial<Pick<VorlageVorschau, 'fahrzeuge_gesperrt' | 'personal_gesperrt'>> = {},
): VorlageVorschau {
  return {
    vorlage_id: 5,
    fahrzeuge_gesperrt: false,
    personal_gesperrt: false,
    ...modul,
    knoten: [
      knoten(
        5,
        'Sanitätszug Musterstadt',
        'Zug',
        [fz(10, 'ELW 1', fahrzeuge[10])],
        [
          ps(100, 'Zora Zugführer', { fahrzeug_id: 10, ...personal[100] }),
          ps(101, 'Fred Funker', { fahrzeug_id: 10, ...personal[101] }),
        ],
      ),
      knoten(
        6,
        'Rettungsstaffel',
        'Staffel',
        [fz(20, 'RTW 1', fahrzeuge[20]), fz(21, 'RTW 2', fahrzeuge[21])],
        [
          ps(200, 'Anna Arndt', { fahrzeug_id: 20, ...personal[200] }),
          ps(201, 'Bert Brandt', { fahrzeug_id: 20, ...personal[201] }),
          ps(202, 'Cleo Cramer', { fahrzeug_id: 21, ...personal[202] }),
          ps(203, 'Dirk Dahl', { ...personal[203] }),
        ],
        5,
      ),
    ],
  };
}

const einheit = (id: number, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  einsatz_id: 1,
  abschnitt_id: null,
  abschnitt_name: null,
  ueber_einheit_id: null,
  typ_id: 1,
  typ_label: 'Zug',
  name,
  fuehrer_id: null,
  fuehrer_name: null,
  bemerkung: null,
  sortier: 0,
  soll: null,
  ist: { fuehrer: 0, unterfuehrer: 0, mannschaft: 0 },
  ist_kumuliert: { fuehrer: 0, unterfuehrer: 0, mannschaft: 0 },
  personal_mitglieder: [],
  fahrzeug_mitglieder: [],
  material_mitglieder: [],
  sprechgruppen: [],
  aufgeloest_at: null,
  ...extra,
});

function handlers({
  vorschau = sanitaetszug(),
  einheiten = [] as unknown[],
  rolle = 'einsatzleitung' as EinsatzAnzeige['meine_rolle'],
} = {}) {
  return [
    http.get('/api/einsaetze/1', () =>
      HttpResponse.json(einsatzFixture({ bezeichnung: 'Lage', meine_rolle: rolle })),
    ),
    http.get('/api/einsaetze/1/einheiten/aus-vorlage/5', () => HttpResponse.json(vorschau)),
    http.get('/api/einsaetze/1/einheiten', () => HttpResponse.json(einheiten)),
    http.get('/api/einsaetze/1/abschnitte', () =>
      HttpResponse.json([{ id: 3, einsatz_id: 1, name: 'Nord', sortier: 0 }]),
    ),
  ];
}

function Ort() {
  const ort = useLocation();
  return <div data-testid="ort">{ort.pathname + ort.search}</div>;
}

function zeige(...abweichungen: HttpHandler[]) {
  server.use(...abweichungen, ...handlers());
  return renderMitProviders(
    <Routes>
      <Route
        path="/einsaetze/:id/einheiten/aus-vorlage/:vorlageId"
        element={<EinheitAusVorlagePage />}
      />
      <Route path="*" element={<Ort />} />
    </Routes>,
    { route: '/einsaetze/1/einheiten/aus-vorlage/5' },
  );
}

/** Die Zeile einer Kraft (`fahrzeug-10`, `personal-200`). */
function zeile(schluessel: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-zeile="${schluessel}"]`);
  expect(el, `Zeile ${schluessel} fehlt`).toBeTruthy();
  return el!;
}
const kaestchen = (schluessel: string) => within(zeile(schluessel)).getByRole('checkbox');
const zustand = (schluessel: string) =>
  zeile(schluessel).querySelector('[data-lfh="vorlage-zustand"]')?.textContent;

async function warteAufBaum() {
  await screen.findByRole('heading', { name: 'Rettungsstaffel' });
}

describe('EinheitAusVorlagePage · Kopf', () => {
  it('belegt den Namen mit der obersten Einheit vor, begrenzt ihn und bietet den Abschnitt', async () => {
    zeige();
    const name = await screen.findByLabelText('Name');
    expect(name).toHaveValue('Sanitätszug Musterstadt');
    expect(name).toHaveAttribute('maxLength', String(EINHEIT_NAME_MAX));
    expect(screen.getByLabelText('Abschnitt')).toBeInTheDocument();
    expect(screen.getByText('ohne Abschnitt')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Einheit aus Vorlage bilden' })).toBeInTheDocument();
  });

  it('warnt bei gleichem aktiven Namen, sperrt aber nicht (D15)', async () => {
    let body: AusVorlageEingabe | null = null;
    zeige(
      http.get('/api/einsaetze/1/einheiten', () =>
        HttpResponse.json([einheit(40, 'sanitätszug musterstadt ')]),
      ),
      http.post('/api/einsaetze/1/einheiten/aus-vorlage', async ({ request }) => {
        body = (await request.json()) as AusVorlageEingabe;
        return HttpResponse.json(
          { einheit_id: 50, einheit_ids: [50, 51], fahrzeuge: [], personal: [] },
          { status: 201 },
        );
      }),
    );
    expect(await screen.findByText('Name schon vergeben')).toBeInTheDocument();
    const knopf = screen.getByRole('button', { name: 'Einheit bilden' });
    expect(knopf).toBeEnabled();
    await userEvent.click(knopf);
    await waitFor(() => expect(body).not.toBeNull());
  });

  it('eine aufgelöste Einheit gleichen Namens warnt nicht', async () => {
    zeige(
      http.get('/api/einsaetze/1/einheiten', () =>
        HttpResponse.json([
          einheit(40, 'Sanitätszug Musterstadt', { aufgeloest_at: '2026-10-14 08:00:00' }),
        ]),
      ),
    );
    await warteAufBaum();
    expect(screen.queryByText('Name schon vergeben')).not.toBeInTheDocument();
  });

  it('der geänderte Name steht im Kopf des obersten Paneels', async () => {
    zeige();
    const name = await screen.findByLabelText('Name');
    await userEvent.clear(name);
    await userEvent.type(name, '3. Zug');
    expect(screen.getByRole('heading', { name: '3. Zug' })).toBeInTheDocument();
  });
});

describe('EinheitAusVorlagePage · Baum', () => {
  it('hakt Fahrzeuge an, keine Person; die Zusammenfassung zählt den Baum', async () => {
    zeige();
    await warteAufBaum();
    for (const f of ['fahrzeug-10', 'fahrzeug-20', 'fahrzeug-21']) {
      expect(kaestchen(f)).toBeChecked();
      expect(zustand(f)).toBe('neu');
    }
    for (const p of [100, 101, 200, 201, 202, 203])
      expect(kaestchen(`personal-${p}`)).not.toBeChecked();
    // Beschriftete Kästchen: der Name ist der zugängliche Name.
    expect(screen.getByRole('checkbox', { name: /RTW 2/ })).toBe(kaestchen('fahrzeug-21'));
    expect(screen.getByRole('checkbox', { name: /Anna Arndt/ })).toBe(kaestchen('personal-200'));
    expect(screen.getByText('1 Zug, 1 Staffel, 3 Fahrzeuge, 0 Kräfte')).toBeInTheDocument();
    // Die Zusammenfassung beschreibt den Knopf.
    expect(screen.getByRole('button', { name: 'Einheit bilden' })).toHaveAccessibleDescription(
      '1 Zug, 1 Staffel, 3 Fahrzeuge, 0 Kräfte',
    );
    // Dirk hat kein Vorlagen-Fahrzeug: eigene Gruppe in der Staffel.
    expect(screen.getByText('Ohne Fahrzeug')).toBeInTheDocument();
  });

  it('nennt den Zustand als Wort; eine gebundene Kraft kommt nur mit „umhängen“ (D14)', async () => {
    zeige(
      http.get('/api/einsaetze/1/einheiten/aus-vorlage/5', () =>
        HttpResponse.json(
          sanitaetszug(
            { 21: { zustand: 'gebunden', einheit_id: 9, einheit_name: '2. Zug' } },
            {
              200: { zustand: 'frei' },
              201: { zustand: 'ausser_dienst' },
              202: { zustand: 'gebunden', fahrzeug_name: 'KTW 4' },
            },
          ),
        ),
      ),
    );
    await warteAufBaum();
    expect(zustand('fahrzeug-21')).toBe('in «2. Zug»');
    expect(zustand('personal-200')).toBe('im Einsatz');
    expect(zustand('personal-201')).toBe('außer Dienst');
    expect(zustand('personal-202')).toBe('auf «KTW 4»');
    // Gebunden: Vorgabe aus, das Kästchen heißt „umhängen“ — nur so ist die Kraft wählbar.
    const rtw2 = screen.getByRole('checkbox', { name: /RTW 2.*umhängen aus «2\. Zug»/ });
    expect(rtw2).not.toBeChecked();
    expect(screen.getByText('1 Zug, 1 Staffel, 2 Fahrzeuge, 0 Kräfte')).toBeInTheDocument();
    await userEvent.click(rtw2);
    expect(rtw2).toBeChecked();
    expect(screen.getByText('1 Zug, 1 Staffel, 3 Fahrzeuge, 0 Kräfte')).toBeInTheDocument();
    await userEvent.click(kaestchen('personal-202'));
    expect(zeile('personal-202')).toHaveTextContent('umhängen von «KTW 4»');
    // Außer Dienst: gesperrt.
    expect(kaestchen('personal-201')).toBeDisabled();
  });

  it('eine Person, deren Fahrzeug nicht mitkommt, steht „ohne Fahrzeug“', async () => {
    zeige();
    await warteAufBaum();
    expect(zeile('personal-200')).not.toHaveTextContent('ohne Fahrzeug');
    await userEvent.click(kaestchen('fahrzeug-20'));
    // Erst an einer gewählten Person: eine, die nicht mitkommt, braucht den Hinweis nicht.
    expect(zeile('personal-200')).not.toHaveTextContent('ohne Fahrzeug');
    await userEvent.click(kaestchen('personal-200'));
    expect(zeile('personal-200')).toHaveTextContent('ohne Fahrzeug');
    expect(zeile('personal-201')).not.toHaveTextContent('ohne Fahrzeug');
    expect(screen.getByText('1 Zug, 1 Staffel, 2 Fahrzeuge, 1 Kraft')).toBeInTheDocument();
  });

  it('eine freie Person auf ihrem Fahrzeug verlässt es, wenn es abgewählt ist (14.10.2026)', async () => {
    zeige(
      http.get('/api/einsaetze/1/einheiten/aus-vorlage/5', () =>
        HttpResponse.json(
          sanitaetszug(
            { 20: { zustand: 'frei' } },
            {
              200: { zustand: 'frei', ef_id: 77, fahrzeug_name: 'RTW 1' },
            },
          ),
        ),
      ),
    );
    await warteAufBaum();
    await userEvent.click(kaestchen('personal-200'));
    expect(zeile('personal-200')).not.toHaveTextContent('verlässt');
    await userEvent.click(kaestchen('fahrzeug-20'));
    expect(zeile('personal-200')).toHaveTextContent('verlässt «RTW 1»');
  });

  it('ein gesperrtes Modul steht als Wort, ohne Zeilen und ohne Zählung', async () => {
    const ohnePersonal = sanitaetszug({}, {}, { personal_gesperrt: true });
    for (const k of ohnePersonal.knoten) k.personal = [];
    zeige(
      http.get('/api/einsaetze/1/einheiten/aus-vorlage/5', () => HttpResponse.json(ohnePersonal)),
    );
    await warteAufBaum();
    expect(screen.getByText('Personal gesperrt')).toBeInTheDocument();
    expect(screen.getByText('1 Zug, 1 Staffel, 3 Fahrzeuge')).toBeInTheDocument();
    expect(document.querySelector('[data-zeile^="personal-"]')).toBeNull();
  });

  it('ohne Schreibrecht ist nichts wählbar und der Grund steht oben', async () => {
    server.use(...handlers({ rolle: 'beobachter' }));
    renderMitProviders(
      <Routes>
        <Route
          path="/einsaetze/:id/einheiten/aus-vorlage/:vorlageId"
          element={<EinheitAusVorlagePage />}
        />
      </Routes>,
      { route: '/einsaetze/1/einheiten/aus-vorlage/5' },
    );
    await warteAufBaum();
    expect(kaestchen('fahrzeug-10')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Einheit bilden' })).toBeDisabled();
  });

  it('eine unbekannte Vorlage zeigt einen Fehler statt eines leeren Baums', async () => {
    zeige(
      http.get('/api/einsaetze/1/einheiten/aus-vorlage/5', () =>
        HttpResponse.json({ error: 'Vorlage nicht gefunden' }, { status: 404 }),
      ),
    );
    expect(await screen.findByText('Vorlage nicht verfügbar')).toBeInTheDocument();
  });
});

describe('EinheitAusVorlagePage · Absenden', () => {
  it('sendet Name, Abschnitt und die Wahl und springt ins Meldebild mit der Einheit', async () => {
    let body: AusVorlageEingabe | null = null;
    zeige(
      http.post('/api/einsaetze/1/einheiten/aus-vorlage', async ({ request }) => {
        body = (await request.json()) as AusVorlageEingabe;
        return HttpResponse.json(
          { einheit_id: 50, einheit_ids: [50, 51], fahrzeuge: [], personal: [] },
          { status: 201 },
        );
      }),
    );
    const name = await screen.findByLabelText('Name');
    await userEvent.clear(name);
    await userEvent.type(name, ' 3. Zug ');
    await userEvent.click(kaestchen('fahrzeug-21'));
    await userEvent.click(kaestchen('personal-200'));
    await userEvent.click(kaestchen('personal-203'));
    await userEvent.click(screen.getByRole('button', { name: 'Einheit bilden' }));

    expect(await screen.findByTestId('ort')).toHaveTextContent(
      '/einsaetze/1/kraefteuebersicht?einheit=50',
    );
    expect(body).toEqual({
      vorlage_id: 5,
      name: '3. Zug',
      abschnitt_id: null,
      fahrzeuge: [
        { fahrzeug_id: 10, umhaengen: false },
        { fahrzeug_id: 20, umhaengen: false },
      ],
      personal: [
        { personal_id: 200, umhaengen: false },
        { personal_id: 203, umhaengen: false },
      ],
    });
    expect(await screen.findByText('Einheit gebildet')).toBeInTheDocument();
  });

  it('ohne Freigabe des Meldebilds führt der Sprung in die Ansicht der Einheit', async () => {
    zeige(
      http.get('/api/einsaetze/1/modul-freigaben', () =>
        HttpResponse.json(freigabenFixture({ kraefteuebersicht: { zugriff: false } })),
      ),
      http.post('/api/einsaetze/1/einheiten/aus-vorlage', () =>
        HttpResponse.json(
          { einheit_id: 50, einheit_ids: [50], fahrzeuge: [], personal: [] },
          { status: 201 },
        ),
      ),
    );
    await warteAufBaum();
    // Die Freigaben laden neben der Seite; erst mit ihnen steht die Sperre fest.
    await new Promise((r) => setTimeout(r, 20));
    await userEvent.click(screen.getByRole('button', { name: 'Einheit bilden' }));
    expect(await screen.findByTestId('ort')).toHaveTextContent('/einsaetze/1/einheiten/50');
  });

  it('wer die Seite während des Bildens verlässt, wird danach nicht zurückgerissen', async () => {
    let freigeben: () => void = () => {};
    zeige(
      http.post('/api/einsaetze/1/einheiten/aus-vorlage', async () => {
        await new Promise<void>((r) => (freigeben = r));
        return HttpResponse.json(
          { einheit_id: 50, einheit_ids: [50], fahrzeuge: [], personal: [] },
          { status: 201 },
        );
      }),
    );
    await warteAufBaum();
    await userEvent.click(screen.getByRole('button', { name: 'Einheit bilden' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Abbrechen' })).toBeDisabled());
    await userEvent.click(screen.getByRole('link', { name: 'Einheiten' }));
    expect(await screen.findByTestId('ort')).toHaveTextContent('/einsaetze/1/einheiten');
    freigeben();
    expect(await screen.findByText('Einheit gebildet')).toBeInTheDocument();
    expect(screen.getByTestId('ort')).toHaveTextContent(/^\/einsaetze\/1\/einheiten$/);
  });

  it('eine Ablehnung steht an der Zeile, ohne Toast; die Vorschau wird abgeglichen (D14)', async () => {
    let abrufe = 0;
    zeige(
      http.get('/api/einsaetze/1/einheiten/aus-vorlage/5', () => {
        abrufe += 1;
        return HttpResponse.json(
          abrufe === 1
            ? sanitaetszug()
            : sanitaetszug({
                21: { zustand: 'gebunden', einheit_id: 9, einheit_name: '2. Zug' },
              }),
        );
      }),
      http.post('/api/einsaetze/1/einheiten/aus-vorlage', () =>
        HttpResponse.json(
          {
            error: 'Nicht alle Kräfte lassen sich übernehmen',
            zeilen: [{ art: 'fahrzeug', id: 21, grund: 'gehört zu «2. Zug»' }],
          },
          { status: 422 },
        ),
      ),
    );
    await warteAufBaum();
    await userEvent.click(screen.getByRole('button', { name: 'Einheit bilden' }));

    await waitFor(() => expect(zeile('fahrzeug-21')).toHaveTextContent('gehört zu «2. Zug»'));
    expect(zeile('fahrzeug-20')).not.toHaveTextContent('gehört zu');
    await waitFor(() => expect(zustand('fahrzeug-21')).toBe('in «2. Zug»'));
    expect(abrufe).toBe(2);
    // Die getroffene Wahl bleibt; das Umhängen setzt die Seite nicht still.
    expect(kaestchen('fahrzeug-21')).toBeChecked();
    expect(zeile('fahrzeug-21')).not.toHaveTextContent('umhängen');
    expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);
    expect(screen.queryByTestId('ort')).not.toBeInTheDocument();
  });

  it('Abbrechen ist gesperrt, solange das Bilden läuft, und führt sonst zurück', async () => {
    let freigeben: () => void = () => {};
    zeige(
      http.post('/api/einsaetze/1/einheiten/aus-vorlage', async () => {
        await new Promise<void>((r) => (freigeben = r));
        return HttpResponse.json({ error: 'kaputt' }, { status: 500 });
      }),
    );
    await warteAufBaum();
    await userEvent.click(screen.getByRole('button', { name: 'Einheit bilden' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Abbrechen' })).toBeDisabled());
    freigeben();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Abbrechen' })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(await screen.findByTestId('ort')).toHaveTextContent('/einsaetze/1/einheiten');
  });

  it('über dem Deckel bleibt „Einheit bilden“ gesperrt und nennt den Grund (D7)', async () => {
    const gross = sanitaetszug();
    gross.knoten[1].fahrzeuge = Array.from({ length: 51 }, (_, i) => fz(1000 + i, `RTW ${i + 3}`));
    zeige(http.get('/api/einsaetze/1/einheiten/aus-vorlage/5', () => HttpResponse.json(gross)));
    await warteAufBaum();
    expect(screen.getByText('Höchstens 50 Fahrzeuge je Bildung')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Einheit bilden' })).toBeDisabled();
  });
});
