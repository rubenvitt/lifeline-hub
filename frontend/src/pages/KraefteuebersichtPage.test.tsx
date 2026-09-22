import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within, fireEvent, waitFor } from '@testing-library/react';
import { renderMitProviders } from '../test/utils';
import { setzeViewportBreite } from '../test/viewport';
import KraefteuebersichtPage, {
  aktiveFilterChips,
  LEERER_FILTER,
  meldebildMeta,
} from './KraefteuebersichtPage';
import { Routes, Route } from 'react-router';
import { ladeEinsatz } from '../api/einsaetze';
import { listeEinheiten, setzeEinheitStatus } from '../api/einheiten';
import { listeEinsatzPersonal } from '../api/einsatzPersonal';
import { listeEinsatzFahrzeuge } from '../api/einsatzFahrzeuge';
import { listeEinsatzMaterial } from '../api/einsatzMaterial';
import { listeAbschnitte } from '../api/einsatzabschnitte';
import { listeAuftraege } from '../api/auftraege';
import { ApiError } from '../api/client';
import { listeFahrzeugStatus } from '../api/fahrzeugStatus';
import { legeLageberichtAn, aktualisiereLagebericht } from '../api/lageberichte';
import type { Auftrag, EinsatzAnzeige, FahrzeugStatus } from '../api/types';

vi.mock('../api/einsaetze', () => ({ ladeEinsatz: vi.fn() }));
vi.mock('../api/einheiten', () => ({ listeEinheiten: vi.fn(), setzeEinheitStatus: vi.fn() }));
vi.mock('../api/einsatzPersonal', () => ({ listeEinsatzPersonal: vi.fn() }));
vi.mock('../api/einsatzFahrzeuge', () => ({ listeEinsatzFahrzeuge: vi.fn() }));
vi.mock('../api/einsatzMaterial', () => ({ listeEinsatzMaterial: vi.fn() }));
vi.mock('../api/einsatzabschnitte', () => ({ listeAbschnitte: vi.fn() }));
vi.mock('../api/auftraege', () => ({ listeAuftraege: vi.fn() }));
vi.mock('../api/fahrzeugStatus', () => ({ listeFahrzeugStatus: vi.fn() }));
vi.mock('../api/lageberichte', () => ({
  legeLageberichtAn: vi.fn(() => Promise.resolve({ id: 99 })),
  aktualisiereLagebericht: vi.fn(() => Promise.resolve({})),
}));
const { navigiere } = vi.hoisted(() => ({ navigiere: vi.fn() }));
vi.mock('react-router', async (orig) => ({ ...(await orig()), useNavigate: () => navigiere }));

// Nur die im Page genutzten Felder; Rest via Cast (Test-Fixture, kein echter Server-DTO).
const EINSATZ = {
  id: 1,
  bezeichnung: 'Testeinsatz',
  status: 'aktiv',
  meine_rolle: 'einsatzleitung',
} as EinsatzAnzeige;

const PERSON_P1 = {
  id: 1,
  einsatz_id: 1,
  personal_id: null,
  einheit_id: null,
  fahrzeug_id: null,
  ist_adhoc: false,
  name: 'P1',
  funktion: null,
  traegerorganisation: null,
  staerke_position: 'mannschaft' as const,
  status_id: null,
  status_label: null,
  status_kategorie: 'gebunden' as const,
  status_farbe: null,
  bemerkung: null,
  disponiert_at: '2024-01-01T00:00:00',
  disponiert_von: null,
};

const ABSCHNITT_A1 = {
  id: 10,
  einsatz_id: 1,
  ueber_abschnitt_id: null,
  name: 'Abschnitt Nord',
  leiter_id: null,
  leiter_name: null,
  bemerkung: null,
  sortier: 1,
  flaeche_geojson: null,
  tz_fachaufgabe: null,
  tz_organisation: null,
  sprechgruppe_tmo: null,
  sprechgruppe_dmo: null,
  kommunikationsmittel: null,
  erreichbarkeit: null,
  sprechgruppen: [],
};

const EINHEIT_E10 = {
  id: 20,
  einsatz_id: 1,
  abschnitt_id: 10,
  abschnitt_name: 'Abschnitt Nord',
  ueber_einheit_id: null,
  typ_id: null,
  typ_label: null,
  name: '1. Zug',
  fuehrer_id: null,
  fuehrer_name: null,
  bemerkung: null,
  sortier: 1,
  soll: null,
  ist: { fuehrer: 0, unterfuehrer: 0, mannschaft: 0 },
  ist_kumuliert: { fuehrer: 0, unterfuehrer: 0, mannschaft: 0 },
  personal_mitglieder: [],
  fahrzeug_mitglieder: [],
  material_mitglieder: [],
  lat: null,
  lon: null,
  tz_fachaufgabe: null,
  tz_organisation: null,
  aktueller_br_id: null,
  sprechgruppen: [],
  status: { quelle: 'ohne' as const, verteilung: [] },
};

