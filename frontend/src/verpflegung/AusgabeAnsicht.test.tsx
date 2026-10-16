import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import type { ModulFreigaben, VerpflegungZeitfenster } from '../api/types';
import { queueLeerenFuerTests, schreibaktionenLaden } from '../offline/queue';
import { benutzerFixture, freigabenFixture } from '../test/fixtures';
import { meHandler, server } from '../test/server';
import { renderMitProviders, setzeOnline } from '../test/utils';
import { optionenVon, oeffne, waehle } from '../test/auswahlListe';
import {
  DEICH,
  FELDKUECHE,
  KEINE_SONDERKOST,
  TURNHALLE,
  ausgabe,
  stelle,
  verpflegungMitStellen,
  zeitfenster,
} from '../test/verpflegungDaten';
import type { Verpflegungsstelle } from '../api/types';
import { liesGemerkteStelle, merkeStelle } from './stellenGedaechtnis';

dayjs.extend(utc);

const einsatz = vi.hoisted(() => ({
  wert: { id: 1, bezeichnung: 'Hochwasser', status: 'aktiv', meine_rolle: 'einsatzleitung' },
  freigaben: {} as ModulFreigaben,
}));
vi.mock('../api/einsaetze', () => ({
  ladeEinsatz: vi.fn(() => Promise.resolve(einsatz.wert)),
  ladeModulFreigaben: vi.fn(() => Promise.resolve(einsatz.freigaben)),
}));
vi.mock('../api/nachforderungen', () => ({
  listeNachforderungen: vi.fn(() => Promise.resolve([])),
}));

const ladeVerpflegung = vi.fn();
const erfasseAusgabe = vi.fn();
const nimmAusgabeZurueck = vi.fn();
vi.mock('../api/verpflegung', () => ({
  ladeVerpflegung: (...a: unknown[]) => ladeVerpflegung(...a),
  erfasseAusgabe: (...a: unknown[]) => erfasseAusgabe(...a),
  nimmAusgabeZurueck: (...a: unknown[]) => nimmAusgabeZurueck(...a),
}));

// Die Uhr als Stellschraube, wie auf der Modulseite.
const uhr = vi.hoisted(() => ({ wert: null as import('dayjs').Dayjs | null }));
vi.mock('../abloesung/useUhr', () => ({ useUhr: () => uhr.wert! }));

const { default: AusgabeAnsicht } = await import('./AusgabeAnsicht');

const JETZT = dayjs.utc('2026-09-24 10:30:00');
const um = (minuten: number) => JETZT.add(minuten, 'minute').format('YYYY-MM-DD HH:mm:ss');
const BENUTZER_ID = 1;

/** Laufend: Bedarf 250 (davon 3 vegan, 10 vegetarisch), ausgegeben 230, fehlt 20. */
const mittag = (over: Partial<VerpflegungZeitfenster> = {}) =>
  zeitfenster({
    id: 1,
    von_at: um(-30),
    bis_at: um(60),
    bedarf: {
      kraefte: 180,
      betreute: 70,
      weitere: 0,
      gesamt: 250,
      sonderkost: { ...KEINE_SONDERKOST, vegan: 3, vegetarisch: 10 },
    },
    ausgegeben: { gesamt: 230, sonderkost: { ...KEINE_SONDERKOST, vegan: 3, vegetarisch: 4 } },
    fehlmenge: { gesamt: 20, sonderkost: { ...KEINE_SONDERKOST, vegetarisch: 6 } },
    ...over,
  });

function liefert(zf: VerpflegungZeitfenster[], stellen: Verpflegungsstelle[] = []) {
  ladeVerpflegung.mockImplementation(() => Promise.resolve({ zeitfenster: zf, stellen }));
}

const ansicht = (
  <Routes>
    <Route path="/einsaetze/:id/verpflegung/:zeitfensterId/ausgabe" element={<AusgabeAnsicht />} />
    <Route path="/einsaetze/:id/verpflegung" element={<div>Modulseite</div>} />
  </Routes>
);

function zeige(zfId = 1, suche = '') {
  server.use(meHandler(benutzerFixture({ id: BENUTZER_ID, anzeigename: 'Leitung' })));
  return renderMitProviders(ansicht, {
    route: `/einsaetze/1/verpflegung/${zfId}/ausgabe${suche}`,
  });
}

