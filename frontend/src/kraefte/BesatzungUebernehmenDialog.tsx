import { useEffect, useState } from 'react';
import { App, Checkbox, Form, Space, Typography, theme } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { SAMMEL_MAX } from '../api/eingabegrenzen';
import { zuordnenBesatzungMenge } from '../api/einsatzFahrzeuge';
import { POSITION_LABELS } from '../api/personal';
import { einsatzKeys } from '../api/queryKeys';
import type { EinsatzFahrzeug, EinsatzPersonal } from '../api/types';
import { ErfassungsModal } from '../components/Erfassung';
import { besatzungKandidaten, besatzungVorschlag } from './besatzungVorschlag';
import { funktionText } from './einsatzfunktionKern';
import { gruendeJeKraft } from './sammelDisposition';

type Werte = { ep_ids: number[] };

export interface BesatzungUebernehmenDialogProps {
  einsatzId: number;
  /**
   * Das Fahrzeug mit Einheit und die beim Öffnen vorgewählten Kräfte (`besatzungVorschlag`, vom
   * Aufrufer beim Klick festgehalten, damit ein Refetch der Personalliste nicht neu wählt);
   * `null` = Dialog zu.
   */
  auftrag: { fahrzeug: EinsatzFahrzeug; vorgewaehlt: readonly number[] } | null;
  /** Personal des Einsatzes (die Seite lädt es schon). */
  personal: readonly EinsatzPersonal[];
  /** Führer der Einheit des Fahrzeugs, nur mit Freigabe `einheiten` bekannt. */
  fuehrerId: number | null;
  onSchliessen: () => void;
}

/** Position und Funktion einer Kraft, wie im Besatzungsblock (design.md D13). */
export function angabeZurKraft(p: EinsatzPersonal): string {
  return [p.staerke_position ? POSITION_LABELS[p.staerke_position] : null, funktionText(p)]
    .filter(Boolean)
    .join(' · ');
}

/**
 * Dialog „Personal der Einheit übernehmen“ (LLH-1073, design.md D12, Spec `fahrzeug-bearbeitung`):
 * die freien Kräfte der Einheit des Fahrzeugs als Häkchenliste, vorbelegt nach dem Vorschlag bis
 * zum Soll (`besatzungVorschlag`), je Person Name, Position und Funktion. Ein Absenden ordnet alle
 * gewählten in einem Schritt zu; lehnt der Server einzelne ab, steht der Grund an der Person und
 * niemand ist zugeordnet. Die Vorbelegung gilt beim Öffnen; was danach frei wird, steht in der
 * Liste, aber ungewählt.
 */
