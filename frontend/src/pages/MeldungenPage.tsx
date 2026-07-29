import { Alert, App, Breadcrumb, Button, Card, Flex, Segmented, Spin, Typography } from 'antd';
import { CloseOutlined, PlusOutlined, UpOutlined } from '@ant-design/icons';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useQueryParamSelektion } from '../routing/useQueryParamSelektion';
import { einsatzKeys } from '../api/queryKeys';
import { ladeEinsatz, ladeMitglieder } from '../api/einsaetze';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import { bestaetigeMeldung, erteileAuftragAusMeldung, legeMeldungAn, listeMeldungen, markiereLagerelevant, setzeMeldungStatus, weiseBearbeiterZu } from '../api/meldungen';
import { listeAbschnitte } from '../api/einsatzabschnitte';
import { listeEinheiten } from '../api/einheiten';
import type { Meldung, MeldungStatus, NeueMeldung, NeuerAuftrag } from '../api/types';
import { MELDUNG_STATUS, istAbgeschlossen, prioRang } from '../kommunikation';
import MeldungListe from '../meldungen/MeldungListe';
import MeldungFormular from '../meldungen/MeldungFormular';
import AuftragErteilenModal from '../meldungen/AuftragErteilenModal';
import LagerelevantModal, { type LagerelevantDaten } from '../meldungen/LagerelevantModal';

/**
 * Sortierung der Meldungen: Prio (sofort→dringend→normal), dann eskaliert zuerst
 * (Alarm oben), dann Ereigniszeit absteigend. Meldungen haben keine Frist im
 * Auftrags-Sinn → keine Fälligkeits-Gruppierung, flache Liste mit Badges.
 */
function vergleicheMeldung(a: Meldung, b: Meldung): number {
  const prio = prioRang(a.prioritaet) - prioRang(b.prioritaet);
  if (prio !== 0) return prio;
  const eskaliert = Number(b.eskaliert) - Number(a.eskaliert);
  if (eskaliert !== 0) return eskaliert;
  return (b.ereigniszeit ?? '').localeCompare(a.ereigniszeit ?? '');
}

/**
 * Sortierung der Abgeschlossen-Ansicht (LFH-113): zuletzt Erledigtes oben (erledigt_at ↓).
 * Ohne Stempel (Altbestand vor der Spalte) Fallback auf Ereigniszeit ↓.
 */
function vergleicheAbgeschlossen(a: Meldung, b: Meldung): number {
  const erledigt = (b.erledigt_at ?? '').localeCompare(a.erledigt_at ?? '');
  if (erledigt !== 0) return erledigt;
  return (b.ereigniszeit ?? '').localeCompare(a.ereigniszeit ?? '');
}

