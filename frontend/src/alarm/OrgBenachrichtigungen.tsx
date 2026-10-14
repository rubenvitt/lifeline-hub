import { useEffect } from 'react';
import { schliesseAlleDesktopAlarme } from './desktopAlarm';
import { useAlarmToasts } from './useAlarmToasts';
import { quittiereNachNutzer, useBenachrichtigungen } from './useBenachrichtigungen';

/**
 * Schlanke Zentrale im Org-Layout (design.md D5): Toasts der Org-Arten (`einsatz_aufnahme`,
 * `einsatz_neu`) im selben Budget wie im Einsatz, ohne Ton- und Benachrichtigungsknöpfe; die
 * stehen im Einsatzkopf. Die Ereignisse trägt der Org-Kanal (`useOrgLiveStream`). Gekoppelte
 * Geräte erreichen das Org-Layout nicht (`routes/RequireAuth.tsx`).
 */
export default function OrgBenachrichtigungen() {
  const toasts = useAlarmToasts(null, quittiereNachNutzer);
  useBenachrichtigungen(null, toasts);

  // Ist der Tab wieder sichtbar, trägt der Toast; die OS-Meldungen gehen (LFH-951).
  useEffect(() => {
    const sichtbar = () => {
      if (!document.hidden) schliesseAlleDesktopAlarme();
    };
    window.addEventListener('focus', sichtbar);
    document.addEventListener('visibilitychange', sichtbar);
    return () => {
      window.removeEventListener('focus', sichtbar);
      document.removeEventListener('visibilitychange', sichtbar);
    };
  }, []);

  return null;
}
