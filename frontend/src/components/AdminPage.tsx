import { Typography, theme } from 'antd';
import type { ReactNode } from 'react';
import { flaeche } from '../theme/tokens';
import { seitenkopfStil, seitentitelStil } from './EinsatzSeite';
import { useModusFarben } from './rahmenStil';

interface AdminPageProps {
  titel: ReactNode;
  /** Einzeilige, gedämpfte Beschreibung unter dem Titel. */
  beschreibung?: ReactNode;
  /**
   * Rechter Header-Slot. WICHTIG: wird AUSSERHALB jedes `<Form>` gerendert — ein
   * Speichern-Button hier darf NICHT `htmlType="submit"` tragen (submittet als
   * DOM-Geschwister außerhalb des `<form>` nichts). Verdrahtung: Seite hält
   * `Form.useForm()`, gibt `<Button onClick={() => form.submit()}>` hier rein und
   * legt `<Form form={form}>` in `children`.
   */
  aktionen?: ReactNode;
  /** Optionaler Hinweis unter dem Header (z. B. ein read-only-Alert). */
  hinweis?: ReactNode;
  /** Container-Breite in px. Default `flaeche.seiteSchmal`. */
  breite?: number;
  children: ReactNode;
}

/**
 * Geteilter schlanker Seiten-Rahmen + Header für die Verwaltungs-Seiten (LFH-281):
 * Stammdaten, Globale Einstellungen, Karten, Benutzer. Level-4-Überschrift, Abstände und
 * Farben aus `theme.useToken()` bzw. den Rollen des Modus.
 *
 * NEUENTWURF (21.09.2026): derselbe Seitenkopf wie `EinsatzSeite` — 44-px-Leiste mit
 * Haarlinie, Titel 14/600, rechts der Aktionen-Slot. Anders als dort NICHT vollbreit: die
 * Seite steht neben der Verwaltungs-Seitenleiste, ein negativer Rand liefe in sie hinein.
 * Die Spalte ist linksbündig an der Seitenleiste verankert statt zentriert.
 */
export default function AdminPage({
  titel,
  beschreibung,
  aktionen,
  hinweis,
  breite = flaeche.seiteSchmal,
  children,
}: AdminPageProps) {
  const { token } = theme.useToken();
  const farben = useModusFarben();
  return (
    <div style={{ maxWidth: breite }}>
      <div data-lfh="seitenkopf" style={seitenkopfStil(token, farben, false)}>
        <Typography.Title level={4} style={{ ...seitentitelStil(farben), minWidth: 0 }}>
          {titel}
        </Typography.Title>
        {/* `data-lfh` markiert den Kopf-Slot, damit „genau eine Primäraktion im Kopf" AM KOPF
          prüfbar ist statt global (LFH-340 · C5, dieselbe Bauform wie
          `data-lfh="seitenkopf-aktionen"` an `EinsatzSeite`). Global gezählt wäre die Aussage
          falsch: eine Sektion mit Formular im Inhalt hat dort zu Recht einen Absende-Knopf. */}
        {aktionen && <div data-lfh="adminpage-aktionen">{aktionen}</div>}
      </div>
      {beschreibung && (
        <div style={{ marginBottom: token.margin }}>
          <Typography.Text type="secondary">{beschreibung}</Typography.Text>
        </div>
      )}
      {hinweis && <div style={{ marginBottom: token.marginLG }}>{hinweis}</div>}
      {children}
    </div>
  );
}
