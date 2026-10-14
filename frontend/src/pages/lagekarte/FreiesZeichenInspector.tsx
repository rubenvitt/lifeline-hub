import { Button, Popconfirm, Space } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { parseAnySpec, serializeAnySpec } from '@einsatzzeichen/core';
import type {
  FreiesZeichen,
  FreiesZeichenPatch,
  FreiesZeichenUpdate,
  KartenAnsicht,
} from '../../api/types';
import KartenDetailCard from './KartenDetailCard';
import FreiesZeichenPicker, {
  hatZeichen,
  ZeichenAufPlatte,
  type ZeichenEntwurf,
} from './FreiesZeichenPicker';
import AnsichtZuordnung from './AnsichtZuordnung';
import { Datenfeld, Datenraster, useRollen } from '../../components/instrument';
import {
  ALT_FELDER,
  altform,
  freiesZeichen,
  fuellfarbe,
  type FreiesZeichenEingabe,
} from '../../zeichen/freiesZeichen';
import { ZEICHEN_KARTEN_PX } from './markerIcons';
import { zeichenTeile } from './zeichenWahl';

export interface FreiesZeichenInspectorProps {
  zeichen: FreiesZeichen;
  darfSchreiben: boolean;
  onSchliessen: () => void;
  /** Zeichen und Bezeichnung als Ganzes (lat/lon unveränderbar in v1). */
  onAendern: (spec: FreiesZeichenPatch) => void;
  onLoeschen: () => void;
  ansichten: KartenAnsicht[];
  onVerschieben: (ansichtId: number | null) => void;
}

/** Ruhefrist, nach der eine Änderung im Inspector geschrieben wird. */
const SCHREIB_FRIST_MS = 600;

function eingabe(z: FreiesZeichen): FreiesZeichenEingabe {
  return {
    zeichen_spec: z.zeichen_spec,
    grundzeichen: z.grundzeichen,
    organisation: z.organisation,
    fachaufgabe: z.fachaufgabe,
    symbol: z.symbol,
    einheit: z.einheit,
    funktion: z.funktion,
    farbe: z.farbe,
  };
}

/**
 * Der Entwurf aus dem gespeicherten Zeichen (LFH-836, design.md D5): eine lesbare Spec so, wie sie
 * gespeichert ist (kanonisch), sonst die wirksame Spec des Leseadapters. Eine Altzeile steht damit
 * im Picker als Zeichenbeschreibung und wird beim nächsten Ändern als solche gespeichert.
 */
function baueWert(z: FreiesZeichen): FreiesZeichenUpdate {
  let zeichenSpec: string | null = null;
  if (z.zeichen_spec) {
    try {
      zeichenSpec = serializeAnySpec(parseAnySpec(z.zeichen_spec));
    } catch {
      // Unlesbar: wie eine Altzeile über den Adapter.
    }
  }
  return {
    zeichen_spec: zeichenSpec ?? serializeAnySpec(freiesZeichen(eingabe(z)).spec),
    label: z.label,
  };
}

/**
 * Was gesendet wird: Bleibt das Zeichen gleich und ändert sich nur die Bezeichnung, geht nur
 * `label` raus. Sonst würde schon eine Umbenennung eine Altzeile (oder eine unlesbare Spec aus
 * einer neueren Bibliothek) durch ihre wirksame, womöglich vereinfachte Fassung ersetzen und die
 * Alt-Kennung samt Alt-Farbe verlieren (design.md D6, LFH-836 Review).
 */
function sendung(entwurf: FreiesZeichenUpdate, server: FreiesZeichenUpdate): FreiesZeichenPatch {
  return entwurf.zeichen_spec === server.zeichen_spec ? { label: entwurf.label } : entwurf;
}

/**
 * Die Alt-Kennung eines Altzeichens (`gefahr · abc · #cc0000`), sonst `null` — aus der Hülle einer
 * Altzeile (LLH-1160) wie aus den Feldern eines Lage-Snapshots von vorher.
 */
