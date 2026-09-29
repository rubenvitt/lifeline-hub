import { Button, Descriptions, Popconfirm, Space } from 'antd';
import { useEffect, useRef, useState } from 'react';
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
  ansichten: KartenAnsicht[];
  onVerschieben: (ansichtId: number | null) => void;
}

const NEUTRALE_FARBE = '#333333';

/** Ruhefrist, nach der eine Änderung im Inspector geschrieben wird. */
const SCHREIB_FRIST_MS = 600;

/**
 * Editier-Spec aus dem rohen Record — inkl. fürs Rendering gestrippter Overlays, damit sie im
 * Editor erhalten und wählbar bleiben.
 */
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
 * Detail-Inspector eines freien taktischen Zeichens. Schreibend: der {@link FreiesZeichenPicker},
 * vorbelegt aus dem rohen Record; Änderungen gehen entprellt als Whole-Spec an `onAendern`.
 * Read-only: Vorschau + Werte. Der Parent hält ihn per `key={zeichen.id}` je Record frisch.
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
  /**
   * Eigen-Merker: nur eine Änderung im Picker setzt ihn, das Senden löscht ihn. Ohne ihn schriebe
   * eine per Live-Invalidierung hereinkommende fremde Änderung nach der Frist den alten Entwurf
   * zurück.
   */
  const [eigeneAenderung, setEigeneAenderung] = useState(false);
  const serverStand = JSON.stringify(baueWert(zeichen));
  const entwurfText = JSON.stringify(entwurf);

  // Neuer Serverstand: ohne offene eigene Änderung folgt der Entwurf ihm — während des Renderns,
  // damit kein Bild mit dem alten Entwurf dazwischen steht.
  const [gesehenerServerStand, setGesehenerServerStand] = useState(serverStand);
  if (serverStand !== gesehenerServerStand) {
    setGesehenerServerStand(serverStand);
    if (!eigeneAenderung) setEntwurf(baueWert(zeichen));
  }
  // Steht der Entwurf wieder auf dem Serverstand (dieselbe Kachel erneut, hin und zurück, Echo der
  // eigenen Sendung), ist nichts Eigenes offen — sonst bliebe der Merker stehen und die Übernahme
  // fremder Änderungen dauerhaft aus.
  if (eigeneAenderung && entwurfText === serverStand) setEigeneAenderung(false);

  const onAendernRef = useRef(onAendern);
  useEffect(() => {
    onAendernRef.current = onAendern;
  });
  /**
   * Wer den Inspector innerhalb der Frist schließt, verlöre seine Änderung (der Cleanup räumt den
   * Timer ab). Der Ref trägt die Absicht in den Abbau-Effekt.
   */
  const offenerStand = useRef<string | null>(null);
  useEffect(() => {
    if (!eigeneAenderung || entwurfText === serverStand) {
      offenerStand.current = null;
      return;
    }
    offenerStand.current = entwurfText;
    const t = setTimeout(() => {
      offenerStand.current = null;
      setEigeneAenderung(false);
      onAendernRef.current(JSON.parse(entwurfText) as FreiesZeichenUpdate);
    }, SCHREIB_FRIST_MS);
    return () => clearTimeout(t);
  }, [eigeneAenderung, entwurfText, serverStand]);

  // Beim Abbau nachholen, was die Frist nicht geschafft hat. Leere Deps: läuft einmal beim Abbau
  // und liest über Refs.
  useEffect(
    () => () => {
      const rest = offenerStand.current;
      if (rest) onAendernRef.current(JSON.parse(rest) as FreiesZeichenUpdate);
    },
    [],
  );
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
          {/* Entprellt: im Raster meldet jeder Pfeilschritt eine Auswahl. `autoFokus` aus: der
              Inspector hängt beim Marker-Klick ein und nähme sonst der Karte die Tastatur. */}
          <FreiesZeichenPicker
            wert={entwurf}
            autoFokus={false}
            onChange={(spec) => {
              setEntwurf(spec);
              setEigeneAenderung(true);
            }}
          />
          <AnsichtZuordnung
            ansichten={ansichten}
            wert={zeichen.ansicht_id}
            disabled={!darfSchreiben}
            onChange={onVerschieben}
          />
          {/* Hart gelöscht (`freies_zeichen/repo.rs`), also Rückfrage mit rotem OK. */}
          <Popconfirm
            title={`„${titel}“ löschen?`}
            description="Das Zeichen wird endgültig von der Karte entfernt."
            okText="Löschen"
            okButtonProps={{ danger: true }}
            cancelText="Abbrechen"
            onConfirm={() => {
              // Eine offene Änderung wird verworfen, nicht beim Abbau nachgeholt (PATCH auf
              // gelöschtes Zeichen → 404). Erst beim Bestätigen — ein Abbrechen darf sie nicht
              // verlieren.
              offenerStand.current = null;
              onLoeschen();
            }}
          >
            <Button danger block>
              Löschen
            </Button>
          </Popconfirm>
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
