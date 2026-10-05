import { Modal, Spin, Tabs, Typography, theme } from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../../api/client';
import type { NeuerEintrag } from '../../api/etb';
import type { EinsatzAnzeige, EtbBaustein } from '../../api/types';
import Schnellerfassung, { nurUebernahme, VERSAND_RUHE, type Versand } from '../Schnellerfassung';
import type { MetadatenWerte } from '../schnellerfassungModell';
import { entwurfLabel, istLeer, zuWerte } from './entwurfModell';
import type { StandardRufnameZugriff } from '../useStandardRufname';
import { useEtbEntwuerfe } from './useEtbEntwuerfe';
import { useEntwurfsDateien, type EntwurfsDateien } from './useEntwurfsDateien';
import { useEntwurfsVersand, type EntwurfsVersand } from './useEntwurfsVersand';
import { IconKreuz } from '../../icons';
import { useAuth } from '../../auth/AuthContext';

interface EtbEntwurfsTabsProps {
  einsatzId: number;
  erfassen: (e: NeuerEintrag) => Promise<void>;
  bausteine: EtbBaustein[];
  einsatz: EinsatzAnzeige;
  /** Standard-Rufname der Person (LFH-894), an jede Schnellerfassung durchgereicht. */
  rufname: StandardRufnameZugriff;
  /** Zustand des Schalters „Werte behalten". Liegt beim Aufrufer — s. Kommentar unten. */
  werteBehalten: boolean;
  onWerteBehaltenChange: (b: boolean) => void;
  /**
   * Meldet, ob gerade ein Entwurf sendet. `EtbPage` sperrt damit „Berichtigen": die
   * Berichtigung ersetzt diesen Container, und ein laufender Versand verlöre dabei seinen
   * sichtbaren Zustand.
   */
  onSendetChange?: (sendet: boolean) => void;
  /** Gewählte Anhänge je Entwurf; fehlt es, führt der Container sie selbst. */
  dateien?: EntwurfsDateien;
  /** Sendezustand je Entwurf; fehlt es, führt der Container ihn selbst (LFH-748). */
  versand?: EntwurfsVersand;
}

/** Stabile leere Liste: ein frisches `[]` je Render wäre für die Schnellerfassung jedes Mal neu. */
const KEINE_DATEIEN: File[] = [];

/**
 * Deutsche Namen für „+“, × und das Überlaufmenü. antd reicht kein Locale an die Reiter, und
 * `de_DE` kennt keine Tabs-Texte; ohne diese Zeile hießen die Knöpfe „Add tab“, „remove“ und
 * „expanded dropdown“ (LFH-957).
 */
const REITER_TEXTE = {
  addAriaLabel: 'Weiteren Entwurf anlegen',
  removeAriaLabel: 'Entwurf verwerfen',
  dropdownAriaLabel: 'Weitere Entwürfe',
};

/**
 * Stil des Schließen-Kreuzes je Entwurfstab — rein und exportiert (Muster `bedienzielStil`).
 * Ein unbeschriftetes Ziel hält den Boden auf BEIDEN Achsen (A1 Gate 3); antds Vorgabe maß
 * 15 × 24 px in jeder Stufe (LFH-724).
 *
 * HÖHENNEUTRAL: der Kartentab rechnet sein senkrechtes Polster fest aus `cardHeight`, jeder
 * höhere Inhalt streckte ihn (handschuh 90 → rund 141 px) und risse den Deckel der
 * angepinnten Erfassungsleiste. Der negative Rand nimmt die Fläche aus dem Layout; sie ragt
 * zentriert über den Knopf hinaus und bleibt sein Kind, ein Klick darauf ist ein Klick auf ihn.
 */
export function entfernenStil(token: { controlHeightSM: number }) {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: token.controlHeightSM,
    minHeight: token.controlHeightSM,
    marginBlock: -token.controlHeightSM / 2,
  } as const;
}