const taste = (name: string | RegExp) => screen.getByRole('button', { name });
const sammlungMenge = () => document.querySelector('[data-lfh="sammlung-menge"]')!.textContent;
const kennzahl = (titel: string) =>
  [...document.querySelectorAll<HTMLElement>('[data-lfh="kennzahl"]')].find((k) =>
    k.textContent?.startsWith(titel),
  )!;
const wert = (titel: string) =>
  kennzahl(titel).querySelector<HTMLElement>('[data-lfh="kennzahl-wert"]')!;
const grund = () => document.querySelector<HTMLElement>('[data-lfh="zaehltasten-grund"]')!;
/** Der Text, auf den `aria-describedby` zeigt. */
const beschreibung = (el: HTMLElement) =>
  document.getElementById(el.getAttribute('aria-describedby') ?? '')?.textContent;

async function geladen() {
  await screen.findByRole('heading', { level: 1, name: 'Mittag' });
}

beforeEach(() => {
  vi.clearAllMocks();
  uhr.wert = JETZT;
  einsatz.wert = {
    id: 1,
    bezeichnung: 'Hochwasser',
    status: 'aktiv',
    meine_rolle: 'einsatzleitung',
  };
  einsatz.freigaben = freigabenFixture();
  liefert([mittag()]);
  erfasseAusgabe.mockImplementation((_e: number, _z: number, body: { menge: number }) =>
    Promise.resolve({
      ausgabe_id: 55,
      zeitfenster: mittag({
        ausgegeben: { gesamt: 230 + body.menge, sonderkost: mittag().ausgegeben.sonderkost },
        fehlmenge: { gesamt: Math.max(0, 20 - body.menge), sonderkost: KEINE_SONDERKOST },
      }),
    }),
  );
});

afterEach(async () => {
  setzeOnline(true);
  await queueLeerenFuerTests();
});

describe('AusgabeAnsicht — Kopf (LLH-1032, design.md D3)', () => {
  it('Soll, ausgegeben, fehlt vom Server; „Sammlung 0“ mit gesperrtem „Buchen“ und Kurzgrund', async () => {
    zeige();
    await geladen();
    expect(wert('Soll')).toHaveTextContent('250');
    expect(wert('ausgegeben')).toHaveTextContent('230');
    expect(wert('fehlt')).toHaveTextContent('20');
    expect(kennzahl('fehlt')).toHaveAttribute('data-ton', 'alarm');
    expect(screen.getByText('Unterdeckung')).toBeInTheDocument();
    expect(sammlungMenge()).toBe('0');
    const buchen = taste('Buchen');
    expect(buchen).toBeDisabled();
    expect(beschreibung(buchen)).toBe('keine Sammlung');
    // Der leere Platz der Stellenwahl (LLH-1040) steht, ohne Inhalt.
    const stelle = document.querySelector('[data-lfh="ausgabe-stelle"]');
    expect(stelle).not.toBeNull();
    expect(stelle!.childNodes).toHaveLength(0);
  });

  it('ein Tipp erhöht „Sammlung“ und lässt „fehlt“ unverändert; fehlt ist nicht der Rest des Balkens', async () => {
    zeige();
    await geladen();
    await userEvent.click(taste('+5'));
    expect(sammlungMenge()).toBe('5');
    expect(wert('fehlt')).toHaveTextContent('20');
    // Die Länge im Bild rechnet die Sammlung ab, die Zahl „fehlt“ nicht.
    expect(document.querySelector('[data-lfh="aufgliederung-legende"]')).toHaveTextContent(
      'ausgegeben 230 · Sammlung 5 · ausstehend 0 · Rest 15',
    );
    expect(erfasseAusgabe).not.toHaveBeenCalled();
  });

  it('Zahlen in Monospace mit tabellarischen Ziffern', async () => {
    zeige();
    await geladen();
    for (const t of ['Soll', 'ausgegeben', 'fehlt']) {
      expect(wert(t).style.fontVariantNumeric).toBe('tabular-nums');
    }
    expect(
      document.querySelector<HTMLElement>('[data-lfh="sammlung-menge"]')!.style.fontVariantNumeric,
    ).toBe('tabular-nums');
  });
});

