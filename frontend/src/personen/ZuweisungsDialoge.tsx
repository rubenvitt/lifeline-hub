import { Form, Input } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { einsatzKeys } from '../api/queryKeys';
import { aktualisiereTier, listeTiere, tierRegistrierAnzeige } from '../api/einsatzTier';
import {
  aktualisiereSchaden,
  listeSchadenAuswahl,
  schadenRegistrierAnzeige,
} from '../api/einsatzSchaden';
import { aenderePersonBelegung } from '../api/einsatzUhs';
import type { Uhs } from '../api/types';
import { ErfassungsModal } from '../components/Erfassung';
import { Select } from '../components/Select';
import { SPEZIES_META } from '../pages/tiere/tierHelfer';

/**
 * Zuweisungsdialoge der Personen-Detailseite (Aufenthalt in einer UHS, Bezug zu Tier oder Schaden), auf
 * der Erfassungshülle (`frontend/AGENTS.md`, Erfassungs-Norm; LFH-796). Alle drei sind reine
 * Auswahlmasken: Enter schluckt der `Select`, die Struktur belegt der Seitentest.
 *
 * Jeder Dialog besitzt seine Mutation; was danach ungültig wird, sagt die Seite über
 * `onZugewiesen`. Schliessen und Leeren besorgt die Hülle, ebenso den Grund einer Ablehnung: er
 * steht im Dialog, kein Toast (LFH-1077, `frontend/AGENTS.md`, „Rückwege und Fehler“).
 */

interface ZuweisungsDialogProps {
  einsatzId: number;
  personId: number;
  offen: boolean;
  /** Nach erfolgreichem Schreiben (Invalidierung); der Dialog schließt danach selbst. */
  onZugewiesen: () => void;
  onSchliessen: () => void;
}

interface UhsWerte {
  uhs_id: number;
  notiz?: string;
}

/**
 * UHS-Zuweisung von der Personen-Seite (Gegenrichtung zum Grundriss). `art` spiegelt die
 * Belegungslogik des Grundrisses: bereits belegt → `wechsel`, sonst `eintritt`. Austragen ist kein
 * Dialog, sondern ein Knopf der Seite.
 */
export function UhsZuweisenDialog({
  einsatzId,
  personId,
  offen,
  belegt,
  uhsListe,
  onZugewiesen,
  onSchliessen,
}: ZuweisungsDialogProps & {
  /** Steht die Person schon in einer UHS? */
  belegt: boolean;
  /** Die UHS des Einsatzes; die Seite lädt sie ohnehin für die Klartext-Anzeige. */
  uhsListe: Uhs[];
}) {
  const [form] = Form.useForm<UhsWerte>();
  const belegungMutation = useMutation({
    mutationFn: (v: UhsWerte) =>
      aenderePersonBelegung(einsatzId, personId, {
        art: belegt ? 'wechsel' : 'eintritt',
        uhs_id: v.uhs_id,
        notiz: v.notiz ?? null,
      }),
    onSuccess: onZugewiesen,
  });

  return (
    <ErfassungsModal<UhsWerte>
      offen={offen}
      titel={belegt ? 'Verlegen' : 'In UHS aufnehmen'}
      form={form}
      erfassenText={belegt ? 'Verlegen' : 'Aufnehmen'}
      laeuft={belegungMutation.isPending}
      speicherung={belegungMutation}
      speicherFehlerTitel="Nicht zugewiesen"
      onErfassen={(v) => belegungMutation.mutateAsync(v)}
      onFertig={onSchliessen}
      onAbbrechen={onSchliessen}
    >
      <Form.Item
        label="Unfallhilfsstelle"
        name="uhs_id"
        rules={[{ required: true, message: 'Bitte UHS wählen' }]}
      >
        <Select
          placeholder="aktive UHS wählen"
          options={uhsListe
            .filter((u) => u.status === 'aktiv')
            .map((u) => ({ value: u.id, label: u.bezeichnung }))}
        />
      </Form.Item>
      <Form.Item label="Notiz (optional)" name="notiz">
        <Input />
      </Form.Item>
    </ErfassungsModal>
  );
}

/** Wert einer Wahl in der Bezugssuche: Art und Kennung in einem String (`tier:5`, `schaden:7`). */
type BezugWahl = `tier:${number}` | `schaden:${number}`;

