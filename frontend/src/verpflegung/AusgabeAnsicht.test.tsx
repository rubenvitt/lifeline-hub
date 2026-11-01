import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import { einsatzKeys } from '../api/queryKeys';
import type { ModulFreigaben, VerpflegungZeitfenster } from '../api/types';
import { meldeOfflineSchreibaktionGesendet } from '../offline/ereignisse';
import { queueLeerenFuerTests, schreibaktionenLaden } from '../offline/queue';
import { benutzerFixture, freigabenFixture } from '../test/fixtures';
import { meHandler, server } from '../test/server';
import { renderMitProviders, setzeOnline } from '../test/utils';
import { optionenVon, oeffne, waehle } from '../test/auswahlListe';
import {
  ABSCHNITT_DEICH,
  BS_TURNHALLE,
  DEICH,
  FELDKUECHE,
  GRUPPE_1,
  GRUPPE_2,
  KEINE_SONDERKOST,
  TURNHALLE,
  ausgabe,
  empfaenger,
  empfaengerMitBetreuung,
  stelle,
  verpflegungMitStellen,
  zeitfenster,
} from '../test/verpflegungDaten';
import type { VerpflegungEmpfaenger, Verpflegungsstelle } from '../api/types';
import { loadGemerkteStelle, saveGemerkteStelle } from './stellenGedaechtnis';

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

function liefert(
  zf: VerpflegungZeitfenster[],
  stellen: Verpflegungsstelle[] = [],
  empfaengerListe?: VerpflegungEmpfaenger,
) {
  ladeVerpflegung.mockImplementation(() =>
    Promise.resolve({
      zeitfenster: zf,
      stellen,
      ...(empfaengerListe ? { empfaenger: empfaengerListe } : {}),
    }),
  );
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
  vi.useRealTimers();
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
    // Die Uhr steht: Unter Last dauert das Tippen sonst länger als die Ruhe (RUHE_MS), und die
    // Sammlung bucht, bevor der Dialog prüft.
    vi.useFakeTimers({ toFake: ['Date'] });
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
    // Die Sammlung schließt erst nach der Ruhe (RUHE_MS = 3 s); unter Last braucht der Rest länger.
    expect(
      await screen.findByText(/Offline vorgemerkt: 3 EP zu ‚Mittag‘/, {}, { timeout: 10000 }),
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
    expect(loadGemerkteStelle(1)).toBe(FELDKUECHE);
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
    saveGemerkteStelle(1, DEICH);
    zeige();
    await geladen();
    expect(gewaehlt()).toBe('Zuführung Deich');
  });

  it('`?stelle=` aus der Karte geht vor der gemerkten Wahl', async () => {
    saveGemerkteStelle(1, DEICH);
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

  it('die Vorwahl gilt beim Öffnen: eine neue Zuordnung bei offener Ansicht ändert die Wahl nicht', async () => {
    liefert([mittagAnStellen([FELDKUECHE])], stellen());
    const { client } = zeige();
    await geladen();
    expect(gewaehlt()).toBe('Feldküche BR Sportplatz');
    await userEvent.click(taste('+5'));
    liefert([mittagAnStellen([TURNHALLE, FELDKUECHE])], stellen());
    await client.invalidateQueries();
    await waitFor(() => expect(ladeVerpflegung).toHaveBeenCalledTimes(2));
    expect(gewaehlt()).toBe('Feldküche BR Sportplatz');
    expect(erfasseAusgabe).not.toHaveBeenCalled();
    await userEvent.click(taste('Buchen'));
    await waitFor(() =>
      expect(erfasseAusgabe.mock.calls[0][2]).toMatchObject({
        menge: 5,
        verpflegungsstelle_id: FELDKUECHE,
      }),
    );
  });

  it('die Vorwahl gilt beim Öffnen: fällt eine von zwei zugeordneten weg, bleibt „ohne Stelle“', async () => {
    const { client } = zeige();
    await geladen();
    expect(gewaehlt()).toBe('ohne Stelle');
    liefert(
      [mittagAnStellen()],
      stellen().map((s) => (s.id === TURNHALLE ? { ...s, status: 'aufgeloest' as const } : s)),
    );
    await client.invalidateQueries();
    await waitFor(() => expect(ladeVerpflegung).toHaveBeenCalledTimes(2));
    await oeffne('Stelle');
    await waitFor(() => expect(optionenVon('Stelle')).not.toContain('Ausgabe Turnhalle Nord'));
    expect(gewaehlt()).toBe('ohne Stelle');
  });

  it('wird die gewählte Stelle bei offener Ansicht aufgelöst, fällt sie aus der Wahl', async () => {
    liefert([mittagAnStellen([FELDKUECHE])], stellen());
    const { client } = zeige();
    await geladen();
    expect(gewaehlt()).toBe('Feldküche BR Sportplatz');
    liefert(
      [mittagAnStellen([FELDKUECHE])],
      stellen().map((s) => (s.id === FELDKUECHE ? { ...s, status: 'aufgeloest' as const } : s)),
    );
    await client.invalidateQueries();
    await waitFor(() => expect(gewaehlt()).toBe('ohne Stelle'));
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
    saveGemerkteStelle(1, DEICH);
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
    expect(loadGemerkteStelle(1)).toBe(DEICH);
  });

  it('ohne Stellen im Einsatz bleibt der Platz leer', async () => {
    liefert([mittag()], []);
    zeige();
    await geladen();
    expect(platz().childNodes).toHaveLength(0);
  });
});

