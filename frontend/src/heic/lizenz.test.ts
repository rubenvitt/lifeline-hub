import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Hinweis und Quellenliste des HEIC-Decoders (LFH-1000, `LIESMICH.md`) folgen der Fassung im
 * Paket. Wer `libheif-js` hebt, ohne Hinweis und Liste nachzuziehen, verteilte die Quelle eines
 * anderen Stands, als im Binary steckt.
 */
// jsdom setzt `import.meta.url` auf http://; Pfade deshalb ab dem Frontend-Ordner (cwd der Suite).
const require = createRequire(join(process.cwd(), 'package.json'));
const lies = (pfad: string) => readFileSync(join(process.cwd(), pfad), 'utf8');

const paketVersion = (JSON.parse(lies('package.json')) as { dependencies: Record<string, string> })
  .dependencies['libheif-js'];
const hinweis = lies('public/lizenzen/HEIC-DECODER.txt');
const staende = new Map(
  lies('../scripts/release/drittanbieter-quellen.txt')
    .split('\n')
    .filter((z) => z.trim() && !z.startsWith('#'))
    .map((z) => {
      const [name, repo, tag, commit] = z.trim().split(/\s+/);
      return [name!, { repo: repo!, tag: tag!, commit: commit! }];
    }),
);
const wasm = readFileSync(require.resolve('libheif-js/libheif-wasm/libheif.wasm')).toString(
  'latin1',
);

describe('HEIC-Decoder: Hinweis und Quellen (LFH-1000)', () => {
  it('libheif-js ist exakt gepinnt und steht so in der Quellenliste', () => {
    expect(paketVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(staende.get('libheif-js')?.tag).toBe(paketVersion);
  });

  it('die Quellenliste trägt jede Bibliothek mit vollem Commit', () => {
    expect([...staende.keys()].sort()).toEqual([
      'libde265',
      'libheif',
      'libheif-emscripten',
      'libheif-js',
    ]);
    for (const { commit } of staende.values()) expect(commit).toMatch(/^[0-9a-f]{40}$/);
  });

  it('die WebAssembly-Datei enthält genau die gelisteten Fassungen von libheif und libde265', () => {
    for (const name of ['libheif', 'libde265']) {
      const fassung = staende.get(name)!.tag.replace(/^v/, '');
      expect(wasm, `${name} ${fassung}`).toContain(`\0${fassung}\0`);
    }
  });

  it('der Hinweis nennt jeden Stand und den Austauschweg', () => {
    for (const [name, { tag }] of staende) {
      expect(hinweis, name).toContain(`Tag ${tag}`);
    }
    expect(hinweis).toContain(`libheif-js ${paketVersion}`);
    expect(hinweis).toContain('--heic-decoder-verzeichnis');
    expect(hinweis).toContain('/bibliotheken/libheif/');
  });
});
