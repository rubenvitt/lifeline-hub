import { Flex, Typography, theme } from 'antd';
import type { ReactNode } from 'react';

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
  /** Container-Breite in px. Default 900. */
  breite?: number;
  children: ReactNode;
}

/**
 * Geteilter schlanker Seiten-Rahmen + Header für die Verwaltungs-Seiten (LFH-281):
 * Stammdaten, Globale Einstellungen, Karten, Benutzer. Vereinheitlicht die zuvor
 * divergierenden Container (maxWidth/margin/padding) auf eine zentrierte Spalte und
 * ersetzt die redundanten level-3-H3s durch einen level-4-Header (die AdminLayout-
 * Top-Tabs benennen die Sektion bereits). Abstände/Farben aus `theme.useToken()`.
 */
export default function AdminPage({
  titel,
  beschreibung,
  aktionen,
  hinweis,
  breite = 900,
  children,
}: AdminPageProps) {
  const { token } = theme.useToken();
  return (
    <div style={{ maxWidth: breite, margin: '0 auto' }}>
      <Flex
        justify="space-between"
        align="flex-start"
        gap={token.margin}
        style={{ marginBottom: token.marginLG }}
      >
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>
            {titel}
          </Typography.Title>
          {beschreibung && <Typography.Text type="secondary">{beschreibung}</Typography.Text>}
        </div>
        {aktionen && <div>{aktionen}</div>}
      </Flex>
      {hinweis && <div style={{ marginBottom: token.marginLG }}>{hinweis}</div>}
      {children}
    </div>
  );
}
