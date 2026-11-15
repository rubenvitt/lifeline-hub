/** Pins für Runtime-Konfiguration, die sich in einem jsdom-Render nicht sinnvoll ausführen lässt. */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const src = dirname(fileURLToPath(import.meta.url));
const frontend = join(src, '..');
const main = readFileSync(join(src, 'main.tsx'), 'utf8');
const viteConfig = readFileSync(join(frontend, 'vite.config.ts'), 'utf8');

/** Quelldateien unter `src/` ohne Tests. */
function quellen(verzeichnis = src): { datei: string; text: string }[] {
  const aus: { datei: string; text: string }[] = [];
  for (const name of readdirSync(verzeichnis)) {
    const pfad = join(verzeichnis, name);
    if (statSync(pfad).isDirectory()) {
      if (name !== 'test') aus.push(...quellen(pfad));
    } else if (/\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) {
      aus.push({ datei: relative(src, pfad), text: readFileSync(pfad, 'utf8') });
    }
  }
  return aus;
}

describe('Runtime-Konfiguration (LFH-334)', () => {
  it('aktiviert eine neue PWA-Version nur per Prompt und meldet sie an die Betriebszeile', () => {
    expect(viteConfig).toMatch(/registerType:\s*'prompt'/);
    expect(viteConfig).not.toMatch(/registerType:\s*'autoUpdate'/);
    expect(main).toContain('onNeedRefresh: meldeAppAktualisierungVerfuegbar');
  });

  it('stellt die Paketversion dem sichtbaren Benutzermenü bereit', () => {
    expect(viteConfig).toContain('__APP_VERSION__: JSON.stringify(frontendVersion)');
  });

  it('Alarme stehen in der Alarmzone, nie in antds Benachrichtigungsfläche (LLH-1735)', () => {
    // `frontend/AGENTS.md`, Rahmen, „Alarme stehen in der Alarmzone“: die Zone verschiebt den
    // Inhalt; eine antd-Notification läge wieder über Aktionen, Drawer und Dialogen.
    expect(main).toContain('<AntApp>');
    expect(main).not.toMatch(/<AntApp[^>]*notification=/);
    const aufrufe = quellen()
      .filter(({ text }) =>
        /notification\.(open|info|warning|error|success)\(|const \{[^}]*\bnotification\b[^}]*\} = App\.useApp\(\)/.test(
          text,
        ),
      )
      .map(({ datei }) => datei);
    expect(aufrufe).toEqual([]);
  });
});
