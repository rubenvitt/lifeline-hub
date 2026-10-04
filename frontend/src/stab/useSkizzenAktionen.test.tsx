import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ApiError } from '../api/client';
import {
  entferneKomponente,
  legeSkizzenVerbindungAn,
  loeseSprechgruppe,
  ordneSprechgruppeZu,
  setzeSchriftfeld,
  setzeSkizzenLage,
  verwerfeSkizzenLage,
} from '../api/fernmeldeskizze';
import { patcheAbschnitt } from '../api/einsatzabschnitte';
import { patcheEinheit } from '../api/einheiten';
import { patcheFuehrungsstelle } from '../api/einsaetze';
import { legeKommunikationsStelleAn } from '../api/kommunikationsplan';
import type {
  EinsatzAnzeige,
  Fernmeldeskizze,
  Fuehrungsstelle,
  KommunikationsStelle,
  SkizzenVerbindung,
} from '../api/types';
import { freigabenFixture } from '../test/fixtures';
import { skizzenRechte, useSkizzenAktionen } from './useSkizzenAktionen';

vi.mock('../api/fernmeldeskizze', () => ({
  ladeFernmeldeskizze: vi.fn(),
  setzeSkizzenLage: vi.fn(),
  verwerfeSkizzenLage: vi.fn(),
  setzeSchriftfeld: vi.fn(),
  legeKomponenteAn: vi.fn(),
  aendereKomponente: vi.fn(),
  entferneKomponente: vi.fn(),
  legeSkizzenVerbindungAn: vi.fn(),
  aendereSkizzenVerbindung: vi.fn(),
  entferneSkizzenVerbindung: vi.fn(),
  legeBereichAn: vi.fn(),
  aendereBereich: vi.fn(),
  entferneBereich: vi.fn(),
  ordneSprechgruppeZu: vi.fn(),
  loeseSprechgruppe: vi.fn(),
}));
vi.mock('../api/einsatzabschnitte', () => ({ patcheAbschnitt: vi.fn() }));
vi.mock('../api/einheiten', () => ({ patcheEinheit: vi.fn() }));
vi.mock('../api/einsaetze', () => ({ patcheFuehrungsstelle: vi.fn() }));
vi.mock('../api/kommunikationsplan', () => ({ legeKommunikationsStelleAn: vi.fn() }));

/** Literale statt Factory (Charakterisierung, `frontend/AGENTS.md` Query-Key-Registry). */
const SKIZZE_KEY = ['einsatz-stab', 7, 'fernmeldeskizze'];
const PLAN_KEY = ['einsatz-stab', 7, 'kommunikationsplan'];
const ABSCHNITTE_KEY = ['einsatz-abschnitte', 7];
const EINHEITEN_KEY = ['einsatz-einheiten', 7];
const FS_KEY = ['einsatz-fuehrungsstelle', 7];

const SKIZZE: Fernmeldeskizze = {
  lage: [{ element: 'ab-3', x: 0, y: 0, breite: null, version: 1 }],
  komponenten: [{ id: 2, art: 'repeater', bezeichnung: null, sprechgruppen: [] }],
  verbindungen: [],
  bereiche: [],
  schriftfeld: {
    herausgeber: null,
    vs_vermerk: 'keiner',
    gueltig_ab: null,
    gez_name: null,
    gez_at: null,
  },
  stand: null,
};

let qc: QueryClient;

function setup(darfSchreiben = true) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return renderHook(() => useSkizzenAktionen(7, darfSchreiben), { wrapper }).result;
}

/** Ein Key gilt als invalidiert, wenn sein Eintrag danach `isInvalidated` trägt. */
function invalidiert(key: unknown[]): boolean {
  return qc.getQueryState(key)?.isInvalidated === true;
}

beforeEach(() => {
  qc = new QueryClient();
  qc.setQueryData(SKIZZE_KEY, SKIZZE);
  for (const k of [PLAN_KEY, ABSCHNITTE_KEY, EINHEITEN_KEY]) qc.setQueryData(k, []);
  qc.setQueryData(FS_KEY, { rufname: null, sprechgruppen: [] });
  vi.clearAllMocks();
});

describe('useSkizzenAktionen — Recht', () => {
  it('gibt ohne Schreibrecht im Einsatz keine Aktionen (Fläche schreibgeschützt, D8)', () => {
    expect(setup(false).current).toBeNull();
    expect(setup(true).current).not.toBeNull();
  });
});

