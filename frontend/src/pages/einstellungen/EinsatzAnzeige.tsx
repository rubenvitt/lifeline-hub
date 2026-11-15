import { Typography } from 'antd';
import AnzeigeLeisten, { ANZEIGE_LEISTEN_BREITE } from '../../components/AnzeigeLeisten';
import { Paneel } from '../../components/instrument';

/**
 * Reiter „Anzeige“ der Einsatz-Einstellungen (LLH-1730, Spec `benutzermenue`, „Anzeige auch in den
 * Einsatz-Einstellungen und im Profil“): Darstellung, Bediendichte und Helligkeit, dort, wo man
 * Einstellungen sucht, nicht nur hinter den Initialen.
 *
 * EINE GERÄTEEINSTELLUNG, KEINE DES EINSATZES: kein Formular, kein Speichern-Knopf, kein Recht, auch
 * im abgeschlossenen Einsatz bedienbar (der Rahmen zeigt hier keinen Rechtehinweis). Dieselben
 * Leisten wie im Benutzermenü, also derselbe Wert.
 */
export default function EinsatzAnzeige() {
  return (
    <Paneel titel="Anzeige auf diesem Gerät" koerperPolster>
      <Typography.Paragraph type="secondary">
        Gilt nur auf diesem Gerät, nicht für den Einsatz.
      </Typography.Paragraph>
      <div style={{ maxWidth: ANZEIGE_LEISTEN_BREITE }}>
        <AnzeigeLeisten hasTitel={false} />
      </div>
    </Paneel>
  );
}
