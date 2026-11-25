import { useRef } from 'react';
import { useRollen } from '../components/instrument';
import { GROSS_BEZUG, grossMass } from '../components/grossbild/grossMass';
import { useHlsWiedergabe } from '../pages/lagekarte/useHlsWiedergabe';

export interface LagemonitorLivebildProps {
  einsatzId: number;
  /** Erste Videokennung aus `drohne.videos`; `null`, wenn die Quelle keine meldet. */
  videoKey: string | null;
}

/**
 * Inhalt der Kachel „Livebild“ des Lagemonitors (LLH-2109): das Livebild der Drohne vom Proxy,
 * stumm, ohne Bedienung, in 16 : 9 auf Schwarz. Ohne Bild steht „Kein Livebild“, ohne Alarm. Die
 * Kachel kommt nur, wenn die Einsatzleitung den Schalter „Livebild auf dem Lagemonitor“
 * eingeschaltet hat (Block `drohne` in `situation-monitor`, Regel `geraet/AGENTS.md`).
 */
export default function LagemonitorLivebild({ einsatzId, videoKey }: LagemonitorLivebildProps) {
  const { rollen } = useRollen();
  const videoRef = useRef<HTMLVideoElement>(null);
  const zustand = useHlsWiedergabe(einsatzId, videoKey, videoRef);
  const kein = zustand === 'kein';
  return (
    <div
      style={{
        position: 'relative',
        flex: '1 1 0',
        minHeight: 0,
        background: '#000',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
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
          height: '100%',
          maxWidth: '100%',
          aspectRatio: '16 / 9',
          objectFit: 'contain',
        }}
      />
      {zustand !== 'laeuft' && (
        <span
          style={{
            position: 'absolute',
            fontSize: grossMass(GROSS_BEZUG.text),
            lineHeight: 1.2,
            color: rollen.text2,
          }}
        >
          {kein ? 'Kein Livebild' : 'Livebild lädt …'}
        </span>
      )}
    </div>
  );
}
