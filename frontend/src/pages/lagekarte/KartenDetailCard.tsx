import { IconKreuz } from '../../icons';
import { Button } from 'antd';
import type { ReactNode } from 'react';
import { Stapel, Textstufe, monoStil, useRollen } from '../../components/instrument';

interface KartenDetailCardProps {
  /** Name des gewählten Objekts (bricht bei Bedarf um statt abzuschneiden). */
  titel: ReactNode;
  /** Objekt-/Quellenfarbe — Rahmen der Symbol-Kachel. */
  akzentFarbe: string;
  onSchliessen: () => void;
  /** Inhalt der 38-px-Kachel (z. B. das taktische Zeichen); ohne Angabe das Kürzel „TZ". */
  kachel?: ReactNode;
  /** Mono-Unterzeile unter dem Namen (Objektart, Kennung). */
  unterzeile?: ReactNode;
  /** Veraltet: die Breite gibt die Leiste vor; bleibt, damit Aufrufer nicht brechen. */
  width?: number;
  children: ReactNode;
}

/** Kantenlänge der Symbol-Kachel (Neuentwurf S5). */
const KACHEL_KANTE = 38;

/**
 * Ein gewähltes Objekt im Paneel „Ausgewählt" der rechten Kartenleiste, im Fluss der Leiste (als
 * schwebende Karte verdeckte es das gewählte Objekt am rechten Rand). Kopf mit Symbol-Kachel, Name
 * und Mono-Unterzeile, darunter der Inhalt des Inspectors — alle vier Inspectors nutzen diese
 * Bauform.
 *
 * Der Name ist ein `h3` unter dem `h2` des Paneels, damit mehrere gewählte Objekte als getrennte
 * Abschnitte im Baum stehen.
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
      <Stapel richtung="zeile" abstand="sm" ausrichten="mitte">
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
        <Stapel abstand="xs" wachsen>
          <Textstufe als="h3" stufe="kartentitel" umbruch="ueberall">
            {titel}
          </Textstufe>
          {unterzeile != null && (
            <div style={{ ...monoStil('meta'), color: rollen.gedaempft, overflowWrap: 'anywhere' }}>
              {unterzeile}
            </div>
          )}
        </Stapel>
        {/* Kein `size` — die Trefffläche kommt aus `controlHeight`. */}
        <Button
          type="text"
          onClick={onSchliessen}
          aria-label="Schließen"
          icon={
            <span aria-hidden="true" style={{ display: 'inline-flex' }}>
              <IconKreuz size={16} />
            </span>
          }
        />
      </Stapel>
      {children}
    </section>
  );
}
