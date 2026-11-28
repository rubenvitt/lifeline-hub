import { Button } from 'antd';
import { useRef } from 'react';
import { useDrohnenQuellen } from '../../api/drohne';
import { IconKreuz } from '../../icons';
import { Paneel, Textstufe, useRollen } from '../../components/instrument';
import { UEBERLAGERUNG_RAND } from './KartenUeberlagerung';
import { useHlsWiedergabe } from './useHlsWiedergabe';
import { useLivebildMaxBreite } from './livebildPlatz';

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
 * Steht als letztes Element im linken Block der Karte (`KartenUeberlagerung`, Prop `livebild`),
 * unter der Zeigerkoordinate: so liegt es nie über dem Block, wie hoch er auch ist (LLH-2137). Der
 * Block reicht Tipps durch, das Fenster holt sie sich zurück. Die Breite folgt der Kartenspalte
 * (bis zur Knopfspalte, höchstens `28rem`) und gibt nach, bis das Bild über dem Kartenfuß endet
 * (`livebildPlatz.ts`): das Bild bleibt 16 : 9 und wird schmaler, statt beschnitten zu werden.
 */
export default function DrohnenVideoFenster({
  einsatzId,
  videoKey,
  onClose,
}: DrohnenVideoFensterProps) {
  const { rollen } = useRollen();
  const videoRef = useRef<HTMLVideoElement>(null);
  const fensterRef = useRef<HTMLDivElement>(null);
  const bildRef = useRef<HTMLDivElement>(null);
  const zustand = useHlsWiedergabe(einsatzId, videoKey, videoRef);
  const maxBreite = useLivebildMaxBreite(fensterRef, bildRef, UEBERLAGERUNG_RAND);

  const kein = zustand === 'kein';
  return (
    <div
      ref={fensterRef}
      data-lfh={DROHNEN_VIDEO_FENSTER}
      style={{
        // Der Block endet vor der Knopfspalte (`maxWidth`), das Fenster an ihm.
        width: '28rem',
        maxWidth: maxBreite == null ? '100%' : `min(100%, ${maxBreite}px)`,
        pointerEvents: 'auto',
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
        <div
          ref={bildRef}
          style={{ position: 'relative', aspectRatio: '16 / 9', background: rollen.grund }}
        >
          <video
            ref={videoRef}
            muted
            autoPlay
            playsInline
            aria-label="Livebild der Drohne"
            hidden={kein}
            style={{
              display: kein ? 'none' : 'block',
              width: '100%',
              height: '100%',
              // Kein Überlagerungsweg für das Video: ohne Filter malte Chromium unter dem Fenster im
              // linken Block einen Kasten in der Farbe der Bildfläche über die Karte, der erst mit
              // dem Fenster verschwand (LLH-2137, Bildlauf der Anwenderdoku).
              filter: 'opacity(1)',
            }}
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
