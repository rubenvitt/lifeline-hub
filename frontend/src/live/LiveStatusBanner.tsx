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
import { RAHMEN_KLEBT, useRahmenObenQuelle } from '../components/rahmenOben';
import { useViewport } from '../components/useViewport';
import { anzahl } from '../anzeige/anzahl';

/**
 * Eine globale Betriebszeile für Leitung, Einsatz-Live-Feed und App-Version.
 * Zeigt bei unterbrochener Leitung (`liveStatusStore`) und bei `navigator.onLine === false`
 * einen Hinweis, damit weder ein toter Feed noch ein lokaler Netzausfall unsichtbar bleibt.
 *
 * `klebend` (LFH-952, `frontend/AGENTS.md`, Rahmen): unter `md` rollt der Kopf mit, dann bleibt
 * die Zeile am oberen Rand stehen, solange sie eine Verbindungsstörung meldet (offline oder
 * Live-Verbindung `lost`). Ab `md` trägt die SYNC-Zelle im klebenden Kopf die Störung. Nur der
 * Rahmen, der im Dokument rollt, setzt es; die Gerätehülle rollt in einem eigenen Bereich.
 */
export default function LiveStatusBanner({
  benutzerId,
  klebend = false,
}: {
  benutzerId?: number;
  klebend?: boolean;
}) {
  // Offline-Aktionen bleiben einsatzübergreifend sichtbar: gefiltert auf den Route-Einsatz
  // verschwände eine abgelehnte Aktion aus Einsatz A beim Wechsel nach B aus dem Blick.
  const queue = useOfflineQueueZaehler(benutzerId);
  const { token } = theme.useToken();
  // Dieselbe Quelle wie das Instrumentenband des Lage-Dashboards.
  const status = useSyncExternalStore(abonniereLiveStatus, leseLiveStatus, leseLiveStatus);
  const [istOnline, setIstOnline] = useState(() => navigator.onLine);
  const [aktualisierungLaeuft, setAktualisierungLaeuft] = useState(false);
  const [aktualisierungFehlgeschlagen, setAktualisierungFehlgeschlagen] = useState(false);
  const [recoveryOffen, setRecoveryOffen] = useState(false);
  const { abBreite } = useViewport();
  const mittel = abBreite('md');
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
    // Der Zustand ohne Folgensatz (LFH-1078): die Farbe des Banners trägt die Störung.
    hinweise.push('Live-Verbindung unterbrochen');
  } else if (status === 'connecting') {
    hinweise.push('Live-Verbindung wird wiederhergestellt …');
  }
  if (aktualisierungVerfuegbar) hinweise.push('Neue Version verfügbar.');
  if (aktualisierungFehlgeschlagen) {
    // Ohne Bitte (LFH-1078): „Jetzt neu laden“ steht daneben und trägt den zweiten Versuch.
    hinweise.push('Aktualisierung fehlgeschlagen');
  }

  const stoerung = !istOnline || status === 'lost';
  const klebt = klebend && !mittel && stoerung;
  const zeileRef = useRahmenObenQuelle<HTMLDivElement>(klebt);

  const bannerSichtbar =
    hinweise.length > 0 ||
    queue.ausstehend > 0 ||
    queue.abgelehnt > 0 ||
    queue.nicht_zugeordnet > 0;
  if (!bannerSichtbar && !recoveryOffen) return null;

  const typ =
    stoerung || queue.abgelehnt > 0
      ? 'error'
      : status === 'connecting' || queue.ausstehend > 0 || queue.nicht_zugeordnet > 0
        ? 'warning'
        : 'info';

  const queueBadges = (
    <Space size={12} wrap>
      {queue.ausstehend > 0 && (
        <Space
          size={4}
          aria-label={anzahl(
            queue.ausstehend,
            'ausstehende Offline-Aktion',
            'ausstehende Offline-Aktionen',
          )}
        >
          <Badge count={queue.ausstehend} overflowCount={999} color={token.colorWarning} />
          <span>ausstehend</span>
        </Space>
      )}
      {queue.abgelehnt > 0 && (
        <Button
          type="text"
          danger
          aria-label={anzahl(
            queue.abgelehnt,
            'abgelehnte Offline-Aktion',
            'abgelehnte Offline-Aktionen',
          )}
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
          // Der Name beginnt mit dem sichtbaren Wortlaut (WCAG 2.5.3), die Zahl folgt.
          aria-label={`Alte Offline-Daten ansehen (${anzahl(queue.nicht_zugeordnet, 'Aktion', 'Aktionen')} ohne Zuordnung)`}
          onClick={() => setRecoveryOffen(true)}
        >
          <Space size={4}>
            <Badge count={queue.nicht_zugeordnet} overflowCount={999} color={token.colorWarning} />
            {/* Der Knopf öffnet nur den Drawer; dort fragt das Verwerfen nach. „verwerfen“ las
                sich wie die Löschung selbst und wurde gemieden (LFH-944). */}
            <span>Alte Offline-Daten ansehen</span>
          </Space>
        </Button>
      )}
    </Space>
  );

  return (
    <>
      {bannerSichtbar && (
        <div ref={zeileRef} data-lfh="betriebszeile" style={klebt ? RAHMEN_KLEBT : undefined}>
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
        </div>
      )}
      <OfflineRecoveryDrawer
        open={recoveryOffen}
        onClose={() => setRecoveryOffen(false)}
        benutzerId={benutzerId}
      />
    </>
  );
}