describe('AusgabeAnsicht — Gerät an einer Verpflegungsstelle (LLH-1048 Teil II)', () => {
  /** Was der Server dem Gerät der Feldküche liefert: nur seine Stelle und deren Ist. */
  const mittagAnKueche = () =>
    mittag({
      stelle_ids: [FELDKUECHE],
      je_stelle: [
        { stelle_id: FELDKUECHE, ausgegeben: { gesamt: 100, sonderkost: KEINE_SONDERKOST } },
      ],
    });
  const kueche = () => stelle({ id: FELDKUECHE, bezeichnung: 'Feldküche BR Sportplatz' });
  const platz = () => document.querySelector<HTMLElement>('[data-lfh="ausgabe-stelle"]')!;

  function zeigeAmGeraet(suche = '') {
    server.use(
      meHandler({
        ...benutzerFixture({ id: BENUTZER_ID, anzeigename: 'Feldküche BR Sportplatz · Tresen' }),
        geraet: {
          kopplung_id: 3,
          einsatz_id: 1,
          ansicht: 'verpflegung',
          uhs_id: null,
          stelle_id: FELDKUECHE,
          stelle: 'Feldküche BR Sportplatz',
          bezeichnung: 'Tresen',
          laeuft_ab_at: '2026-10-04 18:00:00',
        },
      }),
    );
    return renderMitProviders(ansicht, { route: `/einsaetze/1/verpflegung/1/ausgabe${suche}` });
  }

  beforeEach(() => {
    localStorage.clear();
    liefert([mittagAnKueche()], [kueche()]);
  });

  it('keine Stellenwahl: die eigene Stelle steht fest mit ihrem Ist, das Bündel trägt sie', async () => {
    zeigeAmGeraet();
    await geladen();
    await waitFor(() => expect(platz()).toHaveTextContent('Feldküche BR Sportplatz'));
    expect(screen.queryByRole('combobox', { name: 'Stelle' })).toBeNull();
    expect(platz().querySelector('[data-lfh="ausgabe-stelle-fest"]')).not.toBeNull();
    expect(platz().querySelector('[data-lfh="ausgabe-stelle-ist"]')).toHaveTextContent(
      'an der Stelle 100 EP',
    );
    await userEvent.click(taste('+1'));
    await userEvent.click(taste('Buchen'));
    await waitFor(() =>
      expect(erfasseAusgabe.mock.calls[0][2]).toEqual({
        menge: 1,
        verpflegungsstelle_id: FELDKUECHE,
        client_id: expect.any(String),
      }),
    );
  });

  it('auch im einsatzweiten Zeitfenster (ohne Zuordnung) steht und bucht die eigene Stelle', async () => {
    liefert([mittag()], [kueche()]);
    zeigeAmGeraet();
    await geladen();
    await waitFor(() => expect(platz()).toHaveTextContent('Feldküche BR Sportplatz'));
    expect(platz().querySelector('[data-lfh="ausgabe-stelle-ist"]')).toHaveTextContent(
      'an der Stelle 0 EP',
    );
    await userEvent.click(taste('+1'));
    await userEvent.click(taste('Buchen'));
    await waitFor(() =>
      expect(erfasseAusgabe.mock.calls[0][2]).toMatchObject({
        verpflegungsstelle_id: FELDKUECHE,
      }),
    );
  });

  it('`?stelle=` einer anderen Stelle ändert die eigene nicht', async () => {
    zeigeAmGeraet(`?stelle=${TURNHALLE}`);
    await geladen();
    await waitFor(() => expect(platz()).toHaveTextContent('Feldküche BR Sportplatz'));
    await userEvent.click(taste('+1'));
    await userEvent.click(taste('Buchen'));
    await waitFor(() =>
      expect(erfasseAusgabe.mock.calls[0][2]).toMatchObject({
        verpflegungsstelle_id: FELDKUECHE,
      }),
    );
  });

  it('„Ausgabe nachtragen“: die Stelle steht fest, ohne Auswahl und ohne Zuführungsziel', async () => {
    zeigeAmGeraet();
    await geladen();
    await waitFor(() => expect(platz()).toHaveTextContent('Feldküche BR Sportplatz'));
    await userEvent.click(taste('Ausgabe nachtragen'));
    const dialog = await screen.findByRole('dialog', { name: 'Ausgabe nachtragen: Mittag' });
    expect(within(dialog).queryByRole('combobox', { name: 'Stelle' })).toBeNull();
    expect(dialog.querySelector('[data-lfh="nachtrag-stelle-fest"]')).toHaveTextContent(
      'Feldküche BR Sportplatz',
    );
    expect(within(dialog).queryByLabelText('Zuführungsziel')).toBeNull();
    await userEvent.type(within(dialog).getByLabelText('Menge (EP)'), '12');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Nachtragen' }));
    await waitFor(() =>
      expect(erfasseAusgabe.mock.calls[0][2]).toMatchObject({
        menge: 12,
        verpflegungsstelle_id: FELDKUECHE,
      }),
    );
  });
});

