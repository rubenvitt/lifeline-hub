// frontend/src/command-palette/befehle.modulstatus.test.ts
import { describe, it, expect, vi } from 'vitest';
import { baueBefehle } from './befehle';
import { modulRegistry } from '../einsatz/modulRegistry';
import type { ModulEintrag } from '../einsatz/modulRegistry';
import type { BefehlKontext } from './typen';
import type { BenutzerAnzeige } from '../api/types';

/**
 * Der Schnellaktions-Filter folgt der LESEACHSE (LFH-391 · A1b).
 *
 * `baueBefehle` fragte für Schnellaktionen bis dahin `istModulSichtbar && !istModulGesperrt`
 * — die ZWEITEILIGE Fassung ohne `status === 'fertig'`. Die Modul- und die
 * „Zuletzt"-Schleife derselben Datei fragen dagegen `istModulFreigegeben`, also dreiteilig.
 * Eine Schnellaktion konnte damit auf ein unfertiges Modul zeigen, dessen Navigationseintrag
 * daneben gar nicht existiert — und sie ist der Spiegel des Backend-Gates.
 *
 * WARUM EINE EIGENE DATEI: der Unterschied ist im Bestand NICHT beobachtbar — alle vier
 * Trägermodule sind `fertig` (gemessen: 24 der 25 Registry-Einträge, einziger `wip` ist
 * `stab`). Beobachtbar wird er erst über einen Registry-Stub, und `vi.mock` hoistet
 * dateiweit: im selben File verfälschte er die zwanzig übrigen Aussagen von
 * `befehle.test.ts` und die Registry-Abgleiche von `schnellaktionen.guard.test.ts`.
 *
 * Über `ModulOverrides` geht es nicht — die tragen `sichtbar` und `benoetigte_rolle`, aber
 * keinen Status; die Statusachse ist ausschließlich Registry. Ein erfundenes fünftes Modul
 * wäre eine Produktivänderung für einen Test.
 *
 * Gestubbt wird NUR die Datentabelle. Die Freigabefunktionen bleiben die echten, sonst
 * prüfte der Test seine eigene Attrappe.
 */
vi.mock('../einsatz/modulRegistry', async (importOriginal) => {
  const echt = await importOriginal<typeof import('../einsatz/modulRegistry')>();
  return {
    ...echt,
    modulRegistry: echt.modulRegistry.map((m: ModulEintrag) =>
      (m.key === 'personen' ? { ...m, status: 'wip' as const } : m)),
  };
});

const fuehrungskraft: BenutzerAnzeige = {
  id: 1, anzeigename: 'EL', benutzername: 'el', system_rolle: 'keiner',
  org_rolle: 'fuehrungskraft', aktiv: true, erstellt_at: '', totp_aktiviert: false,
};

/** Wie in `befehle.test.ts` — bewusst lokal gehalten: eine geteilte Fixture zöge diese
 *  Datei samt ihrem Registry-Stub in den Importgraph der anderen. */
function kontext(over: Partial<BefehlKontext> = {}): BefehlKontext {
  return {
    einsatzId: 5, benutzer: fuehrungskraft, einsaetze: [], overrides: undefined,
    darfSchreibenImEinsatz: true,
    navigate: vi.fn(), setThemeModus: vi.fn(), setDichte: vi.fn(), setKoordinaten: vi.fn(), logout: vi.fn(),
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
   * Kontrolle, dass der Stub überhaupt durchschlägt: dieselbe Statusachse hält die
   * Modul-Navigation schon heute zurück. Ohne diese Zeile wäre die Aussage darüber auch bei
   * einem wirkungslosen Mock erklärbar — dann fehlte `aktion:personen` aus einem anderen Grund.
   */
  it('hält dasselbe Modul auch aus der Navigation heraus', () => {
    expect(baueBefehle(kontext()).some((x) => x.id === 'modul:personen')).toBe(false);
  });

  /** Gegenaussage zur Negativaussage: es fällt nicht alles weg, der Filter trifft genau das
   *  gestubbte Modul — und die Reihenfolge der übrigen drei bleibt die der Tabelle. */
  it('lässt die Schnellaktionen der fertigen Module stehen', () => {
    expect(baueBefehle(kontext()).map((x) => x.id).filter((id) => id.startsWith('aktion:'))).toEqual(
      ['aktion:etb', 'aktion:unfallhilfsstellen', 'aktion:schaeden'],
    );
  });
});
