import { App, Badge, Button, Tooltip } from 'antd';
import { BellOutlined, NotificationOutlined } from '@ant-design/icons';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { istSofortGemutet, setzeSofortMute } from './sofortTon';

/**
 * Einsatzweiter Sofort-Alarm (LFH-97): lauscht auf das window-CustomEvent
 * `lfh:sofortmeldung` (von useEinsatzLiveStream beim SSE-Tag `sofortmeldung` ausgelöst)
 * und zeigt einen unübersehbaren, NICHT selbst-schließenden Toast mit Sprung zur
 * Meldungsliste. Dazu ein Mute-Toggle für den Ton (Per-User, localStorage).
 *
 * Im Layout-Header montiert → wirkt seitenunabhängig in der gesamten Führungs-UI.
 * Toast über App.useApp().notification (kein statischer Import — sonst Kontext-Leak in Tests).
 */
export default function SofortAlarm() {
  const { notification } = App.useApp();
  const navigate = useNavigate();
  const { id } = useParams();
  const [gemutet, setGemutet] = useState(istSofortGemutet());
  // Fallback-Zähler für Toast-Keys, falls das Event keine meldung_id trägt (z. B. lagged).
  const zaehler = useRef(0);

  useEffect(() => {
    const onSofort = (ev: Event) => {
      const detail = (ev as CustomEvent<{ meldung_id?: number }>).detail ?? {};
      // Key bevorzugt aus meldung_id (dedupliziert Erst- und Eskalations-Toast je Meldung),
      // sonst monoton steigend (kein Überschreiben bei gleicher Millisekunde).
      const key = detail.meldung_id != null ? `sofort-${detail.meldung_id}` : `sofort-${++zaehler.current}`;
      notification.warning({
        key,
        title: 'Sofortmeldung eingegangen',
        description: 'Eine Sofortmeldung erfordert Aufmerksamkeit — bitte sichten und bestätigen.',
        duration: 0,
        actions: (
          <Button
            type="primary"
            size="small"
            onClick={() => {
              navigate(`/einsaetze/${id}/meldungen`);
              notification.destroy(key);
            }}
          >
            Öffnen
          </Button>
        ),
      });
    };
    window.addEventListener('lfh:sofortmeldung', onSofort);
    return () => window.removeEventListener('lfh:sofortmeldung', onSofort);
  }, [notification, navigate, id]);

  const umschalten = () => {
    const neu = !gemutet;
    setzeSofortMute(neu);
    setGemutet(neu);
  };

  return (
    <Tooltip title={gemutet ? 'Sofort-Ton stummgeschaltet' : 'Sofort-Ton aktiv'}>
      <Button
        type="text"
        aria-label={gemutet ? 'Sofort-Ton einschalten' : 'Sofort-Ton stummschalten'}
        aria-pressed={gemutet}
        onClick={umschalten}
        icon={
          // Header ist in beiden Modi dunkel → Icon immer weiß. Die Farbe MUSS am
          // Icon selbst sitzen, nicht am Button: der Badge-Wrapper setzt via
          // resetComponent ein eigenes color: colorText, das eine vom Button nur
          // vererbte Farbe überschreiben würde (im Light-Mode → schwarzes Icon).
          gemutet ? (
            <BellOutlined style={{ color: '#fff', opacity: 0.45 }} />
          ) : (
            <Badge dot status="error">
              <NotificationOutlined style={{ color: '#fff' }} />
            </Badge>
          )
        }
      />
    </Tooltip>
  );
}
