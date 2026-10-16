import { App, Form, Input } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ruftAbAusBr, type BrAbrufEingabe } from '../../api/einsatzBereitstellungsraum';
import { AUFTRAG_TEXT_MAX } from '../../api/eingabegrenzen';
import { einsatzKeys } from '../../api/queryKeys';
import type {
  BrAbrufErgebnis,
  BrDetail,
  Einheit,
  Einsatzabschnitt,
  ModulFreigaben,
  ObjektTyp,
} from '../../api/types';
import { ErfassungsModal } from '../../components/Erfassung';
import { Select } from '../../components/Select';
import { zeichenGrenze, zeichenRegel } from '../../components/zeichenGrenze';
import { abrufFelderRechte, abrufQuittung, verbandImRaum } from './abrufKern';

/** Wen der Dialog abruft; `austragen` bucht den Austritt im selben Schritt (Lage ohne Einweiser). */
export interface AbrufZiel {
  objekt_typ: ObjektTyp;
  objekt_id: number;
  /** Name der Einheit bzw. Funkrufname des Fahrzeugs, für Titel und Quittung. */
  name: string;
  austragen: boolean;
}

interface AbrufWerte {
  abschnitt_id?: number | null;
  auftrag_text?: string;
}

export interface AbrufDialogProps {
  einsatzId: number;
  br: BrDetail;
  /** `null`: der Dialog ist zu. */
  ziel: AbrufZiel | null;
  onClose: () => void;
  /** Alle Einheiten des Einsatzes: Verband und bisheriger Abschnitt. */
  einheiten: readonly Einheit[];
  /** Abschnitte des Einsatzes; ohne Freigabe Einsatzabschnitte leer. */
  abschnitte: readonly Einsatzabschnitt[];
  freigaben: ModulFreigaben | undefined;
  /** Nach dem Abruf; die Seite zeigt die eigene Zeile sofort, auch hinter gehaltener Schleuse. */
  onAbgerufen: (ziel: AbrufZiel, ergebnis: BrAbrufErgebnis) => void;
}

/**
 * „Abrufen“ einer bereitgestellten Kraft (LLH-1085 Teil II, Spec `bereitstellungsraum-belegung`,
 * „Abruf in der Oberfläche“). Zwei Felder, also Modal (`frontend/AGENTS.md`, „UI-Form-Leitlinie“):
 * Ziel-Abschnitt, vorbelegt mit dem Abschnitt des Raums (nur bei einer Einheit: ein Fahrzeug ohne
 * Einheit hat keine Unterstellung, der Server lehnt sie mit 422 ab), und der Auftrag. Beide
 * optional; leer lässt die Unterstellung unverändert bzw. erteilt keinen Auftrag.
 *
 * - Ein Feld, dessen Modul der Person fehlt, steht gesperrt mit Grund daneben, und sein Wert geht
 *   nicht hinaus (`abrufFelderRechte`); eine Ablehnung des Servers (403, 422) steht im Dialog.
 * - Eine Einheit nimmt ihre Untereinheiten im Raum mit; der Dialog nennt sie am Knopf. Eine
 *   Mehrfachauswahl gibt es nicht: der Server ruft je Aufruf eine Kraft ab, der Verband geht mit.
 * - `austragen` (Lage ohne Einweiser) schickt `ausgerueckt: true`: Abruf und Austritt in einer
 *   Transaktion mit einem ETB-Eintrag. Nur am Desktop; ein Gerät ruft nie ab.
 */
export default function AbrufDialog({
  einsatzId,
  br,
  ziel,
  onClose,
  einheiten,
  abschnitte,
  freigaben,
  onAbgerufen,
}: AbrufDialogProps) {
  const [form] = Form.useForm<AbrufWerte>();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const sperre = abrufFelderRechte(freigaben);
  const istEinheit = ziel?.objekt_typ === 'einheit';
  const mitAbschnitt = istEinheit && sperre.abschnitt == null;

  const mutation = useMutation({
    mutationFn: ({ daten }: { daten: BrAbrufEingabe; ziel: AbrufZiel }) =>
      ruftAbAusBr(einsatzId, br.id, daten),
    onSuccess: (ergebnis, { ziel: z }) => {
      message.success({
        content: abrufQuittung(z.name, {
          ziel: ergebnis.abruf.ziel_anzeige,
          auftragNr: ergebnis.auftrag_nr,
          ausgetragen: z.austragen,
        }),
        key: 'br-belegung',
      });
      onAbgerufen(z, ergebnis);
      for (const key of [
        einsatzKeys.br(einsatzId),
        einsatzKeys.brDetail(einsatzId, br.id),
        einsatzKeys.brVerlauf(einsatzId, br.id),
        einsatzKeys.einheiten(einsatzId),
        einsatzKeys.fahrzeuge(einsatzId),
        einsatzKeys.etb(einsatzId),
        einsatzKeys.auftraege(einsatzId),
      ]) {
        qc.invalidateQueries({ queryKey: key });
      }
    },
  });

  const einheit = istEinheit ? einheiten.find((e) => e.id === ziel.objekt_id) : undefined;
  const verband = istEinheit ? verbandImRaum(ziel.objekt_id, br.einheiten, einheiten) : [];
  const handlung = ziel?.austragen ? 'Abrufen und austragen' : 'Abrufen';

  return (
    <ErfassungsModal<AbrufWerte>
      offen={ziel != null}
      titel={ziel ? `${ziel.name} ${ziel.austragen ? 'abrufen und austragen' : 'abrufen'}` : ''}
      form={form}
      erfassenText={handlung}
      initialValues={{ abschnitt_id: br.abschnitt_id ?? undefined }}
      speicherung={mutation}
      speicherFehlerTitel="Nicht abgerufen"
      speicherFehlerFallback="Abrufen fehlgeschlagen"
      zusammenfassung={verband.length > 0 ? `mit ${verband.join(', ')}` : undefined}
      onErfassen={async (w) => {
        if (!ziel) return;
        const text = sperre.auftrag == null ? w.auftrag_text?.trim() : undefined;
        await mutation.mutateAsync({
          ziel,
          daten: {
            objekt_typ: ziel.objekt_typ,
            objekt_id: ziel.objekt_id,
            ...(mitAbschnitt && w.abschnitt_id != null ? { abschnitt_id: w.abschnitt_id } : {}),
            ...(text ? { auftrag_text: text } : {}),
            ...(ziel.austragen ? { ausgerueckt: true } : {}),
          },
        });
      }}
      onFertig={onClose}
      onAbbrechen={onClose}
    >
      {istEinheit && (
        <Form.Item label="Ziel-Abschnitt" name="abschnitt_id" extra={sperre.abschnitt || undefined}>
          <Select<number>
            allowClear
            disabled={!mitAbschnitt}
            placeholder={
              einheit?.abschnitt_name ? `bleibt ${einheit.abschnitt_name}` : 'ohne Abschnitt'
            }
            options={abschnitte.map((a) => ({ value: a.id, label: a.name }))}
          />
        </Form.Item>
      )}
      <Form.Item
        label="Auftrag"
        name="auftrag_text"
        extra={sperre.auftrag || undefined}
        rules={[zeichenRegel(AUFTRAG_TEXT_MAX, 'Auftragstext')]}
      >
        <Input.TextArea
          rows={2}
          disabled={sperre.auftrag != null}
          placeholder="kein Auftrag"
          count={zeichenGrenze(AUFTRAG_TEXT_MAX)}
        />
      </Form.Item>
    </ErfassungsModal>
  );
}