const FAHRZEUG_F1 = {
  id: 30,
  einsatz_id: 1,
  fahrzeug_id: null,
  einheit_id: 20,
  ist_adhoc: false,
  funkrufname: 'FW 1/44-1',
  kennzeichen: null,
  fahrzeugtyp: 'HLF 20',
  opta: null,
  traegerorganisation: null,
  status_id: null,
  status_label: null,
  status_kategorie: 'verfuegbar' as const,
  status_farbe: null,
  bemerkung: null,
  disponiert_at: '2024-01-01T00:00:00',
  disponiert_von: null,
  lat: null,
  lon: null,
  tz_fachaufgabe: null,
  tz_organisation: null,
  aktueller_br_id: null,
  soll_besatzung: null,
};

/** Katalog wie im Seed (`migrations/0008`): das Label trägt die FMS-Ziffer selbst. */
const KATALOG = [
  { id: 102, label: '2 – Frei auf Wache', kategorie: 'verfuegbar', fms_anker: 2, sortier: 20 },
  { id: 104, label: '4 – Am Einsatzort', kategorie: 'gebunden', fms_anker: 4, sortier: 40 },
  {
    id: 106,
    label: '6 – Nicht einsatzbereit',
    kategorie: 'nicht_verfuegbar',
    fms_anker: 6,
    sortier: 60,
  },
] as FahrzeugStatus[];

const AUFTRAG_A3 = {
  id: 3,
  lfd_nr: 3,
  auftrag_text: 'Deichsicherung km 3,8 – 4,6',
  bearbeitungsstatus: 'offen',
  erteilt_at: '2026-09-21T08:00:00',
  ist_ueberfaellig: false,
  empfaenger: [{ id: 31, einheit_id: 20 }],
} as unknown as Auftrag;

let drucke: ReturnType<typeof vi.fn>;

beforeEach(() => {
  drucke = vi.fn();
  navigiere.mockReset();
  vi.stubGlobal('print', drucke);
  vi.mocked(ladeEinsatz).mockResolvedValue(EINSATZ);
  vi.mocked(listeEinheiten).mockResolvedValue([]);
  vi.mocked(listeEinsatzPersonal).mockResolvedValue([]);
  vi.mocked(listeEinsatzFahrzeuge).mockResolvedValue([]);
  vi.mocked(listeEinsatzMaterial).mockResolvedValue([]);
  vi.mocked(listeAbschnitte).mockResolvedValue([]);
  vi.mocked(listeAuftraege).mockResolvedValue([]);
  vi.mocked(listeFahrzeugStatus).mockResolvedValue(KATALOG);
});

/**
 * Über `renderMitProviders`: ohne `ConfigProvider` fiele `theme.useToken()` auf
 * antd-Vorgaben, und jede Aussage über Zweig oder Dichte von `Datensicht` wäre unerreichbar.
 */
function setup() {
  return renderMitProviders(
    <Routes>
      <Route path="/einsaetze/:id/kraefteuebersicht" element={<KraefteuebersichtPage />} />
    </Routes>,
    { route: '/einsaetze/1/kraefteuebersicht' },
  );
}

/** Der Einheitenstatus, wie ihn der Server aus einem Fahrzeug in S4 ableitet (LFH-609). */
const STATUS_S4 = {
  quelle: 'fahrzeuge' as const,
  status: {
    status_id: 104,
    label: '4 – Am Einsatzort',
    kategorie: 'gebunden' as const,
    fms_anker: 4,
    sortier: 40,
  },
  kategorie: 'gebunden' as const,
  seit: '2026-09-21 07:12:00',
  verteilung: [],
};

/** Abschnitt → Einheit (20) → Fahrzeug (30, S4 „Am Einsatzort"). */
function mitEinheit() {
  vi.mocked(listeAbschnitte).mockResolvedValue([ABSCHNITT_A1]);
  vi.mocked(listeEinheiten).mockResolvedValue([
    {
      ...EINHEIT_E10,
      status: STATUS_S4,
      fahrzeug_mitglieder: [{ ef_id: 30, funkrufname: 'FW 1/44-1', fahrzeugtyp: 'HLF 20' }],
    },
  ]);
  vi.mocked(listeEinsatzFahrzeuge).mockResolvedValue([
    { ...FAHRZEUG_F1, status_id: 104, status_kategorie: 'gebunden' },
  ]);
}

