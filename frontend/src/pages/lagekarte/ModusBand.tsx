import { Button, Typography } from 'antd';
import { useId, useState } from 'react';
import FeldLabel from '../../components/FeldLabel';
import { useRollen } from '../../components/instrument';
import KoordinatenEingabe from '../../anzeige/KoordinatenEingabe';
import type { LatLon } from '../../anzeige/koordinaten';
import { istLatLon, type KoordinatenWert } from '../../anzeige/koordinatenWert';
import { ModusBedienung, type PlatzierModus } from './PlatzierSteuerung';

/** Zusatzangaben beim Platzieren: der Weg über die Koordinate. */
export interface PlatzierZusatz {
  einsatzId: number;
  /** Eigener Marker, den die Ort-Vorschau ausschließt (`ortVorschauExclude`). */
  exclude?: string;
  onKoordinate: (lat: number, lon: number) => void;
}

/** Zusatzangaben beim Bild einpassen: fehlende Kantengriffe und der Mittelpunkt als Zahl. */
export interface BildZusatz {
  einsatzId: number;
  /** `griffHinweis(...)` — gesetzt, wenn die Karte Griffe mangels Platz ausblendet. */
  griffHinweis: string | null;
  zentrum: LatLon | null;
  onMittelpunkt: (lat: number, lon: number) => void;
}

/** Anker je Modus — die beiden älteren tragen e2e-Specs und Tests weiter. */
function anker(art: PlatzierModus['art']): string {
  if (art === 'platzieren') return 'platzieren-hinweis';
  if (art === 'verortet') return 'verortet-hinweis';
  return 'modus-band';
}

/**
 * Modus-Band der Kartenleiste (LLH-1028, Zielgliederung D3): direkt unter der Segmentleiste, in
 * jeder Ansicht gleich und außerhalb der Rollfläche. Ab `lg` (`bedienung`) trägt es die ganze
 * Bedienung des laufenden Leistenmodus und die Rückmeldung „… verortet“ — derselbe Baustein wie
 * das Fuß-Band (`ModusBedienung`). Unter `lg` stehen die Knöpfe im Fuß; hier bleiben Titel und
 * Zusatzangaben (Koordinate, Mittelpunkt), die über „Leiste einblenden“ erreichbar sind.
 *
 * Die Zeilen und Gruppen der Ansichten zeigen nur den Zustand („wird platziert“): je Breite genau
 * ein Knopf je Handlung, auch wenn die Person die Ansicht wechselt.
 *
 * Eingabeentwürfe (Koordinate, Mittelpunkt) leben hier; die Leiste hängt das Band je Ziel neu
 * ein (`key`), damit ein Entwurf nicht ins nächste Ziel wandert.
 */
export default function ModusBand({
  modus,
  bedienung,
  platzieren,
  bild,
}: {
  modus: PlatzierModus | null;
  bedienung: boolean;
  platzieren?: PlatzierZusatz;
  bild?: BildZusatz;
}) {
  const { token, rollen } = useRollen();
  const koordId = useId();
  const mitteId = useId();
  // Ungültige Eingabe ist kein Ziel (LFH-517): „Übernehmen“ nimmt nur ein gültiges Paar.
  const [koord, setKoord] = useState<KoordinatenWert>(null);
  const [mitte, setMitte] = useState<KoordinatenWert>(null);
  if (!modus) return null;

  const zusatz =
    modus.art === 'platzieren' && platzieren ? (
      <div>
        {/* Ein Tipp auf die Karte setzt die Position; hier steht der Weg über die Koordinate. */}
        <FeldLabel text="Koordinate" htmlFor={koordId}>
          <KoordinatenEingabe
            id={koordId}
            value={koord}
            onChange={setKoord}
            einsatzId={platzieren.einsatzId}
            exclude={platzieren.exclude}
          />
        </FeldLabel>
        <div style={{ marginTop: token.marginXS }}>
          <Button
            disabled={!istLatLon(koord)}
            onClick={() => {
              if (istLatLon(koord)) {
                platzieren.onKoordinate(koord.lat, koord.lon);
                setKoord(null);
              }
            }}
          >
            Übernehmen
          </Button>
        </div>
      </div>
    ) : modus.art === 'bild' && bild ? (
      <div>
        {bild.griffHinweis && (
          <Typography.Text
            type="warning"
            style={{ fontSize: 12, display: 'block', marginBottom: token.marginXS }}
            data-lfh="bildgriff-hinweis"
          >
            {bild.griffHinweis}
          </Typography.Text>
        )}
        <FeldLabel text="Mittelpunkt" htmlFor={mitteId}>
          <KoordinatenEingabe
            id={mitteId}
            value={mitte ?? bild.zentrum}
            onChange={setMitte}
            einsatzId={bild.einsatzId}
          />
        </FeldLabel>
        <div style={{ marginTop: token.marginXS }}>
          <Button
            disabled={!istLatLon(mitte)}
            onClick={() => {
              if (istLatLon(mitte)) {
                bild.onMittelpunkt(mitte.lat, mitte.lon);
                setMitte(null);
              }
            }}
          >
            Mittelpunkt setzen
          </Button>
        </div>
      </div>
    ) : null;

  // Unter `lg` ohne Zusatz (Taktisches Zeichen, Rückmeldung): alles steht im Fuß.
  if (!bedienung && zusatz == null) return null;
  return (
    <div
      data-lfh={anker(modus.art)}
      data-modus-band={modus.art}
      style={{
        padding: token.padding,
        borderBlockEnd: `1px solid ${rollen.linie}`,
        borderInlineStart: `2px solid ${rollen.bedien}`,
        background: rollen.flaeche2,
      }}
    >
      <ModusBedienung modus={modus} zusatz={zusatz} bedienung={bedienung} />
    </div>
  );
}
