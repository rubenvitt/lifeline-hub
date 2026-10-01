import { afterEach, describe, expect, it, vi } from 'vitest';
import { heraufstufenZuEtb } from './chat';

afterEach(() => vi.restoreAllMocks());

// LFH-700: Anhänge gehen nur mit, wenn die Person sie im Dialog gewählt hat.
describe('heraufstufenZuEtb', () => {
  function sendeMock() {
    return vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ id: 1 }), { status: 200 }));
  }

  it('sendet die gewählten Anhänge als `anhang_ids`', async () => {
    const fetchMock = sendeMock();
    await heraufstufenZuEtb(7, 3, 'meldung', 'Deich', [11, 12]);
    const [pfad, init] = fetchMock.mock.calls[0];
    expect(pfad).toBe('/api/einsaetze/7/chat/nachrichten/3/heraufstufen-etb');
    expect(JSON.parse(String(init?.body))).toEqual({
      typ: 'meldung',
      inhalt: 'Deich',
      anhang_ids: [11, 12],
    });
  });

  it('lässt das Feld ohne Auswahl weg', async () => {
    const fetchMock = sendeMock();
    await heraufstufenZuEtb(7, 3, 'lage', 'Deich', []);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      typ: 'lage',
      inhalt: 'Deich',
    });
  });
});
