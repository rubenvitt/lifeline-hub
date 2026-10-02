import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { lagebildDehydrierOptionen } from '../offline/lagebildFilter';
import { ApiError, NetzFehler } from './client';
import { erzeugeQueryClient } from './queryClient';
import { einsatzKeys } from './queryKeys';
import { HOECHSTLIEGEZEIT_MS } from '../offline/lagebildStart';
import { SITZUNG_ABGELAUFEN, sitzungsMeldungZuruecksetzen } from '../auth/sitzungsEvent';

afterEach(() => sitzungsMeldungZuruecksetzen());

/** Führt eine Mutation aus, die mit `fehler` scheitert, und wartet ihr Ende ab. */
async function mutationScheitert(fehler: unknown) {
  const client = erzeugeQueryClient({ mutations: { retry: false } });
  await client
    .getMutationCache()
    .build(client, { mutationFn: () => Promise.reject(fehler) })
    .execute(undefined)
    .catch(() => {});
}

/** Führt eine Query aus, die mit `fehler` scheitert, und wartet ihr Ende ab. */
async function queryScheitert(fehler: unknown) {
  const client = erzeugeQueryClient({ queries: { retry: false } });
  await client
    .fetchQuery({ queryKey: ['test-401'], queryFn: () => Promise.reject(fehler) })
    .catch(() => {});
}

describe('erzeugeQueryClient — globale 401-Erkennung', () => {
  it('meldet den Sitzungsablauf, wenn eine Mutation 401 liefert', async () => {
    const horcher = vi.fn();
    window.addEventListener(SITZUNG_ABGELAUFEN, horcher);
    await mutationScheitert(new ApiError(401, 'Nicht angemeldet'));
    window.removeEventListener(SITZUNG_ABGELAUFEN, horcher);
    expect(horcher).toHaveBeenCalledTimes(1);
  });

  it('meldet den Sitzungsablauf, wenn eine Query 401 liefert', async () => {
    const horcher = vi.fn();
    window.addEventListener(SITZUNG_ABGELAUFEN, horcher);
    await queryScheitert(new ApiError(401, 'Nicht angemeldet'));
    window.removeEventListener(SITZUNG_ABGELAUFEN, horcher);
    expect(horcher).toHaveBeenCalledTimes(1);
  });

  it('schweigt bei jedem anderen ApiError — die lokalen onError-Handler melden ihn', async () => {
    const horcher = vi.fn();
    const konsole = vi.spyOn(console, 'error').mockImplementation(() => {});
    window.addEventListener(SITZUNG_ABGELAUFEN, horcher);
    await mutationScheitert(new ApiError(422, 'Ort darf nicht leer sein'));
    await mutationScheitert(new ApiError(409, 'Stornierter Schaden'));
    await queryScheitert(new ApiError(500, 'kaputt'));
    window.removeEventListener(SITZUNG_ABGELAUFEN, horcher);
    expect(horcher).not.toHaveBeenCalled();
    expect(konsole).not.toHaveBeenCalled();
    konsole.mockRestore();
  });

  it('protokolliert unerwartete Nicht-ApiError-Fehler, meldet aber keinen Sitzungsablauf', async () => {
    const horcher = vi.fn();
    const konsole = vi.spyOn(console, 'error').mockImplementation(() => {});
    window.addEventListener(SITZUNG_ABGELAUFEN, horcher);
    await mutationScheitert(new TypeError('Failed to fetch'));
    window.removeEventListener(SITZUNG_ABGELAUFEN, horcher);
    expect(horcher).not.toHaveBeenCalled();
    expect(konsole).toHaveBeenCalledTimes(1);
    konsole.mockRestore();
  });

  it('behandelt einen klassifizierten NetzFehler als erwarteten Betriebszustand', async () => {
    const konsole = vi.spyOn(console, 'error').mockImplementation(() => {});
    await mutationScheitert(new NetzFehler());
    expect(konsole).not.toHaveBeenCalled();
    konsole.mockRestore();
  });

  it('übernimmt die übergebenen defaultOptions', () => {
    const client = erzeugeQueryClient({ queries: { retry: false, gcTime: 0 } });
    expect(client.getDefaultOptions().queries?.gcTime).toBe(0);
  });
});

