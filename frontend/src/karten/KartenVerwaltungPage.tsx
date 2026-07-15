import { Alert, Typography } from 'antd';
import { useAuth } from '../auth/AuthContext';
import AdminPage from '../components/AdminPage';
import SegmentSektionen from '../components/SegmentSektionen';
import OnlineQuellenVerwaltung from './OnlineQuellenVerwaltung';
import OfflineKartenVerwaltung from './OfflineKartenVerwaltung';

/**
 * Admin-Sub-Seite `/admin/karten`: Verwaltung der Karten-Quellen — Online-Basemap-Quellen
 * (LFH-180) und Offline-Karten-Manager (LFH-181, In-App-Download von MBTiles). Schreiben nur
 * System-Admin — Führungskräfte sehen die Tabellen read-only (Hinweis-Banner). Gliederung via
 * Segmented (LFH-281); beide Panels bleiben gemountet, damit das Download-/Bau-Polling der
 * Offline-Sektion beim Pillen-Wechsel nicht abreißt.
 */
export default function KartenVerwaltungPage() {
  const { benutzer } = useAuth();
  const istAdmin = benutzer?.system_rolle === 'admin';

  const onlineSektion = (
    <>
      <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
        Quellen mit Status „aktiv" erscheinen im Basemap-Switcher der Lagekarte.
      </Typography.Paragraph>
      <OnlineQuellenVerwaltung />
    </>
  );

  const offlineSektion = (
    <>
      <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
        MBTiles für den netzlosen Betrieb. In der Prep-Phase (mit Netz) herunterladen; die aktive
        Karte wird im Feld offline ausgeliefert. Pflicht-Attribution ist auf der Karte sichtbar.
      </Typography.Paragraph>
      <OfflineKartenVerwaltung />
    </>
  );

  return (
    <AdminPage
      titel="Karten-Verwaltung"
      beschreibung="Online-Basemap-Quellen und Offline-Karten (MBTiles) für die Lagekarte."
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
      <SegmentSektionen
        ariaLabel="Karten-Bereiche"
        sektionen={[
          { key: 'online', label: 'Online-Quellen', inhalt: onlineSektion },
          { key: 'offline', label: 'Offline-Karten', inhalt: offlineSektion },
        ]}
      />
    </AdminPage>
  );
}
