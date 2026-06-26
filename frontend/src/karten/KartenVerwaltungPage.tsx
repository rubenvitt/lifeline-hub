import { Alert, Typography } from 'antd';
import { useAuth } from '../auth/AuthContext';
import OnlineQuellenVerwaltung from './OnlineQuellenVerwaltung';

/**
 * Admin-Sub-Seite `/admin/karten`: Verwaltung der Karten-Quellen.
 * Aktuell nur die Online-Basemap-Quellen (LFH-180); der Offline-Manager (LFH-181)
 * dockt hier später als zweite Sektion an. Schreiben nur System-Admin —
 * Führungskräfte sehen die Tabelle read-only (Hinweis-Banner).
 */
export default function KartenVerwaltungPage() {
  const { benutzer } = useAuth();
  const istAdmin = benutzer?.system_rolle === 'admin';

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', paddingTop: 24 }}>
      <Typography.Title level={3} style={{ marginTop: 0 }}>
        Karten-Verwaltung
      </Typography.Title>
      <Typography.Paragraph type="secondary">
        Online-Basemap-Quellen für die Lagekarte. Quellen mit Status „aktiv" erscheinen im
        Basemap-Switcher der Lagekarte.
      </Typography.Paragraph>

      {!istAdmin && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          title="Nur lesend"
          description="Karten-Quellen ändern dürfen nur System-Admins. Du siehst die Liste read-only."
        />
      )}

      <Typography.Title level={5}>Online-Quellen</Typography.Title>
      <OnlineQuellenVerwaltung />
    </div>
  );
}
