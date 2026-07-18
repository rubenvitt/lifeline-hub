import { beforeEach, describe, expect, it } from 'vitest';
import type { NeuerEintrag } from '../api/etb';
import {
  abgelehntEntfernen,
  abgelehntHinzufuegen,
  abgelehntLaden,
  queueEinreihen,
  queueLaden,
  queueLeerenFuerTests,
} from './queue';

const eintrag: NeuerEintrag = { typ: 'meldung', inhalt: 'x' };

beforeEach(async () => {
  await queueLeerenFuerTests();
});

describe('offline queue (F03/LFH-261)', () => {
  it('mintet eine client_id, wenn der Eintrag keine trägt', async () => {
    await queueEinreihen(7, eintrag);
    const [a] = await queueLaden(7);
    expect(a.eintrag.client_id).toBeTruthy();
  });

  it('überschreibt eine vorgegebene client_id NICHT', async () => {
    await queueEinreihen(7, { ...eintrag, client_id: 'vorgegeben-1' });
    const [a] = await queueLaden(7);
    expect(a.eintrag.client_id).toBe('vorgegeben-1');
  });

  it('persistiert abgelehnte Einträge in IndexedDB (überleben Reload)', async () => {
    await abgelehntHinzufuegen(7, eintrag, 'Keine Berechtigung');
    const geladen = await abgelehntLaden(7);
    expect(geladen).toHaveLength(1);
    expect(geladen[0]).toMatchObject({
      grund: 'Keine Berechtigung',
      eintrag: { inhalt: 'x' },
    });

    await abgelehntEntfernen(geladen[0].id!);
    expect(await abgelehntLaden(7)).toHaveLength(0);
  });

  it('trennt abgelehnte Einträge nach Einsatz', async () => {
    await abgelehntHinzufuegen(7, eintrag, 'a');
    await abgelehntHinzufuegen(8, eintrag, 'b');
    expect(await abgelehntLaden(7)).toHaveLength(1);
    expect(await abgelehntLaden(8)).toHaveLength(1);
  });
});