describe('AusgabeAnsicht — Tasten und Sonderkost (D2, D4, D9)', () => {
  it('„−1“ ohne Sammlung gesperrt mit sichtbarem Kurzgrund „keine Sammlung“, nach einem Tipp frei (AK 4)', async () => {
    zeige();
    await geladen();
    const minus = taste('−1');
    expect(minus).toBeDisabled();
    expect(beschreibung(minus)).toBe('keine Sammlung');
    expect(grund()).toHaveTextContent('keine Sammlung');
    await userEvent.click(taste('+1'));
    expect(minus).toBeEnabled();
    expect(minus).not.toHaveAttribute('aria-describedby');
    await userEvent.click(minus);
    expect(sammlungMenge()).toBe('0');
    expect(minus).toBeDisabled();
  });

  it('„+1“ ist die einzige Primärtaste', async () => {
    zeige();
    await geladen();
    const primaer = document.querySelectorAll('[data-lfh="zaehltasten"] .ant-btn-primary');
    expect(primaer).toHaveLength(1);
    expect(primaer[0]).toHaveTextContent('+1');
  });

  it('„Menge …“ nimmt bei Sammlung 10 keine 99 995 an; es geht keine Anfrage hinaus', async () => {
    zeige();
    await geladen();
    await userEvent.click(taste('+10'));
    await userEvent.click(taste('Menge …'));
    const dialog = await screen.findByRole('dialog', { name: 'Menge zählen' });
    await userEvent.type(within(dialog).getByLabelText('Menge (EP)'), '99995');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zählen' }));
    expect(await within(dialog).findByText('Höchstens 99990 EP')).toBeInTheDocument();
    expect(sammlungMenge()).toBe('10');
    expect(erfasseAusgabe).not.toHaveBeenCalled();
  });

  it('„Menge …“ 60 bucht sofort eine Ausgabe über 60 EP', async () => {
    zeige();
    await geladen();
    await userEvent.click(taste('Menge …'));
    const dialog = await screen.findByRole('dialog', { name: 'Menge zählen' });
    await userEvent.type(within(dialog).getByLabelText('Menge (EP)'), '60');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zählen' }));
    await waitFor(() =>
      expect(erfasseAusgabe).toHaveBeenCalledWith(
        1,
        1,
        { menge: 60, client_id: expect.any(String) },
        { offlineQueueBenutzerId: BENUTZER_ID },
      ),
    );
  });

  it('Sonderkost-Taste erhöht Kostform und Menge; „+ n“ an der Taste; gebucht als eine Ausgabe (AK 3)', async () => {
    zeige();
    await geladen();
    const veg = taste(/^vegetarisch 4\/10/);
    expect(veg).toHaveTextContent('fehlt 6');
    await userEvent.click(veg);
    await userEvent.click(taste('+1'));
    expect(sammlungMenge()).toBe('2');
    expect(veg).toHaveTextContent('+ 1');
    await userEvent.click(taste('Buchen'));
    await waitFor(() =>
      expect(erfasseAusgabe).toHaveBeenCalledWith(
        1,
        1,
        { menge: 2, sonderkost: { vegetarisch: 1 }, client_id: expect.any(String) },
        { offlineQueueBenutzerId: BENUTZER_ID },
      ),
    );
  });

  it('Kostform ohne Bedarf nur im Menü „Weitere Kostform …“; ein Eintrag zählt wie eine Taste', async () => {
    zeige();
    await geladen();
    expect(screen.queryByRole('button', { name: /^ohne Schweinefleisch/ })).toBeNull();
    expect(taste(/^vegan 3\/3/)).toBeInTheDocument();
    await userEvent.click(taste('Weitere Kostform …'));
    const menue = await waitFor(() => {
      const m = document.querySelector<HTMLElement>(
        '.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]',
      );
      expect(m).not.toBeNull();
      return m!;
    });
    expect(
      [...menue.querySelectorAll('[role="menuitem"]')].map((e) => e.textContent?.trim()),
    ).toEqual(['ohne Schweinefleisch', 'Diät/allergenarm', 'Säugling/Kleinkind']);
    await userEvent.click(within(menue).getByText('ohne Schweinefleisch'));
    expect(sammlungMenge()).toBe('1');
  });
});

