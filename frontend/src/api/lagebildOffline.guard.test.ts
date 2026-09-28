import { describe, expect, it } from 'vitest';
import { QueryClient, dehydrate } from '@tanstack/react-query';
import {
  EINSATZ_KEYS,
  GLOBAL_KEYS,
  LAGEBILD_OFFLINE,
  einsatzKeys,
  istLagebildOfflineKey,
} from './queryKeys';
import { lagebildDehydrierFilter, lagebildSperren } from '../offline/lagebildFilter';

// Guard auf die Allowlist des Lagebilds (LFH-723, design.md D3): was nicht gelistet ist,
// landet NIE auf der Platte — auch dann nicht, wenn es im Tab geladen war. Geprüft wird
// gegen JEDEN verwalteten Prefix der Registry, damit ein neuer Prefix nicht still
// mitgeschrieben wird (er erscheint dann nicht in der Erwartung und färbt den Test rot).

/** Die erwartete Menge, als LITERALE gegen die Registry-Konstanten — sonst prüfte die
 *  Allowlist sich selbst. */
const ERWARTET_EINSATZ = new Set([
  'einsatz',
  'einsatz-modul-overrides',
  'einsatz-einstellungen',
  'einsatz-modul-zaehler',
  'etb',
  'einsatz-einheiten',
  'einsatz-personal',
  'einsatz-fahrzeuge',
  'einsatz-material',
  'einsatz-abschnitte',
  'einsatz-auftraege',
  'einsatz-befehle',
  'einsatz-personen',
  'einsatz-uhs',
  'einsatz-zonen',
  'einsatz-freie-zeichen',
  'gefahrengebiete',
  'einsatz-schaeden',
  'einsatz-lagemeldungen',
  'einsatz-fuehrungskraefte',
  'einsatz-betreuung',
  'einsatz-karten-ansicht',
  'einsatz-kartenbilder',
  'einsatz-lage-snapshot',
]);
const ERWARTET_GLOBAL = new Set(['einsaetze', 'karte-config', 'organisation', 'fahrzeug-status']);

function geschriebeneKeys(qc: QueryClient): unknown[][] {
  return dehydrate(qc, { shouldDehydrateQuery: lagebildDehydrierFilter(qc) }).queries.map(
    (q) => q.queryKey as unknown[],
  );
}

describe('istLagebildOfflineKey', () => {
  it('nimmt gelistete Einsatz-Keys samt Sub-Keys', () => {
    expect(istLagebildOfflineKey(einsatzKeys.etbListe(7, { q: 'x' }))).toBe(true);
    expect(istLagebildOfflineKey(einsatzKeys.personen(7))).toBe(true);
    expect(istLagebildOfflineKey(einsatzKeys.einsatz(7))).toBe(true);
  });

  it('nimmt von den Meldungen nur die Rückmeldungen', () => {
    expect(istLagebildOfflineKey(['einsatz-meldungen', 7, 'rueckmeldungen'])).toBe(true);
    expect(istLagebildOfflineKey(['einsatz-meldungen', 7])).toBe(false);
    expect(istLagebildOfflineKey(['einsatz-meldungen', 7, 'andere'])).toBe(false);
  });

  it('verlangt an Stelle 1 eine Einsatz-ID', () => {
    expect(istLagebildOfflineKey(['etb'])).toBe(false);
    expect(istLagebildOfflineKey(['etb', 'x'])).toBe(false);
  });

  it('nimmt die gelisteten globalen Keys', () => {
    expect(istLagebildOfflineKey(['karte-config'])).toBe(true);
    expect(istLagebildOfflineKey(['fahrzeug-status'])).toBe(true);
    expect(istLagebildOfflineKey(['benutzer'])).toBe(false);
  });

  it('führt die Allowlist mit den Werten der Registry', () => {
    expect(new Set(LAGEBILD_OFFLINE.einsatz)).toEqual(ERWARTET_EINSATZ);
    expect(new Set(LAGEBILD_OFFLINE.global)).toEqual(ERWARTET_GLOBAL);
  });
});

describe('Guard: nur die Allowlist erreicht die Platte', () => {
  it('schreibt aus einem Cache mit JEDEM verwalteten Prefix genau die Allowlist', () => {
    const qc = new QueryClient();
    for (const prefix of Object.values(EINSATZ_KEYS)) qc.setQueryData([prefix, 7], { x: 1 });
    qc.setQueryData(['einsatz-meldungen', 7, 'rueckmeldungen'], { x: 1 });
    for (const prefix of Object.values(GLOBAL_KEYS)) qc.setQueryData([prefix], { x: 1 });

    const geschrieben = geschriebeneKeys(qc);
    const einsatzPrefixe = new Set(
      geschrieben.filter((k) => typeof k[1] === 'number' && k.length === 2).map((k) => k[0]),
    );
    const globalPrefixe = new Set(geschrieben.filter((k) => k.length === 1).map((k) => k[0]));
    expect(einsatzPrefixe).toEqual(ERWARTET_EINSATZ);
    expect(globalPrefixe).toEqual(ERWARTET_GLOBAL);
    // Von den Meldungen genau der Rückmeldungs-Key, nicht die Liste.
    expect(geschrieben.filter((k) => k[0] === 'einsatz-meldungen')).toEqual([
      ['einsatz-meldungen', 7, 'rueckmeldungen'],
    ]);
  });

  it('schreibt keine Fehler- und keine Ladezustände', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await qc
      .fetchQuery({
        queryKey: einsatzKeys.personen(7),
        queryFn: () => Promise.reject(new Error('weg')),
      })
      .catch(() => {});
    void qc.prefetchQuery({
      queryKey: einsatzKeys.einsatz(7),
      queryFn: () => new Promise(() => {}),
    });
    expect(geschriebeneKeys(qc)).toEqual([]);
  });
});

describe('Sperrmarke nach Rechteentzug (design.md D6)', () => {
  it('hält einen gesperrten Einsatz ganz von der Platte fern, andere Einsätze nicht', () => {
    const qc = new QueryClient();
    qc.setQueryData(einsatzKeys.personen(7), []);
    qc.setQueryData(einsatzKeys.einsatz(7), { id: 7 });
    qc.setQueryData(einsatzKeys.personen(8), []);
    lagebildSperren(qc, einsatzKeys.einsatz(7), 'einsatz');
    expect(geschriebeneKeys(qc)).toEqual([einsatzKeys.personen(8)]);
  });

  it('hält bei einem gesperrten Modul nur dessen Prefix im Einsatz fern', () => {
    const qc = new QueryClient();
    qc.setQueryData(einsatzKeys.personen(7), []);
    qc.setQueryData(einsatzKeys.einheiten(7), []);
    lagebildSperren(qc, einsatzKeys.personen(7), 'prefix');
    expect(geschriebeneKeys(qc)).toEqual([einsatzKeys.einheiten(7)]);
  });
});