/** Der Seitenkopf — das Meta steht zusätzlich im (am Schirm verborgenen) Druckkopf. */
async function seitenkopf() {
  return within(
    await waitFor(() => {
      const k = document.querySelector('[data-lfh="seitenkopf"]') as HTMLElement | null;
      expect(k).not.toBeNull();
      return k!;
    }),
  );
}

const zeile = (container: HTMLElement, schluessel: string) =>
  container.querySelector(`[data-row-key="${schluessel}"]`) as HTMLElement | null;

describe('KraefteuebersichtPage — Seitenkopf', () => {
  it('trägt den Titel „Meldebild" und die Stärke in BOS-Schreibweise als Mono-Meta', async () => {
    mitEinheit();
    vi.mocked(listeEinsatzPersonal).mockResolvedValue([PERSON_P1]);
    setup();
    expect(await screen.findByRole('heading', { name: 'Meldebild' })).toBeInTheDocument();
    expect(
      await (await seitenkopf()).findByText('1 Einheit · Stärke 0/0/1//1'),
    ).toBeInTheDocument();
  });

  it('„Einheit" ist die eine Primäraktion und führt auf die Einheiten-Seite', async () => {
    setup();
    const kopf = await waitFor(() => {
      const k = document.querySelector('[data-lfh="seitenkopf-aktionen"]') as HTMLElement;
      expect(k).not.toBeNull();
      return k;
    });
    const knopf = within(kopf).getByRole('button', { name: /Einheit/ });
    // Genau eine Primäraktion im Kopf (LFH-340 · C5).
    expect(kopf.querySelectorAll('.ant-btn-primary')).toHaveLength(1);
    expect(knopf).toHaveClass('ant-btn-primary');
    fireEvent.click(knopf);
    expect(navigiere).toHaveBeenCalledWith('/einsaetze/1/einheiten');
    // Der Abschnitt-Filter sitzt sekundär daneben.
    expect(within(kopf).getByRole('combobox', { name: 'Abschnitt filtern' })).toBeInTheDocument();
  });

  it('ohne Schreibrecht KEIN „Einheit"-Knopf und keine Lagebericht-Übernahme', async () => {
    vi.mocked(ladeEinsatz).mockResolvedValue({
      ...EINSATZ,
      meine_rolle: 'beobachter',
    } as EinsatzAnzeige);
    setup();
    await screen.findByRole('button', { name: /Drucken/i });
    expect(screen.queryByRole('button', { name: /^Einheit/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /In Lagebericht übernehmen/i })).toBeNull();
  });
});

describe('meldebildMeta', () => {
  it('nennt ungefiltert Einheitenzahl und Gesamtstärke', () => {
    expect(
      meldebildMeta({
        einheiten: 7,
        einheitenGesamt: 7,
        staerke: '2/3/10//15',
        staerkeGesamt: '2/3/10//15',
        gefiltert: false,
      }),
    ).toBe('7 Einheiten · Stärke 2/3/10//15');
  });

  it('nennt gefiltert den Ausschnitt UND den Bezugswert (H3)', () => {
    expect(
      meldebildMeta({
        einheiten: 3,
        einheitenGesamt: 7,
        staerke: '1/0/5//6',
        staerkeGesamt: '2/3/10//15',
        gefiltert: true,
      }),
    ).toBe('3 von 7 Einheiten · Stärke 1/0/5//6 von 2/3/10//15');
  });
});

