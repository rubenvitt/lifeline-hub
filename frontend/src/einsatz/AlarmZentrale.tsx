import { App, Badge, Button, Tooltip } from 'antd';
import { BellOutlined, DesktopOutlined, NotificationOutlined } from '@ant-design/icons';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { istAlarmGemutet, setzeAlarmMute } from './alarmTon';
import { desktopPermission, fordereDesktopPermission, zeigeDesktopAlarm } from './desktopAlarm';
import { auftraegePfad, erinnerungenPfad, meldungenPfad } from '../routing/deeplinks';

type ErinnerungDetail = {
  erinnerung_id?: number;
  bezug_typ?: 'auftrag' | 'meldung' | null;
  bezug_id?: number | null;
};

/**
 * Einsatzweite Alarm-Zentrale (LFH-97/118): lauscht auf die window-CustomEvents
 * `lfh:sofortmeldung` und `lfh:erinnerung-alarm` (von useEinsatzLiveStream ausgelöst) und zeigt
 * unübersehbare, NICHT selbst-schließende Toasts mit Deeplink zur Quelle — plus optional eine
 * Desktop-Benachrichtigung bei Hintergrund-Tab. EIN globaler Mute-Toggle (Per-User, localStorage)
 * schaltet ALLE Alarmtöne. Im Layout-Header montiert → wirkt seitenunabhängig.
 * Toasts über App.useApp().notification (kein statischer Import — sonst Kontext-Leak in Tests).
 */
export default function AlarmZentrale() {
  const { notification } = App.useApp();
  const navigate = useNavigate();
  const { id } = useParams();
  const einsatzId = Number(id);
  const [gemutet, setGemutet] = useState(istAlarmGemutet());
  const [permission, setPermission] = useState(desktopPermission());
  // Fallback-Zähler für Toast-Keys ohne stabile ID (z. B. lagged-Sofortmeldung).
  const zaehler = useRef(0);

  // Sofortmeldung (LFH-97).
  useEffect(() => {
    const onSofort = (ev: Event) => {
      const detail = (ev as CustomEvent<{ meldung_id?: number }>).detail ?? {};
      const key = detail.meldung_id != null ? `sofort-${detail.meldung_id}` : `sofort-${++zaehler.current}`;
      const oeffnen = () => { navigate(meldungenPfad(einsatzId)); notification.destroy(key); };
      notification.warning({
        key,
        title: 'Sofortmeldung eingegangen',
        description: 'Eine Sofortmeldung erfordert Aufmerksamkeit — bitte sichten und bestätigen.',
        duration: 0,
        actions: (<Button type="primary" size="small" onClick={oeffnen}>Öffnen</Button>),
      });
      zeigeDesktopAlarm('Sofortmeldung eingegangen', {
        koerper: 'Bitte sichten und bestätigen.',
        beiKlick: () => navigate(meldungenPfad(einsatzId)),
      });
    };
    window.addEventListener('lfh:sofortmeldung', onSofort);
    return () => window.removeEventListener('lfh:sofortmeldung', onSofort);
  }, [notification, navigate, einsatzId]);

  // Fällige Erinnerung / Auftrags-Eskalation (LFH-118).
  useEffect(() => {
    const onErinnerung = (ev: Event) => {
      const detail = (ev as CustomEvent<ErinnerungDetail>).detail ?? {};
      const istAuftrag = detail.bezug_typ === 'auftrag';
      const key = istAuftrag ? `auftrag-${detail.bezug_id}` : `erinnerung-${detail.erinnerung_id}`;
      const titel = istAuftrag ? 'Auftrag überfällig' : 'Erinnerung fällig';
      const beschreibung = istAuftrag
        ? 'Ein Auftrag ist über seine Quittierfrist — bitte prüfen und quittieren.'
        : 'Eine Erinnerung ist fällig — bitte sichten.';
      const ziel = istAuftrag && detail.bezug_id != null
        ? auftraegePfad(einsatzId, { auftrag: detail.bezug_id })
        : erinnerungenPfad(einsatzId);
      const oeffnen = () => { navigate(ziel); notification.destroy(key); };
      const config = {
        key,
        title: titel,
        description: beschreibung,
        duration: 0,
        actions: (<Button type="primary" size="small" onClick={oeffnen}>Öffnen</Button>),
      };
      if (istAuftrag) notification.warning(config);
      else notification.info(config);
      zeigeDesktopAlarm(titel, { koerper: beschreibung, beiKlick: () => navigate(ziel) });
    };
    window.addEventListener('lfh:erinnerung-alarm', onErinnerung);
    return () => window.removeEventListener('lfh:erinnerung-alarm', onErinnerung);
  }, [notification, navigate, einsatzId]);

  const umschalten = () => {
    const neu = !gemutet;
    setzeAlarmMute(neu);
    setGemutet(neu);
  };

  const desktopAktivieren = () => {
    fordereDesktopPermission((p) => setPermission(p));
  };

  return (
    <>
      {permission === 'default' && (
        <Tooltip title="Desktop-Benachrichtigungen aktivieren">
          <Button
            type="text"
            aria-label="Desktop-Benachrichtigungen aktivieren"
            onClick={desktopAktivieren}
            icon={<DesktopOutlined style={{ color: '#fff' }} />}
          />
        </Tooltip>
      )}
      <Tooltip title={gemutet ? 'Alarm-Ton stummgeschaltet' : 'Alarm-Ton aktiv'}>
        <Button
          type="text"
          aria-label={gemutet ? 'Alarm-Ton einschalten' : 'Alarm-Ton stummschalten'}
          aria-pressed={gemutet}
          onClick={umschalten}
          icon={
            // Header ist in beiden Modi dunkel → Icon immer weiß; Farbe MUSS am Icon selbst sitzen
            // (der Badge-Wrapper setzt via resetComponent ein eigenes color).
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
    </>
  );
}
