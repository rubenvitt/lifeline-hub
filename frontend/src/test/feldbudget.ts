/**
 * Sichtbare Formularfelder unter `wurzel` (Feldbudget, `frontend/AGENTS.md`): außerhalb eines
 * Klappteils oder in einem offenen. Felder hinter `forceRender` stehen im Baum, zählen zugeklappt
 * aber nicht; Muster wie `meldungen/MeldungFormular.test.tsx`.
 */
export function sichtbareFormfelder(wurzel: ParentNode): HTMLElement[] {
  return [...wurzel.querySelectorAll<HTMLElement>('.ant-form-item')].filter((f) => {
    const klapp = f.closest('.ant-collapse-panel');
    return klapp == null || klapp.classList.contains('ant-collapse-panel-active');
  });
}
