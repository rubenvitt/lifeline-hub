import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Erst klicken, wenn der Dialog steht (LLH-2065, Muster LFH-1114 in `einsatz-kern.ts`).
 *
 * antd blendet Modal und Popconfirm mit rc-motion ein: Das Element trägt währenddessen
 * `ant-zoom-appear` bzw. `ant-zoom-big-appear` (samt `-start`/`-active`), solange nimmt es
 * keine Zeigerereignisse sicher an. Unter Last (vier Worker, CPU voll) fiel der Klick auf
 * „Entwurf anlegen“ in diese Phase: kein POST, der Dialog blieb ohne Fehlermeldung offen. Ohne
 * Zusatzlast fiel der Klick in 37 von 40 Läufen in die Einblendung und ging nur meist gut.
 * `fill` traf das Feld trotzdem, weil es über den Fokus schreibt, nicht über den Zeiger.
 *
 * Geprüft werden das Ziel und seine Vorfahren: beim Modal liegt die Klasse auf dem Element mit
 * `role="dialog"`, beim Popconfirm auf dem Popover um den Knopf.
 */
const EINBLENDUNG = /^ant-[a-z-]+-(appear|enter)$/;

/** Wartet, bis `ziel` sichtbar ist und weder es noch ein Vorfahr mehr einblendet. */
export async function eingeblendet(ziel: Locator): Promise<Locator> {
  await expect(ziel).toBeVisible();
  await expect
    .poll(
      () =>
        ziel.evaluate((el, quelle) => {
          const muster = new RegExp(quelle);
          for (let e: Element | null = el; e; e = e.parentElement) {
            if (Array.from(e.classList).some((k) => muster.test(k))) return true;
          }
          return false;
        }, EINBLENDUNG.source),
      { message: 'Einblendung läuft noch (ant-…-appear/-enter)' },
    )
    .toBe(false);
  return ziel;
}

/** Der Dialog `name`, sobald er ganz eingeblendet ist. */
export async function dialogSteht(
  page: Page,
  name: string | RegExp,
  { exact }: { exact?: boolean } = {},
): Promise<Locator> {
  return eingeblendet(page.getByRole('dialog', { name, exact }));
}
