import { expect, test } from '@playwright/test';

/**
 * Der e2e-Dev-Server liefert eigene Module mit `no-store` aus, nicht mit `no-cache` (LLH-1932).
 *
 * Jede volle Seitenladung im Dev-Server holt rund 1.200 einzelne Module. Mit `no-cache` und ETag
 * revalidiert Chromium jedes davon (304). Unter der Last des Gates (3 Worker) brach dabei ab und
 * zu der ganze Modulgraph ab: `main.tsx` meldete einen Ladefehler, die übrigen Abrufe endeten mit
 * `ERR_ABORTED`, und die Seite blieb schwarz. Ohne HTTP-Cache trat das nicht mehr auf. Am
 * häufigsten traf es die Prüffläche C10 (`trefflaeche-pruefflaechen.spec.ts`, 20 volle Ladungen),
 * und zwar an einem wandernden Datenanker. `vite.config.ts` (`moduleOhneCache`) schaltet die
 * Revalidierung im e2e-Lauf ab; dieser Spec misst, dass das wirkt.
 *
 * Gegenprobe: Die vorgebündelten Pakete bleiben `immutable`. Sie werden nie revalidiert, und die
 * großen (`antd.js`, 3,2 MB) bei jeder Ladung neu zu holen, kostete nur Zeit.
 */
test('eigene Module kommen ohne Cache, vorgebündelte Pakete bleiben im Cache', async ({
  page,
  request,
}) => {
  await page.goto('/login');
  await expect(page.getByRole('button', { name: 'Anmelden', exact: true })).toBeVisible();

  for (const pfad of ['/src/main.tsx', '/src/App.tsx', '/src/index.css', '/@vite/client']) {
    const antwort = await request.get(pfad);
    expect(antwort.status(), pfad).toBe(200);
    expect(antwort.headers()['cache-control'], `${pfad}: Cache-Control`).toBe('no-store');
  }

  // Ohne `?v=` wie in `dev-server-antwortgroesse.spec.ts`: Vite erkennt das Paket am Pfad und
  // vergleicht keinen Browser-Hash, der sich bei einer Neu-Vorbündelung gerade ändern könnte.
  const paket = await request.get('/node_modules/.vite/deps/antd.js');
  expect(paket.status(), 'antd.js').toBe(200);
  expect(paket.headers()['cache-control'], 'antd.js: Cache-Control').toBe(
    'max-age=31536000,immutable',
  );
});