describe('KraefteuebersichtPage — Statusband', () => {
  it('zählt Einheiten je FMS-Status mit Code, Zahl und Wort (LFH-609)', async () => {
    mitEinheit();
    const { container } = setup();
    const zelle = await waitFor(() => {
      const z = container.querySelector(
        '[aria-label="Einheiten je Status"] [data-lfh="kennzahl"]',
      ) as HTMLElement;
      expect(z).not.toBeNull();
      return z;
    });
    expect(zelle).toHaveTextContent('S4');
    expect(zelle).toHaveTextContent('1');
    expect(zelle).toHaveTextContent('Am Einsatzort');
    // Ton aus der Kategorie (gebunden → achtung), nicht aus dem Anker.
    expect(zelle).toHaveAttribute('data-ton', 'achtung');
  });

  it('führt die Personalverteilung als eigene Zellen', async () => {
    vi.mocked(listeEinsatzPersonal).mockResolvedValue([PERSON_P1]);
    setup();
    const gruppe = await screen.findByRole('region', { name: 'Personal je Status' });
    expect(within(gruppe).getByText('gebunden')).toBeInTheDocument();
  });

  it('zeigt „keine Rückmeldung" NICHT — dafür gibt es keine Daten (LFH-610)', async () => {
    mitEinheit();
    setup();
    await screen.findAllByText('Am Einsatzort');
    expect(screen.queryByText(/keine Rückmeldung/i)).toBeNull();
  });

  it('meldet einen gescheiterten Abruf als „Stand unbekannt", nicht als Null', async () => {
    vi.mocked(listeEinsatzFahrzeuge).mockRejectedValue(new Error('kaputt'));
    setup();
    expect((await screen.findAllByText('Stand unbekannt')).length).toBeGreaterThan(0);
  });
});

