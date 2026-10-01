import { expect, test } from '@playwright/test';

/**
 * Keine Antwort des e2e-Dev-Servers wächst über wenige MB (LFH-659).
 *
 * Node 26 bricht den Vite-Dev-Server gelegentlich mit „Lazy deopt after a fast API call with
 * return value is unsupported" ab: `Buffer.byteLength` in `res.end`, beim Ausliefern eines
 * ~11 MB großen Strings. Das war das vorgebündelte `antd.js` — 3,2 MB Code und dahinter die
 * Sourcemap als Base64-Kommentar, zusammen 11,3 MB. Danach lief jeder Folgetest in
 * `ERR_CONNECTION_REFUSED`. `vite.config.ts` (`depsOhneSourcemap`) lässt die Sourcemaps der
 * vorgebündelten Pakete im e2e-Lauf weg; dieser Spec misst, dass das wirkt.
 *
 * Gemessen werden die vorgebündelten Pakete aus `_metadata.json`, weil nur sie so groß werden:
 * eigener Quellcode kommt modulweise, und ein Modul von mehreren MB fiele schon im Review auf.
 *
 * KEIN Login: `/login` lädt den Einstieg, und der Optimierer hat danach seine Liste geschrieben.
 */

/** 4 MiB: das größte Paket (`antd.js`) misst ohne Sourcemap 3,2 MB, mit ihr 11,3 MB. */
const GRENZE_BYTES = 4 * 1024 * 1024;

interface DepsMetadaten {
  optimized: Record<string, { file: string }>;
  chunks: Record<string, { file: string }>;
}

test('vorgebündelte Pakete kommen ohne Sourcemap und unter 4 MiB', async ({ page, request }) => {
  await page.goto('/login');
  await expect(page.getByRole('button', { name: 'Anmelden', exact: true })).toBeVisible();

  const metadaten = await request.get('/node_modules/.vite/deps/_metadata.json');
  expect(metadaten.status(), 'Liste der vorgebündelten Pakete').toBe(200);
  const { optimized, chunks } = (await metadaten.json()) as DepsMetadaten;
  const dateien = [...Object.values(optimized), ...Object.values(chunks)].map((d) => d.file);

  // Gegenprobe: ohne das größte Paket in der Liste bewiese die Messung nichts.
  expect(dateien).toContain('antd.js');

  const zuGross: string[] = [];
  const mitInlineMap: string[] = [];
  for (const datei of dateien) {
    // Ohne `?v=`: Vite prüft den Browser-Hash dann nicht, und eine Neu-Optimierung mitten im
    // Lauf ergäbe kein 504. Ausgeliefert wird dieselbe Antwort wie mit Hash.
    const antwort = await request.get(`/node_modules/.vite/deps/${datei}`);
    expect(antwort.status(), datei).toBe(200);
    const inhalt = await antwort.body();
    if (inhalt.byteLength > GRENZE_BYTES) {
      zuGross.push(`${datei}: ${(inhalt.byteLength / 1e6).toFixed(1)} MB`);
    }
    if (inhalt.includes('sourceMappingURL=data:')) mitInlineMap.push(datei);
  }
  expect(zuGross, 'Antworten über 4 MiB').toEqual([]);
  // Die Größe allein deckte ein Paket ohne Importe nicht ab: dort griff die leere Map zuerst
  // nicht (`terra-draw.js`, 0,3 MB Code, 1 MB mit Map). Jede Map ist ein Rückfall.
  expect(mitInlineMap, 'Pakete mit Inline-Sourcemap').toEqual([]);
});
