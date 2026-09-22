import { useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { EinsatzAnzeige, Person } from '../api/types';
import { ladeKarteConfig } from '../api/karte';
import { globalKeys } from '../api/queryKeys';
import { useRollen } from '../components/instrument';
import { SeitenLeer } from '../components/SeitenZustand';
import { useThemeMode } from '../theme/ThemeModeProvider';
import Kartenflaeche, { type KartenHandle } from '../pages/lagekarte/Kartenflaeche';
import KartenUeberlagerung from '../pages/lagekarte/KartenUeberlagerung';
import { baueMarker } from '../pages/lagekarte/marker';
import { erzeugeZeigerQuelle } from '../pages/lagekarte/mausPosition';
import { startAnsicht } from '../pages/lagekarte/startAnsicht';
import { useBasemap } from '../pages/lagekarte/useBasemap';
import { useKartenAnsicht } from '../pages/lagekarte/useKartenAnsicht';
import { personenMarker } from './personenKarte';

/**
 * Kartenansicht der Betroffenen (LFH-613, design D7): jede nicht stornierte Person mit
 * Fundort-Koordinate als Marker auf der Einsatzkarte.
 *
 * - **Eigenes Bündel.** `PersonenPage` lädt diese Datei per `React.lazy`, erst wenn „Karte"
 *   gewählt ist — MapLibre gehört nicht in das Bündel der Liste.
 * - **Dieselbe Grundlage wie die Lagekarte.** Die Basemap kommt aus der Standardansicht des
 *   Einsatzes (`useKartenAnsicht` + `useBasemap`), nicht aus einer eigenen Wahl: zwei
 *   Karten desselben Einsatzes mit verschiedener Grundlage wären ein Unterschied ohne
 *   Bedeutung. Umgeschaltet wird sie hier nicht — das ist Sache der Lagekarte.
 * - **Keine Zeichen-, Zonen- oder Fachebenen-Props.** Die Karte zeigt, sie bearbeitet nicht;
 *   verortet wird über die Detailseite („Auf Lagekarte verorten").
 * - **Startausschnitt:** Rahmen um die Personen-Marker, ohne sie der Einsatzort. Die Ansicht
 *   der Lagekarte (`zentrum_lat`/`zoom`) zählt bewusst NICHT — sie schlüge den Rahmen, und
 *   gefragt ist hier, wo die Betroffenen liegen. Ohne beides: Leerzustand statt einer
 *   Weltkarte, auf der nichts steht.
 * - **Die Lücke wird GESAGT:** „n ohne Koordinate" steht über der Karte. Eine Karte, die
 *   still weniger zeigt als die Liste, läse sich als vollständig.
 * - **Begrenzte Höhe in `dvh`** (Höhenkette, LFH-343 · C8): das Layout darüber gibt keine
 *   Höhe vor, und die Browserleiste des Handschirms frisst bei `vh` den unteren Rand.
 */
export interface BetroffeneKarteProps {
  einsatzId: number;
  einsatz: EinsatzAnzeige | undefined;
  /** Die Personen der aktuellen Sicht (Statusfilter und Lücken-Filter gelten auch hier). */
  personen: readonly Person[];
  onPersonKlick: (personId: number) => void;
}

const SCHLUESSEL_PRAEFIX = 'person-';

/** Personen-id aus einem Marker-Schlüssel; der Einsatzort und Fremdes ergeben `null`. */
export function personIdAusSchluessel(schluessel: string): number | null {
  if (!schluessel.startsWith(SCHLUESSEL_PRAEFIX)) return null;
  const id = Number(schluessel.slice(SCHLUESSEL_PRAEFIX.length));
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function ohneKoordinateText(anzahl: number): string {
  return anzahl === 1
    ? '1 Person ohne Koordinate — nicht auf der Karte'
    : `${anzahl} Personen ohne Koordinate — nicht auf der Karte`;
}

export default function BetroffeneKarte({
  einsatzId,
  einsatz,
  personen,
  onPersonKlick,
}: BetroffeneKarteProps) {
  const { token } = useRollen();
  const { effektiv } = useThemeMode();
  const kartenRef = useRef<KartenHandle>(null);
  const zeigerQuelle = useMemo(() => erzeugeZeigerQuelle(), []);

  const { data: config } = useQuery({
    queryKey: globalKeys.karteConfig(),
    queryFn: ladeKarteConfig,
  });
  const { effektiveBasemap, onlineStilName, kartenTheme, onStyleFehler } = useKartenAnsicht({
    einsatzId,
    config,
  });
  const { style, basisAttribution } = useBasemap({
    basemap: effektiveBasemap,
    onlineStilName,
    kartenTheme,
    config,
    effektiv,
  });

  const { marker, ohneKoordinate } = useMemo(
    () => personenMarker(personen, token),
    [personen, token],
  );
  // Der Einsatzort steht zur Orientierung mit auf der Karte; `baueMarker` ist die eine
  // Quelle seiner Signatur (Farbrolle `marke`, taktisches Zeichen).
  const ort = useMemo(() => baueMarker(einsatz, [], [], token).verortet, [einsatz, token]);
  const alleMarker = useMemo(() => [...ort, ...marker], [ort, marker]);
  const start = useMemo(() => startAnsicht(marker.length > 0 ? marker : ort), [marker, ort]);

  const hinweis =
    ohneKoordinate > 0 ? (
      <div
        data-lfh="betroffene-karte-ohne-koordinate"
        style={{
          color: token.colorTextSecondary,
          fontSize: token.fontSizeSM,
          marginBlockEnd: token.marginXS,
        }}
      >
        {ohneKoordinateText(ohneKoordinate)}
      </div>
    ) : null;

  if (start === null) {
    return (
      <div data-lfh="betroffene-karte">
        {hinweis}
        <SeitenLeer
          titel="Keine Person mit Koordinate"
          hinweis="Eine Koordinate lässt sich in der Erfassungszeile (#52.2691/9.1342), auf der Detailseite oder über die Lagekarte setzen."
        />
      </div>
    );
  }

  return (
    <div data-lfh="betroffene-karte">
      {hinweis}
      <div
        style={{
          position: 'relative',
          height: 'min(70dvh, 760px)',
          minHeight: 320,
          border: `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        <Kartenflaeche
          ref={kartenRef}
          style={style}
          attribution={basisAttribution}
          markers={alleMarker}
          onMarkerKlick={(schluessel) => {
            const id = personIdAusSchluessel(schluessel);
            if (id != null) onPersonKlick(id);
          }}
          startAnsicht={start}
          onStyleFehler={onStyleFehler}
          onZeigerLage={zeigerQuelle.melde}
        />
        <KartenUeberlagerung
          grundlage={null}
          zeigerQuelle={zeigerQuelle}
          onZoomRein={() => kartenRef.current?.zoomRein()}
          onZoomRaus={() => kartenRef.current?.zoomRaus()}
          onNorden={() => kartenRef.current?.nachNorden()}
        />
      </div>
    </div>
  );
}
