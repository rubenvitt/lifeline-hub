import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { ladeModulFreigaben } from '../api/einsaetze';
import { modulRegistry } from '../einsatz/modulRegistry';
import { MEDIENLAGE_QUELLE } from '../stab/medienlageQuelle';
import { freigabenFixture } from '../test/fixtures';
import { EIGENE_LAGE_QUELLE } from './eigeneLageUebernahme';
import { FUEHRUNGSPROBLEME_QUELLE } from './fuehrungsproblemeUebernahme';
import { LAGEENTWICKLUNG_QUELLE } from './lageentwicklungUebernahme';
import { SCHADENLAGE_QUELLE } from './schadenlageUebernahme';
import { loadAbschnittTexte, loadStartinhalt } from './startinhalt';
import type { UebernahmeQuelle } from './uebernahmeQuelle';

vi.mock('../api/einsaetze', () => ({ ladeModulFreigaben: vi.fn() }));

const dtg = (iso: string) => `DTG(${iso})`;
let qc: QueryClient;
const ctx = () => ({ qc, einsatzId: 7, dtg });

/** Eine Quelle am Modul `etb`, deren Text der Test vorgibt. */
function probe(text: string, modul = 'etb'): UebernahmeQuelle {
  return {
    knopf: `Aus ${text} übernehmen`,
    ersetzenTitel: `${text} ersetzen?`,
    ersetzenText: 'Vorhandener Text wird ersetzt.',
    verfuegbar: (f) =>
      f[modul]?.zugriff ? { frei: true } : { frei: false, grund: `${modul} nicht freigegeben` },
    erzeuge: vi.fn<UebernahmeQuelle['erzeuge']>().mockResolvedValue(`# ${text}`),
  };
}

/** Alle fünf Quellen des Lagevortrags zur Information, je mit fester Rückgabe. */
const QUELLEN = [
  ['gefahren_schadenlage', SCHADENLAGE_QUELLE],
  ['eigene_lage', EIGENE_LAGE_QUELLE],
  ['lageentwicklung', LAGEENTWICKLUNG_QUELLE],
  ['fuehrungsprobleme', FUEHRUNGSPROBLEME_QUELLE],
  ['medienlage', MEDIENLAGE_QUELLE],
] as const;

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.mocked(ladeModulFreigaben).mockReset();
  vi.mocked(ladeModulFreigaben).mockResolvedValue(freigabenFixture());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('loadAbschnittTexte (LLH-1081)', () => {
  it('liefert je Abschnitt den Text der Quelle, in der verlangten Reihenfolge', async () => {
    const a = probe('A');
    const b = probe('B');
    const texte = await loadAbschnittTexte({ a, b }, ['b', 'a'], ctx());
    expect(texte).toEqual([
      { schluessel: 'b', text: '# B' },
      { schluessel: 'a', text: '# A' },
    ]);
    // Dieselbe Quelle mit denselben Freigaben wie die Einzelübernahme: kein zweiter Weg.
    expect(a.erzeuge).toHaveBeenCalledWith({
      qc,
      einsatzId: 7,
      freigaben: freigabenFixture(),
      dtg,
    });
    expect(ladeModulFreigaben).toHaveBeenCalledWith(7);
  });

  it('lädt nur die verlangten Abschnitte', async () => {
    const a = probe('A');
    const b = probe('B');
    await loadAbschnittTexte({ a, b }, ['a'], ctx());
    expect(b.erzeuge).not.toHaveBeenCalled();
  });

  it('nennt eine gesperrte Quelle „— (Grund)“ und fragt sie nicht an', async () => {
    vi.mocked(ladeModulFreigaben).mockResolvedValue(freigabenFixture({ stab: { zugriff: false } }));
    const a = probe('A');
    const s = probe('S', 'stab');
    const texte = await loadAbschnittTexte({ a, s }, ['a', 's'], ctx());
    expect(texte).toEqual([
      { schluessel: 'a', text: '# A' },
      { schluessel: 's', text: '— (stab nicht freigegeben)' },
    ]);
    expect(s.erzeuge).not.toHaveBeenCalled();
  });

  it('sagt „— (Freigaben nicht ermittelbar)“ in jedem Abschnitt, ohne eine Quelle anzufragen', async () => {
    vi.mocked(ladeModulFreigaben).mockRejectedValue(new Error('Netz weg'));
    const a = probe('A');
    const b = probe('B');
    const texte = await loadAbschnittTexte({ a, b }, ['a', 'b'], ctx());
    expect(texte.map((t) => t.text)).toEqual([
      '— (Freigaben nicht ermittelbar)',
      '— (Freigaben nicht ermittelbar)',
    ]);
    expect(a.erzeuge).not.toHaveBeenCalled();
    expect(b.erzeuge).not.toHaveBeenCalled();
  });

  it('nennt eine Quelle, die scheitert, „— (nicht geladen)“; die übrigen bleiben', async () => {
    const a = probe('A');
    const b = probe('B');
    vi.mocked(a.erzeuge).mockRejectedValue(new Error('kaputt'));
    const texte = await loadAbschnittTexte({ a, b }, ['a', 'b'], ctx());
    expect(texte).toEqual([
      { schluessel: 'a', text: '— (nicht geladen)' },
      { schluessel: 'b', text: '# B' },
    ]);
  });

  it('übergeht einen Schlüssel ohne Quelle', async () => {
    const a = probe('A');
    expect(await loadAbschnittTexte({ a }, ['auftrag', 'a'], ctx())).toEqual([
      { schluessel: 'a', text: '# A' },
    ]);
  });
});

