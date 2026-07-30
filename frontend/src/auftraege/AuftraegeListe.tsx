import { Alert, App, Button, Card, Flex, Segmented, Typography } from 'antd';
import { Select } from '../components/Select';
import { CloseOutlined, PlusOutlined, UpOutlined } from '@ant-design/icons';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { einsatzKeys } from '../api/queryKeys';
import { useQueryParamSelektion } from '../routing/useQueryParamSelektion';
import { legeAuftragAn, listeAuftraege, nimmAb, quittiereEmpfaenger, setzeVollzug } from '../api/auftraege';
import { listeAbschnitte } from '../api/einsatzabschnitte';
import { listeEinheiten } from '../api/einheiten';
import type { Auftrag, NeuerAuftrag } from '../api/types';
import {
  AUFTRAG_STATUS, GRUPPE_LABEL, GRUPPE_ORDNUNG, faelligGruppe, istAbgeschlossen, prioRang,
  type FaelligGruppe,
} from '../kommunikation';
import AuftragListe from './AuftragListe';
import AuftragFormular from './AuftragFormular';
import VollzugMeldenModal from './VollzugMeldenModal';

/** Offene Aufträge: nach Prio (sofort→dringend→normal), dann Frist (früheste zuerst). */
function vergleicheOffen(a: Auftrag, b: Auftrag): number {
  const prio = prioRang(a.prioritaet) - prioRang(b.prioritaet);
  if (prio !== 0) return prio;
  return (a.frist_at ?? '￿').localeCompare(b.frist_at ?? '￿');
}

