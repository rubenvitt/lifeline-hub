import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { listeAbschnitte } from '../api/einsatzabschnitte';
import { listeEinheiten } from '../api/einheiten';
import { listeEinsatzFahrzeuge } from '../api/einsatzFahrzeuge';
import { listeEinsatzMaterial } from '../api/einsatzMaterial';
import { listeEinsatzPersonal } from '../api/einsatzPersonal';
import { ladeStab } from '../api/stab';
import type {
  Einheit,
  EinsatzFahrzeug,
  EinsatzPersonal,
  Einsatzabschnitt,
  Stab,
  Stabsfunktion,
} from '../api/types';
import { baueKraeftebild, rendereMeldebildMarkdown } from '../kraefte/kraeftebild';
import {
  baueFuehrungsorganisation,
  rendereFuehrungsorganisationMarkdown,
} from '../pages/einsatzabschnitte/fuehrungsorganisation';
import { freigabenFixture } from '../test/fixtures';
import { EIGENE_LAGE_QUELLE } from './eigeneLageUebernahme';

vi.mock('../api/einsatzabschnitte', () => ({ listeAbschnitte: vi.fn() }));
vi.mock('../api/einheiten', () => ({ listeEinheiten: vi.fn() }));
vi.mock('../api/einsatzPersonal', () => ({ listeEinsatzPersonal: vi.fn() }));
vi.mock('../api/einsatzFahrzeuge', () => ({ listeEinsatzFahrzeuge: vi.fn() }));
vi.mock('../api/einsatzMaterial', () => ({ listeEinsatzMaterial: vi.fn() }));
vi.mock('../api/stab', () => ({ ladeStab: vi.fn() }));

const ABSCHNITTE = [
  {
    id: 1,
    einsatz_id: 1,
    ueber_abschnitt_id: null,
    name: 'EA Nord',
    sortier: 1,
    sprechgruppen: [],
  },
] as unknown as Einsatzabschnitt[];
const EINHEITEN = [
  {
    id: 10,
    einsatz_id: 1,
    abschnitt_id: 1,
    ueber_einheit_id: null,
    name: '1. Gruppe',
    typ_label: 'Gruppe',
    sortier: 1,
    sprechgruppen: [],
    personal_mitglieder: [],
    fahrzeug_mitglieder: [],
    material_mitglieder: [],
    ist: { fuehrer: 1, unterfuehrer: 0, mannschaft: 1 },
    ist_kumuliert: { fuehrer: 1, unterfuehrer: 0, mannschaft: 1 },
    status: { quelle: 'ohne', verteilung: [] },
  },
] as unknown as Einheit[];
const PERSONAL = [
  {
    id: 1,
    einsatz_id: 1,
    einheit_id: 10,
    name: 'Erika Muster',
    staerke_position: 'fuehrer',
    status_kategorie: 'gebunden',
  },
  {
    id: 2,
    einsatz_id: 1,
    einheit_id: 10,
    name: 'Max Muster',
    staerke_position: 'mannschaft',
    status_kategorie: 'gebunden',
  },
] as unknown as EinsatzPersonal[];
const FAHRZEUGE = [
  {
    id: 5,
    einsatz_id: 1,
    einheit_id: 10,
    funkrufname: 'Florian 1',
    fahrzeugtyp: 'LF',
    status_kategorie: 'verfuegbar',
    status_label: '2',
  },
] as unknown as EinsatzFahrzeug[];
const STAB = {
  besetzung: [
    { sachgebiet: 's1', besetzung_art: 'einsatzleitung', personal_noch_disponiert: false },
  ] as unknown as Stabsfunktion[],
} as unknown as Stab;

const STAND = 'STAND';
const dtg = () => STAND;

function erzeuge(freigaben = freigabenFixture()) {
  return EIGENE_LAGE_QUELLE.erzeuge({ qc: new QueryClient(), einsatzId: 1, freigaben, dtg });
}

beforeEach(() => {
  vi.mocked(listeAbschnitte).mockReset().mockResolvedValue(ABSCHNITTE);
  vi.mocked(listeEinheiten).mockReset().mockResolvedValue(EINHEITEN);
  vi.mocked(listeEinsatzPersonal).mockReset().mockResolvedValue(PERSONAL);
  vi.mocked(listeEinsatzFahrzeuge).mockReset().mockResolvedValue(FAHRZEUGE);
  vi.mocked(listeEinsatzMaterial).mockReset().mockResolvedValue([]);
  vi.mocked(ladeStab).mockReset().mockResolvedValue(STAB);
});