describe('KraefteuebersichtPage — Raster', () => {
  it('eine Zeile je Einheit mit Abschnitt, Stärke und Funkrufname; Mittel sind zugeklappt', async () => {
    mitEinheit();
    vi.mocked(listeEinheiten).mockResolvedValue([
      {
        ...EINHEIT_E10,
        fahrzeug_mitglieder: [{ ef_id: 30, funkrufname: 'FW 1/44-1', fahrzeugtyp: 'HLF 20' }],
      },
    ]);
    const { container } = setup();
    await screen.findByText('1. Zug');
    const e = zeile(container, 'eh-20')!;
    expect(within(e).getByText('Abschnitt Nord')).toBeInTheDocument();
    expect(within(e).getByText('0/0/0//0')).toBeInTheDocument();
    // Genau ein Fahrzeug → eindeutiger Rufname der Einheit.
    expect(within(e).getByText('FW 1/44-1')).toBeInTheDocument();
    // Die Mittelzeile ist Detail: zugeklappt.
    expect(zeile(container, 'ef-30')).toBeNull();
    // Der Abschnitt ist Spalte, keine Baumebene mehr.
    expect(zeile(container, 'ab-10')).toBeNull();
  });

  it('klappt die Mittel per Zeilenklick auf und zeigt den FMS-Chip', async () => {
    mitEinheit();
    const { container } = setup();
    fireEvent.click(await screen.findByText('1. Zug'));
    const mittel = await waitFor(() => {
      const m = zeile(container, 'ef-30');
      expect(m).not.toBeNull();
      return m!;
    });
    const chip = mittel.querySelector('[data-lfh="status-chip"]') as HTMLElement;
    expect(chip).toHaveTextContent('S4');
    expect(chip).toHaveTextContent('Am Einsatzort');
  });

  it('die Einheitenzeile trägt die verdichtete Verteilung bereit / gebunden / Ausfall — auch die 0', async () => {
    // Die Spalte „Mittel" steht ab `xl` (LFH-609), darunter im Spaltenschalter.
    setzeViewportBreite(1440);
    mitEinheit();
    const { container } = setup();
    await screen.findByText('1. Zug');
    const gruppe = within(zeile(container, 'eh-20')!).getByRole('group', {
      name: 'Fahrzeuge und Personal',
    });
    expect(within(gruppe).getByTitle('bereit')).toHaveTextContent('0');
    expect(within(gruppe).getByTitle('gebunden')).toHaveTextContent('1');
    expect(within(gruppe).getByTitle('Ausfall')).toHaveTextContent('0');
    // Eine 0 bekommt keinen Ton.
    expect(within(gruppe).getByTitle('Ausfall')).toHaveAttribute('data-ton', 'neutral');
  });

  it('tönt eine Einheit mit Ausfall als Problemzeile — mit der Ausfall-Zahl als zweitem Kanal', async () => {
    setzeViewportBreite(1440);
    vi.mocked(listeEinheiten).mockResolvedValue([
      EINHEIT_E10,
      { ...EINHEIT_E10, id: 21, name: '2. Zug' },
    ]);
    vi.mocked(listeEinsatzFahrzeuge).mockResolvedValue([
      { ...FAHRZEUG_F1, einheit_id: 21, status_id: 106, status_kategorie: 'nicht_verfuegbar' },
    ]);
    const { container } = setup();
    await screen.findByText('2. Zug');
    const problem = zeile(container, 'eh-21')!;
    expect(problem).toHaveClass('meldebild-problemzeile');
    expect(within(problem).getByTitle('Ausfall')).toHaveTextContent('1');
    expect(within(problem).getByTitle('Ausfall')).toHaveAttribute('data-ton', 'alarm');
    expect(zeile(container, 'eh-20')).not.toHaveClass('meldebild-problemzeile');
  });

  it('die Einheitenzeile trägt Status-Chip und „Seit" (LFH-609)', async () => {
    mitEinheit();
    const { container } = setup();
    await screen.findByText('1. Zug');
    const e = zeile(container, 'eh-20')!;
    const chip = e.querySelector('[data-lfh="status-chip"]') as HTMLElement;
    expect(chip).toHaveTextContent('S4');
    expect(chip).toHaveTextContent('Am Einsatzort');
    // Mit Fahrzeug führen die Fahrzeuge — kein Handstatus-Auslöser.
    expect(within(e).queryByRole('button', { name: /Status/ })).toBeNull();
  });

  it('eine Einheit OHNE Fahrzeug trägt mit Schreibrecht den Handstatus-Auslöser und setzt ihn', async () => {
    vi.mocked(listeEinheiten).mockResolvedValue([{ ...EINHEIT_E10, name: 'Fachberater' }]);
    vi.mocked(setzeEinheitStatus).mockResolvedValue({ ...EINHEIT_E10 });
    const { container } = setup();
    await screen.findByText('Fachberater');
    const e = zeile(container, 'eh-20')!;
    const ausloeser = await within(e).findByRole('button', { name: /Fachberater/ });
    fireEvent.click(ausloeser);
    const menue = await waitFor(() => {
      const m = document.querySelector(
        '.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]',
      ) as HTMLElement | null;
      expect(m).not.toBeNull();
      return m!;
    });
    fireEvent.click(within(menue).getByText(/S2 · Frei auf Wache/));
    await waitFor(() => expect(setzeEinheitStatus).toHaveBeenCalledWith(1, 20, 102));
  });

  it('zeigt den jüngsten offenen Auftrag der Einheit als Deeplink', async () => {
    mitEinheit();
    vi.mocked(listeAuftraege).mockResolvedValue([AUFTRAG_A3]);
    const { container } = setup();
    const link = await within(
      await waitFor(() => {
        const z = zeile(container, 'eh-20');
        expect(z).not.toBeNull();
        return z!;
      }),
    ).findByRole('link', { name: /Deichsicherung/ });
    expect(link).toHaveTextContent('Nr. 3 · Deichsicherung km 3,8 – 4,6');
    expect(link).toHaveAttribute('href', '/einsaetze/1/auftraege?auftrag=3');
  });

  it('ein gescheiterter Auftragsabruf nimmt nicht die Tabelle, die Zelle sagt „?"', async () => {
    mitEinheit();
    vi.mocked(listeAuftraege).mockRejectedValue(new Error('403'));
    const { container } = setup();
    await screen.findByText('1. Zug');
    await waitFor(() =>
      expect(
        within(zeile(container, 'eh-20')!).getByTitle('Aufträge nicht abrufbar'),
      ).toBeInTheDocument(),
    );
  });

  it('eine Rolle ohne Auftragsrecht (403) sieht „—", nicht die Störungsmarke', async () => {
    mitEinheit();
    vi.mocked(listeAuftraege).mockRejectedValue(new ApiError(403, 'verboten'));
    const { container } = setup();
    await screen.findByText('1. Zug');
    const e = await waitFor(() => {
      const z = zeile(container, 'eh-20')!;
      expect(within(z).getByTitle('Aufträge für diese Rolle nicht einsehbar')).toBeInTheDocument();
      return z;
    });
    expect(within(e).queryByTitle('Aufträge nicht abrufbar')).toBeNull();
  });

  it('der Abschnitt bleibt auch schmal sichtbar — er ist die Gliederung (kein abBreite)', async () => {
    setzeViewportBreite(390);
    mitEinheit();
    const { container } = setup();
    await screen.findByText('1. Zug');
    expect(within(zeile(container, 'eh-20')!).getByText('Abschnitt Nord')).toBeInTheDocument();
  });

  it('sammelt Kräfte ohne Einheit in „Ohne Einheit" — keine Kraft verschwindet', async () => {
    vi.mocked(listeEinsatzPersonal).mockResolvedValue([PERSON_P1]);
    const { container } = setup();
    await screen.findByText('Ohne Einheit');
    fireEvent.click(screen.getByText('Ohne Einheit'));
    await waitFor(() => expect(zeile(container, 'ep-1')).not.toBeNull());
  });

  it('Leerzustand mit Aktion', async () => {
    setup();
    expect(await screen.findByRole('link', { name: 'Einheit bilden' })).toHaveAttribute(
      'href',
      '/einsaetze/1/einheiten',
    );
  });

  it('bleibt AUCH bei 390 px eine Tabelle (Kriterium 14)', async () => {
    setzeViewportBreite(390);
    mitEinheit();
    const { container } = setup();
    await screen.findByText('1. Zug');
    expect(container.querySelector('.ant-table')).not.toBeNull();
    expect(container.querySelector('[data-lfh="datensicht-karte"]')).toBeNull();
  });

  it('die Problemtönung liegt als Regel an der Zelle und liest die Rolle', () => {
    const hier = dirname(fileURLToPath(import.meta.url));
    const css = readFileSync(join(hier, 'kraefteuebersichtPrint.css'), 'utf-8');
    const schirm = css.slice(0, css.indexOf('@media print'));
    expect(schirm).toMatch(
      /tr\.meldebild-problemzeile\s*>\s*td\s*\{[^}]*background-color:\s*var\(--lfh-problem-zeile\)/,
    );
  });
});