export default function BesatzungUebernehmenDialog({
  einsatzId,
  auftrag,
  personal,
  fuehrerId,
  onSchliessen,
}: BesatzungUebernehmenDialogProps) {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [form] = Form.useForm<Werte>();
  const { token } = theme.useToken();
  const fahrzeug = auftrag?.fahrzeug ?? null;
  const offen = auftrag !== null;
  /** Namen der zuletzt abgesendeten Auswahl: die Gründe nennen sie, auch wenn die Liste wechselt. */
  const [namen, setNamen] = useState<ReadonlyMap<number, string>>(new Map());

  const crew = fahrzeug ? personal.filter((p) => p.fahrzeug_id === fahrzeug.id) : [];
  const vorschlag = besatzungVorschlag({
    kandidaten: fahrzeug ? besatzungKandidaten(personal, fahrzeug) : [],
    crew,
    soll: fahrzeug?.soll_besatzung ?? null,
    fuehrerId,
  });

  // Vorbelegen beim Öffnen (kein Reset; das Leeren besitzt die Erfassungshülle).
  useEffect(() => {
    if (auftrag) form.setFieldsValue({ ep_ids: [...auftrag.vorgewaehlt] });
  }, [auftrag, form]);

  // Fällt eine gewählte Kraft live aus den Kandidaten (auf ein anderes Fahrzeug gesetzt,
  // entlassen), verschwindet ihr Kästchen; dann fällt sie auch aus der Wahl. Sonst ginge ihre ID
  // unsichtbar mit: der Server holte sie still vom anderen Fahrzeug oder lehnte mit einem Grund
  // ab, den niemand abwählen kann. Der Schlüssel hält die Abhängigkeit stabil.
  const kandidatSchluessel = vorschlag.kandidaten.map((p) => p.id).join(',');
  useEffect(() => {
    const sichtbar = new Set(kandidatSchluessel.split(',').filter(Boolean).map(Number));
    const gewaehlt = (form.getFieldValue('ep_ids') as number[] | undefined) ?? [];
    const bleibt = gewaehlt.filter((id) => sichtbar.has(id));
    if (bleibt.length !== gewaehlt.length) form.setFieldsValue({ ep_ids: bleibt });
  }, [kandidatSchluessel, form]);

  const mutation = useMutation({
    mutationFn: (v: { efId: number; epIds: number[] }) =>
      zuordnenBesatzungMenge(einsatzId, v.efId, v.epIds),
    onSuccess: (_, v) => {
      message.success(
        v.epIds.length === 1
          ? 'Kraft als Besatzung zugeordnet'
          : `${v.epIds.length} Kräfte als Besatzung zugeordnet`,
      );
      for (const key of [
        einsatzKeys.fahrzeuge(einsatzId),
        einsatzKeys.personal(einsatzId),
        einsatzKeys.etb(einsatzId),
      ])
        void qc.invalidateQueries({ queryKey: key });
    },
  });
  const gruende = gruendeJeKraft(mutation.error, 'personal');
  const kandidatIds = new Set(vorschlag.kandidaten.map((p) => p.id));
  // Wer abgelehnt wurde und nicht mehr in der Liste steht (etwa inzwischen entlassen), bekommt
  // seinen Grund unter der Liste.
  const ohneZeile = [...gruende].filter(([id]) => !kandidatIds.has(id));

  return (
    <ErfassungsModal<Werte>
      offen={offen}
      titel={fahrzeug ? `Personal der Einheit auf ${fahrzeug.funkrufname}` : 'Personal übernehmen'}
      form={form}
      erfassenText="Übernehmen"
      laeuft={mutation.isPending}
      speicherung={mutation}
      speicherFehlerTitel="Nicht übernommen"
      speicherFehlerFallback="Übernehmen fehlgeschlagen"
      onErfassen={async (werte) => {
        if (!fahrzeug) return;
        // Namen aus dem ganzen Personal: ein Grund nennt die Person auch, wenn sie danach aus der
        // Liste fällt. Die Wahl enthält nur, was als Kästchen steht (Effekt oben).
        setNamen(new Map(personal.map((p) => [p.id, p.name] as const)));
        await mutation.mutateAsync({ efId: fahrzeug.id, epIds: werte.ep_ids });
      }}
      onFertig={onSchliessen}
      onAbbrechen={onSchliessen}
    >
      <Form.Item
        label="Personen"
        name="ep_ids"
        rules={[
          { required: true, message: 'Mindestens eine Person wählen' },
          { type: 'array', max: SAMMEL_MAX, message: `Höchstens ${SAMMEL_MAX} Personen` },
        ]}
        extra={
          ohneZeile.length > 0 ? (
            <ul aria-label="Nicht übernommen" style={{ margin: 0, paddingInlineStart: 18 }}>
              {ohneZeile.map(([id, grund]) => (
                <li key={id}>
                  <Typography.Text type="danger">
                    {namen.get(id) ?? `Person ${id}`} – {grund}
                  </Typography.Text>
                </li>
              ))}
            </ul>
          ) : undefined
        }
      >
        <Checkbox.Group style={{ display: 'block' }}>
          {/* Abstand der Zeilen aus der Dichte-Staffel (7 / 11 / 16 px): am Finger ≥ 8, im
              Handschuh ≥ 16 px zwischen zwei Kästchen (Bedien-Leitlinie, Kriterium 2). */}
          <Space orientation="vertical" size={token.marginSM}>
            {vorschlag.kandidaten.map((p) => {
              const angabe = angabeZurKraft(p);
              const grund = gruende.get(p.id);
              return (
                <div key={p.id}>
                  <Checkbox value={p.id}>
                    <Space size="small" wrap>
                      <span>{p.name}</span>
                      {angabe && <Typography.Text type="secondary">{angabe}</Typography.Text>}
                    </Space>
                  </Checkbox>
                  {grund && (
                    <div>
                      <Typography.Text type="danger">{grund}</Typography.Text>
                    </div>
                  )}
                </div>
              );
            })}
          </Space>
        </Checkbox.Group>
      </Form.Item>
    </ErfassungsModal>
  );
}
