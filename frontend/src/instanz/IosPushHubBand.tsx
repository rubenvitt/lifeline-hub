import { Alert } from 'antd';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { zeitKurz } from '../anzeige/zeitDarstellung';
import type { EinsatzAnzeige } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { darfFuehrungBedienen } from '../einsatz/schreibrecht';
import { iosPushHubBandText, iosPushHubBandTitel } from './instanzText';

/**
 * Hinweisband unter der Kopfleiste (LLH-2074): das Push-Relais sperrt einen Hub, über den die
 * Hinweise dieses Einsatzes reisen. iPhones von Hub-Konten bekommen dann keine Alarme, und diese
 * Instanz pusht ihnen nicht selbst (die Geräte sind am Hub angemeldet). Sehen sollen es, wer
 * handeln kann: Einsatzleitung und System-Admins der Einsatz-Org (wie `darfFuehrungBedienen`).
 * `warning`, weil Rot der Gefahr vorbehalten ist. Ein Band je gesperrtem Hub.
 */
export default function IosPushHubBand({ einsatz }: { einsatz: EinsatzAnzeige }) {
  const { benutzer } = useAuth();
  const { konventionen: konv } = useAnzeigeKonventionen();
  const sperren = einsatz.ios_push_hub_gesperrt ?? [];
  if (sperren.length === 0 || !darfFuehrungBedienen(einsatz, benutzer)) return null;
  return (
    <div data-lfh="ios-push-hub-band">
      {/* Der Hub-Name ist nicht eindeutig (LLH-2086); das Band hat keinen Zustand, den eine
          neue Reihenfolge verschieben könnte, deshalb genügt der Index im Key. */}
      {sperren.map((s, i) => (
        <Alert
          key={`${s.hub_name}-${i}`}
          type="warning"
          showIcon
          banner
          title={iosPushHubBandTitel(s.hub_name)}
          description={iosPushHubBandText(zeitKurz(s.since, konv))}
        />
      ))}
    </div>
  );
}