describe('useSkizzenAktionen — Zuordnen und Lösen (D5)', () => {
  it('ordnet am Datensatz der Stelle zu und invalidiert dessen Liste', async () => {
    vi.mocked(ordneSprechgruppeZu).mockResolvedValue(undefined);
    vi.mocked(loeseSprechgruppe).mockResolvedValue(undefined);
    const a = setup().current!;
    await a.ordneZu('ab-3', 31);
    expect(ordneSprechgruppeZu).toHaveBeenLastCalledWith(
      7,
      { art: 'abschnitt', id: 3 },
      31,
      undefined,
    );
    expect(invalidiert(ABSCHNITTE_KEY)).toBe(true);
    expect(invalidiert(EINHEITEN_KEY)).toBe(false);

    await a.loese('eh-10', 31);
    expect(loeseSprechgruppe).toHaveBeenLastCalledWith(7, { art: 'einheit', id: 10 }, 31);
    expect(invalidiert(EINHEITEN_KEY)).toBe(true);

    await a.ordneZu('fs', 31);
    expect(ordneSprechgruppeZu).toHaveBeenLastCalledWith(
      7,
      { art: 'fuehrungsstelle' },
      31,
      undefined,
    );
    expect(invalidiert(FS_KEY)).toBe(true);
  });

  it('gibt einer externen Stelle den Status mit und invalidiert den Kommunikationsplan', async () => {
    vi.mocked(ordneSprechgruppeZu).mockResolvedValue(undefined);
    await setup().current!.ordneZu('ks-5', 31, 'geplant');
    expect(ordneSprechgruppeZu).toHaveBeenLastCalledWith(
      7,
      { art: 'stelle', id: 5 },
      31,
      'geplant',
    );
    expect(invalidiert(PLAN_KEY)).toBe(true);
  });

  it('ordnet eine Komponente zu und invalidiert die Skizzendaten', async () => {
    vi.mocked(ordneSprechgruppeZu).mockResolvedValue(undefined);
    await setup().current!.ordneZu('ko-2', 31);
    expect(ordneSprechgruppeZu).toHaveBeenLastCalledWith(
      7,
      { art: 'komponente', id: 2 },
      31,
      undefined,
    );
    expect(invalidiert(SKIZZE_KEY)).toBe(true);
  });

  it('lehnt einen unbekannten Schlüssel ab, ohne zu senden', async () => {
    await expect(setup().current!.ordneZu('sg-4', 31)).rejects.toThrow();
    expect(ordneSprechgruppeZu).not.toHaveBeenCalled();
  });
});

describe('useSkizzenAktionen — Skizzendaten', () => {
  it('übernimmt die gespeicherte Lage in den Cache', async () => {
    vi.mocked(setzeSkizzenLage).mockResolvedValue({
      element: 'ab-3',
      x: 16,
      y: 8,
      breite: null,
      version: 2,
    });
    const lage = await setup().current!.verschiebe('ab-3', { x: 16, y: 8 }, 1);
    expect(setzeSkizzenLage).toHaveBeenCalledWith(7, 'ab-3', { x: 16, y: 8, version: 1 });
    expect(lage.version).toBe(2);
    expect(qc.getQueryData<Fernmeldeskizze>(SKIZZE_KEY)!.lage).toEqual([
      { element: 'ab-3', x: 16, y: 8, breite: null, version: 2 },
    ]);
  });

  it('holt bei 409 den Stand des Servers und reicht den Fehler weiter (D4)', async () => {
    vi.mocked(setzeSkizzenLage).mockRejectedValue(new ApiError(409, 'verschoben'));
    await expect(setup().current!.verschiebe('ab-3', { x: 1, y: 1 }, 1)).rejects.toMatchObject({
      status: 409,
    });
    expect(invalidiert(SKIZZE_KEY)).toBe(true);
  });

  it('verwirft beim Neu-Anordnen alle Lagen', async () => {
    vi.mocked(verwerfeSkizzenLage).mockResolvedValue(undefined);
    await setup().current!.neuAnordnen();
    expect(qc.getQueryData<Fernmeldeskizze>(SKIZZE_KEY)!.lage).toEqual([]);
  });

  it('hängt eine neue Verbindung an und setzt das Schriftfeld', async () => {
    const v: SkizzenVerbindung = {
      id: 9,
      von: { art: 'fuehrungsstelle', id: null },
      nach: { art: 'stelle', id: 5 },
      art: 'daten',
      medium: 'leitung',
      status: 'geplant',
      verkehr: null,
      hinweis: null,
    };
    vi.mocked(legeSkizzenVerbindungAn).mockResolvedValue(v);
    vi.mocked(setzeSchriftfeld).mockResolvedValue({ ...SKIZZE.schriftfeld, gez_name: 'S6' });
    const a = setup().current!;
    await a.legeVerbindungAn(v.von, v.nach, { art: 'daten', medium: 'leitung', status: 'geplant' });
    expect(legeSkizzenVerbindungAn).toHaveBeenCalledWith(7, {
      von: v.von,
      nach: v.nach,
      art: 'daten',
      medium: 'leitung',
      status: 'geplant',
    });
    await a.setzeSchriftfeld({ gez_name: 'S6' });
    const neu = qc.getQueryData<Fernmeldeskizze>(SKIZZE_KEY)!;
    expect(neu.verbindungen).toEqual([v]);
    expect(neu.schriftfeld.gez_name).toBe('S6');
  });

  it('entfernt eine Komponente und holt Lage und Verbindungen neu (der Server räumt mit)', async () => {
    vi.mocked(entferneKomponente).mockResolvedValue(undefined);
    await setup().current!.entferneKomponente(2);
    expect(entferneKomponente).toHaveBeenCalledWith(7, 2);
    expect(qc.getQueryData<Fernmeldeskizze>(SKIZZE_KEY)!.komponenten).toEqual([]);
    expect(invalidiert(SKIZZE_KEY)).toBe(true);
  });
});

