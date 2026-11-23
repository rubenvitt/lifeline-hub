// Pfade des Admin-Bereichs ohne Abhängigkeit auf seine Seiten (LLH-2026): Der Alarm-Katalog
// springt zu den Anbindungen, ohne den Admin-Bereich mitzuladen. `adminNav.tsx` reicht weiter.

/** `/admin/<gruppe>/<sektion>`. */
export function adminSektionPfad(gruppe: string, sektion: string): string {
  return `/admin/${gruppe}/${sektion}`;
}

/** Die Seite „Anbindungen“: `/admin/einstellungen/anbindungen`. */
export function anbindungenPfad(): string {
  return adminSektionPfad('einstellungen', 'anbindungen');
}
