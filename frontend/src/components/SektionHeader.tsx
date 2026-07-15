import { Typography, theme } from 'antd';
import type { ReactNode } from 'react';

interface SektionHeaderProps {
  titel: ReactNode;
  /** Einzeilige, gedämpfte Beschreibung unter dem Titel. */
  beschreibung?: ReactNode;
  /** Rechter Slot (z. B. eine Sektions-Aktion). */
  extra?: ReactNode;
  children?: ReactNode;
}

/**
 * Wiederkehrender Sektions-Titel (Title level 5 + optionale gedämpfte Beschreibung)
 * für die Verwaltungs-Seiten (LFH-281). Zentralisiert die sonst überall manuell
 * gesetzten Typography-Margin-Resets; Abstände aus `theme.useToken()`.
 */
export default function SektionHeader({ titel, beschreibung, extra, children }: SektionHeaderProps) {
  const { token } = theme.useToken();
  return (
    <div style={{ marginBottom: token.marginSM }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: token.margin,
        }}
      >
        <Typography.Title level={5} style={{ margin: 0 }}>
          {titel}
        </Typography.Title>
        {extra}
      </div>
      {beschreibung && (
        <Typography.Paragraph type="secondary" style={{ marginTop: token.marginXXS, marginBottom: 0 }}>
          {beschreibung}
        </Typography.Paragraph>
      )}
      {children}
    </div>
  );
}
