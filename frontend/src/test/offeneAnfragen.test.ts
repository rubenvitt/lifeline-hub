import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from './server';

/**
 * Wächter für `offeneAnfragen.ts` (LLH-1536). Die Reihenfolge der Tests ist Absicht: Der erste
 * lässt Anfragen mit kurzer Frist offen, die folgenden laufen, während diese Fristen ablaufen.
 * Ohne die Grenze in `setup.ts` ist der zweite Test immer rot und der dritte oft
 * (`ECONNREFUSED 127.0.0.1:3000`).
 */
describe('offene Anfragen nach ihrem Test (LLH-1536)', () => {
  const ausgang: string[] = [];

  it('lässt gehaltene Anfragen mit kurzer Frist offen zurück', async () => {
    server.use(http.post('/api/gehalten', () => new Promise<never>(() => {})));
    // Wie `api/client.ts`, nur mit kurzer Frist: sie liefe im nächsten Test ab.
    for (const frist of [150, 250, 350]) {
      fetch('/api/gehalten', {
        method: 'POST',
        body: '{}',
        signal: AbortSignal.timeout(frist),
      }).then(
        () => ausgang.push('Antwort'),
        (e: Error) => ausgang.push(e.name),
      );
    }
    await new Promise((r) => setTimeout(r, 20));
    expect(ausgang).toEqual([]);
  });

  it('die Frist bricht sie nach dem Test nicht mehr ab', async () => {
    await new Promise((r) => setTimeout(r, 400));
    expect(ausgang).toEqual([]);
  });

  it('Anfragen eines Tests erreichen den Mock, solange alte Fristen ablaufen', async () => {
    server.use(
      http.get('/api/frisch', async () => {
        await new Promise((r) => setTimeout(r, 5));
        return HttpResponse.json({ ok: true });
      }),
    );
    const fehler: string[] = [];
    const ende = Date.now() + 600;
    while (Date.now() < ende) {
      await Promise.all(
        Array.from({ length: 8 }, () =>
          fetch('/api/frisch')
            .then((r) => r.json())
            .catch((e: Error & { cause?: Error }) => {
              fehler.push(`${e.name}: ${e.cause?.message ?? e.message}`);
            }),
        ),
      );
    }
    expect(fehler).toEqual([]);
  });

  // Zuletzt: Der Abbruch hier liefe sonst in den nächsten Test hinein.
  it('im eigenen Test bricht die Frist weiter ab', async () => {
    server.use(http.post('/api/gehalten', () => new Promise<never>(() => {})));
    const eigene = fetch('/api/gehalten', {
      method: 'POST',
      body: '{}',
      signal: AbortSignal.timeout(50),
    }).catch((e: Error) => e.name);
    expect(await eigene).toBe('TimeoutError');
  });
});
