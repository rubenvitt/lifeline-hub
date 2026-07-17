import { Alert, Typography } from 'antd';
import { useAuth } from '../auth/AuthContext';
import AdminPage from '../components/AdminPage';
import OnlineQuellenVerwaltung from './OnlineQuellenVerwaltung';

/** Admin-Sektion `/admin/karten/online` — Online-Basemap-Quellen (LFH-180). Schreiben nur
 *  System-Admin; Führungskräfte sehen read-only (Hinweis-Banner). */
export default function KartenOnlineSektion() {
  const { benutzer } = useAuth();
  const istAdmin = benutzer?.system_rolle === 'admin';
  return (
    <AdminPage
      titel="Online-Quellen"
      beschreibung="Online-Basemap-Quellen für die Lagekarte."
      hinweis={
        !istAdmin ? (
          <Alert
            type="info"
            showIcon
            title="Nur lesend"
            description="Karten-Quellen ändern dürfen nur System-Admins. Du siehst die Liste read-only."
          />
        ) : undefined
      }
    >
      <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
        Quellen mit Status „aktiv" erscheinen im Basemap-Switcher der Lagekarte.
      </Typography.Paragraph>
      <OnlineQuellenVerwaltung />
    </AdminPage>
  );
}
