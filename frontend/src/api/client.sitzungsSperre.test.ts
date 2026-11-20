/**
 * LLH-1770: Leseanfragen warten während einer unterbrochenen Sitzung, statt mit 401 zu scheitern.
 * Die Sperre setzt im Betrieb die Sitzungswache synchron auf `SITZUNG_ABGELAUFEN`; hier steht ein
 * Horcher an ihrer Stelle.
 */
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { ApiError, apiGet } from './client';
import { SITZUNG_ABGELAUFEN, sitzungsMeldungZuruecksetzen } from '../auth/sitzungsEvent';
import { sitzungEntsperren, sitzungSperren } from '../auth/sitzungsSperre';

let antworten: number[];
let aufrufe: Record<string, number>;
let ereignisse: number;
const sperren = () => {
  ereignisse++;
  sitzungSperren();
};

function antworteMit(...folge: number[]) {
  antworten = folge;
}

beforeEach(() => {
  aufrufe = {};
  ereignisse = 0;
  antworten = [200];
  server.use(
    http.get('/api/probe/:n', ({ params }) => {
      const n = String(params.n);
      const i = aufrufe[n] ?? 0;
      aufrufe[n] = i + 1;
      const status = antworten[Math.min(i, antworten.length - 1)];
      return status === 200
        ? HttpResponse.json({ n })
        : HttpResponse.json({ error: 'abgelaufen' }, { status });
    }),
    http.get('/api/auth/me', () => HttpResponse.json({ error: 'x' }, { status: 401 })),
  );
});

afterEach(() => {
  window.removeEventListener(SITZUNG_ABGELAUFEN, sperren);
  sitzungEntsperren('beendet');
  sitzungsMeldungZuruecksetzen();
});

/** Wartet, bis alle angefangenen Abrufe beim Server waren. */
async function bisAngefragt(anzahl: number) {
  for (let i = 0; i < 100; i++) {
    if (Object.values(aufrufe).reduce((a, b) => a + b, 0) >= anzahl) return;
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe('apiGet bei unterbrochener Sitzung (LLH-1770)', () => {
  it('wartet bei 401 auf die Anmeldung und wiederholt einmal', async () => {
    window.addEventListener(SITZUNG_ABGELAUFEN, sperren);
    antworteMit(401, 200);
    const abruf = apiGet<{ n: string }>('/api/probe/a');
    await bisAngefragt(1);
    await new Promise((r) => setTimeout(r, 20));
    expect(aufrufe.a).toBe(1);
    sitzungEntsperren('wiederhergestellt');
    await expect(abruf).resolves.toEqual({ n: 'a' });
    expect(aufrufe.a).toBe(2);
  });

  it('wirft 401, wenn die Unterbrechung mit Abmelden endet', async () => {
    window.addEventListener(SITZUNG_ABGELAUFEN, sperren);
    antworteMit(401);
    const abruf = apiGet('/api/probe/b');
    await bisAngefragt(1);
    sitzungEntsperren('beendet');
    await expect(abruf).rejects.toMatchObject({ status: 401 });
    expect(aufrufe.b).toBe(1);
  });

  it('ohne Sperre wirft 401 wie bisher', async () => {
    antworteMit(401);
    const fehler = await apiGet('/api/probe/c').catch((e: unknown) => e);
    expect(fehler).toBeInstanceOf(ApiError);
    expect((fehler as ApiError).status).toBe(401);
  });

  it('fünf gleichzeitige Abrufe: ein Ereignis, jeder wiederholt genau einmal', async () => {
    window.addEventListener(SITZUNG_ABGELAUFEN, sperren);
    antworteMit(401, 200);
    const abrufe = ['1', '2', '3', '4', '5'].map((n) => apiGet(`/api/probe/${n}`));
    await bisAngefragt(5);
    await new Promise((r) => setTimeout(r, 20));
    sitzungEntsperren('wiederhergestellt');
    await Promise.all(abrufe);
    expect(ereignisse).toBe(1);
    expect(Object.values(aufrufe)).toEqual([2, 2, 2, 2, 2]);
  });

  it('eine 401 nach der Wiederherstellung wird nicht erneut abgewartet', async () => {
    window.addEventListener(SITZUNG_ABGELAUFEN, sperren);
    antworteMit(401, 401);
    const abruf = apiGet('/api/probe/d');
    await bisAngefragt(1);
    sitzungEntsperren('wiederhergestellt');
    await expect(abruf).rejects.toMatchObject({ status: 401 });
    expect(aufrufe.d).toBe(2);
  });

  it('wartet vor dem Abruf, solange schon gesperrt ist', async () => {
    sitzungSperren();
    const abruf = apiGet('/api/probe/e');
    await new Promise((r) => setTimeout(r, 20));
    expect(aufrufe.e).toBeUndefined();
    sitzungEntsperren('wiederhergestellt');
    await expect(abruf).resolves.toEqual({ n: 'e' });
  });

  it('/api/auth/me wartet nie', async () => {
    sitzungSperren();
    await expect(apiGet('/api/auth/me')).rejects.toMatchObject({ status: 401 });
  });
});
