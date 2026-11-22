import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Vorwärm-Skript der iOS-Hülle (LLH-1980, `ios/App/Huelle/vorwaermen.js`): die Hülle führt es
 * per `callAsyncJavaScript` als Funktionsrumpf mit den Argumenten `pfade` und `gleichzeitig` aus,
 * damit die Assets im HTTP-Cache des Datenspeichers liegen, bevor sie die Oberfläche ablegt.
 */
const skript = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../../ios/App/Huelle/vorwaermen.js'),
  'utf8',
);

interface Ergebnis {
  ok: number;
  fehler: string[];
}

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
  ...argumente: string[]
) => (pfade: string[], gleichzeitig: number) => Promise<Ergebnis>;

function vorwaermen(pfade: string[], gleichzeitig: number): Promise<Ergebnis> {
  return new AsyncFunction('pfade', 'gleichzeitig', skript)(pfade, gleichzeitig);
}

function antwort(ok: boolean): Response {
  return { ok, arrayBuffer: () => Promise.resolve(new ArrayBuffer(1)) } as unknown as Response;
}

describe('Vorwärm-Skript der iOS-Hülle (LLH-1980)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('holt jeden Pfad unter der Wurzel mit force-cache', async () => {
    const abruf = vi.fn().mockResolvedValue(antwort(true));
    vi.stubGlobal('fetch', abruf);
    const ergebnis = await vorwaermen(['assets/a.js', 'assets/b.css'], 4);
    expect(ergebnis).toEqual({ ok: 2, fehler: [] });
    expect(abruf.mock.calls.map((c) => c[0]).sort()).toEqual(['/assets/a.js', '/assets/b.css']);
    for (const [, optionen] of abruf.mock.calls) {
      expect(optionen).toEqual({ cache: 'force-cache', credentials: 'same-origin' });
    }
  });

  it('hält höchstens die erlaubte Zahl gleichzeitig offen', async () => {
    let offen = 0;
    let hoechstens = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        offen += 1;
        hoechstens = Math.max(hoechstens, offen);
        await new Promise((r) => setTimeout(r, 1));
        offen -= 1;
        return antwort(true);
      }),
    );
    const pfade = ['a', 'b', 'c', 'd', 'e', 'f'].map((n) => `assets/${n}.js`);
    const ergebnis = await vorwaermen(pfade, 2);
    expect(ergebnis.ok).toBe(6);
    expect(hoechstens).toBe(2);
  });

  it('meldet fehlgeschlagene und nicht ok beantwortete Pfade', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (pfad: string) => {
        if (pfad === '/assets/weg.js') throw new TypeError('Load failed');
        return antwort(pfad !== '/assets/404.js');
      }),
    );
    const ergebnis = await vorwaermen(['assets/a.js', 'assets/weg.js', 'assets/404.js'], 4);
    expect(ergebnis.ok).toBe(1);
    expect(ergebnis.fehler.sort()).toEqual(['assets/404.js', 'assets/weg.js']);
  });

  it('liest jeden Körper ganz, damit er im Cache landet', async () => {
    const gelesen = vi.fn(() => Promise.resolve(new ArrayBuffer(1)));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, arrayBuffer: gelesen }) as unknown as Response),
    );
    await vorwaermen(['assets/a.js'], 4);
    expect(gelesen).toHaveBeenCalledTimes(1);
  });

  it('leere Liste ergibt ok 0', async () => {
    const abruf = vi.fn();
    vi.stubGlobal('fetch', abruf);
    expect(await vorwaermen([], 4)).toEqual({ ok: 0, fehler: [] });
    expect(abruf).not.toHaveBeenCalled();
  });
});
