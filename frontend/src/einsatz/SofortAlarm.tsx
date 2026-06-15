import { App, Badge, Button, Tooltip } from 'antd';
import { BellOutlined, NotificationOutlined } from '@ant-design/icons';
import { useEffect, useState } from 'react';
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

  useEffect(() => {
    const onSofort = () => {
      const key = `sofort-${Date.now()}`;
      notification.warning({
        key,
        message: 'Sofortmeldung eingegangen',
        description: 'Eine Sofortmeldung erfordert Aufmerksamkeit — bitte sichten und bestätigen.',
        duration: 0,
        btn: (
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
          gemutet ? (
            <BellOutlined style={{ opacity: 0.45 }} />
          ) : (
            <Badge dot status="error">
              <NotificationOutlined />
            </Badge>
          )
        }
      />
    </Tooltip>
  );
}
