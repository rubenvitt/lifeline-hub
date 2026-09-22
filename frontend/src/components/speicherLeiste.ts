import type { CSSProperties } from 'react';

// Umgezogen aus `pages/einstellungen/einsatzEinstellungenForm.ts` (22.09.2026): die Leiste
// wird auch von `stammdaten/` (Organisation, Fahrzeug- und Personal-Detail) benutzt und ist
// damit kein Einstellungs-Detail mehr, sondern ein Baustein aller Formularseiten.

/**
 * Speicher-Leiste am unteren Rand einer Sektion — sticky, mit Trennlinie und eigenem Grund.
 *
 * **Sticky ist die halbe Zusicherung, „im `<form>`" die andere.** Der Knopf lag bis C10 im
 * Kopf-Aktionen-Slot von `EinsatzSeite`, also als DOM-Geschwister AUSSERHALB des `<form>` —
 * dort konnte er nichts übermitteln, weshalb der Bestand `form.submit()` von Hand rief und
 * Enter im Formular tot war (Erfassungs-Norm B4/LFH-332, Befund H69). Hier trägt er
 * `htmlType="submit"`, und die eingebaute Formularübermittlung des Browsers erledigt den
 * Rest. Sticky, weil er sonst bei neun Feldern aus dem Bild scrollt, während man das letzte
 * ausfüllt (Bauform übernommen aus `pages/EinheitDetailPage.tsx`, Befund M26).
 *
 * Kein `<Space>`: hier steht genau EIN Knopf, kein `danger`-Nachbar — die Abstandsregel aus
 * LFH-363 hat hier nichts zu entscheiden.
 */
export function speicherLeisteStil(token: {
  colorBgContainer: string;
  paddingSM: number;
  colorBorderSecondary: string;
}): CSSProperties {
  return {
    position: 'sticky',
    bottom: 0,
    zIndex: 1,
    background: token.colorBgContainer,
    paddingBlock: token.paddingSM,
    borderTop: `1px solid ${token.colorBorderSecondary}`,
  };
}
