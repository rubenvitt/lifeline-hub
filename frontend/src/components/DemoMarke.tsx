import { Tag } from 'antd';

/**
 * Marke „Demo“ an Stammdaten aus dem Demo-Import (LFH-733, Spec `demo-daten`,
 * `openspec/changes/lfh-733-demo-marke-stammdaten/design.md` D5).
 *
 * Bewusst ein neutrales `Tag` ohne `color`: der Text trägt die Bedeutung (WCAG 1.4.1), die
 * Umrandung ist die Form. Es ist kein Status — deshalb keine Karte in `theme/statusFarben.ts`
 * und kein `StatusTag`. Blau schiede aus, weil Blau bedient (`frontend/AGENTS.md`, „Farbe und
 * Zeichen“). Kataloge, Detailköpfe, Auswahllisten und Einsatz-Tabellen zeigen die Marke nur
 * über diese Komponente.
 */
export default function DemoMarke() {
  return <Tag title="Stammdaten aus dem Demo-Import">Demo</Tag>;
}
