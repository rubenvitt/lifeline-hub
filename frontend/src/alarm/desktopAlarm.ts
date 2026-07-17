/**
 * Desktop-Benachrichtigung (LFH-118) via Browser-Notification-API — NUR wenn der Tab im
 * Hintergrund ist (`document.hidden`) und die Permission erteilt wurde. Defensiv: API fehlt oder
 * Permission verweigert → No-op (der In-App-Toast trägt in jedem Fall).
 */
function verfuegbar(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function desktopPermission(): NotificationPermission | 'unsupported' {
  return verfuegbar() ? Notification.permission : 'unsupported';
}

/** Fragt die Permission an (nur sinnvoll aus einer User-Geste). Callback erhält das Ergebnis. */
export function fordereDesktopPermission(beiErgebnis?: (p: NotificationPermission) => void): void {
  if (verfuegbar() && Notification.permission === 'default') {
    void Notification.requestPermission().then((p) => beiErgebnis?.(p));
  }
}

/** Zeigt eine Desktop-Notification, wenn Tab im Hintergrund + Permission granted. */
export function zeigeDesktopAlarm(
  titel: string,
  opts: { koerper?: string; beiKlick?: () => void } = {},
): void {
  try {
    if (!verfuegbar()) return;
    if (!document.hidden) return;
    if (Notification.permission !== 'granted') return;
    const n = new Notification(titel, { body: opts.koerper });
    n.onclick = () => {
      window.focus();
      opts.beiKlick?.();
      n.close();
    };
  } catch {
    /* Notification-API blockiert/unavailable → still */
  }
}
