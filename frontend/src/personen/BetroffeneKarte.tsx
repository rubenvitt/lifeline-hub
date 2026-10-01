import { useMemo, useRef, useState, type FocusEvent, type PointerEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { EinsatzAnzeige, Person } from '../api/types';
import { ladeKarteConfig } from '../api/karte';
import { globalKeys } from '../api/queryKeys';
import { Sammelbanner, useRollen } from '../components/instrument';
import { SeitenLeer } from '../components/SeitenZustand';
import { useThemeMode } from '../theme/ThemeModeProvider';
import Kartenflaeche, { type KartenHandle } from '../pages/lagekarte/Kartenflaeche';
import KartenUeberlagerung from '../pages/lagekarte/KartenUeberlagerung';
import { baueMarker } from '../pages/lagekarte/marker';
import { erzeugeZeigerQuelle } from '../pages/lagekarte/mausPosition';
import { startAnsicht } from '../pages/lagekarte/startAnsicht';
import { useBasemap } from '../pages/lagekarte/useBasemap';
import { useKartenAnsicht } from '../pages/lagekarte/useKartenAnsicht';
import type { KarteMarker } from '../pages/lagekarte/marker';
import { schleuse, wartendText } from './kartenSchleuse';
import { personenMarker } from './personenKarte';

/**
 * Kartenansicht der Betroffenen: jede nicht stornierte Person mit Fundort-Koordinate als Marker.
 *
 * - **Eigenes Bündel** (`React.lazy` in `PersonenPage`) — MapLibre gehört nicht ins Bündel der
 *   Liste.
 * - **Dieselbe Grundlage wie die Lagekarte** (`useKartenAnsicht` + `useBasemap`); umgeschaltet
 *   wird sie nur dort.
 * - **Keine Bearbeitungs-Props**: die Karte zeigt nur; verortet wird über die Detailseite.
 * - **Startausschnitt:** Rahmen um die Personen-Marker, sonst der Einsatzort; die gespeicherte
 *   Ansicht der Lagekarte zählt bewusst nicht. Ohne beides Leerzustand statt Weltkarte.
 * - **Die Lücke wird GESAGT:** „n ohne Koordinate" steht immer über der Karte — nur bei `> 0`
 *   spränge die Karte um eine Zeile, sobald die letzte Person live verortet wird.
 * - **Begrenzte Höhe in `dvh`**: das Layout gibt keine Höhe vor, und bei `vh` fräße die
 *   Browserleiste des Handschirms den unteren Rand.
 * - **Schleuse** (LFH-668, `openspec/changes/lfh-668-betroffenen-karte-schleuse/design.md`): solange
 *   Maus oder Stift über der Ansicht liegen, der Fokus darin steht oder ein Bündel aufgefächert ist,
 *   halten die Marker Menge, Folge und Lage — ein Zugang verschmilzt nicht unter dem Zeiger zum
 *   Bündel. Sichtung und Beschriftung fließen weiter. Neu, verlegt und entfallen wartet im
 *   Sammelbanner der Standzeile; Entfallene bleiben bis dahin stehen (ein Wegfall spaltete sonst
 *   ein Bündel unter dem Zeiger). Touch zählt nur über das aufgefächerte Bündel. Der Bereich ist
 *   die ganze Ansicht samt Banner: der Weg dorthin taut nicht auf.
 * - **Die Standzeile hat eine feste Höhe**: „Live", „Live pausiert" oder der Banner — ihr Wechsel
 *   verschiebt die Karte nie.
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

/**
 * `verortet` = Personen-Marker auf der Karte. Ohne Lücke UND ohne Marker wäre „alle stehen auf
 * der Karte" über einer leeren Karte falsch — dann sagt der Satz, dass die Auswahl keine
 * angetroffene Person enthält.
 */
export function ohneKoordinateText(anzahl: number, verortet: number, wartendNeu = 0): string {
  // Ein wartender Zugang steht noch nicht auf der Karte (Schleuse, LFH-668): dann keine
  // Vollständigkeit behaupten.
  if (anzahl === 0 && wartendNeu > 0) return 'Keine Person ohne Koordinate';
  if (anzahl === 0 && verortet === 0) return 'Keine angetroffene Person in dieser Auswahl';
  if (anzahl === 0) return 'Alle angetroffenen Personen dieser Auswahl stehen auf der Karte';
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
  const { token, rollen } = useRollen();
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

  const { marker: frisch, ohneKoordinate } = useMemo(
    () => personenMarker(personen, token),
    [personen, token],
  );

  // ── Schleuse (LFH-668) ───────────────────────────────────────────────────────────
  // `gehalten === null`: offen. Geschlossen wird mit dem gerade gezeigten Stand — bei offener
  // Schleuse ist das der frische.
  const [gehalten, setGehalten] = useState<readonly KarteMarker[] | null>(null);
  const { gezeigt: marker, wartend } = useMemo(
    () => schleuse(gehalten, frisch),
    [gehalten, frisch],
  );
  const frischRef = useRef(frisch);
  frischRef.current = frisch;
  const bedingungRef = useRef({ zeiger: false, fokus: false, spider: false });
  const bereichRef = useRef<HTMLDivElement>(null);
  const setzeBedingung = (art: 'zeiger' | 'fokus' | 'spider', wert: boolean) => {
    const b = { ...bedingungRef.current, [art]: wert };
    bedingungRef.current = b;
    const zu = b.zeiger || b.fokus || b.spider;
    setGehalten((vorher) => (zu ? (vorher ?? frischRef.current) : null));
  };
  // Touch zählt nicht: ein Tipp betritt und verlässt den Bereich, und nach einem Wisch hielte ein
  // haftendes „drin" den Stand ohne Grund. Touch schließt über das aufgefächerte Bündel.
  const zeigerRein = (e: PointerEvent) => {
    if (e.pointerType !== 'touch') setzeBedingung('zeiger', true);
  };
  const zeigerRaus = (e: PointerEvent) => {
    if (e.pointerType !== 'touch') setzeBedingung('zeiger', false);
  };
  // `blur` feuert auch beim Wechsel zwischen zwei Zielen des Bereichs — nur ein Ziel außerhalb taut.
  const fokusRaus = (e: FocusEvent) => {
    const ziel = e.relatedTarget;
    if (ziel instanceof Node && bereichRef.current?.contains(ziel)) return;
    setzeBedingung('fokus', false);
  };
  const wartet = wartendText(wartend);
  // Der Einsatzort steht zur Orientierung mit auf der Karte; `baueMarker` ist die eine Quelle
  // seiner Signatur.
  const ort = useMemo(() => baueMarker(einsatz, [], [], token).verortet, [einsatz, token]);
  const alleMarker = useMemo(() => [...ort, ...marker], [ort, marker]);
  const start = useMemo(() => startAnsicht(marker.length > 0 ? marker : ort), [marker, ort]);

  const hinweis = (
    <div
      data-lfh="betroffene-karte-ohne-koordinate"
      data-anzahl={ohneKoordinate}
      style={{
        color: token.colorTextSecondary,
        fontSize: token.fontSizeSM,
        marginBlockEnd: token.marginXS,
      }}
    >
      {ohneKoordinateText(ohneKoordinate, marker.length, wartend.neu)}
    </div>
  );

  /**
   * Feste Höhe = die des Sammelbanners (Knopf `controlHeight` + Innenabstand + Rand): der Wechsel
   * zwischen „Live", „Live pausiert" und dem Banner verschiebt die Karte nicht. Nur der Banner
   * trägt `role="status"` — die ruhigen Texte wechselten beim bloßen Überfahren.
   */
  const standHoehe = token.controlHeight + 2 * token.paddingXS + 2;
  const standzeile = (
    <div
      data-testid="betroffene-karte-stand"
      data-lfh="betroffene-karte-stand"
      style={{ height: standHoehe, marginBlockEnd: token.marginXS, display: 'flex' }}
    >
      {wartet !== null ? (
        <Sammelbanner
          aktion={{ label: 'anzeigen', onKlick: () => setGehalten(frischRef.current) }}
          style={{ flex: '1 1 auto', minWidth: 0, flexWrap: 'nowrap', boxSizing: 'border-box' }}
        >
          <span
            title={wartet}
            style={{
              display: 'block',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {wartet}
          </span>
        </Sammelbanner>
      ) : (
        <span
          style={{
            alignSelf: 'center',
            fontSize: token.fontSizeSM,
            color: rollen.gedaempft,
          }}
        >
          {gehalten === null ? 'Live' : 'Live pausiert'}
        </span>
      )}
    </div>
  );

  const bereichProps = {
    ref: bereichRef,
    'data-testid': 'betroffene-karte-bereich',
    onPointerEnter: zeigerRein,
    onPointerLeave: zeigerRaus,
    onFocus: () => setzeBedingung('fokus', true),
    onBlur: fokusRaus,
  };

  if (start === null) {
    return (
      <div data-lfh="betroffene-karte" {...bereichProps}>
        {hinweis}
        {standzeile}
        <SeitenLeer
          titel="Keine Person mit Koordinate"
          hinweis="Eine Koordinate lässt sich in der Erfassungszeile (#52.2691/9.1342), auf der Detailseite oder über die Lagekarte setzen."
        />
      </div>
    );
  }

  return (
    <div data-lfh="betroffene-karte" {...bereichProps}>
      {hinweis}
      {standzeile}
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
          onSpiderOffen={(offen) => setzeBedingung('spider', offen)}
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
