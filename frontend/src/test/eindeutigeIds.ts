/**
 * Eindeutige antd-Kennungen unter Vitest (LLH-1625). Steht in `vite.config.ts` als ERSTE
 * Setup-Datei, damit der Hook hängt, bevor irgendein Modul antd lädt.
 *
 * `useId` aus `@rc-component/util` liefert unter `NODE_ENV=test` für jeden Aufruf ohne eigene
 * Kennung die Konstante `'test-id'`. Seit antd 6.7 nutzen Collapse-Inhalt, Menüs und
 * Auswahlfelder diese Kennung; das `aria-labelledby` eines Dialogs zeigte dann auf das erste
 * Element mit `id="test-id"`, und `findByRole('dialog', { name })` fand nichts. In der App gilt
 * `React.useId`, dort trat der Fehler nie auf.
 *
 * Ein `vi.mock` greift hier nicht: Vitest lädt antd und `@rc-component/*` an Vite vorbei über
 * Node. `NODE_ENV` umzustellen träfe zu viel (Select, TextArea, Tabs, Portal und message haben
 * eigene Test-Zweige). Der Ladehook streicht deshalb nur in `hooks/useId.js` (es und lib) den
 * Test-Zweig; übrig bleibt `React.useId` wie in der App. Fehlt der Zweig nach einem Update,
 * bricht das Laden laut ab, statt still wieder `test-id` zu liefern.
 */
import { registerHooks } from 'node:module';

const USE_ID = /[\\/]@rc-component[\\/]util[\\/](?:es|lib)[\\/]hooks[\\/]useId\.js$/;
const TEST_ZWEIG = /process\.env\.NODE_ENV\s*===\s*['"]test['"]/g;

const MARKE = Symbol.for('lifeline-hub.eindeutigeIds');
const global = globalThis as typeof globalThis & { [MARKE]?: true };

if (!global[MARKE]) {
  global[MARKE] = true;
  registerHooks({
    load(url, context, nextLoad) {
      const ergebnis = nextLoad(url, context);
      if (!USE_ID.test(url) || ergebnis.source == null) return ergebnis;
      const quelle = String(ergebnis.source);
      const ohneTestZweig = quelle.replace(TEST_ZWEIG, 'false');
      if (ohneTestZweig === quelle) {
        throw new Error(
          `eindeutigeIds: Test-Zweig in ${url} nicht gefunden. @rc-component/util hat useId ` +
            'geändert; src/test/eindeutigeIds.ts anpassen.',
        );
      }
      return { ...ergebnis, source: ohneTestZweig };
    },
  });
}