describe('useSkizzenAktionen — Datensatz der Stelle', () => {
  it('schreibt Rufname und Kommunikationsmittel über den PATCH des Datensatzes', async () => {
    vi.mocked(patcheAbschnitt).mockResolvedValue({} as never);
    vi.mocked(patcheEinheit).mockResolvedValue({} as never);
    const fs = { rufname: 'Florian Kreis 1', sprechgruppen: [] } as unknown as Fuehrungsstelle;
    vi.mocked(patcheFuehrungsstelle).mockResolvedValue(fs);
    const a = setup().current!;
    await a.setzeRufname('ab-3', 'EA N');
    expect(patcheAbschnitt).toHaveBeenCalledWith(7, 3, { kurzbezeichnung: 'EA N' });
    expect(invalidiert(ABSCHNITTE_KEY)).toBe(true);
    await a.setzeRufname('eh-10', null);
    expect(patcheEinheit).toHaveBeenCalledWith(7, 10, { funkrufname: null });
    await a.setzeKommunikationsmittel('eh-10', 'digitalfunk');
    expect(patcheEinheit).toHaveBeenLastCalledWith(7, 10, { kommunikationsmittel: 'digitalfunk' });
    expect(invalidiert(EINHEITEN_KEY)).toBe(true);
    await a.setzeRufname('fs', 'Florian Kreis 1');
    expect(patcheFuehrungsstelle).toHaveBeenCalledWith(7, { rufname: 'Florian Kreis 1' });
    expect(qc.getQueryData(FS_KEY)).toEqual(fs);
  });

  it('kennt keinen Rufnamen an einer externen Stelle', async () => {
    await expect(setup().current!.setzeRufname('ks-5', 'x')).rejects.toThrow();
  });

  it('legt eine externe Stelle im Kommunikationsplan an und gibt sie zurück (D3)', async () => {
    const alt: KommunikationsStelle = {
      id: 1,
      stellenart: 'behoerde',
      bezeichnung: 'Polizei',
      verbindungen: [],
      sprechgruppen: [],
    };
    const ils: KommunikationsStelle = {
      id: 4,
      stellenart: 'leitstelle',
      bezeichnung: 'ILS Musterhausen',
      verbindungen: [],
      sprechgruppen: [],
    };
    qc.setQueryData(PLAN_KEY, [alt]);
    vi.mocked(legeKommunikationsStelleAn).mockResolvedValue([ils, alt]);
    const neu = await setup().current!.legeExterneStelleAn('leitstelle', 'ILS Musterhausen');
    expect(legeKommunikationsStelleAn).toHaveBeenCalledWith(7, {
      stellenart: 'leitstelle',
      bezeichnung: 'ILS Musterhausen',
    });
    expect(neu).toBe(ils);
    expect(qc.getQueryData(PLAN_KEY)).toEqual([ils, alt]);
  });
});

describe('skizzenRechte (D5, D8)', () => {
  const aktiv = { status: 'aktiv', meine_rolle: 'fuehrungspersonal' } as EinsatzAnzeige;

  it('leitet je Quelle das Recht aus Schreibrecht und Modulfreigabe ab', () => {
    expect(skizzenRechte(aktiv, null, freigabenFixture())).toEqual({
      einsatzabschnitte: true,
      einheiten: true,
      verwaltung: true,
      stab: true,
    });
  });

  it('nimmt einem gesperrten Modul sein Recht, die Führungsstelle hat kein Modul', () => {
    const freigaben = freigabenFixture();
    freigaben.einheiten = { ...freigaben.einheiten, zugriff: false };
    expect(skizzenRechte(aktiv, null, freigaben)).toEqual({
      einsatzabschnitte: true,
      einheiten: false,
      verwaltung: true,
      stab: true,
    });
  });

  it('gibt ohne Schreibrecht im Einsatz nichts frei', () => {
    const beobachter = { status: 'aktiv', meine_rolle: 'beobachter' } as EinsatzAnzeige;
    expect(skizzenRechte(beobachter, null, freigabenFixture())).toEqual({
      einsatzabschnitte: false,
      einheiten: false,
      verwaltung: false,
      stab: false,
    });
  });
});