describe('AusgabeAnsicht — Buchen, Rückgängig, Ablehnung (D6)', () => {
  it('nach 3 s Ruhe genau eine Ausgabe; Toast „Gebucht“ mit Rückgängig (AK 1)', async () => {
    zeige();
    await geladen();
    for (let i = 0; i < 4; i++) await userEvent.click(taste('+1'));
    expect(erfasseAusgabe).not.toHaveBeenCalled();
    await waitFor(() => expect(erfasseAusgabe).toHaveBeenCalledTimes(1), { timeout: 5000 });
    expect(erfasseAusgabe.mock.calls[0][2]).toEqual({ menge: 4, client_id: expect.any(String) });
    expect(await screen.findByText('Gebucht: 4 EP zu ‚Mittag‘')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Rückgängig/ })).toBeInTheDocument();
  });

  it('zwei Bündel ergeben einen Toast; „Rückgängig“ nimmt das zweite zurück', async () => {
    erfasseAusgabe
      .mockResolvedValueOnce({ ausgabe_id: 55, zeitfenster: mittag() })
      .mockResolvedValueOnce({ ausgabe_id: 56, zeitfenster: mittag() });
    nimmAusgabeZurueck.mockResolvedValue({ ausgabe_id: 56, zeitfenster: mittag() });
    zeige();
    await geladen();
    await userEvent.click(taste('+1'));
    await userEvent.click(taste('Buchen'));
    await screen.findByText('Gebucht: 1 EP zu ‚Mittag‘');
    await userEvent.click(taste('+5'));
    await userEvent.click(taste('Buchen'));
    await screen.findByText('Gebucht: 5 EP zu ‚Mittag‘');
    await waitFor(() => expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(1));
    await userEvent.click(screen.getByRole('button', { name: /Rückgängig/ }));
    await waitFor(() => expect(nimmAusgabeZurueck).toHaveBeenCalledWith(1, 56));
    expect(nimmAusgabeZurueck).toHaveBeenCalledTimes(1);
  });

  it('409: Grund „Nicht gebucht: n EP“ an der Seite, kein Fehler-Toast', async () => {
    erfasseAusgabe.mockRejectedValue(new ApiError(409, 'Einsatz ist abgeschlossen'));
    zeige();
    await geladen();
    await userEvent.click(taste(/^vegetarisch/));
    await userEvent.click(taste('+1'));
    await userEvent.click(taste('Buchen'));
    const zeile = document.querySelector<HTMLElement>('[data-lfh="ausgabe-ablehnung"]')!;
    expect(await within(zeile).findByRole('alert')).toHaveTextContent(
      'Nicht gebucht: 2 EP (davon 1 vegetarisch)',
    );
    expect(zeile).toHaveTextContent('Einsatz ist abgeschlossen');
    expect(sammlungMenge()).toBe('0');
    expect(document.querySelectorAll('.ant-message-error')).toHaveLength(0);
  });

  it('Rücknahme aus dem Toast abgelehnt: Grund „Nicht zurückgenommen“ unter den Sonderkost-Tasten, nicht über den Tasten', async () => {
    erfasseAusgabe.mockResolvedValue({ ausgabe_id: 55, zeitfenster: mittag() });
    nimmAusgabeZurueck.mockRejectedValue(new ApiError(409, 'Ausgabe bereits zurückgenommen'));
    zeige();
    await geladen();
    await userEvent.click(taste('+1'));
    await userEvent.click(taste('Buchen'));
    await userEvent.click(await screen.findByRole('button', { name: /Rückgängig/ }));
    // Fester Platz unter den Sonderkost-Tasten: der Grund verschiebt keine Zähltaste (Spec).
    const zeile = document.querySelector<HTMLElement>('[data-lfh="ausgabe-ablehnung"]')!;
    expect(await within(zeile).findByRole('alert')).toHaveTextContent('Nicht zurückgenommen');
    expect(zeile).toHaveTextContent('Ausgabe bereits zurückgenommen');
    expect(document.querySelector('[data-lfh="seiten-beschreibung"]')).toBeNull();
    expect(document.querySelectorAll('.ant-message-error')).toHaveLength(0);
  });

  it('„Letzte Buchungen“: zehn Zeilen, „Zurücknehmen“ mit Rückfrage, ab elf ein Link „1 ältere Ausgabe“', async () => {
    const elf = Array.from({ length: 11 }, (_, i) =>
      ausgabe({ id: 100 + i, menge: i + 1, zeitpunkt_at: um(-29 + i) }),
    );
    liefert([mittag({ ausgaben: elf })]);
    nimmAusgabeZurueck.mockResolvedValue({ ausgabe_id: 110, zeitfenster: mittag() });
    zeige();
    await geladen();
    const zeilen = document.querySelectorAll('[data-lfh="ausgabe-zeile"]');
    expect(zeilen).toHaveLength(10);
    // Die jüngste zuerst.
    expect(zeilen[0]).toHaveTextContent('11 EP');
    expect(screen.getByRole('link', { name: /^1 ältere Ausgabe/ })).toHaveAttribute(
      'href',
      '/einsaetze/1/verpflegung',
    );
    await userEvent.click(
      screen.getAllByRole('button', { name: /^Zurücknehmen: Ausgabe 11 EP/ })[0],
    );
    const dialog = await screen.findByRole('dialog', { name: 'Ausgabe zurücknehmen?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zurücknehmen' }));
    await waitFor(() => expect(nimmAusgabeZurueck).toHaveBeenCalledWith(1, 110));
  });

  it('mit zehn Ausgaben kein Link auf ältere', async () => {
    liefert([
      mittag({
        ausgaben: Array.from({ length: 10 }, (_, i) =>
          ausgabe({ id: 100 + i, zeitpunkt_at: um(-29 + i) }),
        ),
      }),
    ]);
    zeige();
    await geladen();
    expect(screen.queryByRole('link', { name: /ältere Ausgabe/ })).toBeNull();
  });
});

