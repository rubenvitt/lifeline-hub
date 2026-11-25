import { useEffect, useRef, useState, type RefObject } from 'react';

/** Playlist-Einstieg des Proxys (Route `…/drone/video/{key}/hls/index.m3u8`, LLH-2107). */
export function livebildUrl(einsatzId: number, videoKey: string): string {
  return `/api/incidents/${einsatzId}/drone/video/${encodeURIComponent(videoKey)}/hls/index.m3u8`;
}

export type HlsZustand = 'laedt' | 'laeuft' | 'kein';

/**
 * Wartezeit vor dem nächsten Versuch nach `fehlschlaege` gescheiterten Versuchen in Folge: 5 s,
 * 10 s, 20 s, dann höchstens 30 s. Ein kurzer Funkausfall (LTE) beendet das Livebild so nicht.
 */
export function wiederholNachMs(fehlschlaege: number): number {
  return Math.min(5_000 * 2 ** Math.max(0, fehlschlaege - 1), 30_000);
}

/**
 * HLS-Wiedergabe des Livebilds vom Proxy des Servers (LLH-2107, als Hook seit LLH-2109): spielt
 * `videoKey` in `videoRef`, stumm und mit Autoplay; `hls.js` wird erst hier nachgeladen (eigener
 * Chunk), Safari und iOS spielen die Playlist selbst (`canPlayType`). Liefert „lädt“, „läuft“ oder
 * „kein“ (kein Schlüssel, nicht unterstützt oder ein fataler Player-Fehler). Ein fataler Fehler
 * ist nicht das Ende: bei einem Netzfehler lädt der Player zuerst einmal neu, bei einem
 * Medienfehler stellt er sich einmal wieder her; scheitert das, startet er mit Pause neu
 * ([`wiederholNachMs`]), solange `videoKey` gesetzt ist. Ein neuer Schlüssel startet neu.
 * Genutzt vom Fenster an der Lagekarte und von der Kachel des Lagemonitors.
 */
export function useHlsWiedergabe(
  einsatzId: number,
  videoKey: string | null,
  videoRef: RefObject<HTMLVideoElement | null>,
): HlsZustand {
  const [zustand, setZustand] = useState<HlsZustand>(videoKey == null ? 'kein' : 'laedt');
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
  }, [einsatzId, videoKey, versuch, videoRef]);
  return zustand;
}
