import { Form, Input } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { einsatzKeys } from '../api/queryKeys';
import { aktualisiereTier, listeTiere, tierRegistrierAnzeige } from '../api/einsatzTier';
import {
  aktualisiereSchaden,
  listeSchaeden,
  schadenRegistrierAnzeige,
} from '../api/einsatzSchaden';
import { aenderePersonBelegung } from '../api/einsatzUhs';
import type { Uhs } from '../api/types';
import { ErfassungsModal } from '../components/Erfassung';
import { Select } from '../components/Select';
import { useFehlerMeldung } from '../components/useFehlerMeldung';
import { SPEZIES_META } from '../pages/tiere/tierHelfer';

/**
 * Zuweisungsdialoge der Personen-Detailseite (UHS, Tier als Halter, Schaden als Geschädigte), auf
 * der Erfassungshülle (`frontend/AGENTS.md`, Erfassungs-Norm; LFH-796). Alle drei sind reine
 * Auswahlmasken: Enter schluckt der `Select`, die Struktur belegt der Seitentest.
 *
 * Jeder Dialog besitzt seine Mutation; was danach ungültig wird, sagt die Seite über
 * `onZugewiesen`. Schliessen und Leeren besorgt die Hülle.
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
  const fehler = useFehlerMeldung();
  const belegungMutation = useMutation({
    mutationFn: (v: UhsWerte) =>
      aenderePersonBelegung(einsatzId, personId, {
        art: belegt ? 'wechsel' : 'eintritt',
        uhs_id: v.uhs_id,
        notiz: v.notiz ?? null,
      }),
    onSuccess: onZugewiesen,
    onError: fehler,
  });

  return (
    <ErfassungsModal<UhsWerte>
      offen={offen}
      titel="UHS zuweisen"
      form={form}
      erfassenText="Zuweisen"
      laeuft={belegungMutation.isPending}
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

/**
 * Tier der Person als Halter zuweisen. Die Kandidaten laden erst mit dem offenen Dialog und sind
 * nur FREIE Tiere (kein Halter, kein Kontakt, nicht storniert): kein stilles Überschreiben fremder
 * Zuordnungen. Zuweisen leert den konkurrierenden XOR-Slot im selben PATCH (sonst 500 durch den
 * Mehrspalten-CHECK).
 */
export function TierZuweisenDialog({
  einsatzId,
  personId,
  offen,
  onZugewiesen,
  onSchliessen,
}: ZuweisungsDialogProps) {
  const [form] = Form.useForm<{ tier_id: number }>();
  const fehler = useFehlerMeldung();
  const tiereQuery = useQuery({
    queryKey: einsatzKeys.tiere(einsatzId),
    queryFn: () => listeTiere(einsatzId),
    enabled: offen,
  });
  const freieTiere = (tiereQuery.data ?? []).filter(
    (t) => t.halter_person_id == null && t.halter_kontakt == null && t.storniert_at == null,
  );
  const zuweisenMutation = useMutation({
    mutationFn: (tierId: number) =>
      aktualisiereTier(einsatzId, tierId, { halter_person_id: personId, halter_kontakt: null }),
    onSuccess: onZugewiesen,
    onError: fehler,
  });

  return (
    <ErfassungsModal<{ tier_id: number }>
      offen={offen}
      titel="Tier als Halter zuweisen"
      form={form}
      erfassenText="Zuweisen"
      laeuft={zuweisenMutation.isPending}
      onErfassen={(v) => zuweisenMutation.mutateAsync(v.tier_id)}
      onFertig={onSchliessen}
      onAbbrechen={onSchliessen}
    >
      <Form.Item
        label="Tier"
        name="tier_id"
        rules={[{ required: true, message: 'Bitte Tier wählen' }]}
      >
        <Select
          placeholder="freies Tier wählen"
          loading={tiereQuery.isLoading}
          notFoundContent={tiereQuery.isLoading ? '…' : 'keine freien Tiere'}
          options={freieTiere.map((t) => ({
            value: t.id,
            label: `${tierRegistrierAnzeige(t.registrier_nr)} ${SPEZIES_META[t.spezies] ?? t.spezies}${t.rufname ? ` „${t.rufname}"` : ''}`,
          }))}
        />
      </Form.Item>
    </ErfassungsModal>
  );
}

/**
 * Schaden der Person als Geschädigte zuweisen. Kandidaten wie beim Tier: erst mit dem offenen
 * Dialog, nur freie (kein Geschädigter, nicht storniert, nicht abgeschlossen). Zuweisen leert die
 * drei konkurrierenden XOR-Slots im selben PATCH.
 */
export function SchadenZuweisenDialog({
  einsatzId,
  personId,
  offen,
  onZugewiesen,
  onSchliessen,
}: ZuweisungsDialogProps) {
  const [form] = Form.useForm<{ schaden_id: number }>();
  const fehler = useFehlerMeldung();
  const schaedenQuery = useQuery({
    queryKey: einsatzKeys.schaeden(einsatzId),
    queryFn: () => listeSchaeden(einsatzId, { inklStorniert: false }),
    enabled: offen,
  });
  const freieSchaeden = (schaedenQuery.data ?? []).filter(
    (s) =>
      s.geschaedigt_person_id == null &&
      s.geschaedigt_personal_id == null &&
      s.geschaedigt_organisation_id == null &&
      s.geschaedigt_kontakt == null &&
      s.storniert_at == null &&
      s.status !== 'abgeschlossen',
  );
  const zuweisenMutation = useMutation({
    mutationFn: (schadenId: number) =>
      aktualisiereSchaden(einsatzId, schadenId, {
        geschaedigt_person_id: personId,
        geschaedigt_personal_id: null,
        geschaedigt_organisation_id: null,
        geschaedigt_kontakt: null,
      }),
    onSuccess: onZugewiesen,
    onError: fehler,
  });

  return (
    <ErfassungsModal<{ schaden_id: number }>
      offen={offen}
      titel="Schaden zuweisen (Geschädigte)"
      form={form}
      erfassenText="Zuweisen"
      laeuft={zuweisenMutation.isPending}
      onErfassen={(v) => zuweisenMutation.mutateAsync(v.schaden_id)}
      onFertig={onSchliessen}
      onAbbrechen={onSchliessen}
    >
      <Form.Item
        label="Schaden"
        name="schaden_id"
        rules={[{ required: true, message: 'Bitte Schaden wählen' }]}
      >
        <Select
          placeholder="freien Schaden wählen"
          loading={schaedenQuery.isLoading}
          notFoundContent={schaedenQuery.isLoading ? '…' : 'keine freien Schäden'}
          options={freieSchaeden.map((s) => ({
            value: s.id,
            label: `${schadenRegistrierAnzeige(s.registrier_nr)} ${s.typ} (${s.ausmass})`,
          }))}
        />
      </Form.Item>
    </ErfassungsModal>
  );
}
