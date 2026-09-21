import { Alert, App, Breadcrumb, Button, Spin } from 'antd';
import { CloseOutlined, PlusOutlined, UpOutlined } from '@ant-design/icons';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useQueryParamSelektion } from '../routing/useQueryParamSelektion';
import { einsatzKeys } from '../api/queryKeys';
import { ladeEinsatz, ladeMitglieder } from '../api/einsaetze';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { useAuth } from '../auth/AuthContext';
import { fehlerText } from '../api/client';
import {
  bestaetigeMeldung,
  erteileAuftragAusMeldung,
  listeMeldungen,
  markiereLagerelevant,
  setzeMeldungStatus,
  weiseBearbeiterZu,
} from '../api/meldungen';
import { listeAbschnitte } from '../api/einsatzabschnitte';
import { listeEinheiten } from '../api/einheiten';
import type { Meldung, MeldungStatus, NeueMeldung, NeuerAuftrag } from '../api/types';
import { erfasseMeldungOfflineFaehig } from '../offline/schreiben';
import { MELDUNG_STATUS, istAbgeschlossen, prioRang } from '../kommunikation';
import { zeigeRueckgaengig } from '../kommunikation/rueckgaengig';
import MeldungListe from '../meldungen/MeldungListe';
import MeldungFormular from '../meldungen/MeldungFormular';
import AuftragErteilenModal from '../meldungen/AuftragErteilenModal';
import LagerelevantModal, { type LagerelevantDaten } from '../meldungen/LagerelevantModal';
import EinsatzSeite from '../components/EinsatzSeite';
import {
  Augenbraue,
  Kennzahl,
  Kennzahlenband,
  Paneel,
  Segmentleiste,
  useRollen,
} from '../components/instrument';
import { meldungKennzahlen } from '../meldungen/meldungKennzahlen';

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
  const { token } = useRollen();

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const mitgliederQuery = useQuery({
    queryKey: einsatzKeys.mitglieder(einsatzId),
    queryFn: () => ladeMitglieder(einsatzId),
  });
  // Auftrags-Ziele für das Meldung→Auftrag-Formular (wie AuftraegePage/ChatPage).
  const abschnitteQuery = useQuery({
    queryKey: einsatzKeys.abschnitte(einsatzId),
    queryFn: () => listeAbschnitte(einsatzId),
  });
  const einheitenQuery = useQuery({
    queryKey: einsatzKeys.einheiten(einsatzId),
    queryFn: () => listeEinheiten(einsatzId),
  });

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
    // LFH-351/H48: jeder Richtungsfilter ist ein eigener Query-Key. Beim ersten Wechsel ist
    // der Key kalt, und ohne Platzhalter zeigte die Seite für die Dauer des Requests
    // „Keine Meldungen" samt „0 offen" — unter Zeitdruck genau die Sekunde, in der man die
    // Lage falsch abliest. Die vorherige Liste steht, bis die neue da ist.
    placeholderData: (prev) => prev,
  });

  // Cross-Modul-Deeplink (LFH-153): ?meldung=<id> (z. B. Lagekarte-Inspector) hebt die Meldung
  // hervor; Ansicht (offen/abgeschlossen) + Richtungsfilter so setzen, dass sie sichtbar ist.
  // Scroll ist best-effort (jsdom-No-op).
  const [highlightMeldungId, setHighlightMeldungId] = useState<number | null>(null);
  useQueryParamSelektion('meldung', meldungenQuery.isSuccess, (mid) => {
    const m = (meldungenQuery.data ?? []).find((x) => x.id === mid);
    if (!m) return;
    setAnsicht(
      istAbgeschlossen(MELDUNG_STATUS[m.status]?.phase ?? 'offen') ? 'abgeschlossen' : 'offen',
    );
    setRichtungFilter(undefined);
    setHighlightMeldungId(mid);
  });
  useEffect(() => {
    if (highlightMeldungId == null) return;
    document
      .querySelector(`[data-meldung-id="${highlightMeldungId}"]`)
      ?.scrollIntoView?.({ block: 'center' });
  }, [highlightMeldungId]);

  const fehler = (e: unknown) => message.error(fehlerText(e));
  const invalidiere = () => qc.invalidateQueries({ queryKey: einsatzKeys.meldungen(einsatzId) });

  // LFH-332/B4: kein `setFormOffen(false)` mehr. Das Inline-Formular bleibt nach
  // dem Senden offen, damit die nächste Meldung ohne Aufklappen weitergeht;
  // Zuklappen ist ausdrückliche Nutzeraktion (Kopf-Umschalter oder Kreuz an der
  // Paneel). Der conditional Render des Paneels (unten) würde das Formular sonst
  // unmounten — samt Serienzähler und Wertübernahme.
  const anlegenMutation = useMutation({
    mutationFn: (d: NeueMeldung) => {
      if (!benutzer) throw new Error('Nicht angemeldet');
      return erfasseMeldungOfflineFaehig(benutzer.id, einsatzId, d);
    },
    onSuccess: (ergebnis) => {
      if (ergebnis.zustand === 'vorgemerkt') {
        message.warning('Offline vorgemerkt — Meldung wird bei Verbindung gesendet');
        return;
      }
      const meldung = ergebnis.daten;
      qc.setQueriesData<Meldung[]>({ queryKey: einsatzKeys.meldungen(einsatzId) }, (alt = []) => {
        const ohne = alt.filter((m) => m.id !== meldung.id);
        return [meldung, ...ohne];
      });
      invalidiere();
      message.success(`Meldung #${meldung.lfd_nr} erfasst`);
    },
    onError: fehler,
  });
  /**
   * Triage-Schritt und seine Rücknahme laufen durch DIESELBE Mutation
   * (LFH-343 · C8, Befund H50). `vorher` ist der Stand VOR dem Klick und damit das
   * Ziel des Rückwegs; `src/meldung/repo.rs:setze_status` nimmt jeden gültigen
   * Status an, die Rücknahme braucht also keine eigene Route.
   *
   * `zurueck` unterscheidet die Richtungen: die Rücknahme darf keinen eigenen
   * Rückgängig-Toast erzeugen, sonst schaukelte sich das Paar endlos auf.
   */
  const statusMutation = useMutation({
    mutationFn: ({
      meldungId,
      status,
    }: {
      meldungId: number;
      status: MeldungStatus;
      vorher?: MeldungStatus;
      zurueck?: boolean;
    }) => setzeMeldungStatus(einsatzId, meldungId, status),
    onSuccess: (_daten, { meldungId, status, vorher, zurueck }) => {
      invalidiere();
      if (zurueck || !vorher) return;
      zeigeRueckgaengig(message, `Meldung ${MELDUNG_STATUS[status]?.label ?? status}`, () =>
        statusMutation.mutate({ meldungId, status: vorher, zurueck: true }),
      );
    },
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
    onSuccess: () => {
      invalidiere();
      message.success('Sofortmeldung bestätigt');
    },
    onError: fehler,
  });
  const auftragMutation = useMutation({
    mutationFn: ({ meldungId, daten }: { meldungId: number; daten: NeuerAuftrag }) =>
      erteileAuftragAusMeldung(einsatzId, meldungId, daten),
    onSuccess: (_daten, { meldungId }) => {
      invalidiere();
      qc.invalidateQueries({ queryKey: einsatzKeys.auftraege(einsatzId) });
      setAuftragMeldung(null);
      // Wer aus einer Meldung einen Auftrag erteilt, HAT sie bearbeitet
      // (LFH-343 · C8, Befund H50). Ohne diesen Schritt stand sie danach weiter
      // auf „neu", und der Weg Meldung→Auftrag→erledigt kostete zwei zusätzliche
      // Klicks. Der Riegel auf den Ausgangsstatus ist tragend: ohne ihn schriebe
      // die Seite bei einer schon laufenden Meldung denselben Status noch einmal
      // — ein PATCH samt Invalidierung und Live-Ereignis für nichts.
      //
      // Bewusst OHNE Rückgängig-Toast (`vorher` bleibt leer): der sichtbare
      // Vorgang ist das Erteilen des Auftrags, und ein Rückweg, der nur den
      // Meldungsstatus zurückdreht, ließe den Auftrag stehen — er verspräche
      // eine Rücknahme, die keine ist.
      const quelle = (meldungenQuery.data ?? []).find((m) => m.id === meldungId);
      if (quelle && quelle.status !== 'in_bearbeitung' && quelle.status !== 'erledigt') {
        statusMutation.mutate({ meldungId, status: 'in_bearbeitung' });
      }
      message.success('Auftrag aus Meldung erteilt');
    },
    onError: fehler,
  });

  if (einsatzQuery.isLoading) {
    return (
      <div style={{ textAlign: 'center', paddingTop: 80 }}>
        <Spin size="large" />
      </div>
    );
  }
  if (einsatzQuery.isError || !einsatzQuery.data) {
    return <Alert type="error" title="Einsatz nicht gefunden oder kein Zugriff" showIcon />;
  }
  const einsatz = einsatzQuery.data;
  const darfSchreiben = darfImEinsatzSchreiben(einsatz, benutzer);
  const alleMeldungen = meldungenQuery.data ?? [];

  // Offen/Abgeschlossen clientseitig über die gemeinsame Phasen-Semantik trennen.
  const phaseVon = (m: Meldung) => MELDUNG_STATUS[m.status]?.phase ?? 'offen';
  const offene = alleMeldungen
    .filter((m) => !istAbgeschlossen(phaseVon(m)))
    .sort(vergleicheMeldung);
  const abgeschlossene = alleMeldungen
    .filter((m) => istAbgeschlossen(phaseVon(m)))
    .sort(vergleicheAbgeschlossen);
  const mitglieder = mitgliederQuery.data ?? [];

  // Zwei Gruppen in der Offen-Ansicht (LFH-343 · C8, Befund H47). Die Seite war
  // bewusst flach — der Kommentar an `vergleicheMeldung` sagt das noch —, und
  // dieser Kopf ändert es: die erste Frage der Triage lautet „was hat noch niemand
  // angefasst", nicht „was ist am dringendsten". Eine gesichtete Sofortmeldung
  // steht danach unter einer neuen Normalmeldung; das ist gewollt.
  // Innerhalb jeder Gruppe bleibt `vergleicheMeldung` die Ordnung — `offene` ist
  // bereits sortiert, `filter` erhält die Reihenfolge.
  const neue = offene.filter((m) => MELDUNG_STATUS[m.status]?.unbearbeitet);
  const angefasste = offene.filter((m) => !MELDUNG_STATUS[m.status]?.unbearbeitet);
  const offeneGruppen = [
    { titel: `Neu (${neue.length})`, meldungen: neue },
    { titel: `In Arbeit (${angefasste.length})`, meldungen: angefasste },
  ].filter((g) => g.meldungen.length > 0);

  const listenProps = {
    einsatzId,
    darfSchreiben,
    mitglieder,
    highlightId: highlightMeldungId,
    onStatus: (meldungId: number, status: MeldungStatus) => {
      const vorher = alleMeldungen.find((m) => m.id === meldungId)?.status;
      statusMutation.mutate({ meldungId, status, vorher });
    },
    onZuweisen: (meldungId: number, bearbeiterId: number | null) =>
      zuweisenMutation.mutate({ meldungId, bearbeiterId }),
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

  const kennzahlen = meldungKennzahlen(alleMeldungen);

  return (
    <EinsatzSeite
      titel="Meldungen (eingehend)"

      meta={`${offene.length} offen · ${abgeschlossene.length} abgeschlossen`}
      dataUpdatedAt={meldungenQuery.dataUpdatedAt}
      breadcrumb={
        <Breadcrumb
          items={[
            { title: <Link to="/einsaetze">Einsätze</Link> },
            { title: einsatz.bezeichnung },
            { title: 'Meldungen (eingehend)' },
          ]}
        />
      }
      aktionen={
        darfSchreiben && (
          <Button
            type="primary"
            icon={formOffen ? <UpOutlined /> : <PlusOutlined />}
            onClick={() => setFormOffen((o) => !o)}
          >
            {formOffen ? 'Formular schließen' : 'Meldung erfassen'}
          </Button>
        )
      }
    >
      {/* Kennzahlen der Triage (Neuentwurf „Zahl führt"): dieselben Mengen, aus denen die
          Liste darunter gebaut ist — keine zweite Zählung, `meldungKennzahlen` ist rein. */}
      <Kennzahlenband beschriftung="Meldungen in Zahlen" style={{ marginBottom: token.margin }}>
        <Kennzahl
          titel="Unbearbeitet"
          groesse="klein"
          wert={kennzahlen.unbearbeitet}
          ton={kennzahlen.unbearbeitet > 0 ? 'achtung' : 'neutral'}
          notiz="noch nicht gesichtet"
          zustand={meldungenQuery.isLoading ? 'laden' : meldungenQuery.isError ? 'fehler' : 'daten'}
        />
        <Kennzahl
          titel="In Arbeit"
          groesse="klein"
          wert={kennzahlen.inArbeit}
          notiz="gesichtet oder in Bearbeitung"
          zustand={meldungenQuery.isLoading ? 'laden' : meldungenQuery.isError ? 'fehler' : 'daten'}
        />
        <Kennzahl
          titel="Alarmiert"
          groesse="klein"
          wert={kennzahlen.alarmiert}
          ton={kennzahlen.alarmiert > 0 ? 'alarm' : 'neutral'}
          notiz="Bestätigungsfrist verstrichen"
          zustand={meldungenQuery.isLoading ? 'laden' : meldungenQuery.isError ? 'fehler' : 'daten'}
        />
        <Kennzahl
          titel="Erledigt"
          groesse="klein"
          wert={kennzahlen.erledigt}
          zustand={meldungenQuery.isLoading ? 'laden' : meldungenQuery.isError ? 'fehler' : 'daten'}
        />
      </Kennzahlenband>

      {darfSchreiben && formOffen && (
        <Paneel
          titel="Neue Meldung erfassen"
          koerperPolster
          style={{ marginBottom: token.margin }}
          aktion={
            <Button
              type="text"
              icon={<CloseOutlined />}
              onClick={() => setFormOffen(false)}
              aria-label="Formular schließen"
            />
          }
        >
          <MeldungFormular
            card={false}
            senden={anlegenMutation.isPending}
            // mutateAsync, nicht mutate: die Erfassungshülle darf die Felder nur
            // leeren, wenn der Datensatz wirklich angekommen ist. Den Fehler-Toast
            // wirft weiterhin `onError` der Mutation.
            onAnlegen={(d) => anlegenMutation.mutateAsync(d)}
          />
        </Paneel>
      )}

      {meldungenQuery.isError && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: token.marginSM }}
          title="Meldungen konnten nicht geladen werden"
        />
      )}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: token.marginSM,
          marginBottom: token.margin,
          alignItems: 'center',
        }}
      >
        <Segmentleiste
          beschriftung="Ansicht"
          wert={ansicht}
          onWechsel={setAnsicht}
          optionen={[
            { wert: 'offen', label: `Offen (${offene.length})` },
            { wert: 'abgeschlossen', label: `Abgeschlossen (${abgeschlossene.length})` },
          ]}
        />
        <Segmentleiste
          beschriftung="Richtung"
          wert={richtungFilter ?? 'alle'}
          onWechsel={(v) => setRichtungFilter(v === 'alle' ? undefined : v)}
          optionen={[
            { wert: 'alle', label: 'Alle Richtungen' },
            { wert: 'intern', label: 'Intern' },
            { wert: 'extern', label: 'Extern' },
          ]}
        />
      </div>
      {ansicht === 'offen' ? (
        offeneGruppen.length === 0 ? (
          <MeldungListe meldungen={[]} ansicht="offen" {...listenProps} />
        ) : (
          offeneGruppen.map(({ titel, meldungen }) => (
            <div key={titel} style={{ marginBottom: token.margin }}>
              <Augenbraue als="h2" style={{ display: 'block', marginBottom: token.marginXS }}>
                {titel}
              </Augenbraue>
              <MeldungListe meldungen={meldungen} ansicht="offen" {...listenProps} />
            </div>
          ))
        )
      ) : (
        <MeldungListe meldungen={abgeschlossene} ansicht="abgeschlossen" {...listenProps} />
      )}
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
        // mutateAsync: die Erfassungshülle im Formular darf die Felder nur leeren,
        // wenn der Auftrag wirklich angekommen ist (LFH-332/B4).
        onAnlegen={(daten) =>
          auftragMeldung
            ? auftragMutation.mutateAsync({ meldungId: auftragMeldung.id, daten })
            : Promise.reject(new Error('Keine Quellmeldung'))
        }
      />
    </EinsatzSeite>
  );
}
