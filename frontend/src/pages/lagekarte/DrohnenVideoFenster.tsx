import { Button } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { useDrohnenQuellen } from '../../api/drohne';
import { IconKreuz } from '../../icons';
import { Paneel, Textstufe, useRollen } from '../../components/instrument';
import { UEBERLAGERUNG_RAND, kartenKnopfBreite } from './KartenUeberlagerung';

/** `data-lfh` des Fensters — die Seite und die Tests finden es darüber. */
export const DROHNEN_VIDEO_FENSTER = 'drohnen-video-fenster';

/** Playlist-Einstieg des Proxys (Route `…/drone/video/{key}/hls/index.m3u8`, LLH-2107). */
export function livebildUrl(einsatzId: number, videoKey: string): string {
  return `/api/incidents/${einsatzId}/drone/video/${encodeURIComponent(videoKey)}/hls/index.m3u8`;
}

type Zustand = 'laedt' | 'laeuft' | 'kein';

/**
 * Wartezeit vor dem nächsten Versuch nach `fehlschlaege` gescheiterten Versuchen in Folge: 5 s,
 * 10 s, 20 s, dann höchstens 30 s. Ein kurzer Funkausfall (LTE) beendet das Livebild so nicht.
 */
export function wiederholNachMs(fehlschlaege: number): number {
  return Math.min(5_000 * 2 ** Math.max(0, fehlschlaege - 1), 30_000);
}

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
  const [zustand, setZustand] = useState<Zustand>(videoKey == null ? 'kein' : 'laedt');
  // Jeder neue Versuch nach einem Ausfall zählt hoch und startet den Player neu.
  const [versuch, setVersuch] = useState(0);
  // Gescheiterte Versuche in Folge, je Schlüssel; ein laufendes Bild setzt zurück.
  const fehlschlaege = useRef<{ key: string | null; n: number }>({ key: null, n: 0 });

  useEffect(() => {
    const video = videoRef.current;
    if (videoKey == null || !video) {
      setZustand('kein');
      return;
    }
    if (fehlschlaege.current.key !== videoKey) fehlschlaege.current = { key: videoKey, n: 0 };
    setZustand('laedt');
    const url = livebildUrl(einsatzId, videoKey);
    let beendet = false;
    let abbau: (() => void) | undefined;
    let wiederholung: ReturnType<typeof setTimeout> | undefined;
    const spiele = () => {
      void video.play?.()?.catch(() => undefined);
    };
    const laeuft = () => {
      fehlschlaege.current.n = 0;
      setZustand('laeuft');
    };
    /** Aufgegeben: „Kein Livebild“ und mit Pause ein neuer Versuch. */
    const ausgefallen = () => {
      if (beendet) return;
      setZustand('kein');
      fehlschlaege.current.n += 1;
      clearTimeout(wiederholung);
      wiederholung = setTimeout(
        () => setVersuch((v) => v + 1),
        wiederholNachMs(fehlschlaege.current.n),
      );
    };

    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      const kaputt = () => ausgefallen();
      video.addEventListener('playing', laeuft);
      video.addEventListener('error', kaputt);
      video.src = url;
      abbau = () => {
        video.removeEventListener('playing', laeuft);
        video.removeEventListener('error', kaputt);
        video.removeAttribute('src');
        video.load?.();
      };
    } else {
      void import('hls.js').then(
        ({ default: Hls }) => {
          if (beendet) return;
          if (!Hls.isSupported()) {
            setZustand('kein');
            return;
          }
          const player = new Hls({ lowLatencyMode: false });
          let neuGeladen = false;
          let wiederhergestellt = false;
          video.addEventListener('playing', laeuft);
          player.on(Hls.Events.MANIFEST_PARSED, spiele);
          player.on(Hls.Events.ERROR, (_ereignis, daten) => {
            if (!daten.fatal) return;
            // Erst der eigene Weg des Players, je einmal; dann Neustart mit Pause.
            if (daten.type === Hls.ErrorTypes.NETWORK_ERROR && !neuGeladen) {
              neuGeladen = true;
              player.startLoad();
              return;
            }
            if (daten.type === Hls.ErrorTypes.MEDIA_ERROR && !wiederhergestellt) {
              wiederhergestellt = true;
              player.recoverMediaError();
              return;
            }
            player.destroy();
            ausgefallen();
          });
          player.loadSource(url);
          player.attachMedia(video);
          abbau = () => {
            video.removeEventListener('playing', laeuft);
            player.destroy();
          };
        },
        () => {
          if (!beendet) setZustand('kein');
        },
      );
    }
    return () => {
      beendet = true;
      clearTimeout(wiederholung);
      abbau?.();
    };
  }, [einsatzId, videoKey, versuch]);

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
