import { QueryClient } from '@tanstack/react-query';
import { delay, http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { einsatzKeys } from '../api/queryKeys';
import type { Erinnerung } from '../api/types';
import { server } from '../test/server';
import { ladeErinnerungTitel } from './erinnerungInhalt';
import { INHALT_FRIST_MS } from './meldungInhalt';

/** Spec `benachrichtigungen`, „Fällige Erinnerung erreicht ihre Empfänger“ (LLH-1737, D6). */

const FAELLIG = {
  art: 'erinnerung_faellig',
  bezug_typ: 'erinnerung',
  bezug_id: 5,
  einsatz_id: 1,
} as const;

function erinnerung(id: number, titel: string): Erinnerung {
  return { id, einsatz_id: 1, titel } as unknown as Erinnerung;
}

function serverMit(liste: Erinnerung[]) {
  const abrufe = { anzahl: 0 };
  server.use(
    http.get('/api/einsaetze/:id/reminders', () => {
      abrufe.anzahl += 1;
      return HttpResponse.json(liste);
    }),
  );
  return abrufe;
}

afterEach(() => vi.useRealTimers());

describe('ladeErinnerungTitel', () => {
  it('nimmt den Titel aus der Liste der offenen Erinnerungen', async () => {
    serverMit([erinnerung(4, 'Funkcheck'), erinnerung(5, 'Pegel prüfen')]);
    expect(await ladeErinnerungTitel(FAELLIG)).toBe('Pegel prüfen');
  });

  it('ein gefüllter Cache antwortet ohne Abruf', async () => {
    const abrufe = serverMit([]);
    const qc = new QueryClient();
    qc.setQueryData(einsatzKeys.erinnerungenPhase(1, 'offen'), [erinnerung(5, 'Pegel prüfen')]);
    expect(await ladeErinnerungTitel(FAELLIG, qc)).toBe('Pegel prüfen');
    expect(abrufe.anzahl).toBe(0);
  });

  it('eine unbekannte Erinnerung ergibt null', async () => {
    serverMit([erinnerung(4, 'Funkcheck')]);
    expect(await ladeErinnerungTitel(FAELLIG)).toBeNull();
  });

  it('andere Arten ergeben null, ohne Abruf', async () => {
    const abrufe = serverMit([erinnerung(5, 'Pegel prüfen')]);
    expect(
      await ladeErinnerungTitel({ ...FAELLIG, art: 'auftrag_erteilt', bezug_typ: 'auftrag' }),
    ).toBeNull();
    expect(abrufe.anzahl).toBe(0);
  });

  it('ein Fehler ergibt null', async () => {
    server.use(
      http.get('/api/einsaetze/:id/reminders', () =>
        HttpResponse.json({ error: 'verboten' }, { status: 403 }),
      ),
    );
    expect(await ladeErinnerungTitel(FAELLIG)).toBeNull();
  });

  it('nach der Frist ergibt es null, auch wenn die Antwort noch kommt', async () => {
    server.use(
      http.get('/api/einsaetze/:id/reminders', async () => {
        await delay(INHALT_FRIST_MS + 500);
        return HttpResponse.json([erinnerung(5, 'Pegel prüfen')]);
      }),
    );
    const start = Date.now();
    expect(await ladeErinnerungTitel(FAELLIG)).toBeNull();
    expect(Date.now() - start).toBeLessThan(INHALT_FRIST_MS + 400);
  });
});