export default function EtbEntwurfsTabs({
  einsatzId,
  erfassen,
  bausteine,
  einsatz,
  rufname,
  werteBehalten,
  onWerteBehaltenChange,
  onSendetChange,
  dateien: dateienVonAussen,
  versand: versandVonAussen,
}: EtbEntwurfsTabsProps) {
  const { token } = theme.useToken();
  const benutzerId = useAuth().benutzer?.id ?? null;
  const {
    entwuerfe,
    aktiverId,
    neuerEntwurf,
    entwurfSchliessen,
    entwurfAktualisieren,
    entwurfFesthalten,
    entwurfNeuAusweisen,
    aktivenSetzen,
  } = useEtbEntwuerfe(benutzerId, einsatzId);

  /**
   * Wertübernahme über die Remount-Grenze (LFH-332).
   *
   * Nach erfolgreichem Erfassen schließt dieser Container den Entwurfs-Tab; das `key`-Prop an
   * `Schnellerfassung` erzwingt dabei einen Remount. Deshalb liegen die übernommenen Werte HIER
   * — ein `useState` unterhalb der Remount-Grenze überlebt das nicht. Kein Modul-Global (macht
   * Tests reihenfolgeabhängig) und kein `localStorage` (die Übernahme gilt für die laufende
   * Erfassung, nicht für die nächste Sitzung).
   *
   * **Der SCHALTER liegt noch eine Ebene höher, in `EtbPage`**: bei einer Berichtigung rendert
   * `EtbPage` eine eigene `Schnellerfassung` STATT dieser Tabs. Läge der Schalter hier, stünde
   * eine bewusst abgewählte Wertübernahme nach jeder Berichtigung wieder auf AN. Die
   * übernommenen WERTE dürfen dabei fallen; die Entscheidung darf es nicht.
   */
  const [uebernahme, setUebernahme] = useState<MetadatenWerte>({});

  // Gewählte Anhänge je Entwurf: nur der aktive Tab ist montiert, also liegen sie nicht in der
  // Schnellerfassung. Vorzugsweise vom Aufrufer geführt (`EtbPage`), damit sie auch eine
  // Berichtigung überleben — s. `useEntwurfsDateien`.
  const eigeneDateien = useEntwurfsDateien();
  const dateien = dateienVonAussen ?? eigeneDateien;
  const dateienVerwerfen = dateien.verwerfen;

  /**
   * Sendezustand je Entwurf — aus demselben Grund über den Reitern wie die Dateien: ein
   * Tabwechsel während des Uploads montierte sonst eine entsperrte Schnellerfassung, deren
   * Eingaben der laufende Versand still verwarf. Vorzugsweise vom Aufrufer geführt (`EtbPage`),
   * damit der Grund eines gescheiterten Uploads auch eine Berichtigung überlebt (LFH-748).
   */
  const eigenerVersand = useEntwurfsVersand();
  const versand = versandVonAussen ?? eigenerVersand;
  const versandJe = versand.je;
  const { aendern: versandSetzen, umhaengen: versandUmhaengen } = versand;
  /**
   * Umgezogene Entwurfs-ids (alt → neu): der laufende Versand schreibt seinen Zustand aus einer
   * alten Closure unter der ALTEN id weiter — nach einem 409 gehört er dem Entwurf unter der neuen.
   */
  const umgezogen = useRef(new Map<string, string>());
  const versandAendern = useCallback(
    (idAlt: string, aenderung: Partial<Versand>) =>
      versandSetzen(umgezogen.current.get(idAlt) ?? idAlt, aenderung),
    [versandSetzen],
  );
  // Nur über die eigenen Entwürfe: der gehobene Zustand überlebt den Einsatzwechsel (`EtbPage`
  // montiert dabei nicht neu), ein noch sendender Entwurf des alten Einsatzes sperrte sonst hier.
  const irgendeinerSendet = entwuerfe.some((e) => versandJe[e.id]?.sendet);
  useEffect(() => {
    onSendetChange?.(irgendeinerSendet);
    // Hängt der Container ab (Einsatzwechsel), sperrt ein verwaister Wert sonst „Berichtigen".
    return () => onSendetChange?.(false);
  }, [irgendeinerSendet, onSendetChange]);

  const verwerfen = useCallback(
    (id: string) => {
      dateienVerwerfen(id);
      versandAendern(id, VERSAND_RUHE);
      void entwurfSchliessen(id);
    },
    [dateienVerwerfen, versandAendern, entwurfSchliessen],
  );

  /**
   * Entwurf, dessen Verwerfen auf die Rückfrage wartet (LFH-957). Ein Entwurf hat keinen
   * Rückweg: kein Papierkorb, nichts auf dem Server (`frontend/AGENTS.md`, LFH-343). Deshalb
   * fragt das × nach, sobald etwas verloren ginge — Text, ausdrücklich gesetzte Felder oder
   * Dateien. `istLeer` sieht die Dateien nicht, sie liegen nur im Speicher.
   */
  const [verwerfenId, setVerwerfenId] = useState<string | null>(null);

  const onEdit = useCallback(
    (targetKey: React.MouseEvent | React.KeyboardEvent | string, action: 'add' | 'remove') => {
      if (action === 'add') neuerEntwurf(werteBehalten ? uebernahme : {});
      else if (typeof targetKey === 'string') {
        // Ein sendender Entwurf trägt kein Schließkreuz; der Riegel hier hält auch den
        // Tastaturweg (Entf auf dem Reiter) — sonst entstünde ein verworfener Eintrag doch.
        if (versandJe[targetKey]?.sendet) return;
        // Die Rückfrage steht HIER und nicht am Icon: auch Entf auf dem Reiter läuft über `onEdit`.
        const entwurf = entwuerfe.find((e) => e.id === targetKey);
        const hatDateien = (dateien.je[targetKey]?.length ?? 0) > 0;
        if ((entwurf && !istLeer(zuWerte(entwurf))) || hatDateien) setVerwerfenId(targetKey);
        else verwerfen(targetKey);
      }
    },
    [neuerEntwurf, werteBehalten, uebernahme, versandJe, entwuerfe, dateien.je, verwerfen],
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
              // 409: die Entwurfs-id steht als client_id schon für einen anderen Eintrag (ein zweiter
              // Browser-Tab hat diesen Entwurf gesendet). Wortlaut und Dateien bleiben, der Entwurf bekommt
              // eine neue id. Den Grund setzt die Schnellerfassung an die Erfassung.
              if (err instanceof ApiError && err.status === 409) {
                const neu = await entwurfNeuAusweisen(e.id);
                if (neu) {
                  umgezogen.current.set(e.id, neu);
                  dateien.umhaengen(e.id, neu);
                  versandUmhaengen(e.id, neu);
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
            // Die Dateien sind jetzt am Eintrag — sie gehen mit dem Entwurf.
            dateienVerwerfen(e.id);
            // Nur ein NEUER Folgeentwurf erhält die Übernahme. Ein bestehender Entwurf
            // bleibt auch mit bewusst leerem An maßgeblich (LFH-461).
            await entwurfSchliessen(e.id, naechsteMetadaten);
          }}
          berichtigungZu={null}
          onBerichtigungAbbrechen={() => {}}
          bausteine={bausteine}
          einsatz={einsatz}
          rufname={rufname}
          initialWerte={zuWerte(e)}
          // Mit Dateien bleibt auch ein geleerter Entwurf gespeichert (LFH-748, D2).
          onWerteChange={(w) =>
            entwurfAktualisieren(e.id, w, { festhalten: (dateien.je[e.id]?.length ?? 0) > 0 })
          }
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
    <>
      <Tabs
        type="editable-card"
        locale={REITER_TEXTE}
        removeIcon={
          <span style={entfernenStil(token)}>
            <IconKreuz />
          </span>
        }
        activeKey={aktiverId ?? undefined}
        onChange={aktivenSetzen}
        onEdit={onEdit}
        items={items}
      />
      {/* Kontrolliertes `<Modal>` statt `Popconfirm`: am × lässt sich keine Blase verankern, und
         der Tastaturweg (Entf) hat gar kein Ziel dafür. */}
      <Modal
        open={verwerfenId != null}
        title="Entwurf verwerfen?"
        okText="Verwerfen"
        okButtonProps={{ danger: true }}
        cancelText="Behalten"
        onOk={() => {
          // Hat der Entwurf inzwischen zu senden begonnen, bleibt er: verworfen stünde er doch im
          // Tagebuch.
          if (verwerfenId != null && !versandJe[verwerfenId]?.sendet) verwerfen(verwerfenId);
          setVerwerfenId(null);
        }}
        onCancel={() => setVerwerfenId(null)}
        destroyOnHidden
      >
        <Typography.Paragraph>
          Text, Felder und Anhänge dieses Entwurfs gehen verloren. Er steht noch nicht im Tagebuch.
        </Typography.Paragraph>
      </Modal>
    </>
  );
}