describe('KraefteuebersichtPage — Aufklappen', () => {
  it('„Mit Mitteln" klappt alle auf, „Nur Einheiten" wieder zu', async () => {
    mitEinheit();
    setup();
    await screen.findByText('1. Zug');
    fireEvent.click(screen.getByText('Mit Mitteln'));
    expect(await screen.findByText('HLF 20')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Nur Einheiten'));
    await waitFor(() => expect(screen.queryByText('HLF 20')).toBeNull());
    expect(screen.getByText('1. Zug')).toBeInTheDocument();
  });

  it('klappt nach dem Zuklappen EINER Zeile über „Mit Mitteln" wieder vollständig auf', async () => {
    mitEinheit();
    vi.mocked(listeEinsatzPersonal).mockResolvedValue([PERSON_P1]);
    setup();
    await screen.findByText('1. Zug');
    fireEvent.click(screen.getByText('Mit Mitteln'));
    await screen.findByText('HLF 20');

    fireEvent.click(screen.getByText('1. Zug'));
    await waitFor(() => expect(screen.queryByText('HLF 20')).toBeNull());
    // „Ohne Einheit" steht noch offen — die Liste ist also nicht leer, aber unvollständig.
    expect(screen.getByText('P1')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Mit Mitteln'));
    expect(await screen.findByText('HLF 20')).toBeInTheDocument();
  });
});

describe('KraefteuebersichtPage — Werkzeugzeile', () => {
  it('trägt Trägerorganisation-Filter und Druck', async () => {
    setup();
    expect(await screen.findByText('Trägerorganisation')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Drucken/i })).toBeInTheDocument();
  });

  it('ruft legeLageberichtAn und aktualisiereLagebericht beim Klick auf Übernahme-Button auf', async () => {
    setup();
    const btn = await screen.findByRole('button', { name: /In Lagebericht übernehmen/i });
    fireEvent.click(btn);
    await waitFor(() =>
      expect(vi.mocked(legeLageberichtAn)).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ vorlage: 'freitext' }),
      ),
    );
    await waitFor(() =>
      expect(vi.mocked(aktualisiereLagebericht)).toHaveBeenCalledWith(
        1,
        99,
        expect.objectContaining({
          abschnitte: expect.arrayContaining([expect.objectContaining({ schluessel: 'text' })]),
        }),
      ),
    );
  });

  it('die Statusfilter-Optionen kommen aus der einen Statusachse — ohne den vierten Eimer', async () => {
    const { container } = setup();
    await screen.findByText('Trägerorganisation');
    // Auf die Werkzeugzeile scopen: „Status" ist auch ein Spaltenkopf.
    const leiste = container.querySelector('[data-lfh="meldebild-werkzeuge"]') as HTMLElement;
    expect(leiste, 'Werkzeugzeile nicht gefunden').not.toBeNull();
    const statusFilter = [...leiste.querySelectorAll('.ant-select')].find((s) =>
      s.textContent?.includes('Status'),
    );
    expect(statusFilter, 'Status-Select nicht gefunden').not.toBeUndefined();
    fireEvent.mouseDown(statusFilter!.querySelector('.ant-select-content')!);
    const optionen = await waitFor(() => {
      const treffer = document.querySelectorAll('.ant-select-item-option-content');
      expect(treffer.length).toBeGreaterThan(0);
      return [...treffer].map((o) => o.textContent);
    });
    expect(optionen).toEqual(['verfügbar', 'gebunden', 'nicht verfügbar']);
  });
});

