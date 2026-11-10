import { App, Form, Radio, Typography } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { loadRegistrierListe, sendHaushaltWechsel } from '../../api/betreuungRegistrierung';
import { einsatzKeys } from '../../api/queryKeys';
import type { Haushalt, HaushaltZielEingabe } from '../../api/types';
import { ErfassungsModal } from '../../components/Erfassung';
import { useRollen } from '../../components/instrument';
import { OHNE_VERBINDUNG_NICHT_AENDERBAR, useOhneVerbindung } from '../../offline/verbindung';
import { haushaltKennung } from './registrierKern';

/**
 * Dialog „Haushalt ändern“ (LLH-1615, Change `lm62ud0b-haushalt-umbauen`, design.md D4): eine an
 * der Stelle registrierte Person in einen anderen Haushalt DIESER Stelle umhängen oder in einen
 * neuen lösen. Die Auswahl kommt aus der Registrierliste der Stelle (derselbe Query-Key wie das
 * Paneel). Ohne Netz öffnet ihn niemand: die Aufrufer sperren mit Grund (D5). Fällt das Netz bei
 * offenem Dialog weg, sperrt er das Speichern selbst mit Grund; die Mutation läuft mit
 * `networkMode: 'always'`, damit TanStack sie nicht anhält und später still nachholt (kein
 * `client_id`, also nicht wiederholbar).
 */

export interface HaushaltAendernPerson {
  id: number;
  /** „R-002 Weber, Tom“: Kennung und Name für Titel und Meldung. */
  titel: string;
  haushaltId: number | null;
  istBezugsperson: boolean;
}

export interface HaushaltAendernModalProps {
  einsatzId: number;
  stelleId: number;
  person: HaushaltAendernPerson;
  /** Nach dem Speichern, mit dem Ziel-Haushalt (Liste und Detail abgleichen). */
  onGeschrieben: (ziel: Haushalt) => void;
  onSchliessen: () => void;
}

const NEU = 'neu';

const personenWort = (n: number) => `${n} ${n === 1 ? 'Person' : 'Personen'}`;

export default function HaushaltAendernModal({
  einsatzId,
  stelleId,
  person,
  onGeschrieben,
  onSchliessen,
}: HaushaltAendernModalProps) {
  const { message } = App.useApp();
  const { token } = useRollen();
  const [form] = Form.useForm<{ ziel: string }>();
  const ohneNetz = useOhneVerbindung();
  const liste = useQuery({
    queryKey: einsatzKeys.registrierliste(einsatzId, stelleId),
    queryFn: () => loadRegistrierListe(einsatzId, stelleId),
  });
  const wechsel = useMutation({
    networkMode: 'always',
    mutationFn: (ziel: HaushaltZielEingabe) =>
      sendHaushaltWechsel(einsatzId, stelleId, person.id, ziel),
    onSuccess: (ziel) => {
      onGeschrieben(ziel);
      message.success(`${person.titel} jetzt in ${haushaltKennung(ziel.nummer)}`);
    },
  });

  const andere = (liste.data?.haushalte ?? []).filter((h) => h.id !== person.haushaltId);
  const bisher = liste.data?.haushalte.find((h) => h.id === person.haushaltId);
  // Ein Satz zur Folge vor dem Schritt (LFH-1078): wer nachrückt, entscheidet der Server.
  const folge =
    person.istBezugsperson && bisher && bisher.personen.length > 1
      ? `Ein anderes Mitglied von ${haushaltKennung(bisher.nummer)} wird Bezugsperson.`
      : null;

  return (
    <ErfassungsModal<{ ziel: string }>
      offen
      titel={`Haushalt von ${person.titel} ändern`}
      form={form}
      erfassenText="Haushalt ändern"
      laeuft={wechsel.isPending}
      gesperrt={ohneNetz}
      speicherung={wechsel}
      speicherFehlerTitel="Haushalt nicht geändert"
      onErfassen={({ ziel }) =>
        wechsel.mutateAsync(ziel === NEU ? { neuer_haushalt: true } : { haushalt_id: Number(ziel) })
      }
      onFertig={onSchliessen}
      onAbbrechen={onSchliessen}
    >
      {ohneNetz && (
        <Typography.Paragraph type="secondary">
          {OHNE_VERBINDUNG_NICHT_AENDERBAR}
        </Typography.Paragraph>
      )}
      {folge && <Typography.Paragraph>{folge}</Typography.Paragraph>}
      <Form.Item name="ziel" label="Ziel" rules={[{ required: true, message: 'Haushalt wählen' }]}>
        <Radio.Group style={{ display: 'flex', flexDirection: 'column', gap: token.marginXS }}>
          {andere.map((h) => (
            <Radio key={h.id} value={String(h.id)} data-lfh="haushalt-ziel">
              {[haushaltKennung(h.nummer), h.bezugsperson_name, personenWort(h.personen.length)]
                .filter(Boolean)
                .join(' · ')}
            </Radio>
          ))}
          <Radio value={NEU} data-lfh="haushalt-ziel">
            Neuer Haushalt
          </Radio>
        </Radio.Group>
      </Form.Item>
    </ErfassungsModal>
  );
}
