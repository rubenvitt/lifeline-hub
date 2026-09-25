// frontend/src/etb/entwuerfe/EtbEntwurfsTabs.tsx
import { Spin, Tabs } from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../../api/client';
import type { NeuerEintrag } from '../../api/etb';
import type { EinsatzAnzeige, EtbBaustein } from '../../api/types';
import Schnellerfassung, { nurUebernahme, VERSAND_RUHE, type Versand } from '../Schnellerfassung';
import type { MetadatenWerte } from '../schnellerfassungModell';
import { entwurfLabel, zuWerte } from './entwurfModell';
import { useEtbEntwuerfe } from './useEtbEntwuerfe';
import { useEntwurfsDateien, type EntwurfsDateien } from './useEntwurfsDateien';

export interface EtbEntwurfsTabsProps {
  einsatzId: number;
  erfassen: (e: NeuerEintrag) => Promise<void>;
  bausteine: EtbBaustein[];
  einsatz: EinsatzAnzeige;
  /** Eine laufende Detail-Abfrage muss vor der ersten Vorbelegung ankommen. */
  kontextLaedt?: boolean;
  /** Zustand des Schalters „Werte behalten". Liegt beim Aufrufer — s. Kommentar unten. */
  werteBehalten: boolean;
  onWerteBehaltenChange: (b: boolean) => void;
  /**
   * Meldet, ob gerade ein Entwurf sendet (LFH-117, Review C1). `EtbPage` sperrt damit
   * „Berichtigen": die Berichtigung ersetzt diesen Container, und ein laufender Versand
   * verlöre dabei seinen sichtbaren Zustand.
   */
  onSendetChange?: (sendet: boolean) => void;
  /** Gewählte Anhänge je Entwurf; fehlt es, führt der Container sie selbst. */
  dateien?: EntwurfsDateien;
}

/** Stabile leere Liste: ein frisches `[]` je Render wäre für die Schnellerfassung jedes Mal neu. */
const KEINE_DATEIEN: File[] = [];

