import { Button, Descriptions, Space } from 'antd';
import { useState } from 'react';
import TaktischesZeichen, {
  einheiten,
  fachaufgaben,
  funktionen,
  grundzeichen as grundzeichenKatalog,
  organisationen,
  symbole,
} from 'taktische-zeichen-react';
import type { GrundzeichenId } from 'taktische-zeichen-react';
import type { FreiesZeichen, FreiesZeichenUpdate, KartenAnsicht } from '../../api/types';
import KartenDetailCard from './KartenDetailCard';
import FreiesZeichenPicker from './FreiesZeichenPicker';
import AnsichtZuordnung from './AnsichtZuordnung';
import { baueFreiesZeichenTz } from './marker';

export interface FreiesZeichenInspectorProps {
  zeichen: FreiesZeichen;
  darfSchreiben: boolean;
  onSchliessen: () => void;
  /** Whole-Spec-Overwrite (lat/lon unveränderbar in v1). */
  onAendern: (spec: FreiesZeichenUpdate) => void;
  onLoeschen: () => void;
  /** Ansichts-Zuordnung (B/LFH-320). */
  ansichten: KartenAnsicht[];
  onVerschieben: (ansichtId: number | null) => void;
}

const NEUTRALE_FARBE = '#333333';

/** Editier-Spec (FreiesZeichenUpdate) aus dem ROHEN Record — inkl. evtl. fürs Rendering
 *  gestrippter Overlays, damit sie im Editor erhalten/wählbar bleiben (NICHT die render-tz). */
function baueWert(z: FreiesZeichen): FreiesZeichenUpdate {
  return {
    grundzeichen: z.grundzeichen as GrundzeichenId,
    organisation: z.organisation as FreiesZeichenUpdate['organisation'],
    fachaufgabe: z.fachaufgabe as FreiesZeichenUpdate['fachaufgabe'],
    symbol: z.symbol as FreiesZeichenUpdate['symbol'],
    einheit: z.einheit as FreiesZeichenUpdate['einheit'],
    funktion: z.funktion as FreiesZeichenUpdate['funktion'],
    farbe: z.farbe,
    label: z.label,
  };
}

function labelAus(
  katalog: readonly { id: string; label: string }[],
  id: string | null | undefined,
): string | null {
  if (!id) return null;
  return katalog.find((k) => k.id === id)?.label ?? id;
}

/**
 * Kartenseitiger Detail-Inspector eines freien taktischen Zeichens (LFH-170).
 * Schreibend: der {@link FreiesZeichenPicker}, vorbelegt aus dem rohen Record, meldet jede
 * Änderung als Whole-Spec an `onAendern`; read-only: Vorschau + Werte, keine Controls.
 * Der Parent hält den Inspector über `key={zeichen.id}` je Record frisch (Init-State).
 */
export default function FreiesZeichenInspector({
  zeichen,
  darfSchreiben,
  onSchliessen,
  onAendern,
  onLoeschen,
  ansichten,
  onVerschieben,
}: FreiesZeichenInspectorProps) {
  const [entwurf, setEntwurf] = useState<FreiesZeichenUpdate>(() => baueWert(zeichen));
  const titel = zeichen.label?.trim() ? zeichen.label : 'Taktisches Zeichen';
  const tz = baueFreiesZeichenTz(zeichen);

  return (
    <KartenDetailCard
      titel={titel}
      akzentFarbe={zeichen.farbe ?? NEUTRALE_FARBE}
      onSchliessen={onSchliessen}
    >
      {darfSchreiben ? (
        <Space orientation="vertical" style={{ width: '100%' }}>
          <FreiesZeichenPicker
            wert={entwurf}
            onChange={(spec) => {
              setEntwurf(spec);
              onAendern(spec);
            }}
          />
          <AnsichtZuordnung
            ansichten={ansichten}
            wert={zeichen.ansicht_id}
            disabled={!darfSchreiben}
            onChange={onVerschieben}
          />
          <Button danger block onClick={onLoeschen}>
            Löschen
          </Button>
        </Space>
      ) : (
        <Space orientation="vertical" style={{ width: '100%', alignItems: 'center' }}>
          <TaktischesZeichen {...tz} style={{ width: 64, height: 64 }} />
          <Descriptions column={1} size="small" style={{ width: '100%' }}>
            <Descriptions.Item label="Grundzeichen">
              {labelAus(grundzeichenKatalog, zeichen.grundzeichen)}
            </Descriptions.Item>
            {zeichen.organisation && (
              <Descriptions.Item label="Organisation">
                {labelAus(organisationen, zeichen.organisation)}
              </Descriptions.Item>
            )}
            {zeichen.fachaufgabe && (
              <Descriptions.Item label="Fachaufgabe">
                {labelAus(fachaufgaben, zeichen.fachaufgabe)}
              </Descriptions.Item>
            )}
            {zeichen.symbol && (
              <Descriptions.Item label="Symbol">
                {labelAus(symbole, zeichen.symbol)}
              </Descriptions.Item>
            )}
            {zeichen.einheit && (
              <Descriptions.Item label="Einheit">
                {labelAus(einheiten, zeichen.einheit)}
              </Descriptions.Item>
            )}
            {zeichen.funktion && (
              <Descriptions.Item label="Funktion">
                {labelAus(funktionen, zeichen.funktion)}
              </Descriptions.Item>
            )}
          </Descriptions>
        </Space>
      )}
    </KartenDetailCard>
  );
}
