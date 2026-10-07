import { useAuth } from '../auth/AuthContext';
import AdminPage from '../components/AdminPage';
import { NUR_ADMIN } from '../components/nurAnsicht';
import { RechteHinweis } from '../components/SpeicherHinweis';
import OnlineQuellenVerwaltung from './OnlineQuellenVerwaltung';

/** Admin-Sektion `/admin/karten/online` — Online-Quellen der Kartengrundlage. Schreiben nur
    System-Admin; alle anderen sehen „Nur Ansicht · nur System-Admin“ (LFH-1078, keine Erklärung
    im Text). */
export default function KartenOnlineSektion() {
  const { benutzer } = useAuth();
  const istAdmin = benutzer?.system_rolle === 'admin';
  return (
    <AdminPage
      titel="Online-Quellen"
      // Admin: kein `hinweis`, sonst trüge AdminPage einen leeren Abstand.
      hinweis={istAdmin ? undefined : <RechteHinweis sichtbar text={NUR_ADMIN} />}
    >
      <OnlineQuellenVerwaltung />
    </AdminPage>
  );
}
