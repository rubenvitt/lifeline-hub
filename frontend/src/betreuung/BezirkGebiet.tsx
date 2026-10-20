import { useQuery } from '@tanstack/react-query';
import { Space, Typography } from 'antd';
import { useMemo, type ReactNode } from 'react';
import { listeZonen } from '../api/lagezonen';
import { einsatzKeys } from '../api/queryKeys';
import type { Evakuierungsbezirk } from '../api/types';
import { SprungKnopf } from '../components/Sprung';
import { Paneel, useRollen } from '../components/instrument';
import { lagekartePfad } from '../routing/deeplinks';
import { personenZahl } from './betreuungText';
import { bezirkFlaechen } from './bezirkFlaechen';
import BezirkKartenbild from './BezirkKartenbild';

/** „1 Fläche“ bzw. „3 Flächen“. */
export function flaechenText(n: number): string {
  return n === 1 ? '1 Fläche' : `${personenZahl(n)} Flächen`;
}

/**
 * Paneel „Gebiet“ der Bezirks-Detailseite (LLH-1076, design.md D5): der nicht bedienbare
 * Kartenausschnitt der zugeordneten Flächen und der Sprung „Auf Lagekarte öffnen“, der dort eine
 * Fläche des Bezirks wählt (LFH-673).
 *
 * - Die Geometrien kommen aus der Zonenliste der Lagekarte (`einsatzKeys.zonen`). Sie gehört dem
 *   Modul Lagekarte: ohne dessen Freigabe wird sie nicht abgerufen, das Paneel nennt nur die Zahl
 *   der Flächen und der Sprung steht gesperrt mit Grund (LFH-888).
 * - Ohne Fläche ein Leerzustand in Worten; `leerAktion` trägt dort „Gebiet zeichnen“ (LLH-1069).
 *   Mit Fläche steht `zeichnenAktion` („Weitere Teilfläche zeichnen“) neben dem Sprung im Fuß.
 *   Beide gibt nur die Seite mit Schreibrecht hinein.
 */
export default function BezirkGebiet({
  einsatzId,
  bezirk,
  karteGesperrt,
  leerAktion,
  zeichnenAktion,
}: {
  einsatzId: number;
  bezirk: Evakuierungsbezirk;
  /** Modul Lagekarte für diese Person gesperrt (`useSprungSperre`). */
  karteGesperrt: boolean;
  /** Handlung im Leerzustand (LLH-1069: „Gebiet zeichnen“). */
  leerAktion?: ReactNode;
  /** Handlung neben dem Sprung, wenn es schon Flächen gibt (LLH-1069: „Weitere Teilfläche zeichnen“). */
  zeichnenAktion?: ReactNode;
}) {
  const { token, rollen } = useRollen();
  const mitFlaeche = bezirk.flaechen > 0;
  const zonenQuery = useQuery({
    queryKey: einsatzKeys.zonen(einsatzId),
    queryFn: () => listeZonen(einsatzId),
    enabled: mitFlaeche && !karteGesperrt,
  });
  const flaechen = useMemo(
    () => bezirkFlaechen(zonenQuery.data ?? [], bezirk.id),
    [zonenQuery.data, bezirk.id],
  );

  const hinweis = (text: string, aktion?: ReactNode) => (
    <div
      data-lfh="bezirk-gebiet-hinweis"
      style={{
        minHeight: 120,
        display: 'grid',
        placeItems: 'center',
        gap: token.marginSM,
        padding: token.padding,
        textAlign: 'center',
        color: rollen.text2,
        border: `1px dashed ${rollen.linie}`,
      }}
    >
      <span>{text}</span>
      {aktion}
    </div>
  );

  let inhalt: ReactNode;
  if (!mitFlaeche) {
    inhalt = hinweis('Kein Gebiet auf der Lagekarte', leerAktion);
  } else if (karteGesperrt) {
    inhalt = (
      <Typography.Text>{`${flaechenText(bezirk.flaechen)} auf der Lagekarte`}</Typography.Text>
    );
  } else if (zonenQuery.isError) {
    inhalt = <Typography.Text type="danger">Gebiet konnte nicht geladen werden</Typography.Text>;
  } else if (zonenQuery.isLoading) {
    inhalt = <Typography.Text type="secondary">Gebiet wird geladen …</Typography.Text>;
  } else if (flaechen.ausschnitt == null) {
    // Gezählt, aber (noch) keine lesbare Fläche in der Liste: etwa eine Ansicht, deren Zonen der
    // Abruf nicht trägt. Nie eine leere Karte zeigen.
    inhalt = hinweis('Gebiet nicht darstellbar');
  } else {
    inhalt = (
      <BezirkKartenbild
        flaechen={flaechen}
        etikett={`Karte: Gebiet von Bezirk ${bezirk.bezeichnung}`}
      />
    );
  }

  return (
    <Paneel
      titel="Gebiet"
      meta={mitFlaeche ? flaechenText(bezirk.flaechen) : undefined}
      koerperPolster
      fuss={
        mitFlaeche ? (
          <Space wrap size="middle">
            <SprungKnopf
              to={lagekartePfad(einsatzId, { evakuierungsbezirk: bezirk.id })}
              gesperrt={karteGesperrt}
            >
              Auf Lagekarte öffnen
            </SprungKnopf>
            {zeichnenAktion}
          </Space>
        ) : undefined
      }
    >
      {inhalt}
    </Paneel>
  );
}