const MELDEBILD = () =>
  rendereMeldebildMarkdown(baueKraeftebild(ABSCHNITTE, EINHEITEN, PERSONAL, FAHRZEUGE, []), STAND);
const ORG = (
  opts: Partial<Parameters<typeof rendereFuehrungsorganisationMarkdown>[1]> = {},
  einheiten: Einheit[] | null = EINHEITEN,
) =>
  rendereFuehrungsorganisationMarkdown(baueFuehrungsorganisation(ABSCHNITTE, einheiten), {
    stand: STAND,
    stab: STAB.besetzung,
    einheitenZustand: 'daten',
    ...opts,
  });

describe('Eigene Lage aus Meldebild und Führungsorganisation (LFH-870)', () => {
  it('setzt beide Teile wörtlich wie die Einzelübernahme zusammen, Meldebild zuerst', async () => {
    const text = await erzeuge();
    expect(text).toBe(`${MELDEBILD()}\n${ORG()}`);
    // Freigegeben „mit Namen“ (Checkpoint LFH-870): die Kräftegliederung führt das Personal.
    expect(text).toContain('Erika Muster');
    expect(text).toContain('**Stand:** STAND');
  });

  it('führt ein Kräftemeldebild ohne Personal-Freigabe als „—“ mit Grund, nie als 0', async () => {
    const text = await erzeuge(freigabenFixture({ personal: { zugriff: false } }));
    expect(listeEinsatzPersonal).not.toHaveBeenCalled();
    expect(text).toBe(`# Kräftemeldebild\n\n— nicht freigegeben (Personal)\n\n${ORG()}`);
  });

  it('nennt eine Liste, die beim Klick scheitert, mit ihrem Grund', async () => {
    vi.mocked(listeEinsatzMaterial).mockRejectedValue(new Error('500'));
    vi.mocked(listeEinsatzFahrzeuge).mockRejectedValue(new ApiError(403, 'verboten'));
    const text = await erzeuge();
    expect(
      text.startsWith(
        '# Kräftemeldebild\n\n— nicht freigegeben (Fahrzeuge); nicht geladen (Material)\n',
      ),
    ).toBe(true);
  });

  it('macht beide Teile zu „—“, wenn die Abschnitte nicht laden', async () => {
    vi.mocked(listeAbschnitte).mockRejectedValue(new Error('500'));
    const text = await erzeuge();
    expect(text).toBe(
      '# Kräftemeldebild\n\n— nicht geladen (Abschnitte)\n\n' +
        '# Führungsorganisation\n\n— nicht geladen (Abschnitte)\n',
    );
  });

  it('sagt ohne Stab-Freigabe kein Wort über den Stab und ruft ihn nicht ab', async () => {
    const text = await erzeuge(freigabenFixture({ stab: { sichtbar: false } }));
    expect(ladeStab).not.toHaveBeenCalled();
    expect(text).toBe(`${MELDEBILD()}\n${ORG({ stab: null })}`);
    expect(text).not.toContain('Stab:');
  });

  it('überlässt fehlende Einheiten dem Renderer der Führungsorganisation', async () => {
    const text = await erzeuge(freigabenFixture({ einheiten: { zugriff: false } }));
    expect(listeEinheiten).not.toHaveBeenCalled();
    expect(text).toContain(ORG({ einheitenZustand: 'gesperrt' }, null));
    expect(text).toContain('— nicht freigegeben (Einheiten)');
  });

  describe('verfuegbar', () => {
    it('ist frei, sobald ein Teil frei ist', () => {
      expect(
        EIGENE_LAGE_QUELLE.verfuegbar(freigabenFixture({ personal: { zugriff: false } })),
      ).toEqual({ frei: true });
    });

    it('nennt die fehlenden Freigaben, wenn kein Teil frei ist', () => {
      expect(
        EIGENE_LAGE_QUELLE.verfuegbar(
          freigabenFixture({
            einsatzabschnitte: { zugriff: false },
            material: { sichtbar: false },
          }),
        ),
      ).toEqual({
        frei: false,
        grund:
          'Kräftemeldebild nicht freigegeben (Abschnitte, Material), ' +
          'Führungsorganisation nicht freigegeben (Abschnitte)',
      });
    });
  });
});
