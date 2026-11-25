import { Button } from 'antd';
import { useRef } from 'react';
import { useDrohnenQuellen } from '../../api/drohne';
import { IconKreuz } from '../../icons';
import { Paneel, Textstufe, useRollen } from '../../components/instrument';
import { UEBERLAGERUNG_RAND, kartenKnopfBreite } from './KartenUeberlagerung';
import { useHlsWiedergabe } from './useHlsWiedergabe';

export { livebildUrl, wiederholNachMs } from './useHlsWiedergabe';

/** `data-lfh` des Fensters — die Seite und die Tests finden es darüber. */
export const DROHNEN_VIDEO_FENSTER = 'drohnen-video-fenster';

export interface DrohnenVideoFensterProps {
  einsatzId: number;
  /** Schlüssel des Videostroms; `null`, wenn die Quelle gerade keinen meldet („Kein Livebild“). */
  videoKey: string | null;
  onClose: () => void;
}

/**
 * Livebild der Drohne als Fenster über der Karte (LLH-2107): HLS vom Proxy des Servers, stumm, mit
 * Autoplay. `hls.js` wird erst hier nachgeladen (eigener Chunk); Safari und iOS spielen die Playlist
 * selbst (`canPlayType`). Zustände: „Lädt …“, läuft, „Kein Livebild“ (kein Schlüssel, nicht
 * unterstützt oder ein fataler Player-Fehler). Ein neuer Schlüssel startet neu, so auch einer, der
 * nach einem Ausfall wieder erscheint.
 *
 * Ein fataler Fehler ist nicht das Ende: bei einem Netzfehler lädt der Player zuerst einmal neu
 * (`startLoad`), bei einem Medienfehler stellt er sich einmal wieder her (`recoverMediaError`);
 * scheitert das, startet das Fenster mit Pause neu ([`wiederholNachMs`]), solange die Quelle den
 * Schlüssel meldet (verschwindet er, ist `videoKey` `null` und der Versuch entfällt).
 *
 * Eigener Block der Karte (Muster `KartenUeberlagerung`): einzeln positioniert, kein Rahmen über der
 * Karte, sonst schluckte er jedes Ziehen. Die Breite folgt der Kartenspalte (bis zur Knopfspalte,
 * höchstens `28rem`), keine feste Breite.
 */
export default function DrohnenVideoFenster({
  einsatzId,
  videoKey,
  onClose,
}: DrohnenVideoFensterProps) {
  const { token, rollen } = useRollen();
  const videoRef = useRef<HTMLVideoElement>(null);
  const zustand = useHlsWiedergabe(einsatzId, videoKey, videoRef);

  const kein = zustand === 'kein';
  return (
    <div
      data-lfh={DROHNEN_VIDEO_FENSTER}
      style={{
        position: 'absolute',
        left: UEBERLAGERUNG_RAND,
        top: '50%',
        transform: 'translateY(-50%)',
        zIndex: 6,
        // Bis vor die Knopfspalte, nie breiter als nötig; folgt der Kartenspalte (390 px bis Desktop).
        width: `calc(100% - ${kartenKnopfBreite(token) + 3 * UEBERLAGERUNG_RAND}px)`,
        maxWidth: '28rem',
      }}
    >
      <Paneel
        titel="Livebild"
        aktion={
          <Button
            type="text"
            onClick={onClose}
            aria-label="Livebild schließen"
            icon={
              <span aria-hidden="true" style={{ display: 'inline-flex' }}>
                <IconKreuz size={16} />
              </span>
            }
          />
        }
      >
        <div style={{ position: 'relative', aspectRatio: '16 / 9', background: rollen.grund }}>
          <video
            ref={videoRef}
            muted
            autoPlay
            playsInline
            aria-label="Livebild der Drohne"
            hidden={kein}
            style={{ display: kein ? 'none' : 'block', width: '100%', height: '100%' }}
          />
          {zustand !== 'laeuft' && (
            <div
              role="status"
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Textstufe stufe="textKlein" ton="gedaempft">
                {kein ? 'Kein Livebild' : 'Lädt …'}
              </Textstufe>
            </div>
          )}
        </div>
      </Paneel>
    </div>
  );
}

/**
 * Die Seite hält nur, welche Quelle ihr Livebild zeigt; den Schlüssel liest der Halter aus der
 * Quellenliste (dieselbe Abfrage wie die Leiste), damit ein Ausfall oder ein neuer Strom das
 * Fenster ohne Zutun der Seite nachführt.
 */
export function DrohnenVideoHalter({
  einsatzId,
  adapterId,
  onClose,
}: {
  einsatzId: number;
  adapterId: string;
  onClose: () => void;
}) {
  const quellen = useDrohnenQuellen(einsatzId);
  const quelle = quellen.data?.find((q) => q.adapter_id === adapterId);
  return (
    <DrohnenVideoFenster
      einsatzId={einsatzId}
      videoKey={quelle?.video_keys[0] ?? null}
      onClose={onClose}
    />
  );
}
