import { describe, it, expect, vi } from 'vitest';
import { baueBefehle } from './befehle';
import { modulRegistry } from '../einsatz/modulRegistry';
import type { ModulEintrag } from '../einsatz/modulRegistry';
import type { BefehlKontext } from './typen';
import { benutzerFixture, freigabenFixture } from '../test/fixtures';

/**
 * Der Schnellaktions-Filter folgt der LESEACHSE `istModulFreigegeben` (inkl.
 * `status === 'fertig'`), wie die Modul- und die Zuletzt-Schleife.
 *
 * Eigene Datei, weil der Unterschied nur über einen Registry-Stub beobachtbar ist, und `vi.mock`
 * hoistet dateiweit (er verfälschte `befehle.test.ts` und `schnellaktionen.guard.test.ts`).
 * Die `ModulFreigaben` des Servers tragen keinen Status. Gestubbt wird NUR die Datentabelle, die
 * Freigabefunktionen bleiben echt.
 */
vi.mock('../einsatz/modulRegistry', async (importOriginal) => {
  const echt = await importOriginal<typeof import('../einsatz/modulRegistry')>();
  return {
    ...echt,
    modulRegistry: echt.modulRegistry.map((m: ModulEintrag) =>
      m.key === 'personen' ? { ...m, status: 'wip' as const } : m,
    ),
  };
});

const fuehrungskraft = benutzerFixture({ anzeigename: 'EL', org_rolle: 'fuehrungskraft' });

/** Wie in `befehle.test.ts`, bewusst lokal: eine geteilte Fixture zöge den Registry-Stub in den
 *  Importgraph der anderen. */
function kontext(over: Partial<BefehlKontext> = {}): BefehlKontext {
  return {
    einsatzId: 5,
    benutzer: fuehrungskraft,
    einsaetze: [],
    freigaben: freigabenFixture(),
    darfSchreibenImEinsatz: true,
    navigate: vi.fn(),
    setThemeModus: vi.fn(),
    setDichte: vi.fn(),
    setHelligkeit: vi.fn(),
    setKoordinaten: vi.fn(),
    logout: vi.fn(),
    ...over,
  };
}

describe('baueBefehle — Schnellaktionen folgen der Leseachse', () => {
  it('stubbt die Registry überhaupt (Vorbedingung)', () => {
    expect(modulRegistry.find((m) => m.key === 'personen')?.status).toBe('wip');
    expect(modulRegistry.find((m) => m.key === 'etb')?.status).toBe('fertig');
  });

  it('liefert für ein UNFERTIGES Trägermodul keine Schnellaktion', () => {
    expect(baueBefehle(kontext()).some((x) => x.id === 'aktion:personen')).toBe(false);
  });

  /**
   * Kontrolle, dass der Stub durchschlägt: dieselbe Statusachse hält die Modul-Navigation zurück.
   */
  it('hält dasselbe Modul auch aus der Navigation heraus', () => {
    expect(baueBefehle(kontext()).some((x) => x.id === 'modul:personen')).toBe(false);
  });

  /** Gegenaussage: der Filter trifft genau das gestubbte Modul, die Reihenfolge der übrigen
   *  bleibt. */
  it('lässt die Schnellaktionen der fertigen Module stehen', () => {
    expect(
      baueBefehle(kontext())
        .map((x) => x.id)
        .filter((id) => id.startsWith('aktion:')),
    ).toEqual([
      'aktion:etb',
      'aktion:unfallhilfsstellen',
      'aktion:schaeden',
      'aktion:stab',
      'aktion:dokumente',
      'aktion:tiere',
      'aktion:bereitstellungsraeume',
      'aktion:einsatzabschnitte',
    ]);
  });
});
