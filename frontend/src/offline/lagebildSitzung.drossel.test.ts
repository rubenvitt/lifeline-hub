import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type { BenutzerAnzeige } from '../api/types';
import { einsatzKeys } from '../api/queryKeys';
import { lagebildLesen, lagebildLoeschenPlatte } from './lagebildSpeicher';
import { lagebildBeenden, lagebildStarten } from './lagebildSitzung';

// Gezählt wird das Dehydrieren selbst (LFH-939 D1): es lief vorher bei jedem Cache-Ereignis.
const dehydriert = vi.hoisted(() => ({ anzahl: 0 }));
vi.mock('@tanstack/react-query', async (original) => {
  const echt = await original<typeof import('@tanstack/react-query')>();
  return {
    ...echt,
    dehydrate: (...args: Parameters<typeof echt.dehydrate>) => {
      dehydriert.anzahl += 1;
      return echt.dehydrate(...args);
    },
  };
});

const A = { id: 7, benutzername: 'a', anzeigename: 'A' } as BenutzerAnzeige;
const DROSSEL = 40;
const warte = (ms: number) => new Promise((r) => setTimeout(r, ms));

const clients: QueryClient[] = [];

afterEach(async () => {
  for (const qc of clients.splice(0)) await lagebildBeenden(qc);
  await lagebildLoeschenPlatte();
});

describe('Lagebild-Sitzung: Drossel vor dem Dehydrieren (LFH-939)', () => {
  it('dehydriert viele Ereignisse in einem Drosselfenster genau einmal', async () => {
    const qc = new QueryClient();
    clients.push(qc);
    await lagebildStarten(qc, { art: 'ok', benutzer: A }, { drosselMs: DROSSEL });
    await warte(DROSSEL * 3);
    dehydriert.anzahl = 0;
    for (let i = 0; i < 25; i++) qc.setQueryData(einsatzKeys.personen(3), [{ id: i }]);
    expect(dehydriert.anzahl).toBe(0);
    await warte(DROSSEL * 3);
    expect(dehydriert.anzahl).toBe(1);
    const satz = await lagebildLesen();
    expect(satz?.client.clientState.queries[0].state.data).toEqual([
      expect.objectContaining({ id: 24 }),
    ]);
  });

  it('löst mit einem Ereignis des Mutations-Cache keinen Durchlauf aus', async () => {
    const qc = new QueryClient();
    clients.push(qc);
    await lagebildStarten(qc, { art: 'ok', benutzer: A }, { drosselMs: DROSSEL });
    await warte(DROSSEL * 3);
    dehydriert.anzahl = 0;
    await qc
      .getMutationCache()
      .build(qc, { mutationFn: async () => 1 })
      .execute(undefined);
    await warte(DROSSEL * 3);
    expect(dehydriert.anzahl).toBe(0);
  });
});