export default function EtbEntwurfsTabs({
  einsatzId,
  erfassen,
  bausteine,
  einsatz,
  kontextLaedt = false,
  werteBehalten,
  onWerteBehaltenChange,
  onSendetChange,
  dateien: dateienVonAussen,
}: EtbEntwurfsTabsProps) {
  const {
    entwuerfe,
    aktiverId,
    neuerEntwurf,
    entwurfSchliessen,
    entwurfAktualisieren,
    entwurfFesthalten,
    entwurfNeuAusweisen,
    aktivenSetzen,
  } = useEtbEntwuerfe(einsatzId, einsatz.meine_fuehrungsstelle, kontextLaedt);

  /**
   * Wertübernahme über die Remount-Grenze (LFH-332/H61).
   *
   * Nach erfolgreichem Erfassen schliesst dieser Container den Entwurfs-Tab; das `key`-Prop
   * an `Schnellerfassung` erzwingt dabei einen Remount. Deshalb liegen die übernommenen
   * Werte HIER und nicht in der Schnellerfassung — ein `useState` unterhalb der
   * Remount-Grenze überlebt das nicht. Bewusst kein Modul-Global (macht Tests
   * reihenfolgeabhängig) und kein `localStorage` (die Übernahme gilt für die laufende
   * Erfassung, nicht für die nächste Sitzung).
   *
   * **Der SCHALTER liegt noch eine Ebene höher, in `EtbPage`** — und zwar aus demselben
   * Grund, eine Grenze weiter: `EtbPage` rendert bei einer Berichtigung eine eigene
   * `Schnellerfassung` STATT dieser Tabs, dieser Container verschwindet dabei also ganz.
   * Läge der Schalter hier, stünde eine bewusst abgewählte Wertübernahme nach jeder
   * Berichtigung wieder auf AN — ohne Nutzeraktion und ohne Hinweis. Die übernommenen
   * WERTE dürfen dabei fallen (eine Berichtigung unterbricht die Erfassungsreihe
   * ohnehin); die Entscheidung darf es nicht.
   */
  const [uebernahme, setUebernahme] = useState<MetadatenWerte>({});

  // Gewählte Anhänge je Entwurf (LFH-117, D9): nur der aktive Tab ist montiert, also liegen
  // sie nicht in der Schnellerfassung. Vorzugsweise vom Aufrufer geführt (`EtbPage`), damit sie
  // auch eine Berichtigung überleben — s. `useEntwurfsDateien`.
  const eigeneDateien = useEntwurfsDateien();
  const dateien = dateienVonAussen ?? eigeneDateien;
  const dateienVerwerfen = dateien.verwerfen;

  /**
   * Sendezustand je Entwurf (LFH-117, Review C1) — aus demselben Grund hier wie die Dateien:
   * nur der aktive Tab ist montiert. Ein Tabwechsel während des Uploads montierte sonst eine
   * entsperrte Schnellerfassung, deren Eingaben der laufende Versand bei seinem Erfolg still
   * verwarf. Ein Eintrag im Ruhezustand fällt weg, damit geschlossene Entwürfe nicht liegen
   * bleiben.
   */
  const [versandJe, setVersandJe] = useState<Record<string, Versand>>({});
  /**
   * Umgezogene Entwurfs-ids (alt → neu, Review C1): der laufende Versand schreibt seinen
   * Zustand aus einer alten Closure unter der ALTEN id weiter — nach einem 409 gehört er dem
   * Entwurf unter seiner neuen.
   */
  const umgezogen = useRef(new Map<string, string>());
  const versandAendern = useCallback((idAlt: string, aenderung: Partial<Versand>) => {
    const id = umgezogen.current.get(idAlt) ?? idAlt;
    setVersandJe((alt) => {
      const neu = { ...(alt[id] ?? VERSAND_RUHE), ...aenderung };
      const rest = { ...alt };
      if (!neu.sendet && neu.fortschritt == null && neu.hinweis == null) delete rest[id];
      else rest[id] = neu;
      return rest;
    });
  }, []);
  const irgendeinerSendet = Object.values(versandJe).some((v) => v.sendet);
  useEffect(() => {
    onSendetChange?.(irgendeinerSendet);
    // Hängt der Container ab (Einsatzwechsel), sperrt ein verwaister Wert sonst „Berichtigen".
    return () => onSendetChange?.(false);
  }, [irgendeinerSendet, onSendetChange]);

  const onEdit = useCallback(
    (targetKey: React.MouseEvent | React.KeyboardEvent | string, action: 'add' | 'remove') => {
      if (action === 'add') neuerEntwurf(werteBehalten ? uebernahme : {});
      else if (typeof targetKey === 'string') {
        // Ein sendender Entwurf trägt kein Schließkreuz; der Riegel hier hält auch den
        // Tastaturweg (Entf auf dem Reiter) — sonst entstünde ein verworfener Eintrag doch.
        if (versandJe[targetKey]?.sendet) return;
        dateienVerwerfen(targetKey);
        versandAendern(targetKey, VERSAND_RUHE);
        void entwurfSchliessen(targetKey);
      }
    },
    [
      neuerEntwurf,
      entwurfSchliessen,
      werteBehalten,
      uebernahme,
      dateienVerwerfen,
      versandJe,
      versandAendern,
    ],
  );

  const items = entwuerfe.map((e) => ({
    key: e.id,
    label: entwurfLabel(e),
    // Solange er sendet, lässt sich ein Entwurf nicht schließen: der Versand liefe trotzdem
    // durch, und ein verworfener Entwurf stünde danach als Eintrag im Tagebuch.
    closable: !versandJe[e.id]?.sendet,
    children:
      e.id === aktiverId ? (
        <Schnellerfassung
          key={e.id}
          erfassen={async (eintrag) => {
            try {
              await erfassen(eintrag); // wirft bei fachlicher Ablehnung → Entwurf bleibt
            } catch (err) {
              // 409 (Review C1): die Entwurfs-id steht als client_id schon für einen anderen
              // Eintrag — ein zweiter Browser-Tab hat diesen Entwurf gesendet. Wortlaut und
              // Dateien bleiben, der Entwurf bekommt eine neue id; mit der alten käme er nie
              // mehr durch. Den Grund setzt die Schnellerfassung an die Erfassung.
              if (err instanceof ApiError && err.status === 409) {
                const neu = await entwurfNeuAusweisen(e.id);
                if (neu) {
                  umgezogen.current.set(e.id, neu);
                  dateien.umhaengen(e.id, neu);
                  setVersandJe((alt) => {
                    if (!(e.id in alt)) return alt;
                    const rest = { ...alt, [neu]: alt[e.id] };
                    delete rest[e.id];
                    return rest;
                  });
                }
              }
              throw err;
            }
            // Übernahme VOR dem Schliessen setzen: `entwurfSchliessen` montiert die
            // Schnellerfassung neu, und `initialWerte` wird nur beim Mount gelesen.
            // Bei ausgeschaltetem Schalter wird geleert statt nur nicht angewandt —
            // sonst tauchten alte Werte beim Wiedereinschalten wieder auf.
            const naechsteMetadaten = werteBehalten ? nurUebernahme(eintrag) : {};
            setUebernahme(naechsteMetadaten);
            // Die Dateien sind jetzt am Eintrag — sie gehen mit dem Entwurf (LFH-117).
            dateienVerwerfen(e.id);
            // Nur ein NEUER Folgeentwurf erhält die Übernahme. Ein bestehender Entwurf
            // bleibt auch mit bewusst leerem An maßgeblich (LFH-461).
            await entwurfSchliessen(e.id, naechsteMetadaten);
          }}
          berichtigungZu={null}
          onBerichtigungAbbrechen={() => {}}
          bausteine={bausteine}
          einsatz={einsatz}
          initialWerte={zuWerte(e)}
          onWerteChange={(w) => entwurfAktualisieren(e.id, w)}
          werteBehalten={werteBehalten}
          onWerteBehaltenChange={onWerteBehaltenChange}
          // Die Entwurfs-id ist der Idempotenzschlüssel: sie überlebt den Remount beim
          // Tabwechsel, ein zweites Absenden während des ersten dedupliziert der Server.
          clientId={e.id}
          dateien={dateien.je[e.id] ?? KEINE_DATEIEN}
          onDateienChange={(d) => {
            dateien.setzen(e.id, d);
            if (d.length > 0) entwurfFesthalten(e.id);
          }}
          versand={versandJe[e.id] ?? VERSAND_RUHE}
          onVersandChange={(a) => versandAendern(e.id, a)}
        />
      ) : null,
  }));

  // Auch „+“ wartet auf die Initialisierung, sonst überschriebe das Laden einen
  // währenddessen angelegten und womöglich bereits bearbeiteten Tab.
  if (entwuerfe.length === 0) return <Spin aria-label="ETB-Entwürfe werden geladen" />;

  return (
    <Tabs
      type="editable-card"
      activeKey={aktiverId ?? undefined}
      onChange={aktivenSetzen}
      onEdit={onEdit}
      items={items}
    />
  );
}
