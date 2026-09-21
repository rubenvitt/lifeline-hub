import { Button } from 'antd';
import { TbX } from 'react-icons/tb';
import type { ReactNode } from 'react';
import { monoStil, useRollen } from '../../components/instrument';

export interface KartenDetailCardProps {
  /** Name des gewählten Objekts (bricht bei Bedarf um statt abzuschneiden). */
  titel: ReactNode;
  /** Objekt-/Quellenfarbe — Rahmen der Symbol-Kachel. */
  akzentFarbe: string;
  onSchliessen: () => void;
  /** Inhalt der 38-px-Kachel (z. B. das taktische Zeichen); ohne Angabe das Kürzel „TZ". */
  kachel?: ReactNode;
  /** Mono-Unterzeile unter dem Namen (Objektart, Kennung). */
  unterzeile?: ReactNode;
  /** Veraltet: die Breite gibt jetzt die Leiste vor. Bleibt, damit Aufrufer nicht brechen. */
  width?: number;
  children: ReactNode;
}

/** Kantenlänge der Symbol-Kachel (Neuentwurf S5). */
export const KACHEL_KANTE = 38;

/**
 * Ein gewähltes Objekt im Paneel „Ausgewählt" der rechten Kartenleiste (Neuentwurf S5).
 *
 * Bis zum Neuentwurf schwebte diese Karte absolut oben rechts ÜBER der Karte — und verdeckte
 * dabei genau den Ausschnitt, in dem das gewählte Objekt lag, sobald es am rechten Rand stand.
 * Jetzt steht sie IM FLUSS der Leiste: Kopf mit Symbol-Kachel (38 px, Rahmen in Objektfarbe),
 * Name und Mono-Unterzeile, darunter der Inhalt des jeweiligen Inspectors. Alle vier
 * Inspectors (Marker, Zone, freies Zeichen, Fachebene) hängen an dieser einen Bauform.
 *
 * Der Name ist eine Überschrift (`h3` unter dem `h2` des Paneels) — mehrere gleichzeitig
 * gewählte Objekte (Marker und Zone) stehen damit als getrennte Abschnitte im Baum.
 */
export default function KartenDetailCard({
  titel,
  akzentFarbe,
  onSchliessen,
  kachel,
  unterzeile,
  children,
}: KartenDetailCardProps) {
  const { token, rollen } = useRollen();
  return (
    <section
      data-lfh="auswahl"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: token.marginSM,
        padding: token.padding,
        borderBlockEnd: `1px solid ${rollen.linie}`,
        minWidth: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: token.marginSM }}>
        <div
          aria-hidden="true"
          data-lfh="auswahl-kachel"
          style={{
            width: KACHEL_KANTE,
            height: KACHEL_KANTE,
            flex: `0 0 ${KACHEL_KANTE}px`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 1,
            borderStyle: 'solid',
            borderColor: akzentFarbe,
            color: akzentFarbe,
            overflow: 'hidden',
            ...monoStil(9),
          }}
        >
          {kachel ?? 'TZ'}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 0 }}>
          <h3
            style={{
              margin: 0,
              fontSize: 14,
              fontWeight: 500,
              lineHeight: 1.3,
              color: rollen.text,
              overflowWrap: 'anywhere',
            }}
          >
            {titel}
          </h3>
          {unterzeile != null && (
            <div style={{ ...monoStil(11), color: rollen.gedaempft, overflowWrap: 'anywhere' }}>
              {unterzeile}
            </div>
          )}
        </div>
        {/* Kein `size` — die Trefffläche kommt aus `controlHeight` (Dichte-Staffel). */}
        <Button
          type="text"
          onClick={onSchliessen}
          aria-label="Schließen"
          icon={
            <span aria-hidden="true" style={{ display: 'inline-flex' }}>
              <TbX size={16} />
            </span>
          }
        />
      </div>
      {children}
    </section>
  );
}
