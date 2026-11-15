import { screen, type ByRoleMatcher } from '@testing-library/react';

type Name = NonNullable<Parameters<typeof screen.queryByRole>[1]>['name'];

/**
 * Ein Eintrag der Einsatz-Navigation unabhängig von seiner Form (nur für Tests): frei ein Link,
 * gesperrt ein Knopf (LLH-1732). Wer die ABWESENHEIT eines ausgeblendeten Moduls prüft, braucht
 * beide Formen, sonst bliebe der Test grün, wenn die Zeile als gesperrter Knopf durchrutscht.
 */
export function queryNavEintrag(name: Name): HTMLElement | null {
  const rollen: ByRoleMatcher[] = ['link', 'button'];
  for (const rolle of rollen) {
    const treffer = screen.queryByRole(rolle, { name });
    if (treffer) return treffer;
  }
  return null;
}