/**
 * „Bezug hinzufügen“ (LLH-1129, Spec `personen-detail`, „Bezüge zu Tier und Schaden in einer
 * Liste“): EINE Suche über freie Tiere und freie Schäden, gruppiert. Ersetzt die beiden Dialoge
 * „Tier zuweisen“ und „Schaden zuweisen“. Die Kandidaten laden erst mit dem offenen Dialog und
 * sind nur FREIE (kein stilles Überschreiben fremder Zuordnungen). Zuweisen leert den
 * konkurrierenden XOR-Slot im selben PATCH (sonst 500 durch den Mehrspalten-CHECK): am Tier den
 * Halter-Kontakt, am Schaden Personal, Organisation und Kontakt.
 */
export function BezugHinzufuegenDialog({
  einsatzId,
  personId,
  offen,
  onZugewiesen,
  onSchliessen,
}: ZuweisungsDialogProps) {
  const [form] = Form.useForm<{ bezug: BezugWahl }>();
  const tiereQuery = useQuery({
    queryKey: einsatzKeys.tiere(einsatzId),
    queryFn: () => listeTiere(einsatzId),
    enabled: offen,
  });
  // Die Auswahl kennt alle nicht stornierten Schäden, auch bei großem Bestand (LFH-1075).
  const schaedenQuery = useQuery({
    queryKey: einsatzKeys.schaedenAuswahl(einsatzId),
    queryFn: () => listeSchadenAuswahl(einsatzId),
    enabled: offen,
  });
  const freieTiere = (tiereQuery.data ?? []).filter(
    (t) => t.halter_person_id == null && t.halter_kontakt == null && t.storniert_at == null,
  );
  const freieSchaeden = (schaedenQuery.data ?? []).filter(
    (sch) => sch.frei && sch.status !== 'abgeschlossen',
  );
  const zuweisenMutation = useMutation({
    mutationFn: (wahl: BezugWahl): Promise<unknown> => {
      const [art, roh] = wahl.split(':');
      const id = Number(roh);
      return art === 'tier'
        ? aktualisiereTier(einsatzId, id, { halter_person_id: personId, halter_kontakt: null })
        : aktualisiereSchaden(einsatzId, id, {
            geschaedigt_person_id: personId,
            geschaedigt_personal_id: null,
            geschaedigt_organisation_id: null,
            geschaedigt_kontakt: null,
          });
    },
    onSuccess: onZugewiesen,
  });
  const laedt = tiereQuery.isLoading || schaedenQuery.isLoading;

  return (
    <ErfassungsModal<{ bezug: BezugWahl }>
      offen={offen}
      titel="Bezug hinzufügen"
      form={form}
      erfassenText="Hinzufügen"
      laeuft={zuweisenMutation.isPending}
      speicherung={zuweisenMutation}
      speicherFehlerTitel="Bezug nicht hinzugefügt"
      onErfassen={(v) => zuweisenMutation.mutateAsync(v.bezug)}
      onFertig={onSchliessen}
      onAbbrechen={onSchliessen}
    >
      <Form.Item
        label="Tier oder Schaden"
        name="bezug"
        rules={[{ required: true, message: 'Bitte Tier oder Schaden wählen' }]}
      >
        <Select
          showSearch={{ optionFilterProp: 'label' }}
          placeholder="Kennung, Art, Name oder Ort suchen"
          loading={laedt}
          notFoundContent={laedt ? '…' : 'keine freien Tiere oder Schäden'}
          options={[
            {
              label: 'Tiere (als Halter)',
              options: freieTiere.map((t) => ({
                value: `tier:${t.id}`,
                label: [
                  tierRegistrierAnzeige(t.registrier_nr),
                  SPEZIES_META[t.spezies] ?? t.spezies,
                  t.rufname ? `„${t.rufname}“` : null,
                  t.antreff_ort,
                ]
                  .filter(Boolean)
                  .join(' · '),
              })),
            },
            {
              label: 'Schäden (als Geschädigte)',
              options: freieSchaeden.map((sch) => ({
                value: `schaden:${sch.id}`,
                label: `${schadenRegistrierAnzeige(sch.registrier_nr)} · ${sch.typ} (${sch.ausmass})`,
              })),
            },
          ].filter((g) => g.options.length > 0)}
        />
      </Form.Item>
    </ErfassungsModal>
  );
}
