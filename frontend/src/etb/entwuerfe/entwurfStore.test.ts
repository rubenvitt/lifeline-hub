import { beforeEach, describe, expect, it } from 'vitest';
import type { EtbEntwurf } from './entwurfModell';
import {
  entwuerfeLaden,
  entwuerfeLeerenFuerTests,
  entwurfEntfernen,
  entwurfSpeichern,
} from './entwurfStore';

function entwurf(over: Partial<EtbEntwurf> = {}): EtbEntwurf {
  return {
    id: 'a',
    einsatz_id: 7,
    inhalt: 'X',
    typ: 'meldung',
    erstellt_at: '2026-06-22T10:00:00.000Z',
    geaendert_at: '2026-06-22T10:00:00.000Z',
    ...over,
  };
}

beforeEach(async () => {
  await entwuerfeLeerenFuerTests();
});

describe('entwurfStore', () => {
  it('speichert und lädt Entwürfe gescopet pro Einsatz, sortiert nach erstellt_at', async () => {
    await entwurfSpeichern(entwurf({ id: 'b', erstellt_at: '2026-06-22T11:00:00.000Z' }));
    await entwurfSpeichern(entwurf({ id: 'a', erstellt_at: '2026-06-22T10:00:00.000Z' }));
    await entwurfSpeichern(entwurf({ id: 'c', einsatz_id: 99 }));

    const liste = await entwuerfeLaden(7);
    expect(liste.map((e) => e.id)).toEqual(['a', 'b']); // c gehört zu Einsatz 99
  });

  it('put aktualisiert einen bestehenden Entwurf (gleiche id)', async () => {
    await entwurfSpeichern(entwurf({ id: 'a', inhalt: 'alt' }));
    await entwurfSpeichern(entwurf({ id: 'a', inhalt: 'neu' }));
    const liste = await entwuerfeLaden(7);
    expect(liste).toHaveLength(1);
    expect(liste[0].inhalt).toBe('neu');
  });

  it('entfernt einen Entwurf', async () => {
    await entwurfSpeichern(entwurf({ id: 'a' }));
    await entwurfEntfernen('a');
    expect(await entwuerfeLaden(7)).toHaveLength(0);
  });
});
