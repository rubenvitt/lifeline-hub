/** Pins für Runtime-Konfiguration, die sich in einem jsdom-Render nicht sinnvoll ausführen lässt. */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const src = dirname(fileURLToPath(import.meta.url));
const frontend = join(src, '..');
const main = readFileSync(join(src, 'main.tsx'), 'utf8');
const viteConfig = readFileSync(join(frontend, 'vite.config.ts'), 'utf8');

describe('Runtime-Konfiguration (LFH-334)', () => {
  it('aktiviert eine neue PWA-Version nur per Prompt und meldet sie an die Betriebszeile', () => {
    expect(viteConfig).toMatch(/registerType:\s*'prompt'/);
    expect(viteConfig).not.toMatch(/registerType:\s*'autoUpdate'/);
    expect(main).toContain('onNeedRefresh: meldeAppAktualisierungVerfuegbar');
  });

  it('stellt die Paketversion dem sichtbaren Benutzermenü bereit', () => {
    expect(viteConfig).toContain('__APP_VERSION__: JSON.stringify(frontendVersion)');
  });

  it('begrenzt die globale antd-Benachrichtigungsfläche auf drei Einträge', () => {
    expect(main).toContain('<AntApp notification={{ maxCount: 3 }}>');
  });
});