describe('erzeugeQueryClient — Produktionsdefaults', () => {
  it('wiederholt ausschließlich NetzFehler bei Queries höchstens zweimal mit Backoff', () => {
    const optionen = erzeugeQueryClient().getDefaultOptions().queries;
    const retry = optionen?.retry;
    const retryDelay = optionen?.retryDelay;

    expect(typeof retry).toBe('function');
    expect(typeof retryDelay).toBe('function');
    if (typeof retry !== 'function' || typeof retryDelay !== 'function') {
      throw new Error('Query-Retry-Defaults fehlen');
    }

    expect(retry(0, new NetzFehler())).toBe(true);
    expect(retry(1, new NetzFehler())).toBe(true);
    expect(retry(2, new NetzFehler())).toBe(false);
    expect(retry(0, new ApiError(503, 'nicht verfügbar'))).toBe(false);
    expect(retry(0, new TypeError('Programmierfehler'))).toBe(false);
    expect(retryDelay(0, new NetzFehler())).toBe(1_000);
    expect(retryDelay(1, new NetzFehler())).toBe(2_000);
  });

  it('wiederholt Mutationen nie automatisch', () => {
    expect(erzeugeQueryClient().getDefaultOptions().mutations?.retry).toBe(0);
  });
});

describe('erzeugeQueryClient — Liegezeit der Lagebild-Allowlist (LFH-723, design.md D8)', () => {
  it('hält gelistete Keys so lange im Speicher, wie sie auf der Platte liegen dürfen', () => {
    const client = erzeugeQueryClient();
    expect(client.getQueryDefaults(einsatzKeys.etbListe(7, {})).gcTime).toBe(HOECHSTLIEGEZEIT_MS);
    expect(client.getQueryDefaults(einsatzKeys.personen(7)).gcTime).toBe(HOECHSTLIEGEZEIT_MS);
    expect(client.getQueryDefaults(['karte-config']).gcTime).toBe(HOECHSTLIEGEZEIT_MS);
  });

  it('lässt ungelistete Keys beim Vorgabewert', () => {
    const client = erzeugeQueryClient();
    expect(client.getQueryDefaults(einsatzKeys.chatNachrichten(7)).gcTime).toBeUndefined();
    expect(client.getQueryDefaults(['benutzer']).gcTime).toBeUndefined();
  });

  it('setzt nichts, wenn eigene defaultOptions übergeben werden (Testclient)', () => {
    const client = erzeugeQueryClient({ queries: { gcTime: 0 } });
    expect(client.getQueryDefaults(einsatzKeys.personen(7)).gcTime).toBeUndefined();
  });
});