describe('AusgabeAnsicht — ohne Netz (LLH-1032, AK 2)', () => {
  it('zählen, 3 s: „ausstehend“ an der Ansicht, „fehlt“ unverändert, Hinweis ohne „Rückgängig“, Band an festem Platz', async () => {
    await queueLeerenFuerTests();
    zeige();
    await geladen();
    const band = document.querySelector<HTMLElement>('[data-lfh="ausgabe-offline"]')!;
    expect(band).toHaveTextContent('');
    setzeOnline(false);
    await waitFor(() => expect(band).toHaveTextContent('Offline vorgemerkt'));
    for (let i = 0; i < 3; i++) await userEvent.click(taste('+1'));
    expect(
      await screen.findByText(/Offline vorgemerkt: 3 EP zu ‚Mittag‘/, {}, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(erfasseAusgabe).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Rückgängig/ })).toBeNull();
    await waitFor(() =>
      expect(document.querySelector('[data-lfh="ausgabe-ausstehend"]')).toHaveTextContent(
        '+ 3 ausstehend',
      ),
    );
    expect(wert('fehlt')).toHaveTextContent('20');
    expect(sammlungMenge()).toBe('0');
    // Ausstehende stehen zuerst in „Letzte Buchungen“, ohne „Zurücknehmen“.
    const zeile = document.querySelector<HTMLElement>('[data-lfh="ausgabe-zeile-ausstehend"]')!;
    expect(zeile).toHaveTextContent('3 EP');
    expect(within(zeile).queryByRole('button')).toBeNull();
    const [aktion] = await schreibaktionenLaden(BENUTZER_ID, 1);
    expect(aktion.aktion).toMatchObject({
      art: 'ausgabe',
      zeitfenster_id: 1,
      daten: { menge: 3, client_id: expect.any(String) },
    });
  });

  it('Kaltstart ohne Netz: „Zeitfenster nicht geladen“, nichts zu zählen', async () => {
    setzeOnline(false);
    zeige();
    expect(await screen.findByText('Zeitfenster nicht geladen')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+1' })).toBeNull();
  });
});

