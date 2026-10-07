import { Alert, Typography } from 'antd';
import { useAuth } from '../auth/AuthContext';
import AdminPage from '../components/AdminPage';
import OnlineQuellenVerwaltung from './OnlineQuellenVerwaltung';

/** Admin-Sektion `/admin/karten/online` — Online-Quellen der Kartengrundlage. Schreiben nur System-Admin;
    Führungskräfte sehen read-only. */
export default function KartenOnlineSektion() {
  const { benutzer } = useAuth();
  const istAdmin = benutzer?.system_rolle === 'admin';
  return (
    <AdminPage
      titel="Online-Quellen"
      beschreibung="Online-Quellen für die Kartengrundlage der Lagekarte."
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
        Quellen mit Status „aktiv" erscheinen in der Wahl der Kartengrundlage auf der Lagekarte.
      </Typography.Paragraph>
      <OnlineQuellenVerwaltung />
    </AdminPage>
  );
}