describe('erzeugeQueryClient — Rechteentzug räumt das Lagebild (LFH-723, design.md D6)', () => {
  const verboten = () => Promise.reject(new ApiError(403, 'Kein Zugriff'));

  function beobachten(client: QueryClient, queryKey: readonly unknown[], queryFn: () => unknown) {
    const beobachter = new QueryObserver(client, { queryKey, queryFn, retry: false });
    return beobachter.subscribe(() => {});
  }

  it('räumt bei 403 auf den Einsatz alle Daten dieses Einsatzes, andere bleiben', async () => {
    const client = erzeugeQueryClient({ queries: { retry: false } });
    client.setQueryData(einsatzKeys.personen(7), [{ id: 1 }]);
    client.setQueryData(einsatzKeys.etbZaehler(7, {}), { anzahl: 3 });
    client.setQueryData(einsatzKeys.personen(8), [{ id: 2 }]);
    client.setQueryData(einsatzKeys.einsatz(7), { id: 7 });
    await client
      .fetchQuery({ queryKey: einsatzKeys.einsatz(7), queryFn: verboten })
      .catch(() => {});
    expect(client.getQueryData(einsatzKeys.personen(7))).toBeUndefined();
    expect(client.getQueryData(einsatzKeys.etbZaehler(7, {}))).toBeUndefined();
    expect(client.getQueryData(einsatzKeys.einsatz(7))).toBeUndefined();
    expect(client.getQueryData(einsatzKeys.personen(8))).toEqual([{ id: 2 }]);
  });

  it('räumt bei 404 auf den Einsatz ebenso', async () => {
    const client = erzeugeQueryClient({ queries: { retry: false } });
    client.setQueryData(einsatzKeys.personen(7), [{ id: 1 }]);
    await client
      .fetchQuery({
        queryKey: einsatzKeys.einsatz(7),
        queryFn: () => Promise.reject(new ApiError(404, 'weg')),
      })
      .catch(() => {});
    expect(client.getQueryData(einsatzKeys.personen(7))).toBeUndefined();
  });

  it('räumt bei 403 auf ein Modul nur dessen Prefix in diesem Einsatz', async () => {
    const client = erzeugeQueryClient({ queries: { retry: false } });
    client.setQueryData(einsatzKeys.personen(7), [{ id: 1 }]);
    client.setQueryData(einsatzKeys.etbZaehler(7, {}), { anzahl: 3 });
    client.setQueryData(einsatzKeys.personen(8), [{ id: 2 }]);
    await client
      .fetchQuery({ queryKey: einsatzKeys.personen(7), queryFn: verboten })
      .catch(() => {});
    expect(client.getQueryData(einsatzKeys.personen(7))).toBeUndefined();
    expect(client.getQueryData(einsatzKeys.etbZaehler(7, {}))).toEqual({ anzahl: 3 });
    expect(client.getQueryData(einsatzKeys.personen(8))).toEqual([{ id: 2 }]);
  });

  it('läuft bei zwei beobachteten Queries desselben Prefix nicht in eine Abrufschleife', async () => {
    const client = erzeugeQueryClient({ queries: { retry: false } });
    const liste = vi.fn(verboten);
    const zaehler = vi.fn(verboten);
    client.setQueryData(einsatzKeys.etbListe(7, {}), { pages: [], pageParams: [] });
    client.setQueryData(einsatzKeys.etbZaehler(7, {}), { anzahl: 3 });
    // Das Einhängen ruft beide je einmal ab (Daten ohne staleTime sind veraltet); beide
    // scheitern mit 403. Danach muss Ruhe sein — ein Räumen, das beobachtete Geschwister
    // entfernte, ließe sie sich gegenseitig neu anstoßen.
    const ab1 = beobachten(client, einsatzKeys.etbListe(7, {}), liste);
    const ab2 = beobachten(client, einsatzKeys.etbZaehler(7, {}), zaehler);
    await new Promise((r) => setTimeout(r, 100));
    expect(liste).toHaveBeenCalledTimes(1);
    expect(zaehler).toHaveBeenCalledTimes(1);
    // Beide stehen ohne Daten im Fehlerzustand — die Seite zeigt ihren Fehlerzweig statt
    // „Stand veraltet" mit dem alten Stand.
    for (const key of [einsatzKeys.etbListe(7, {}), einsatzKeys.etbZaehler(7, {})]) {
      const zustand = client.getQueryState(key);
      expect(zustand?.status).toBe('error');
      expect(zustand?.data).toBeUndefined();
    }
    ab1();
    ab2();
  });

  it('hält einen geleerten Bereich von der Platte fern, bis er wieder erfolgreich lädt', async () => {
    const client = erzeugeQueryClient({ queries: { retry: false } });
    const filter = lagebildDehydrierOptionen(client).shouldDehydrateQuery!;
    client.setQueryData(einsatzKeys.personen(7), [{ id: 1 }]);
    await client
      .fetchQuery({ queryKey: einsatzKeys.personen(7), queryFn: verboten })
      .catch(() => {});
    client.setQueryData(einsatzKeys.personen(7), [{ id: 9 }]);
    const query = () => client.getQueryCache().find({ queryKey: einsatzKeys.personen(7) })!;
    expect(filter(query())).toBe(false);
    await client.fetchQuery({
      queryKey: einsatzKeys.personen(7),
      queryFn: async () => [{ id: 3 }],
    });
    expect(filter(query())).toBe(true);
  });

  it('räumt bei 401 nichts — der Sitzungsablauf geht über die Sitzungswache', async () => {
    const client = erzeugeQueryClient({ queries: { retry: false } });
    client.setQueryData(einsatzKeys.personen(7), [{ id: 1 }]);
    await client
      .fetchQuery({
        queryKey: einsatzKeys.einsatz(7),
        queryFn: () => Promise.reject(new ApiError(401, 'weg')),
      })
      .catch(() => {});
    expect(client.getQueryData(einsatzKeys.personen(7))).toEqual([{ id: 1 }]);
  });

  it('räumt bei einem Netzfehler nichts', async () => {
    const client = erzeugeQueryClient({ queries: { retry: false } });
    client.setQueryData(einsatzKeys.personen(7), [{ id: 1 }]);
    await client
      .fetchQuery({
        queryKey: einsatzKeys.personen(7),
        queryFn: () => Promise.reject(new NetzFehler()),
      })
      .catch(() => {});
    expect(client.getQueryData(einsatzKeys.personen(7))).toEqual([{ id: 1 }]);
  });
});

describe('erzeugeQueryClient — Object-URLs der HEIC-Vorschau (LFH-759)', () => {
  it('gibt beide URLs frei, sobald die Query den Cache verlässt (auch beim Abmelden)', () => {
    const freigeben = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const client = erzeugeQueryClient();
    client.setQueryData(einsatzKeys.anhangHeicVorschau(7, '/a/1'), {
      klein: 'blob:klein-1',
      gross: 'blob:gross-1',
    });
    client.setQueryData(einsatzKeys.etb(7), []);
    client.clear();
    expect(freigeben).toHaveBeenCalledWith('blob:klein-1');
    expect(freigeben).toHaveBeenCalledWith('blob:gross-1');
    expect(freigeben).toHaveBeenCalledTimes(2);
    freigeben.mockRestore();
  });
});
