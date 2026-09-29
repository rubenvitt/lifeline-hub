import { afterEach, describe, expect, it, vi } from 'vitest';
import { abonniereAuthWechsel, meldeAuthWechsel, type AuthWechsel } from './authKanal';

afterEach(() => vi.unstubAllGlobals());

/** BroadcastChannel stellt asynchron zu; eine Makrotask reicht in Node nicht immer. */
async function warteAuf(bedingung: () => boolean): Promise<void> {
  for (let i = 0; i < 50 && !bedingung(); i++) {
    await new Promise((r) => setTimeout(r, 5));
  }
}

const ruhe = () => new Promise((r) => setTimeout(r, 30));

/** Ein „anderer Tab“: ein eigenes Kanalobjekt auf demselben Namen. */
function andererTab() {
  const kanal = new BroadcastChannel('lfh-auth');
  const gehoert: unknown[] = [];
  kanal.onmessage = (e: MessageEvent) => gehoert.push(e.data);
  return { kanal, gehoert, schliessen: () => kanal.close() };
}

describe('authKanal (LFH-387)', () => {
  it('stellt Meldungen eines anderen Tabs zu', async () => {
    const empfangen: AuthWechsel[] = [];
    const abbestellen = abonniereAuthWechsel((w) => empfangen.push(w));
    const tab = andererTab();
    try {
      tab.kanal.postMessage({ art: 'angemeldet' });
      tab.kanal.postMessage({ art: 'abgemeldet' });
      await warteAuf(() => empfangen.length === 2);
      expect(empfangen).toEqual([{ art: 'angemeldet' }, { art: 'abgemeldet' }]);
    } finally {
      tab.schliessen();
      abbestellen();
    }
  });

  it('meldet an andere Tabs — mit und ohne eigenen Zuhörer', async () => {
    const tab = andererTab();
    try {
      meldeAuthWechsel({ art: 'abgemeldet' });
      const abbestellen = abonniereAuthWechsel(() => {});
      meldeAuthWechsel({ art: 'angemeldet' });
      abbestellen();
      await warteAuf(() => tab.gehoert.length === 2);
      expect(tab.gehoert).toEqual([{ art: 'abgemeldet' }, { art: 'angemeldet' }]);
    } finally {
      tab.schliessen();
    }
  });

  it('der meldende Tab hört sich nicht selbst', async () => {
    const empfangen: AuthWechsel[] = [];
    const abbestellen = abonniereAuthWechsel((w) => empfangen.push(w));
    const zweiter = abonniereAuthWechsel((w) => empfangen.push(w));
    try {
      meldeAuthWechsel({ art: 'angemeldet' });
      await ruhe();
      expect(empfangen).toEqual([]);
    } finally {
      zweiter();
      abbestellen();
    }
  });

  it('stellt nach dem Abbestellen nichts mehr zu', async () => {
    const empfangen: AuthWechsel[] = [];
    const abbestellen = abonniereAuthWechsel((w) => empfangen.push(w));
    abbestellen();
    const tab = andererTab();
    try {
      tab.kanal.postMessage({ art: 'angemeldet' });
      await ruhe();
      expect(empfangen).toEqual([]);
    } finally {
      tab.schliessen();
    }
  });

  it('verwirft fremde oder kaputte Nachrichten auf demselben Kanal', async () => {
    const empfangen: AuthWechsel[] = [];
    const abbestellen = abonniereAuthWechsel((w) => empfangen.push(w));
    const tab = andererTab();
    try {
      tab.kanal.postMessage({ art: 'boese' });
      tab.kanal.postMessage('text');
      tab.kanal.postMessage({ art: 'abgemeldet', benutzer: { id: 9 } });
      await warteAuf(() => empfangen.length === 1);
      await ruhe();
      expect(empfangen).toEqual([{ art: 'abgemeldet' }]);
    } finally {
      tab.schliessen();
      abbestellen();
    }
  });

  it('ist ohne BroadcastChannel ein stiller No-op', () => {
    vi.stubGlobal('BroadcastChannel', undefined);
    const abbestellen = abonniereAuthWechsel(() => {});
    expect(() => meldeAuthWechsel({ art: 'angemeldet' })).not.toThrow();
    expect(() => abbestellen()).not.toThrow();
  });
});