function altKennung(z: FreiesZeichen): string | null {
  const alt = altform(eingabe(z));
  if (!alt) return null;
  const teile = ALT_FELDER.map((f) => alt[f]).filter((w): w is string => !!w);
  return teile.length > 0 ? teile.join(' · ') : null;
}

/**
 * Detail-Inspector eines freien taktischen Zeichens. Schreibend: der {@link FreiesZeichenPicker},
 * vorbelegt aus dem gespeicherten Zeichen; Änderungen gehen entprellt als `zeichen_spec` samt
 * Bezeichnung an `onAendern`. Read-only: die Werte. Die Symbolkachel zeigt das Zeichen, wie die
 * Bibliothek es zeichnet. Der Parent hält ihn per `key={zeichen.id}` je Record frisch.
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
  const { rollen } = useRollen();
  const [entwurf, setEntwurf] = useState<ZeichenEntwurf>(() => baueWert(zeichen));
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
  const serverRef = useRef<FreiesZeichenUpdate>(JSON.parse(serverStand) as FreiesZeichenUpdate);
  useEffect(() => {
    onAendernRef.current = onAendern;
    serverRef.current = JSON.parse(serverStand) as FreiesZeichenUpdate;
  });
  /**
   * Wer den Inspector innerhalb der Frist schließt, verlöre seine Änderung (der Cleanup räumt den
   * Timer ab). Der Ref trägt die Absicht in den Abbau-Effekt.
   */
  const offenerStand = useRef<string | null>(null);
  useEffect(() => {
    // Ohne Zeichen („Kein Grundzeichen“ vor der Symbolwahl) wird nichts gespeichert.
    if (!eigeneAenderung || entwurfText === serverStand || !hatZeichen(entwurf)) {
      offenerStand.current = null;
      return;
    }
    offenerStand.current = entwurfText;
    const t = setTimeout(() => {
      offenerStand.current = null;
      setEigeneAenderung(false);
      onAendernRef.current(
        sendung(JSON.parse(entwurfText) as FreiesZeichenUpdate, serverRef.current),
      );
    }, SCHREIB_FRIST_MS);
    return () => clearTimeout(t);
  }, [eigeneAenderung, entwurf, entwurfText, serverStand]);

  // Beim Abbau nachholen, was die Frist nicht geschafft hat. Leere Deps: läuft einmal beim Abbau
  // und liest über Refs.
  useEffect(
    () => () => {
      const rest = offenerStand.current;
      if (rest) {
        onAendernRef.current(sendung(JSON.parse(rest) as FreiesZeichenUpdate, serverRef.current));
      }
    },
    [],
  );
  const titel = zeichen.label?.trim() ? zeichen.label : 'Taktisches Zeichen';
  const bild = freiesZeichen(eingabe(zeichen));
  const alt = altKennung(zeichen);

  return (
    <KartenDetailCard
      titel={titel}
      akzentFarbe={
        // Mit Füllung deren Palettenfarbe; ohne eine Textrolle: die Kartentinte verschwände auf dem
        // dunklen Paneel (LFH-797, Spec `lagekarte-taktische-zeichen`).
        fuellfarbe(bild.spec) ?? rollen.text2
      }
      kachel={<ZeichenAufPlatte drawing={bild.drawing} size={ZEICHEN_KARTEN_PX} />}
      unterzeile={
        bild.vereinfacht ? (
          <span data-lfh="zeichen-vereinfacht">
            vereinfacht dargestellt{alt ? ` · ${alt}` : ''}
          </span>
        ) : undefined
      }
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
        <Datenraster spalten={1} beschriftung="Zeichen">
          {zeichenTeile(bild.spec).map((t, i) => (
            <Datenfeld key={`${t.achse}-${i}`} label={t.achse}>
              {t.name}
            </Datenfeld>
          ))}
        </Datenraster>
      )}
    </KartenDetailCard>
  );
}
