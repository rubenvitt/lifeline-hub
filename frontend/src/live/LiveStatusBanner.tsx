import { Alert, Badge, Button, Space, theme } from 'antd';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { abonniereLiveStatus, leseLiveStatus } from './liveStatusStore';
import {
  abonniereAppAktualisierung,
  aktualisiereAppJetzt,
  istAppAktualisierungVerfuegbar,
} from '../pwa/appAktualisierung';
import { useOfflineQueueZaehler } from '../offline/useOfflineQueueZaehler';
import OfflineRecoveryDrawer from '../offline/OfflineRecoveryDrawer';

/**
 * Eine globale Betriebszeile für Leitung, Einsatz-Live-Feed und App-Version.
 *
 * Lauscht auf das window-CustomEvent `lfh:live-status` (von `useEinsatzLiveStream` gemeldet)
 * und zeigt bei unterbrochener/wiederverbindender Leitung einen Hinweis. Zusätzlich wird der
 * initiale `navigator.onLine`-Zustand beobachtet. So ist weder „der Feed ist tot / die Lage ist
 * evtl. veraltet" noch ein lokaler Netzausfall unsichtbar. Über Events bzw. den kleinen
 * PWA-Store entkoppelt, damit der Hook render-state-frei und EINE EventSource bleibt.
 */
export default function LiveStatusBanner({ benutzerId }: { benutzerId?: number }) {
  // Beweissichernde Offline-Aktionen bleiben einsatzübergreifend sichtbar. Würde
  // die globale Zeile auf den aktuellen Route-Einsatz filtern, verschwände eine
  // abgelehnte Aktion aus Einsatz A beim Wechsel nach B vollständig aus dem Blick.
  const queue = useOfflineQueueZaehler(benutzerId);
  const { token } = theme.useToken();
  // EINE Quelle mit dem Instrumentenband des Lage-Dashboards (LFH-336 · M3).
  // Der frühere lokale Listener war für sich richtig, aber er war die ZWEITE
  // Kopie desselben Zustands — und die dritte wäre nur eine Datei entfernt.
  const status = useSyncExternalStore(abonniereLiveStatus, leseLiveStatus, leseLiveStatus);
  const [istOnline, setIstOnline] = useState(() => navigator.onLine);
  const [aktualisierungLaeuft, setAktualisierungLaeuft] = useState(false);
  const [aktualisierungFehlgeschlagen, setAktualisierungFehlgeschlagen] = useState(false);
  const [recoveryOffen, setRecoveryOffen] = useState(false);
  const aktualisierungVerfuegbar = useSyncExternalStore(
    abonniereAppAktualisierung,
    istAppAktualisierungVerfuegbar,
    istAppAktualisierungVerfuegbar,
  );

  useEffect(() => {
    const onOnline = () => setIstOnline(true);
    const onOffline = () => setIstOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  async function neuLaden(): Promise<void> {
    setAktualisierungLaeuft(true);
    setAktualisierungFehlgeschlagen(false);
    try {
      await aktualisiereAppJetzt();
    } catch {
      setAktualisierungFehlgeschlagen(true);
    } finally {
      setAktualisierungLaeuft(false);
    }
  }

  const hinweise: string[] = [];
  if (!istOnline) hinweise.push('Offline — keine Verbindung zum Server.');
  if (status === 'lost') {
    hinweise.push('Live-Verbindung unterbrochen — die Anzeige kann veraltet sein.');
  } else if (status === 'connecting') {
    hinweise.push('Live-Verbindung wird wiederhergestellt …');
  }
  if (aktualisierungVerfuegbar) hinweise.push('Neue Version verfügbar.');
  if (aktualisierungFehlgeschlagen) {
    hinweise.push('Aktualisierung fehlgeschlagen — bitte erneut versuchen.');
  }

  const bannerSichtbar =
    hinweise.length > 0 ||
    queue.ausstehend > 0 ||
    queue.abgelehnt > 0 ||
    queue.nicht_zugeordnet > 0;
  if (!bannerSichtbar && !recoveryOffen) return null;

  const typ =
    !istOnline || status === 'lost' || queue.abgelehnt > 0
      ? 'error'
      : status === 'connecting' || queue.ausstehend > 0 || queue.nicht_zugeordnet > 0
        ? 'warning'
        : 'info';

  const queueBadges = (
    <Space size={12} wrap>
      {queue.ausstehend > 0 && (
        <Space size={4} aria-label={`${queue.ausstehend} ausstehende Offline-Aktionen`}>
          <Badge count={queue.ausstehend} overflowCount={999} color={token.colorWarning} />
          <span>ausstehend</span>
        </Space>
      )}
      {queue.abgelehnt > 0 && (
        <Button
          type="text"
          danger
          aria-label={`${queue.abgelehnt} abgelehnte Offline-Aktionen`}
          onClick={() => setRecoveryOffen(true)}
        >
          <Space size={4}>
            <Badge count={queue.abgelehnt} overflowCount={999} color={token.colorError} />
            <span>abgelehnt – prüfen</span>
          </Space>
        </Button>
      )}
      {queue.nicht_zugeordnet > 0 && (
        <Button
          type="text"
          aria-label={`${queue.nicht_zugeordnet} nicht attribuierbare Offline-Alt-Daten`}
          onClick={() => setRecoveryOffen(true)}
        >
          <Space size={4}>
            <Badge count={queue.nicht_zugeordnet} overflowCount={999} color={token.colorWarning} />
            <span>Alt-Daten – verwerfen</span>
          </Space>
        </Button>
      )}
    </Space>
  );

  return (
    <>
      {bannerSichtbar && (
        <Alert
          type={typ}
          showIcon
          banner
          title={
            <Space size={12} wrap>
              {hinweise.length > 0 && <span>{hinweise.join(' · ')}</span>}
              {queueBadges}
            </Space>
          }
          action={
            aktualisierungVerfuegbar ? (
              <Button type="link" loading={aktualisierungLaeuft} onClick={() => void neuLaden()}>
                Jetzt neu laden
              </Button>
            ) : undefined
          }
        />
      )}
      <OfflineRecoveryDrawer
        open={recoveryOffen}
        onClose={() => setRecoveryOffen(false)}
        benutzerId={benutzerId}
      />
    </>
  );
}