describe('KraefteuebersichtPage — Druck', () => {
  it('Drucken klappt alle Mittel auf und druckt genau einmal', async () => {
    // Das Raster startet zugeklappt — „Drucken klappt auf" ist hier also nicht trivial.
    mitEinheit();
    setup();
    await screen.findByText('1. Zug');
    expect(screen.queryByText('HLF 20')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Drucken/i }));

    expect(await screen.findByText('HLF 20')).toBeInTheDocument();
    await waitFor(() => expect(drucke).toHaveBeenCalledTimes(1));
  });

  it('„Drucken" bleibt AUSSERHALB der Werkzeugzeile des Primitivs', async () => {
    // `.kraefte-no-print` ist innerhalb von `Datensicht` nicht setzbar (kein `className`).
    mitEinheit();
    const { container } = setup();
    await screen.findByText('1. Zug');
    const werkzeuge = container.querySelector('[data-lfh="datensicht-werkzeuge"]') as HTMLElement;
    expect(werkzeuge).not.toBeNull();
    expect(within(werkzeuge).queryByRole('button', { name: /Drucken/i })).toBeNull();
    expect(within(werkzeuge).getByRole('button', { name: /Spalten/ })).toBeInTheDocument();
  });

  it('der Druck neutralisiert Bildlaufcontainer, Sticky-Kopf, fixierte Spalte und Werkzeugzeile', () => {
    // jsdom rechnet kein `@media print` — bewusst eine TEXT-Prüfung der Regeldatei, als
    // reguläre Ausdrücke (Quote-Stil ist Formatierung, keine Aussage; Lehre aus LFH-354).
    const hier = dirname(fileURLToPath(import.meta.url));
    const css = readFileSync(join(hier, 'kraefteuebersichtPrint.css'), 'utf-8');
    const druckblock = css.slice(css.indexOf('@media print'));
    for (const marke of [
      /\.ant-table-body\b/,
      /\.ant-table-sticky-holder\b/,
      /\.ant-table-cell-fix-start\b/,
      /\[data-lfh=['"]datensicht-werkzeuge['"]\]/,
    ]) {
      expect(druckblock, `Druckregel für ${marke} fehlt`).toMatch(marke);
    }
    expect(druckblock).toMatch(/overflow:\s*visible\s*!important/);
  });

  it('trägt Einsatzbezeichnung, taktischen Zeitstand, Ersteller und die Meta-Zeile', async () => {
    mitEinheit();
    setup();
    const kopf = await screen.findByTestId('kraefte-druckkopf');
    expect(within(kopf).getByText(/Meldebild — Testeinsatz/)).toBeInTheDocument();
    expect(within(kopf).getByText(/Stand: \d{6}[A-ZÄÖÜ]{3}\d{4}/)).toBeInTheDocument();
    expect(within(kopf).getByText(/Erstellt von:/)).toBeInTheDocument();
    expect(await within(kopf).findByText(/Einheit · Stärke/)).toBeInTheDocument();
  });

  it('nennt die Auswahl im Druckkopf, sobald gefiltert wird — und sonst nicht', async () => {
    mitEinheit();
    setup();
    const kopf = await screen.findByTestId('kraefte-druckkopf');
    expect(within(kopf).queryByText(/^Auswahl:/)).toBeNull();

    await waehleAbschnitt('Abschnitt Nord');

    expect(await within(kopf).findByText('Auswahl: Abschnitt: Abschnitt Nord')).toBeInTheDocument();
  });

  it('verbirgt den Druckkopf am Schirm und wiederholt im Druck die Spaltenköpfe', () => {
    const hier = dirname(fileURLToPath(import.meta.url));
    const css = readFileSync(join(hier, 'kraefteuebersichtPrint.css'), 'utf-8');
    const druckblock = css.slice(css.indexOf('@media print'));
    const schirmblock = css.slice(0, css.indexOf('@media print'));
    expect(schirmblock).toMatch(/\.kraefte-nur-print\s*\{[^}]*display:\s*none/);
    expect(druckblock).toMatch(/\.kraefte-nur-print\s*\{[^}]*display:\s*block/);
    expect(druckblock).toMatch(/thead\s*\{[^}]*display:\s*table-header-group/);
    expect(druckblock).toMatch(/tr\s*\{[^}]*break-inside:\s*avoid/);
  });
});

