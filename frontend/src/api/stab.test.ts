import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { ladeCheckliste, setzeChecklistenPunkt } from './stab';

/**
 * Haken und Bemerkung sind zwei Bedienziele derselben Zeile: der Draht trägt GENAU das eine Feld,
 * sonst überschrieben sich zwei Schirme gegenseitig die andere Angabe (Design D3).
 */
describe('setzeChecklistenPunkt', () => {
  function faengeBody() {
    const bodies: Record<string, unknown>[] = [];
    server.use(
      http.put('/api/einsaetze/1/stab/checkliste/lageskizze', async ({ request }) => {
        bodies.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json([]);
      }),
    );
    return bodies;
  }

  it('schickt beim Haken nur erledigt', async () => {
    const bodies = faengeBody();
    await setzeChecklistenPunkt(1, 'lageskizze', { erledigt: true });
    expect(bodies[0]).toEqual({ erledigt: true });
  });

  it('schickt bei der Bemerkung nur bemerkung', async () => {
    const bodies = faengeBody();
    await setzeChecklistenPunkt(1, 'lageskizze', { bemerkung: 'Hof' });
    expect(bodies[0]).toEqual({ bemerkung: 'Hof' });
  });
});

describe('ladeCheckliste', () => {
  it('liest die gespeicherten Punkte', async () => {
    server.use(
      http.get('/api/einsaetze/1/stab/checkliste', () =>
        HttpResponse.json([{ punkt: 'lageskizze', erledigt: true }]),
      ),
    );
    await expect(ladeCheckliste(1)).resolves.toEqual([{ punkt: 'lageskizze', erledigt: true }]);
  });
});
