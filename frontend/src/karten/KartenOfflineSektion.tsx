import { useAuth } from '../auth/AuthContext';
import AdminPage from '../components/AdminPage';
import { NUR_ADMIN } from '../components/nurAnsicht';
import { RechteHinweis } from '../components/SpeicherHinweis';
import OfflineKartenVerwaltung from './OfflineKartenVerwaltung';

/** Admin-Sektion `/admin/karten/offline` — Offline-Karten-Manager. Schreiben nur System-Admin;
    alle anderen sehen „Nur Ansicht · nur System-Admin“ (LFH-1078, keine Erklärung im Text). */
export default function KartenOfflineSektion() {
  const { benutzer } = useAuth();
  const istAdmin = benutzer?.system_rolle === 'admin';
  return (
    <AdminPage
      titel="Offline-Karten"
      // Admin: kein `hinweis`, sonst trüge AdminPage einen leeren Abstand.
      hinweis={istAdmin ? undefined : <RechteHinweis sichtbar text={NUR_ADMIN} />}
    >
      <OfflineKartenVerwaltung />
    </AdminPage>
  );
}