describe('AusgabeAnsicht — Zustände (D1, D7)', () => {
  it('vergangenes Zeitfenster: Tasten gesperrt mit „Zeitfenster vorbei“, „Ausgabe nachtragen“ bleibt', async () => {
    uhr.wert = JETZT.add(2, 'hour');
    zeige();
    await geladen();
    for (const t of ['+1', '+5', '+10', 'Menge …', '−1']) {
      expect(taste(t)).toBeDisabled();
      expect(beschreibung(taste(t))).toBe('Zeitfenster vorbei');
    }
    expect(taste(/^vegetarisch/)).toBeDisabled();
    expect(grund()).toHaveTextContent('Zeitfenster vorbei');
    await userEvent.click(taste('Ausgabe nachtragen'));
    expect(
      await screen.findByRole('dialog', { name: 'Ausgabe nachtragen: Mittag' }),
    ).toBeInTheDocument();
  });

  it('wird das Zeitfenster während einer Sammlung vergangen, wird sie gebucht', async () => {
    const { rerender } = zeige();
    await geladen();
    await userEvent.click(taste('+5'));
    uhr.wert = JETZT.add(2, 'hour');
    rerender(ansicht);
    await waitFor(() =>
      expect(erfasseAusgabe).toHaveBeenCalledWith(
        1,
        1,
        { menge: 5, client_id: expect.any(String) },
        { offlineQueueBenutzerId: BENUTZER_ID },
      ),
    );
    expect(taste('+1')).toBeDisabled();
  });

  it('unbekanntes Zeitfenster: „gibt es nicht (mehr)“ mit Weg zur Verpflegung', async () => {
    zeige(99);
    expect(await screen.findByText('Dieses Zeitfenster gibt es nicht (mehr)')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Zur Verpflegung' }));
    expect(await screen.findByText('Modulseite')).toBeInTheDocument();
  });

  it('Beobachter: Zähltasten gesperrt sichtbar, Rechtehinweis, kein „Zurücknehmen“, „Ausgabe nachtragen“ gesperrt mit Grund', async () => {
    einsatz.wert = { ...einsatz.wert, meine_rolle: 'beobachter' };
    zeige();
    await geladen();
    const grundText = 'nur Einsatzleitung und Führungspersonal';
    expect(document.querySelector('[data-lfh="seiten-beschreibung"]')).toHaveTextContent(grundText);
    expect(taste('+1')).toBeDisabled();
    expect(beschreibung(taste('+1'))).toBe(grundText);
    expect(taste('Buchen')).toBeDisabled();
    expect(screen.queryByRole('button', { name: /^Zurücknehmen/ })).toBeNull();
    expect(taste(`Ausgabe nachtragen (${grundText})`)).toBeDisabled();
  });

  it('abgeschlossener Einsatz: dieselbe Sperre mit „Einsatz abgeschlossen“', async () => {
    einsatz.wert = { ...einsatz.wert, status: 'abgeschlossen' };
    zeige();
    await geladen();
    expect(taste('+1')).toBeDisabled();
    expect(grund()).toHaveTextContent('Einsatz abgeschlossen');
    expect(taste('Ausgabe nachtragen (Einsatz abgeschlossen)')).toBeDisabled();
  });

  it('Ladefehler: „Zeitfenster nicht geladen“ mit erneutem Abruf', async () => {
    ladeVerpflegung.mockRejectedValueOnce(new ApiError(500, 'kaputt'));
    zeige();
    expect(await screen.findByText('Zeitfenster nicht geladen')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Erneut abrufen' }));
    await geladen();
  });
});

describe('AusgabeAnsicht — Stellenwahl (LLH-1040, D13 Punkt 7)', () => {
  /** „Mittag“ an Turnhalle (80) und Feldküche (100); die Zuführung Deich ist frei, eine Schule aufgelöst. */
  const stellen = () => [
    ...verpflegungMitStellen().stellen,
    stelle({ id: 30, bezeichnung: 'Ausgabe Schule', status: 'aufgeloest' }),
  ];
  const mittagAnStellen = (stelle_ids = [TURNHALLE, FELDKUECHE]) =>
    mittag({
      stelle_ids,
      je_stelle: [
        { stelle_id: TURNHALLE, ausgegeben: { gesamt: 80, sonderkost: KEINE_SONDERKOST } },
        { stelle_id: FELDKUECHE, ausgegeben: { gesamt: 100, sonderkost: KEINE_SONDERKOST } },
      ],
    });
  const platz = () => document.querySelector<HTMLElement>('[data-lfh="ausgabe-stelle"]')!;
  const gewaehlt = () => platz().querySelector('.ant-select-content')?.textContent ?? '';
  const ist = () => platz().querySelector('[data-lfh="ausgabe-stelle-ist"]')?.textContent ?? '';

  beforeEach(() => {
    localStorage.clear();
    liefert([mittagAnStellen()], stellen());
  });
  afterEach(() => vi.restoreAllMocks());

  it('zugeordnete zuerst, ohne aufgelöste; bei zwei zugeordneten keine Vorwahl', async () => {
    zeige();
    await geladen();
    expect(gewaehlt()).toBe('ohne Stelle');
    await oeffne('Stelle');
    expect(optionenVon('Stelle')).toEqual([
      'ohne Stelle',
      'Ausgabe Turnhalle Nord',
      'Feldküche BR Sportplatz',
      'Zuführung Deich',
    ]);
  });

  it('die gewählte Stelle zeigt ihr Ist, das Bündel trägt sie, der Desktop merkt sie', async () => {
    zeige();
    await geladen();
    await waehle('Stelle', 'Feldküche BR Sportplatz');
    expect(ist()).toBe('an der Stelle 100 EP');
    await userEvent.click(taste('+1'));
    await userEvent.click(taste('Buchen'));
    await waitFor(() =>
      expect(erfasseAusgabe.mock.calls[0][2]).toEqual({
        menge: 1,
        verpflegungsstelle_id: FELDKUECHE,
        client_id: expect.any(String),
      }),
    );
    expect(liesGemerkteStelle(1)).toBe(FELDKUECHE);
  });

  it('ein Wechsel der Stelle bucht das offene Bündel an der alten Stelle', async () => {
    zeige();
    await geladen();
    await waehle('Stelle', 'Feldküche BR Sportplatz');
    await userEvent.click(taste('+5'));
    expect(erfasseAusgabe).not.toHaveBeenCalled();
    await waehle('Stelle', 'Ausgabe Turnhalle Nord');
    await waitFor(() => expect(erfasseAusgabe).toHaveBeenCalledTimes(1));
    expect(erfasseAusgabe.mock.calls[0][2]).toMatchObject({
      menge: 5,
      verpflegungsstelle_id: FELDKUECHE,
    });
    expect(gewaehlt()).toBe('Ausgabe Turnhalle Nord');
  });

  it('die gemerkte Wahl gilt beim Öffnen', async () => {
    merkeStelle(1, DEICH);
    zeige();
    await geladen();
    expect(gewaehlt()).toBe('Zuführung Deich');
  });

  it('`?stelle=` aus der Karte geht vor der gemerkten Wahl', async () => {
    merkeStelle(1, DEICH);
    zeige(1, `?stelle=${TURNHALLE}`);
    await geladen();
    expect(gewaehlt()).toBe('Ausgabe Turnhalle Nord');
    expect(ist()).toBe('an der Stelle 80 EP');
  });

  it('eine aufgelöste Stelle ist nicht wählbar, auch nicht über `?stelle=`', async () => {
    zeige(1, '?stelle=30');
    await geladen();
    expect(gewaehlt()).toBe('ohne Stelle');
    await oeffne('Stelle');
    expect(optionenVon('Stelle')).not.toContain('Ausgabe Schule');
  });

  it('genau eine zugeordnete Stelle ist vorgewählt', async () => {
    liefert([mittagAnStellen([FELDKUECHE])], stellen());
    zeige();
    await geladen();
    expect(gewaehlt()).toBe('Feldküche BR Sportplatz');
  });

  it('Speicher wirft: die Wahl wirkt trotzdem bis zum Verlassen', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('gesperrt', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('gesperrt', 'SecurityError');
    });
    zeige();
    await geladen();
    await waehle('Stelle', 'Zuführung Deich');
    await userEvent.click(taste('+1'));
    await userEvent.click(taste('Buchen'));
    await waitFor(() =>
      expect(erfasseAusgabe.mock.calls[0][2]).toMatchObject({
        menge: 1,
        verpflegungsstelle_id: DEICH,
      }),
    );
  });

  it('am Gerät wird nichts gemerkt und nichts Gemerktes gelesen', async () => {
    merkeStelle(1, DEICH);
    server.use(
      meHandler({
        ...benutzerFixture({ id: BENUTZER_ID, anzeigename: 'Gerät' }),
        geraet: {
          kopplung_id: 3,
          einsatz_id: 1,
          ansicht: 'verpflegung',
          uhs_id: null,
          stelle_id: null,
          stelle: null,
          bezeichnung: 'Ausgabe Deich',
          laeuft_ab_at: '2026-10-04 18:00:00',
        },
      }),
    );
    renderMitProviders(ansicht, { route: '/einsaetze/1/verpflegung/1/ausgabe' });
    await geladen();
    await waitFor(() => expect(gewaehlt()).toBe('ohne Stelle'));
    await waehle('Stelle', 'Feldküche BR Sportplatz');
    expect(liesGemerkteStelle(1)).toBe(DEICH);
  });

  it('ohne Stellen im Einsatz bleibt der Platz leer', async () => {
    liefert([mittag()], []);
    zeige();
    await geladen();
    expect(platz().childNodes).toHaveLength(0);
  });
});