export default function MeldungenPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { benutzer } = useAuth();
  const { message } = App.useApp();
  const qc = useQueryClient();

  const einsatzQuery = useQuery({ queryKey: einsatzKeys.einsatz(einsatzId), queryFn: () => ladeEinsatz(einsatzId) });
  const mitgliederQuery = useQuery({ queryKey: einsatzKeys.mitglieder(einsatzId), queryFn: () => ladeMitglieder(einsatzId) });
  // Auftrags-Ziele für das Meldung→Auftrag-Formular (wie AuftraegePage/ChatPage).
  const abschnitteQuery = useQuery({ queryKey: einsatzKeys.abschnitte(einsatzId), queryFn: () => listeAbschnitte(einsatzId) });
  const einheitenQuery = useQuery({ queryKey: einsatzKeys.einheiten(einsatzId), queryFn: () => listeEinheiten(einsatzId) });

  // Offen/Abgeschlossen-Trennung erfolgt clientseitig (alle Meldungen laden, Server-Default).
  const [ansicht, setAnsicht] = useState<'offen' | 'abgeschlossen'>('offen');
  const [richtungFilter, setRichtungFilter] = useState<string | undefined>(undefined);
  const [auftragMeldung, setAuftragMeldung] = useState<Meldung | null>(null);
  const [lageMeldung, setLageMeldung] = useState<Meldung | null>(null);
  // Inline-Erfassen-Formular (LFH-112): per Kopf-Button auf-/zugeklappt, kein Drawer/Sidebar.
  const [formOffen, setFormOffen] = useState(false);

  const meldungenQuery = useQuery({
    queryKey: einsatzKeys.meldungenListe(einsatzId, richtungFilter ?? 'alle'),
    queryFn: () => listeMeldungen(einsatzId, { richtung: richtungFilter }),
  });

  // Cross-Modul-Deeplink (LFH-153): ?meldung=<id> (z. B. Lagekarte-Inspector) hebt die Meldung
  // hervor; Ansicht (offen/abgeschlossen) + Richtungsfilter so setzen, dass sie sichtbar ist.
  // Scroll ist best-effort (jsdom-No-op).
  const [highlightMeldungId, setHighlightMeldungId] = useState<number | null>(null);
  useQueryParamSelektion('meldung', meldungenQuery.isSuccess, (mid) => {
    const m = (meldungenQuery.data ?? []).find((x) => x.id === mid);
    if (!m) return;
    setAnsicht(istAbgeschlossen(MELDUNG_STATUS[m.status]?.phase ?? 'offen') ? 'abgeschlossen' : 'offen');
    setRichtungFilter(undefined);
    setHighlightMeldungId(mid);
  });
  useEffect(() => {
    if (highlightMeldungId == null) return;
    document.querySelector(`[data-meldung-id="${highlightMeldungId}"]`)?.scrollIntoView?.({ block: 'center' });
  }, [highlightMeldungId]);

  const fehler = (e: unknown) => message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');
  const invalidiere = () => qc.invalidateQueries({ queryKey: einsatzKeys.meldungen(einsatzId) });

  // LFH-332/B4: kein `setFormOffen(false)` mehr. Das Inline-Formular bleibt nach
  // dem Senden offen, damit die nächste Meldung ohne Aufklappen weitergeht;
  // Zuklappen ist ausdrückliche Nutzeraktion (Kopf-Umschalter oder Kreuz an der
  // Card). Der conditional Render der Card (unten) würde das Formular sonst
  // unmounten — samt Serienzähler und Wertübernahme.
  const anlegenMutation = useMutation({
    mutationFn: (d: NeueMeldung) => legeMeldungAn(einsatzId, d),
    onSuccess: () => { invalidiere(); message.success('Meldung erfasst'); },
    onError: fehler,
  });
  const statusMutation = useMutation({
    mutationFn: ({ meldungId, status }: { meldungId: number; status: MeldungStatus }) =>
      setzeMeldungStatus(einsatzId, meldungId, status),
    onSuccess: invalidiere,
    onError: fehler,
  });
  const zuweisenMutation = useMutation({
    mutationFn: ({ meldungId, bearbeiterId }: { meldungId: number; bearbeiterId: number | null }) =>
      weiseBearbeiterZu(einsatzId, meldungId, bearbeiterId),
    onSuccess: invalidiere,
    onError: fehler,
  });
  const lageMutation = useMutation({
    mutationFn: ({ meldungId, daten }: { meldungId: number; daten: LagerelevantDaten }) =>
      markiereLagerelevant(einsatzId, meldungId, daten),
    onSuccess: () => {
      invalidiere();
      qc.invalidateQueries({ queryKey: einsatzKeys.lagemeldungen(einsatzId) });
      setLageMeldung(null);
      message.success('An die Lage übergeben');
    },
    onError: fehler,
  });
  const bestaetigenMutation = useMutation({
    mutationFn: (meldungId: number) => bestaetigeMeldung(einsatzId, meldungId),
    onSuccess: () => { invalidiere(); message.success('Sofortmeldung bestätigt'); },
    onError: fehler,
  });
  const auftragMutation = useMutation({
    mutationFn: ({ meldungId, daten }: { meldungId: number; daten: NeuerAuftrag }) =>
      erteileAuftragAusMeldung(einsatzId, meldungId, daten),
    onSuccess: () => {
      invalidiere();
      qc.invalidateQueries({ queryKey: einsatzKeys.auftraege(einsatzId) });
      setAuftragMeldung(null);
      message.success('Auftrag aus Meldung erteilt');
    },
    onError: fehler,
  });

  if (einsatzQuery.isLoading) {
    return <div style={{ textAlign: 'center', paddingTop: 80 }}><Spin size="large" /></div>;
  }
  if (einsatzQuery.isError || !einsatzQuery.data) {
    return <Alert type="error" title="Einsatz nicht gefunden oder kein Zugriff" showIcon />;
  }
  const einsatz = einsatzQuery.data;
  const darfSchreiben = darfImEinsatzSchreiben(einsatz, benutzer);
  const alleMeldungen = meldungenQuery.data ?? [];

  // Offen/Abgeschlossen clientseitig über die gemeinsame Phasen-Semantik trennen.
  const phaseVon = (m: Meldung) => MELDUNG_STATUS[m.status]?.phase ?? 'offen';
  const offene = alleMeldungen.filter((m) => !istAbgeschlossen(phaseVon(m))).sort(vergleicheMeldung);
  const abgeschlossene = alleMeldungen.filter((m) => istAbgeschlossen(phaseVon(m))).sort(vergleicheAbgeschlossen);
  const sichtbare = ansicht === 'offen' ? offene : abgeschlossene;
  const mitglieder = mitgliederQuery.data ?? [];

  const listenProps = {
    einsatzId,
    darfSchreiben,
    mitglieder,
    highlightId: highlightMeldungId,
    onStatus: (meldungId: number, status: MeldungStatus) => statusMutation.mutate({ meldungId, status }),
    onZuweisen: (meldungId: number, bearbeiterId: number | null) => zuweisenMutation.mutate({ meldungId, bearbeiterId }),
    onLagerelevant: (meldungId: number) => {
      const m = alleMeldungen.find((x) => x.id === meldungId) ?? null;
      setLageMeldung(m);
    },
    onBestaetigen: (meldungId: number) => bestaetigenMutation.mutate(meldungId),
    onAuftragErteilen: (m: Meldung) => setAuftragMeldung(m),
  };

  const auftragsZiele = {
    abschnitte: (abschnitteQuery.data ?? []).map((a) => ({ id: a.id, name: a.name })),
    einheiten: (einheitenQuery.data ?? []).map((e) => ({ id: e.id, name: e.name })),
  };

  return (
    <div style={{ maxWidth: 1040, margin: '0 auto' }}>
      <Breadcrumb
        style={{ marginBottom: 12 }}
        items={[
          { title: <Link to="/einsaetze">Einsätze</Link> },
          { title: einsatz.bezeichnung },
          { title: 'Meldungen (eingehend)' },
        ]}
      />
      <Flex justify="space-between" align="center" gap={16} wrap style={{ marginBottom: 16 }}>
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>Meldungen (eingehend)</Typography.Title>
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
            {formOffen ? 'Formular schließen' : 'Meldung erfassen'}
          </Button>
        )}
      </Flex>

      {darfSchreiben && formOffen && (
        <Card
          size="small"
          title="Neue Meldung erfassen"
          style={{ marginBottom: 16 }}
          extra={(
            <Button
              type="text"
              size="small"
              icon={<CloseOutlined />}
              onClick={() => setFormOffen(false)}
              aria-label="Formular schließen"
            />
          )}
        >
          <MeldungFormular
            card={false}
            senden={anlegenMutation.isPending}
            // mutateAsync, nicht mutate: die Erfassungshülle darf die Felder nur
            // leeren, wenn der Datensatz wirklich angekommen ist. Den Fehler-Toast
            // wirft weiterhin `onError` der Mutation.
            onAnlegen={(d) => anlegenMutation.mutateAsync(d)}
          />
        </Card>
      )}

      {meldungenQuery.isError && (
        <Alert type="error" showIcon style={{ marginBottom: 12 }} title="Meldungen konnten nicht geladen werden" />
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
      </div>
      <MeldungListe meldungen={sichtbare} ansicht={ansicht} {...listenProps} />
      <LagerelevantModal
        offen={lageMeldung !== null}
        meldung={lageMeldung}
        senden={lageMutation.isPending}
        einsatzId={einsatzId}
        onAbbrechen={() => setLageMeldung(null)}
        onUebergeben={(daten) => {
          if (lageMeldung) lageMutation.mutate({ meldungId: lageMeldung.id, daten });
        }}
      />
      <AuftragErteilenModal
        meldung={auftragMeldung}
        abschnitte={auftragsZiele.abschnitte}
        einheiten={auftragsZiele.einheiten}
        senden={auftragMutation.isPending}
        onAbbrechen={() => setAuftragMeldung(null)}
        onAnlegen={(daten) => {
          if (auftragMeldung) auftragMutation.mutate({ meldungId: auftragMeldung.id, daten });
        }}
      />
    </div>
  );
}