describe('loadStartinhalt (LLH-1081)', () => {
  it('füllt im Lagevortrag zur Information die fünf Abschnitte mit Quelle, in Vorlagenreihenfolge', async () => {
    for (const [schluessel, quelle] of QUELLEN) {
      vi.spyOn(quelle, 'erzeuge').mockResolvedValue(`Text ${schluessel}`);
    }
    const texte = await loadStartinhalt('lagebericht', ctx());
    expect(texte).toEqual(QUELLEN.map(([s]) => ({ schluessel: s, text: `Text ${s}` })));
  });

  it('lässt den Lagevortrag zur Entscheidung und den freien Bericht ohne Startinhalt', async () => {
    expect(await loadStartinhalt('lagebeurteilung', ctx())).toBeUndefined();
    expect(await loadStartinhalt('freitext', ctx())).toBeUndefined();
    expect(ladeModulFreigaben).not.toHaveBeenCalled();
  });

  /** Je Quelle ein Modul, ohne das sie für die Person ganz gesperrt ist. */
  it.each([
    ['gefahren_schadenlage', ['personen', 'schaeden', 'gefahrenzonen', 'wetter-pegel']],
    ['eigene_lage', ['einsatzabschnitte']],
    ['lageentwicklung', ['etb']],
    ['fuehrungsprobleme', ['auftraege', 'meldungen', 'fernmeldewesen']],
    ['medienlage', ['stab']],
  ])(
    '%s gesperrt: „— (Grund)“ ohne Zahl und ohne Abruf, die übrigen bleiben',
    async (gesperrt, module) => {
      vi.mocked(ladeModulFreigaben).mockResolvedValue(
        freigabenFixture(Object.fromEntries(module.map((m) => [m, { zugriff: false }]))),
      );
      const spione = QUELLEN.map(([s, q]) => [s, vi.spyOn(q, 'erzeuge')] as const);
      for (const [s, spion] of spione) spion.mockResolvedValue(`Text ${s}`);
      const texte = await loadStartinhalt('lagebericht', ctx());
      const text = texte!.find((t) => t.schluessel === gesperrt)!.text;
      expect(text).toMatch(/^— \(.+ nicht freigegeben.*\)$/);
      expect(text).not.toMatch(/\d/);
      for (const [s, spion] of spione) {
        if (s === gesperrt) expect(spion).not.toHaveBeenCalled();
        else expect(spion).toHaveBeenCalledTimes(1);
      }
      expect(texte).toHaveLength(5);
    },
  );

  it('ohne jede Freigabe: fünfmal „—“ mit Grund, keine Zahl, kein Abruf außer den Freigaben', async () => {
    const keine = freigabenFixture(
      Object.fromEntries(modulRegistry.map((m) => [m.key, { zugriff: false }])),
    );
    vi.mocked(ladeModulFreigaben).mockResolvedValue(keine);
    const abrufe = vi.spyOn(qc, 'fetchQuery');
    const texte = await loadStartinhalt('lagebericht', ctx());
    expect(texte).toHaveLength(5);
    for (const { text } of texte!) {
      expect(text).toMatch(/^— \(.+\)$/);
      expect(text).not.toMatch(/\d/);
    }
    expect(abrufe).toHaveBeenCalledTimes(1);
  });
});