describe('AusgabeAnsicht — Empfänger (LLH-1055 Teil II)', () => {
  const platz = () => document.querySelector<HTMLElement>('[data-lfh="ausgabe-empfaenger"]')!;
  const gewaehlt = () => platz().querySelector('.ant-select-content')?.textContent ?? '';
  const offen = () =>
    [...document.querySelectorAll<HTMLElement>('[data-lfh="stand-offen"] > li[data-einheit]')].map(
      (li) => Number(li.dataset.einheit),
    );

  beforeEach(() => {
    liefert([mittag()], [], empfaenger());
  });

  it('Vorgabe „ohne Empfänger“; Einheiten mit Stärke, dann Abschnitte als Zuführung', async () => {
    zeige();
    await geladen();
    expect(gewaehlt()).toBe('ohne Empfänger');
    await oeffne('Empfänger');
    expect(optionenVon('Empfänger')).toEqual([
      'ohne Empfänger',
      '1. Zug · Florian 1 · 1/2/17//20',
      '1. Gruppe · Florian 1-1 · 0/1/8//9',
      '2. Gruppe · Florian 1-2 · 0/1/8//9',
      'Wasserrettung',
      'Zuführung Deich',
    ]);
    // Ohne Empfänger geht das Bündel ohne Empfänger.
    await userEvent.click(taste('+1'));
    await userEvent.click(taste('Buchen'));
    await waitFor(() =>
      expect(erfasseAusgabe.mock.calls[0][2]).toEqual({ menge: 1, client_id: expect.any(String) }),
    );
  });

  it('Einheit gewählt: „+9“ zählt ihre Stärke, überschreibbar mit „−1“; das Bündel trägt sie', async () => {
    zeige();
    await geladen();
    await waehle('Empfänger', '2. Gruppe · Florian 1-2 · 0/1/8//9');
    await userEvent.click(taste('Stärke zählen: 9 EP an 2. Gruppe'));
    expect(sammlungMenge()).toBe('9');
    await userEvent.click(taste('−1'));
    await userEvent.click(taste('Buchen'));
    await waitFor(() =>
      expect(erfasseAusgabe.mock.calls[0][2]).toEqual({
        menge: 8,
        einheit_id: GRUPPE_2,
        client_id: expect.any(String),
      }),
    );
  });

  it('„Menge …“ ist mit der Stärke der gewählten Einheit vorbelegt', async () => {
    zeige();
    await geladen();
    await waehle('Empfänger', '1. Zug · Florian 1 · 1/2/17//20');
    await userEvent.click(taste('Menge …'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Menge (EP)')).toHaveValue('20');
  });

  it('Zuführung an einen Abschnitt: keine Stärke-Taste, das Bündel trägt den Abschnitt', async () => {
    zeige();
    await geladen();
    await waehle('Empfänger', 'Zuführung Deich');
    expect(screen.queryByRole('button', { name: /^Stärke zählen/ })).toBeNull();
    await userEvent.click(taste('+10'));
    await userEvent.click(taste('Buchen'));
    await waitFor(() =>
      expect(erfasseAusgabe.mock.calls[0][2]).toMatchObject({
        menge: 10,
        abschnitt_id: ABSCHNITT_DEICH,
      }),
    );
  });

  it('ein Wechsel des Empfängers bucht das offene Bündel beim alten', async () => {
    zeige();
    await geladen();
    await waehle('Empfänger', '2. Gruppe · Florian 1-2 · 0/1/8//9');
    await userEvent.click(taste('+5'));
    expect(erfasseAusgabe).not.toHaveBeenCalled();
    await waehle('Empfänger', 'ohne Empfänger');
    await waitFor(() => expect(erfasseAusgabe).toHaveBeenCalledTimes(1));
    expect(erfasseAusgabe.mock.calls[0][2]).toMatchObject({ menge: 5, einheit_id: GRUPPE_2 });
  });

  it('„Noch nicht verpflegt“ in der Ansicht; „Wählen“ setzt den Empfänger', async () => {
    liefert(
      [mittag({ ausgaben: [ausgabe({ id: 7, menge: 9, einheit_id: GRUPPE_1 })] })],
      [],
      empfaenger(),
    );
    zeige();
    await geladen();
    expect(offen()).toEqual([31, GRUPPE_2]);
    await userEvent.click(taste('Empfänger wählen: 2. Gruppe'));
    expect(gewaehlt()).toBe('2. Gruppe · Florian 1-2 · 0/1/8//9');
    // Die Ausgabe nennt ihren Empfänger in „Letzte Buchungen“.
    expect(document.querySelector('[data-lfh="ausgabe-zeile"]')).toHaveTextContent(
      '9 EP · an 1. Gruppe',
    );
  });

  it('Beobachter: Empfängerwahl und „Wählen“ gesperrt', async () => {
    einsatz.wert = { ...einsatz.wert, meine_rolle: 'beobachter' };
    zeige();
    await geladen();
    expect(screen.getByRole('combobox', { name: 'Empfänger' })).toBeDisabled();
    expect(taste('Empfänger wählen: 2. Gruppe')).toBeDisabled();
  });

  it('ohne Netz: die vorgemerkte Ausgabe trägt die Einheit, steht „ausstehend“ und nimmt sie nicht aus der Liste (AK)', async () => {
    await queueLeerenFuerTests();
    zeige();
    await geladen();
    setzeOnline(false);
    await waehle('Empfänger', '2. Gruppe · Florian 1-2 · 0/1/8//9');
    await userEvent.click(taste('Stärke zählen: 9 EP an 2. Gruppe'));
    await userEvent.click(taste('Buchen'));
    expect(
      await screen.findByText(/Offline vorgemerkt: 9 EP zu ‚Mittag‘/, {}, { timeout: 10000 }),
    ).toBeInTheDocument();
    const [aktion] = await schreibaktionenLaden(BENUTZER_ID, 1);
    expect(aktion.aktion).toMatchObject({ daten: { menge: 9, einheit_id: GRUPPE_2 } });
    await waitFor(() =>
      expect(
        document.querySelector('[data-lfh="stand-offen"] > li[data-einheit="33"]'),
      ).toHaveTextContent('ausstehend 9 EP'),
    );
    expect(offen()).toContain(GRUPPE_2);
    expect(document.querySelector('[data-lfh="ausgabe-zeile-ausstehend"]')).toHaveTextContent(
      '9 EP · an 2. Gruppe',
    );
  });

  it('Betreuungsstelle (LLH-1295): eigene Gruppe ohne geschlossene, keine Stärke-Taste, das Bündel trägt die Stelle', async () => {
    liefert([mittag()], [], empfaengerMitBetreuung());
    zeige();
    await geladen();
    await oeffne('Empfänger');
    const optionen = optionenVon('Empfänger');
    expect(optionen.slice(-2)).toEqual(['Zuführung Deich', 'Turnhalle Nord']);
    expect(optionen).not.toContain('Schule Süd');
    await waehle('Empfänger', 'Turnhalle Nord');
    expect(screen.queryByRole('button', { name: /^Stärke zählen/ })).toBeNull();
    await userEvent.click(taste('+10'));
    await userEvent.click(taste('Buchen'));
    await waitFor(() =>
      expect(erfasseAusgabe.mock.calls[0][2]).toMatchObject({
        menge: 10,
        betreuungsstelle_id: BS_TURNHALLE,
      }),
    );
  });

  it('nur eine offene Betreuungsstelle: die Empfängerwahl steht', async () => {
    liefert([mittag()], [], {
      einheiten: [],
      abschnitte: [],
      betreuungsstellen: [{ id: BS_TURNHALLE, bezeichnung: 'Turnhalle Nord', geschlossen: false }],
    });
    zeige();
    await geladen();
    expect(screen.getByRole('combobox', { name: 'Empfänger' })).toBeVisible();
  });

  it('ohne Einheiten und Abschnitte bleibt der Platz leer und es gibt keine Liste', async () => {
    liefert([mittag()], [], { einheiten: [], abschnitte: [], betreuungsstellen: [] });
    zeige();
    await geladen();
    expect(platz().childNodes).toHaveLength(0);
    expect(document.querySelector('[data-lfh="verpflegung-stand"]')).toBeNull();
  });
});

describe('AusgabeAnsicht — Live-Zufluss „Letzte Buchungen“ (LLH-1292)', () => {
  const a1 = ausgabe({ id: 101, menge: 7, zeitpunkt_at: um(-20) });
  const a2 = ausgabe({ id: 102, menge: 8, zeitpunkt_at: um(-10) });
  /** Die Buchung eines zweiten Geräts: jünger, sie käme ganz oben an. */
  const fremd = ausgabe({ id: 200, menge: 33, zeitpunkt_at: um(-1) });

  const flaeche = () => document.querySelector<HTMLElement>('[data-lfh="ausgabe-letzte-flaeche"]')!;
  const mengen = () =>
    [...document.querySelectorAll('[data-lfh="ausgabe-zeile"]')].map(
      (z) => /(\d+) EP/.exec(z.textContent ?? '')?.[1],
    );

  /** Der Ereignisstrom invalidiert die Verpflegung; der nächste Abruf trägt `ausgaben`. */
  async function liveStand(
    client: import('@tanstack/react-query').QueryClient,
    ausgaben: ReturnType<typeof ausgabe>[],
  ) {
    liefert([mittag({ ausgaben })]);
    await act(() => client.invalidateQueries({ queryKey: einsatzKeys.verpflegung(1) }));
  }

  it('fremde Buchung bei gehaltenem Zeiger: keine eingeschobene Zeile, sie erscheint nach dem Banner oben', async () => {
    liefert([mittag({ ausgaben: [a1, a2] })]);
    const { client } = zeige();
    await geladen();
    expect(mengen()).toEqual(['8', '7']);

    fireEvent.pointerMove(flaeche(), { pointerType: 'mouse' });
    await liveStand(client, [a1, a2, fremd]);

    const banner = await screen.findByRole('button', { name: '1 neu anzeigen' });
    expect(screen.getByText('1 neue Buchung')).toBeInTheDocument();
    expect(mengen()).toEqual(['8', '7']);
    // Kopf und Kennzahlen rechnen mit der vollen Menge; nur die Liste wartet.
    expect(screen.queryByText('33 EP')).toBeNull();

    fireEvent.click(banner);
    await waitFor(() => expect(mengen()).toEqual(['33', '8', '7']));
    expect(screen.queryByRole('button', { name: '1 neu anzeigen' })).toBeNull();
  });

  it('ohne Zeiger und Fokus erscheint eine fremde Buchung sofort, ohne Banner', async () => {
    liefert([mittag({ ausgaben: [a1, a2] })]);
    const { client } = zeige();
    await geladen();
    await liveStand(client, [a1, a2, fremd]);
    await waitFor(() => expect(mengen()).toEqual(['33', '8', '7']));
    expect(screen.queryByRole('button', { name: /neu anzeigen/ })).toBeNull();
  });

  it('Touch hält nicht: ein Tipp betritt und verlässt die Liste', async () => {
    liefert([mittag({ ausgaben: [a1, a2] })]);
    const { client } = zeige();
    await geladen();
    fireEvent.pointerMove(flaeche(), { pointerType: 'touch' });
    await liveStand(client, [a1, a2, fremd]);
    await waitFor(() => expect(mengen()).toEqual(['33', '8', '7']));
  });

  it('Fokus auf „Zurücknehmen“ hält; der Sprung zum Banner nicht, das Verlassen gibt frei', async () => {
    liefert([mittag({ ausgaben: [a1, a2] })]);
    const { client } = zeige();
    await geladen();
    const zuruck = taste(/^Zurücknehmen: Ausgabe 7 EP/);
    act(() => zuruck.focus());
    await liveStand(client, [a1, a2, fremd]);
    const banner = await screen.findByRole('button', { name: '1 neu anzeigen' });
    expect(mengen()).toEqual(['8', '7']);

    act(() => banner.focus());
    expect(mengen()).toEqual(['8', '7']);

    act(() => banner.blur());
    await waitFor(() => expect(mengen()).toEqual(['33', '8', '7']));
  });

  it('die offene Rückfrage „Zurücknehmen?“ hält, auch ohne Fokus in der Liste', async () => {
    liefert([mittag({ ausgaben: [a1, a2] })]);
    const { client } = zeige();
    await geladen();
    // Ohne Zeiger und Fokus in der Liste (Touch): allein die offene Rückfrage hält.
    fireEvent.click(taste(/^Zurücknehmen: Ausgabe 7 EP/));
    const dialog = await screen.findByRole('dialog', { name: 'Ausgabe zurücknehmen?' });
    expect(flaeche()).not.toContainElement(document.activeElement as HTMLElement);
    await liveStand(client, [a1, a2, fremd]);
    expect(await screen.findByText('1 neue Buchung')).toBeInTheDocument();
    expect(mengen()).toEqual(['8', '7']);
    expect(dialog).toBeInTheDocument();
  });

  it('verschwindet der fokussierte „Zurücknehmen“-Knopf, hält die Liste nicht weiter', async () => {
    liefert([mittag({ ausgaben: [a1, a2] })]);
    const { client } = zeige();
    await geladen();
    act(() => taste(/^Zurücknehmen: Ausgabe 7 EP/).focus());
    // Die Ausgabe ist zurückgenommen (ihr Knopf fällt weg), dazu kommt eine fremde.
    await liveStand(client, [{ ...a1, zurueckgenommen_at: um(-2) }, a2, fremd]);
    await waitFor(() => expect(mengen()).toEqual(['33', '8', '7']));
    expect(screen.queryByRole('button', { name: /neu anzeigen/ })).toBeNull();
  });

  it('eigene Buchung erscheint sofort, auch bei gehaltenem Zeiger', async () => {
    liefert([mittag({ ausgaben: [a1, a2] })]);
    const eigene = ausgabe({ id: 300, menge: 1, zeitpunkt_at: um(0) });
    erfasseAusgabe.mockImplementation(() => {
      liefert([mittag({ ausgaben: [a1, a2, eigene] })]);
      return Promise.resolve({
        ausgabe_id: 300,
        zeitfenster: mittag({ ausgaben: [a1, a2, eigene] }),
      });
    });
    zeige();
    await geladen();
    fireEvent.pointerMove(flaeche(), { pointerType: 'mouse' });
    // `fireEvent` statt `userEvent`: der Zeiger bleibt dabei in der Liste.
    fireEvent.click(taste('+1'));
    fireEvent.click(taste('Buchen'));
    await waitFor(() => expect(mengen()).toEqual(['1', '8', '7']));
    expect(screen.queryByRole('button', { name: /neu anzeigen/ })).toBeNull();
  });

  it('eine vorgemerkte Ausgabe, die der Abgleich bucht, gilt als eigene', async () => {
    liefert([mittag({ ausgaben: [a1, a2] })]);
    const { client } = zeige();
    await geladen();
    fireEvent.pointerMove(flaeche(), { pointerType: 'mouse' });
    const nachgeholt = ausgabe({ id: 400, menge: 4, zeitpunkt_at: um(-5) });
    act(() =>
      meldeOfflineSchreibaktionGesendet({
        art: 'ausgabe',
        benutzerId: BENUTZER_ID,
        einsatzId: 1,
        zeitfensterId: 1,
        ausgabeId: 400,
      }),
    );
    await liveStand(client, [a1, a2, nachgeholt, fremd]);
    await waitFor(() => expect(mengen()).toEqual(['4', '8', '7']));
    expect(screen.getByText('1 neue Buchung')).toBeInTheDocument();
  });
});
