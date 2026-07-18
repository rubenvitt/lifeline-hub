import { Alert } from 'antd';
import { useEffect, useState } from 'react';
import type { LiveVerbindungsStatus } from './useEinsatzLiveStream';

/**
 * Sichtbarer Verbindungsstatus des Einsatz-Live-Feeds (F14/LFH-263).
 *
 * Lauscht auf das window-CustomEvent `lfh:live-status` (von `useEinsatzLiveStream` gemeldet)
 * und zeigt bei unterbrochener/wiederverbindender Leitung einen Banner. So ist „der Feed ist
 * tot / die Lage ist evtl. veraltet" nicht mehr unsichtbar — in einem Führungssystem ist
 * unbemerkt veraltete Lage gefährlicher als ein sichtbarer Ausfall. Bei `open` nichts anzeigen.
 * Über das window-Event entkoppelt, damit der Hook render-state-frei und EINE EventSource bleibt.
 */
export default function LiveStatusBanner() {
  const [status, setStatus] = useState<LiveVerbindungsStatus>('open');

  useEffect(() => {
    const onStatus = (e: Event) => {
      const detail = (e as CustomEvent<{ status?: LiveVerbindungsStatus }>).detail;
      if (detail?.status) setStatus(detail.status);
    };
    window.addEventListener('lfh:live-status', onStatus);
    return () => window.removeEventListener('lfh:live-status', onStatus);
  }, []);

  if (status === 'open') return null;

  return (
    <Alert
      type={status === 'lost' ? 'error' : 'warning'}
      showIcon
      banner
      title={
        status === 'lost'
          ? 'Live-Verbindung unterbrochen — die Anzeige kann veraltet sein.'
          : 'Live-Verbindung wird wiederhergestellt …'
      }
    />
  );
}
