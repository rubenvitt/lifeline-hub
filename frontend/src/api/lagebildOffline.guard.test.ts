import { describe, expect, it } from 'vitest';
import { QueryClient, dehydrate, onlineManager } from '@tanstack/react-query';
import {
  EINSATZ_KEYS,
  GLOBAL_KEYS,
  LAGEBILD_OFFLINE,
  einsatzKeys,
  istLagebildOfflineKey,
} from './queryKeys';
import { lagebildDehydrierOptionen, lagebildSperren } from '../offline/lagebildFilter';
import { HOECHSTLIEGEZEIT_MS } from '../offline/lagebildStart';

// Guard auf die Allowlist des Lagebilds (LFH-723, design.md D3): was nicht gelistet ist,
// landet NIE auf der Platte — auch dann nicht, wenn es im Tab geladen war. Geprüft wird
// gegen JEDEN verwalteten Prefix der Registry, damit ein neuer Prefix nicht still
// mitgeschrieben wird (er erscheint dann nicht in der Erwartung und färbt den Test rot).

/** Die erwartete Menge, als LITERALE gegen die Registry-Konstanten — sonst prüfte die
 *  Allowlist sich selbst. */
const ERWARTET_EINSATZ = new Set([
  'einsatz',
  'einsatz-modul-freigaben',
  'einsatz-einstellungen',
  'einsatz-modul-zaehler',
  'etb',
  'einsatz-einheiten',
  'einsatz-personal',
  'einsatz-fahrzeuge',
  'einsatz-material',
  'einsatz-abschnitte',
  'einsatz-auftraege',
  'einsatz-kraefte-zeitachse',
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
const ERWARTET_GLOBAL = new Set([
  'einsaetze',
  'karte-config',
  'organisation',
  'fahrzeug-status',
  'benutzer-einstellungen',
]);

function geschriebeneKeys(qc: QueryClient): unknown[][] {
  return dehydrate(qc, lagebildDehydrierOptionen(qc)).queries.map((q) => q.queryKey as unknown[]);
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

  it('nimmt vom Stab nur den Kommunikationsplan (LFH-848)', () => {
    expect(istLagebildOfflineKey(einsatzKeys.stabKommunikationsplan(7))).toBe(true);
    expect(istLagebildOfflineKey(einsatzKeys.stab(7))).toBe(false);
    expect(istLagebildOfflineKey(einsatzKeys.stabCheckliste(7))).toBe(false);
    expect(istLagebildOfflineKey(einsatzKeys.stabLagebesprechungen(7))).toBe(false);
    // Die Fernmeldeskizze (LFH-893) bleibt draußen: bearbeitet wird sie nur mit Server.
    expect(istLagebildOfflineKey(einsatzKeys.stabFernmeldeskizze(7))).toBe(false);
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

describe('Guard: ein Fehler MIT Daten ist ein Stand', () => {
  // Fällt der Server im laufenden Tab weg, behalten die Queries nach dem Fehler ihren letzten
  // guten Stand. Der muss auf der Platte bleiben, sonst fände das Neuladen ohne Netz nichts.
  it('schreibt eine gescheiterte Aktualisierung mit ihrem letzten Stand', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(einsatzKeys.personen(7), [{ id: 1 }]);
    await qc
      .fetchQuery({
        queryKey: einsatzKeys.personen(7),
        queryFn: () => Promise.reject(new Error('Leitung weg')),
        staleTime: 0,
      })
      .catch(() => {});
    expect(qc.getQueryState(einsatzKeys.personen(7))?.status).toBe('error');
    expect(geschriebeneKeys(qc)).toEqual([einsatzKeys.personen(7)]);
  });
});

describe('Guard: keine Mutationen auf der Platte (Review LFH-723, Befund 1)', () => {
  // Ohne eigene Regel nähme `dehydrate` jede PAUSIERTE Mutation samt `variables` mit — ohne
  // Netz pausiert jede (networkMode 'online'), also Chat-Texte, Personen-PATCHes …
  it('schreibt eine ohne Netz pausierte Mutation nicht', async () => {
    const qc = new QueryClient();
    onlineManager.setOnline(false);
    try {
      void qc
        .getMutationCache()
        .build(qc, { mutationFn: async (v: { nachricht: string }) => v })
        .execute({ nachricht: 'Chat-Text mit Namen' })
        .catch(() => {});
      await new Promise((r) => setTimeout(r, 0));
      expect(qc.getMutationCache().getAll()[0]?.state.isPaused).toBe(true);
      expect(dehydrate(qc, lagebildDehydrierOptionen(qc)).mutations).toEqual([]);
    } finally {
      onlineManager.setOnline(true);
    }
  });
});

describe('Guard: jeder Einzelstand hat die Höchstliegezeit (Review LFH-723, Befund 3)', () => {
  // `bestaetigtAt` gilt je Benutzer. Ein Einsatz, den niemand mehr öffnet, trüge sonst seinen
  // alten Stand unbegrenzt weiter, solange die Person anderswo arbeitet.
  it('schreibt einen Stand nicht, dessen letzter Abruf älter als 24 h ist', () => {
    const qc = new QueryClient();
    qc.setQueryData(einsatzKeys.personen(7), [], {
      updatedAt: Date.now() - HOECHSTLIEGEZEIT_MS - 1,
    });
    qc.setQueryData(einsatzKeys.personen(8), [], { updatedAt: Date.now() - 60_000 });
    expect(geschriebeneKeys(qc)).toEqual([einsatzKeys.personen(8)]);
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