/**
 * ── FILTERWAHRHEIT (LFH-338 · C3, Befund H3) ────────────────────────────────────
 *
 * Wer kurz weggeht und dann abliest, darf die Teilstärke eines Abschnitts nicht für die
 * Gesamtstärke halten. Der Abschnitt-Filter sitzt seit dem Neuentwurf im Seitenkopf und
 * trägt einen zugänglichen Namen.
 */
async function waehleAbschnitt(name: string) {
  fireEvent.mouseDown(await screen.findByRole('combobox', { name: 'Abschnitt filtern' }));
  fireEvent.click(await screen.findByTitle(name));
}

describe('KraefteuebersichtPage — Filterwahrheit', () => {
  it('das Meta nennt mit Filter den Ausschnitt und die ungefilterte Stärke als Bezugswert', async () => {
    mitEinheit();
    vi.mocked(listeEinsatzPersonal).mockResolvedValue([PERSON_P1]); // 0/0/1//1, ohne Einheit
    setup();
    expect(
      await (await seitenkopf()).findByText('1 Einheit · Stärke 0/0/1//1'),
    ).toBeInTheDocument();

    await waehleAbschnitt('Abschnitt Nord');

    // Gefiltert bleibt keine Person übrig — der Bezugswert steht trotzdem da.
    expect(
      await (await seitenkopf()).findByText('1 von 1 Einheit · Stärke 0/0/0//0 von 0/0/1//1'),
    ).toBeInTheDocument();
  });

  it('zeigt „X von Y Kräften" und setzt mit einem Klick alle Filter zurück', async () => {
    // P1 hängt an KEINER Einheit, F1 an Einheit 20 (Abschnitt Nord).
    mitEinheit();
    vi.mocked(listeEinsatzPersonal).mockResolvedValue([PERSON_P1]);
    setup();

    expect(await screen.findByText('2 von 2 Kräften')).toBeInTheDocument();
    await waehleAbschnitt('Abschnitt Nord');
    expect(await screen.findByText('1 von 2 Kräften')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Filter zurücksetzen' }));
    expect(await screen.findByText('2 von 2 Kräften')).toBeInTheDocument();
    expect((await seitenkopf()).getByText('1 Einheit · Stärke 0/0/1//1')).toBeInTheDocument();
  });

  it('zeigt den gesetzten Filter als schließbare Marke, die genau ihn zurücknimmt', async () => {
    mitEinheit();
    vi.mocked(listeEinsatzPersonal).mockResolvedValue([PERSON_P1]);
    setup();
    await screen.findByText('2 von 2 Kräften');

    await waehleAbschnitt('Abschnitt Nord');
    const marke = await screen.findByText('Abschnitt: Abschnitt Nord');
    fireEvent.click(marke.closest('.ant-tag')!.querySelector('.ant-tag-close-icon')!);
    expect(await screen.findByText('2 von 2 Kräften')).toBeInTheDocument();
    expect(screen.queryByText('Abschnitt: Abschnitt Nord')).toBeNull();
  });
});

describe('aktiveFilterChips', () => {
  const name = () => 'Abschnitt Nord';

  it('ist leer, solange nichts gesetzt ist', () => {
    expect(aktiveFilterChips(LEERER_FILTER, name)).toEqual([]);
  });

  it('führt jeden gesetzten Filter mit sprechendem Etikett, in fester Reihenfolge', () => {
    const chips = aktiveFilterChips(
      { abschnittId: 10, traeger: 'FF Musterstadt', kategorie: 'verfuegbar', suche: '  HLF  ' },
      name,
    );
    expect(chips.map((c) => c.label)).toEqual([
      'Abschnitt: Abschnitt Nord',
      'Träger: FF Musterstadt',
      'Status: verfügbar',
      'Suche: „HLF"',
    ]);
    expect(chips.map((c) => c.schluessel)).toEqual([
      'abschnittId',
      'traeger',
      'kategorie',
      'suche',
    ]);
  });

  it('wertet eine Suche aus lauter Leerzeichen NICHT als gesetzten Filter', () => {
    expect(aktiveFilterChips({ ...LEERER_FILTER, suche: '   ' }, name)).toEqual([]);
  });
});

describe('KraefteuebersichtPage — Quelltext', () => {
  it('trägt weder flexWrap: nowrap noch einen internen Horizontalscroll (Befund H6)', () => {
    const hier = dirname(fileURLToPath(import.meta.url));
    const quelle = readFileSync(join(hier, 'KraefteuebersichtPage.tsx'), 'utf-8');
    expect(quelle).not.toMatch(/flexWrap:\s*'nowrap'/);
    expect(quelle).not.toMatch(/overflowX:\s*'auto'/);
  });
});
