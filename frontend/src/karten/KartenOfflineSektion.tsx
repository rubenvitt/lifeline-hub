import { Alert, Typography } from 'antd';
import { useAuth } from '../auth/AuthContext';
import AdminPage from '../components/AdminPage';
import OfflineKartenVerwaltung from './OfflineKartenVerwaltung';

/** Admin-Sektion `/admin/karten/offline` — Offline-Karten-Manager (LFH-181, MBTiles-Download).
 *  Schreiben nur System-Admin; Führungskräfte sehen read-only (Hinweis-Banner). */
export default function KartenOfflineSektion() {
  const { benutzer } = useAuth();
  const istAdmin = benutzer?.system_rolle === 'admin';
  return (
    <AdminPage
      titel="Offline-Karten"
      beschreibung="Offline-Karten (MBTiles) für den netzlosen Betrieb der Lagekarte."
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
        MBTiles für den netzlosen Betrieb. In der Prep-Phase (mit Netz) herunterladen; die aktive
        Karte wird im Feld offline ausgeliefert. Pflicht-Attribution ist auf der Karte sichtbar.
      </Typography.Paragraph>
      <OfflineKartenVerwaltung />
    </AdminPage>
  );
}