export default function AuftraegeListe({ einsatzId, darfSchreiben }: {
  einsatzId: number;
  darfSchreiben: boolean;
}) {
  const { message } = App.useApp();
  const qc = useQueryClient();

  const abschnitteQuery = useQuery({ queryKey: einsatzKeys.abschnitte(einsatzId), queryFn: () => listeAbschnitte(einsatzId) });
  const einheitenQuery = useQuery({ queryKey: einsatzKeys.einheiten(einsatzId), queryFn: () => listeEinheiten(einsatzId) });

  // Offen/Abgeschlossen-Trennung erfolgt clientseitig (alle Aufträge laden).
  const [ansicht, setAnsicht] = useState<'offen' | 'abgeschlossen'>('offen');
  const [richtungFilter, setRichtungFilter] = useState<string | undefined>(undefined);
  // Empfänger-Filter (LFH-92): kodiert als "abschnitt:<id>" bzw. "einheit:<id>".
  const [empfFilter, setEmpfFilter] = useState<string | undefined>(undefined);
  const [empfTyp, empfId] = empfFilter ? empfFilter.split(':') : [undefined, undefined];
  const abschnittId = empfTyp === 'abschnitt' ? Number(empfId) : undefined;
  const einheitId = empfTyp === 'einheit' ? Number(empfId) : undefined;

  const auftraegeQuery = useQuery({
    queryKey: einsatzKeys.auftraegeListe(einsatzId, richtungFilter ?? 'alle', empfFilter ?? 'alle'),
    queryFn: () => listeAuftraege(einsatzId, { richtung: richtungFilter, abschnittId, einheitId }),
  });

  // Cross-Modul-Deeplink (LFH-153): ?auftrag=<id> (z. B. ETB-Backlink) hebt den Auftrag hervor.
  // Ansicht/Richtungs-/Empfänger-Filter zurücksetzen, damit das Ziel garantiert sichtbar ist;
  // Scroll ist best-effort (jsdom-No-op).
  const [highlightAuftragId, setHighlightAuftragId] = useState<number | null>(null);
  useQueryParamSelektion('auftrag', auftraegeQuery.isSuccess, (aid) => {
    const a = (auftraegeQuery.data ?? []).find((x) => x.id === aid);
    if (!a) return;
    setAnsicht(istAbgeschlossen(AUFTRAG_STATUS[a.bearbeitungsstatus]?.phase ?? 'offen') ? 'abgeschlossen' : 'offen');
    setRichtungFilter(undefined);
    setEmpfFilter(undefined);
    setHighlightAuftragId(aid);
  });
  useEffect(() => {
    if (highlightAuftragId == null) return;
    document.querySelector(`[data-auftrag-id="${highlightAuftragId}"]`)?.scrollIntoView?.({ block: 'center' });
  }, [highlightAuftragId]);

  // Inline-Anlegen-Formular (LFH-112): per Kopf-Button auf-/zugeklappt, kein Drawer/Modal.
  const [formOffen, setFormOffen] = useState(false);

  const fehler = (e: unknown) => message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');
  const invalidiere = () => qc.invalidateQueries({ queryKey: einsatzKeys.auftraege(einsatzId) });

  const anlegenMutation = useMutation({
    mutationFn: (d: NeuerAuftrag) => legeAuftragAn(einsatzId, d),
    onSuccess: () => { invalidiere(); message.success('Auftrag erteilt'); setFormOffen(false); },
    onError: fehler,
  });
  const quittierenMutation = useMutation({
    mutationFn: ({ auftragId, empfaengerId }: { auftragId: number; empfaengerId: number }) =>
      quittiereEmpfaenger(einsatzId, auftragId, empfaengerId),
    onSuccess: invalidiere,
    onError: fehler,
  });
  const [vollzugFuer, setVollzugFuer] = useState<number | null>(null);
  const vollzugMutation = useMutation({
    mutationFn: ({ auftragId, status, text }: { auftragId: number; status: 'in_arbeit' | 'vollzogen'; text?: string }) =>
      setzeVollzug(einsatzId, auftragId, status, text),
    onSuccess: () => { invalidiere(); setVollzugFuer(null); },
    onError: fehler,
  });
  const abnahmeMutation = useMutation({
    mutationFn: (auftragId: number) => nimmAb(einsatzId, auftragId),
    onSuccess: invalidiere,
    onError: fehler,
  });

  const alleAuftraege = auftraegeQuery.data ?? [];

  // Offen/Abgeschlossen clientseitig über die gemeinsame Phasen-Semantik trennen.
  const offene = alleAuftraege.filter((a) => !istAbgeschlossen(AUFTRAG_STATUS[a.bearbeitungsstatus]?.phase ?? 'offen'));
  const abgeschlossene = alleAuftraege.filter((a) => istAbgeschlossen(AUFTRAG_STATUS[a.bearbeitungsstatus]?.phase ?? 'offen'));

  // Offen-Ansicht: nach Fälligkeit gruppieren, je Gruppe nach Prio dann Frist.
  const offeneGruppen: { gruppe: FaelligGruppe; auftraege: Auftrag[] }[] = GRUPPE_ORDNUNG
    .map((gruppe) => ({
      gruppe,
      auftraege: offene
        .filter((a) => faelligGruppe(a.frist_at, a.ist_ueberfaellig) === gruppe)
        .sort(vergleicheOffen),
    }))
    .filter(({ auftraege }) => auftraege.length > 0);

  // Abgeschlossen-Ansicht: flach, neueste zuerst (nach abgenommen_at/vollzogen_at).
  const abgeschlosseneSortiert = [...abgeschlossene].sort((a, b) => {
    const ka = a.abgenommen_at ?? a.vollzogen_at ?? a.erstellt_at;
    const kb = b.abgenommen_at ?? b.vollzogen_at ?? b.erstellt_at;
    return kb.localeCompare(ka);
  });

  const abschnitte = (abschnitteQuery.data ?? []).map((a) => ({ id: a.id, name: a.name }));
  const einheiten = (einheitenQuery.data ?? []).map((e) => ({ id: e.id, name: e.name }));
  const empfaengerOptionen = [
    { label: 'Einsatzabschnitte', options: abschnitte.map((a) => ({ value: `abschnitt:${a.id}`, label: a.name })) },
    { label: 'Einheiten', options: einheiten.map((e) => ({ value: `einheit:${e.id}`, label: e.name })) },
  ];

  const listenProps = {
    einsatzId,
    darfSchreiben,
    highlightId: highlightAuftragId,
    onQuittieren: (auftragId: number, empfaengerId: number) => quittierenMutation.mutate({ auftragId, empfaengerId }),
    onInArbeit: (auftragId: number) => vollzugMutation.mutate({ auftragId, status: 'in_arbeit' as const }),
    onVollzugMelden: (auftragId: number) => setVollzugFuer(auftragId),
    onAbnehmen: (auftragId: number) => abnahmeMutation.mutate(auftragId),
  };

  return (
    <>
      <Flex justify="space-between" align="center" gap={16} wrap style={{ marginBottom: 16 }}>
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>Aufträge</Typography.Title>
          <Typography.Text type="secondary">
            {offene.length} offen · {abgeschlossene.length} abgeschlossen
          </Typography.Text>
        </div>
        {darfSchreiben && (
          <Button
            type="primary"
            size="large"
            icon={formOffen ? <UpOutlined /> : <PlusOutlined />}
            onClick={() => setFormOffen((o) => !o)}
          >
            {formOffen ? 'Formular schließen' : 'Auftrag erteilen'}
          </Button>
        )}
      </Flex>

      {darfSchreiben && formOffen && (
        <Card
          size="small"
          title="Neuer Auftrag/Befehl"
          style={{ marginBottom: 16 }}
          extra={(
            <Button
              type="text"
              icon={<CloseOutlined />}
              onClick={() => setFormOffen(false)}
              aria-label="Formular schließen"
            />
          )}
        >
          <AuftragFormular
            card={false}
            senden={anlegenMutation.isPending}
            abschnitte={abschnitte}
            einheiten={einheiten}
            onAnlegen={(d) => anlegenMutation.mutate(d)}
          />
        </Card>
      )}

      {auftraegeQuery.isError && (
        <Alert type="error" showIcon style={{ marginBottom: 12 }} title="Aufträge konnten nicht geladen werden" />
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16, alignItems: 'center' }}>
        <Segmented
          value={ansicht}
          onChange={(v) => setAnsicht(v as 'offen' | 'abgeschlossen')}
          options={[
            { value: 'offen', label: `Offen (${offene.length})` },
            { value: 'abgeschlossen', label: `Abgeschlossen (${abgeschlossene.length})` },
          ]}
        />
        <Segmented
          value={richtungFilter ?? 'alle'}
          onChange={(v) => setRichtungFilter(v === 'alle' ? undefined : String(v))}
          options={[
            { value: 'alle', label: 'Alle Richtungen' },
            { value: 'intern', label: 'Intern' },
            { value: 'extern', label: 'Extern' },
          ]}
        />
        <Select
          allowClear
          placeholder="Empfänger filtern"
          style={{ minWidth: 220 }}
          value={empfFilter}
          onChange={(v) => setEmpfFilter(v ?? undefined)}
          options={empfaengerOptionen}
        />
      </div>
      {ansicht === 'offen' ? (
        offeneGruppen.length === 0 ? (
          <AuftragListe auftraege={[]} ansicht="offen" {...listenProps} />
        ) : (
          offeneGruppen.map(({ gruppe, auftraege }) => (
            <div key={gruppe} style={{ marginBottom: 16 }}>
              <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
                {GRUPPE_LABEL[gruppe]} ({auftraege.length})
              </Typography.Text>
              <AuftragListe auftraege={auftraege} ansicht="offen" {...listenProps} />
            </div>
          ))
        )
      ) : (
        <AuftragListe auftraege={abgeschlosseneSortiert} ansicht="abgeschlossen" {...listenProps} />
      )}
      <VollzugMeldenModal
        offen={vollzugFuer !== null}
        onAbbrechen={() => setVollzugFuer(null)}
        onBestaetigen={(text) =>
          vollzugFuer != null && vollzugMutation.mutate({ auftragId: vollzugFuer, status: 'vollzogen', text })}
      />
    </>
  );
}
