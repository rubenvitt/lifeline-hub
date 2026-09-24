import { App, Breadcrumb, Button } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  aendereBezirk,
  aendereStelle,
  ladeBetreuung,
  legeBezirkAn,
  legeStelleAn,
  meldeBelegung,
  meldeStand,
  nimmBelegungZurueck,
  nimmStandZurueck,
  storniereBezirk,
  storniereStelle,
} from '../api/betreuung';
import { ladeEinsatz } from '../api/einsaetze';
import { listeAbschnitte } from '../api/einsatzabschnitte';
import { einsatzKeys } from '../api/queryKeys';
import { lagekartePfad } from '../routing/deeplinks';
import type {
  BelegungsmeldungEingabe,
  Betreuungsstelle,
  BetreuungsstelleEingabe,
  BetreuungsstellePatch,
  EinsatzStatus,
  Evakuierungsbezirk,
  EvakuierungsbezirkEingabe,
  EvakuierungsbezirkPatch,
  StandmeldungEingabe,
} from '../api/types';
import { useAuth } from '../auth/AuthContext';
import {
  BelegungMeldenDialog,
  BezirkAnlegenDialog,
  BezirkBearbeitenDialog,
  RaeumungDialog,
  StandMeldenDialog,
  StelleAnlegenDialog,
  StelleBearbeitenDialog,
  StornierenDialog,
} from '../betreuung/BetreuungDialoge';
import { personenZahl, volleStellenSegment } from '../betreuung/betreuungText';
import EvakuierungBlock, { type BezirkAktion } from '../betreuung/EvakuierungBlock';
import StellenBlock, { type StelleAktion } from '../betreuung/StellenBlock';
import { scrolleZurZeile } from '../components/Datensicht';
import EinsatzSeite from '../components/EinsatzSeite';
import { SeitenFehler, SeitenSkeleton, SeitenStandVeraltet } from '../components/SeitenZustand';
import { SeitenHinweise } from '../components/SpeicherHinweis';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { zeigeRueckgaengig } from '../kommunikation/rueckgaengig';
import { useQueryParamSelektion } from '../routing/useQueryParamSelektion';

/** Grund der fehlenden Schreibberechtigung als ganzer Satz (C10/M16). */
export function betreuungRechteText(status: EinsatzStatus): string {
  return status !== 'aktiv'
    ? 'Der Einsatz ist abgeschlossen — Bezirke und Betreuungsstellen sind nur noch lesbar.'
    : 'Nur Einsatzleitung und Führungspersonal können Bezirke und Betreuungsstellen anlegen und Meldungen erfassen.';
}

/** Welcher Dialog offen ist — EINER zur Zeit, jeder frisch montiert (`initialValues`). */
type Dialog =
  | { art: 'bezirkAnlegen' }
  | { art: 'bezirkBearbeiten'; bezirk: Evakuierungsbezirk }
  | { art: 'raeumung'; bezirk: Evakuierungsbezirk }
  | { art: 'stand'; bezirk: Evakuierungsbezirk }
  | { art: 'bezirkStornieren'; bezirk: Evakuierungsbezirk }
  | { art: 'stelleAnlegen' }
  | { art: 'stelleBearbeiten'; stelle: Betreuungsstelle }
  | { art: 'belegung'; stelle: Betreuungsstelle }
  | { art: 'stelleStornieren'; stelle: Betreuungsstelle };

type Hervorhebung = { art: 'bezirk' | 'stelle'; id: number } | null;

/**
 * Fachmodul Betreuung (LFH-639, design.md D7): EINE Route, zwei Blöcke, keine Detailroute.
 *
 * - **Evakuierung** — Karten, weil gelesen wird („was ist mit diesem Bezirk?").
 * - **Betreuungsstellen** — Tabelle, weil verglichen wird („welche hat noch Platz?").
 *
 * KOPF: genau EINE Primäraktion, „Evakuierungsbezirk anlegen" (LFH-340). „Betreuungsstelle
 * anlegen" steht sekundär im eigenen Blockkopf.
 *
 * MELDEN OHNE RÜCKFRAGE, MIT RÜCKWEG (LFH-343): Stand und Belegung haben einen serverseitigen
 * Rückweg (Rücknahme-Route, D3). Der Toast nimmt die `meldung_id` der GERADE angelegten
 * Meldung — nie `bezirk.stand.id`: bei einer nachgetragenen, älteren Meldung ist der aktuelle
 * Stand eine ANDERE Meldung, und „Rückgängig" nähme sonst die falsche zurück.
 *
 * FEHLER: die der Dialoge stehen IM Dialog (`SpeicherFehler`), die einer Rücknahme — die keinen
 * Dialog hat — an der Seite (`SeitenHinweise`, C10/H14). Erfolg quittiert der Toast.
 *
 * LIVE: alle Mutationen und das `betreuung`-Ereignis invalidieren `einsatzKeys.betreuung`.
 * Fremd angelegte Zeilen erscheinen über das Sammelbanner der `Datensicht`, solange der Fokus
 * in einer Sicht liegt (Vorgabe `zufluss="sammelbanner"`).
 */
export default function BetreuungPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const navigate = useNavigate();
  const { benutzer } = useAuth();
  const { message } = App.useApp();
  const qc = useQueryClient();

  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [hervorhebung, setHervorhebung] = useState<Hervorhebung>(null);
  const schliessen = useCallback(() => setDialog(null), []);

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const betreuungQuery = useQuery({
    queryKey: einsatzKeys.betreuung(einsatzId),
    queryFn: () => ladeBetreuung(einsatzId),
  });
  const darfSchreiben = einsatzQuery.data
    ? darfImEinsatzSchreiben(einsatzQuery.data, benutzer)
    : false;
  // Die Abschnitte braucht nur, wer anlegen oder bearbeiten darf.
  const abschnitteQuery = useQuery({
    queryKey: einsatzKeys.abschnitte(einsatzId),
    queryFn: () => listeAbschnitte(einsatzId),
    enabled: darfSchreiben,
  });
  const abschnitte = useMemo(
    () => (abschnitteQuery.data ?? []).map((a) => ({ value: a.id, label: a.name })),
    [abschnitteQuery.data],
  );

  const bezirke = useMemo(() => betreuungQuery.data?.bezirke ?? [], [betreuungQuery.data]);
  const stellen = useMemo(() => betreuungQuery.data?.stellen ?? [], [betreuungQuery.data]);

  // Cross-Modul-Deeplinks (LFH-25): `?bezirk=` / `?stelle=` heben die Zeile hervor.
  useQueryParamSelektion('bezirk', betreuungQuery.isSuccess, (bid) => {
    if (bezirke.some((b) => b.id === bid)) setHervorhebung({ art: 'bezirk', id: bid });
  });
  useQueryParamSelektion('stelle', betreuungQuery.isSuccess, (sid) => {
    if (stellen.some((s) => s.id === sid)) setHervorhebung({ art: 'stelle', id: sid });
  });
  useEffect(() => {
    if (hervorhebung == null) return;
    scrolleZurZeile(`${hervorhebung.art}-${hervorhebung.id}`);
  }, [hervorhebung]);

  const invalidiere = useCallback(() => {
    void qc.invalidateQueries({ queryKey: einsatzKeys.betreuung(einsatzId) });
    void qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
  }, [qc, einsatzId]);
  /**
   * Nach einer Bezirksänderung zusätzlich den Einsatz (LFH-607): Anlegen, Räumung und
   * Stornieren können die Lagekennzahl `evakuiert` kippen, und der Einsatz-Key ist nicht live
   * (`NICHT_LIVE_KEYS`) — ohne diese Zeile sähe die festlegende Person den neuen Zuschnitt des
   * Lage-Dashboards erst beim nächsten Fokus. Stand- und Stellenmeldungen kippen ihn nie.
   */
  const invalidiereBezirk = useCallback(() => {
    invalidiere();
    void qc.invalidateQueries({ queryKey: einsatzKeys.einsatz(einsatzId) });
  }, [invalidiere, qc, einsatzId]);

  // ── Evakuierungsbezirke ─────────────────────────────────────────────────────────────
  const bezirkAnlegenMut = useMutation({
    mutationFn: (body: EvakuierungsbezirkEingabe) => legeBezirkAn(einsatzId, body),
    onSuccess: (b) => {
      invalidiereBezirk();
      message.success(`Evakuierungsbezirk ${b.bezeichnung} angelegt`);
    },
  });
  const bezirkAendernMut = useMutation({
    mutationFn: ({ bezirkId, patch }: { bezirkId: number; patch: EvakuierungsbezirkPatch }) =>
      aendereBezirk(einsatzId, bezirkId, patch),
    onSuccess: (b) => {
      invalidiereBezirk();
      message.success(`Bezirk ${b.bezeichnung} gespeichert`);
    },
  });
  const bezirkStornierenMut = useMutation({
    mutationFn: (bezirkId: number) => storniereBezirk(einsatzId, bezirkId),
    onSuccess: (b) => {
      invalidiereBezirk();
      setDialog(null);
      message.success(`Bezirk ${b.bezeichnung} storniert`);
    },
  });
  const standZurueckMut = useMutation({
    mutationFn: (meldungId: number) => nimmStandZurueck(einsatzId, meldungId),
    onSuccess: (r) => {
      invalidiere();
      message.success(`Meldung zu ${r.bezirk.bezeichnung} zurückgenommen`);
    },
    onError: invalidiere,
  });
  const belegungZurueckMut = useMutation({
    mutationFn: (meldungId: number) => nimmBelegungZurueck(einsatzId, meldungId),
    onSuccess: (r) => {
      invalidiere();
      message.success(`Meldung zu ${r.stelle.bezeichnung} zurückgenommen`);
    },
    onError: invalidiere,
  });
  // Beide Rücknahmen melden ihren Fehler an DERSELBEN Stelle über der Seite (C10/H14). Ohne
  // Räumen bliebe ein alter Fehler dort für immer stehen — die Rücknahme startet aus dem
  // Toast, ein erneutes Absenden in derselben Maske gibt es nicht — und verdeckte über das
  // `??` jede spätere Ablehnung der anderen Rücknahme. Jede Rücknahme räumt deshalb die
  // andere, jede Meldung räumt beide.
  const { reset: resetStandZurueck, mutate: standZuruecknehmen } = standZurueckMut;
  const { reset: resetBelegungZurueck, mutate: belegungZuruecknehmen } = belegungZurueckMut;
  const nimmStandmeldungZurueck = (meldungId: number) => {
    resetBelegungZurueck();
    standZuruecknehmen(meldungId);
  };
  const nimmBelegungsmeldungZurueck = (meldungId: number) => {
    resetStandZurueck();
    belegungZuruecknehmen(meldungId);
  };
  const raeumeRuecknahmeFehler = () => {
    resetStandZurueck();
    resetBelegungZurueck();
  };
  const standMut = useMutation({
    mutationFn: ({ bezirkId, body }: { bezirkId: number; body: StandmeldungEingabe }) =>
      meldeStand(einsatzId, bezirkId, body),
    onMutate: raeumeRuecknahmeFehler,
    onSuccess: (r, { body }) => {
      invalidiere();
      zeigeRueckgaengig(
        message,
        `Stand ${r.bezirk.bezeichnung} gemeldet: ${personenZahl(body.evakuiert)} evakuiert`,
        () => nimmStandmeldungZurueck(r.meldung_id),
      );
    },
  });

  // ── Betreuungsstellen ───────────────────────────────────────────────────────────────
  const stelleAnlegenMut = useMutation({
    mutationFn: (body: BetreuungsstelleEingabe) => legeStelleAn(einsatzId, body),
    onSuccess: (s) => {
      invalidiere();
      message.success(`Betreuungsstelle ${s.bezeichnung} angelegt`);
    },
  });
  const stelleAendernMut = useMutation({
    mutationFn: ({ stelleId, patch }: { stelleId: number; patch: BetreuungsstellePatch }) =>
      aendereStelle(einsatzId, stelleId, patch),
    onSuccess: (s) => {
      invalidiere();
      message.success(`Betreuungsstelle ${s.bezeichnung} gespeichert`);
    },
  });
  // Die Leermeldung vor dem Schließen (D4): eigene Mutation ohne Rückgängig-Toast — sie ist
  // Teil des Schließens, und ein Rückweg auf die 0 ließe eine geschlossene, belegte Stelle zu
  // (der Server lehnt das ohnehin ab, 422).
  const leermeldungMut = useMutation({
    mutationFn: (stelleId: number) => meldeBelegung(einsatzId, stelleId, { belegt: 0 }),
    onSuccess: invalidiere,
  });
  const stelleStornierenMut = useMutation({
    mutationFn: (stelleId: number) => storniereStelle(einsatzId, stelleId),
    onSuccess: (s) => {
      invalidiere();
      setDialog(null);
      message.success(`Betreuungsstelle ${s.bezeichnung} storniert`);
    },
  });
  const belegungMut = useMutation({
    mutationFn: ({ stelleId, body }: { stelleId: number; body: BelegungsmeldungEingabe }) =>
      meldeBelegung(einsatzId, stelleId, body),
    onMutate: raeumeRuecknahmeFehler,
    onSuccess: (r, { body }) => {
      invalidiere();
      zeigeRueckgaengig(
        message,
        `Belegung ${r.stelle.bezeichnung} gemeldet: ${personenZahl(body.belegt)} untergebracht`,
        () => nimmBelegungsmeldungZurueck(r.meldung_id),
      );
    },
  });

  // ── Öffnen: jede Öffnung beginnt ohne den Fehler der letzten ────────────────────────
  const { reset: resetBezirkAnlegen } = bezirkAnlegenMut;
  const { reset: resetBezirkAendern } = bezirkAendernMut;
  const { reset: resetBezirkStornieren } = bezirkStornierenMut;
  const { reset: resetStand } = standMut;
  const { reset: resetStelleAnlegen } = stelleAnlegenMut;
  const { reset: resetStelleAendern } = stelleAendernMut;
  const { reset: resetLeermeldung } = leermeldungMut;
  const { reset: resetStelleStornieren } = stelleStornierenMut;
  const { reset: resetBelegung } = belegungMut;

  const oeffneBezirkAnlegen = useCallback(() => {
    resetBezirkAnlegen();
    setDialog({ art: 'bezirkAnlegen' });
  }, [resetBezirkAnlegen]);
  const oeffneStelleAnlegen = useCallback(() => {
    resetStelleAnlegen();
    setDialog({ art: 'stelleAnlegen' });
  }, [resetStelleAnlegen]);
  const oeffneStand = useCallback(
    (bezirk: Evakuierungsbezirk) => {
      resetStand();
      setDialog({ art: 'stand', bezirk });
    },
    [resetStand],
  );
  const oeffneBelegung = useCallback(
    (stelle: Betreuungsstelle) => {
      resetBelegung();
      setDialog({ art: 'belegung', stelle });
    },
    [resetBelegung],
  );
  const bezirkAktion = useCallback(
    (aktion: BezirkAktion, bezirk: Evakuierungsbezirk) => {
      // LFH-673: Sprung auf die Karte; dort wählt die Seite eine Fläche und räumt den Parameter.
      if (aktion === 'karte') {
        navigate(lagekartePfad(einsatzId, { evakuierungsbezirk: bezirk.id }));
        return;
      }
      if (aktion === 'stornieren') {
        resetBezirkStornieren();
        setDialog({ art: 'bezirkStornieren', bezirk });
        return;
      }
      resetBezirkAendern();
      setDialog({ art: aktion === 'raeumung' ? 'raeumung' : 'bezirkBearbeiten', bezirk });
    },
    [resetBezirkAendern, resetBezirkStornieren, navigate, einsatzId],
  );
  const stelleAktion = useCallback(
    (aktion: StelleAktion, stelle: Betreuungsstelle) => {
      // LFH-673: Sprung in den Platziermodus der Lagekarte; dort räumt die Karte den Auftrag.
      if (aktion === 'verorten') {
        navigate(
          lagekartePfad(einsatzId, { platzieren: { typ: 'betreuungsstelle', id: stelle.id } }),
        );
        return;
      }
      if (aktion === 'stornieren') {
        resetStelleStornieren();
        setDialog({ art: 'stelleStornieren', stelle });
        return;
      }
      resetStelleAendern();
      resetLeermeldung();
      setDialog({ art: 'stelleBearbeiten', stelle });
    },
    [resetStelleAendern, resetLeermeldung, resetStelleStornieren, navigate, einsatzId],
  );

  if (einsatzQuery.isLoading) return <SeitenSkeleton />;
  if (einsatzQuery.isError || !einsatzQuery.data) {
    return (
      <SeitenFehler
        text="Einsatz nicht gefunden oder kein Zugriff"
        ursache={einsatzQuery.error}
        onWiederholen={() => void einsatzQuery.refetch()}
      />
    );
  }
  const einsatz = einsatzQuery.data;

  // Fehler ist nicht leer (LFH-331 · B3): ohne Daten tritt der Fehler an die Stelle der
  // Blöcke, mit Daten bleiben sie stehen und bekommen ein Banner.
  const gescheitert = betreuungQuery.isError && betreuungQuery.data == null;
  const veraltet = betreuungQuery.isError && betreuungQuery.data != null;
  const ladend = betreuungQuery.isLoading;

  return (
    <EinsatzSeite
      titel="Betreuung"
      // „n voll" auch HIER, nicht nur im Blockkopf der Stellen (LFH-678): der Seitenkopf ist die
      // einzige Zeile, die mit vielen Bezirkskarten noch über der Falz steht (Kriterium 9).
      meta={
        betreuungQuery.data
          ? `${bezirke.length} ${bezirke.length === 1 ? 'Bezirk' : 'Bezirke'} · ${stellen.length} ${stellen.length === 1 ? 'Betreuungsstelle' : 'Betreuungsstellen'}${volleStellenSegment(stellen)}`
          : undefined
      }
      dataUpdatedAt={betreuungQuery.dataUpdatedAt}
      breadcrumb={
        <Breadcrumb
          items={[
            { title: <Link to="/einsaetze">Einsätze</Link> },
            { title: einsatz.bezeichnung },
            { title: 'Betreuung' },
          ]}
        />
      }
      // Gesperrt statt versteckt (C10/M16): der Hinweis darunter nennt den Grund.
      aktionen={
        <Button type="primary" disabled={!darfSchreiben} onClick={oeffneBezirkAnlegen}>
          Evakuierungsbezirk anlegen
        </Button>
      }
      neueZeile={darfSchreiben ? oeffneBezirkAnlegen : undefined}
      hinweis={
        <SeitenHinweise
          rechteFehlt={!darfSchreiben}
          rechteText={betreuungRechteText(einsatz.status)}
          fehler={standZurueckMut.error ?? belegungZurueckMut.error}
          fehlerTitel="Meldung konnte nicht zurückgenommen werden"
        />
      }
    >
      {gescheitert ? (
        <SeitenFehler
          text="Betreuung konnte nicht geladen werden"
          ursache={betreuungQuery.error}
          onWiederholen={() => void betreuungQuery.refetch()}
        />
      ) : (
        <>
          {veraltet && <SeitenStandVeraltet onWiederholen={() => void betreuungQuery.refetch()} />}
          <EvakuierungBlock
            einsatzId={einsatzId}
            bezirke={bezirke}
            ladend={ladend}
            darfSchreiben={darfSchreiben}
            hervorgehoben={hervorhebung?.art === 'bezirk' ? hervorhebung.id : null}
            onStandMelden={oeffneStand}
            onAktion={bezirkAktion}
          />
          <StellenBlock
            einsatzId={einsatzId}
            stellen={stellen}
            ladend={ladend}
            darfSchreiben={darfSchreiben}
            hervorgehoben={hervorhebung?.art === 'stelle' ? hervorhebung.id : null}
            onAnlegen={oeffneStelleAnlegen}
            onBelegungMelden={oeffneBelegung}
            onAktion={stelleAktion}
          />
        </>
      )}

      {/* Dialoge je Ziel frisch montiert: `initialValues` greift nur beim Einhängen, und der
          Speicher von rc-field-form überlebt sonst ein Schließen (CLAUDE.md, B4). */}
      {dialog?.art === 'bezirkAnlegen' && (
        <BezirkAnlegenDialog
          abschnitte={abschnitte}
          laeuft={bezirkAnlegenMut.isPending}
          fehler={bezirkAnlegenMut.error}
          onErfassen={(body) => bezirkAnlegenMut.mutateAsync(body)}
          onSchliessen={schliessen}
        />
      )}
      {dialog?.art === 'bezirkBearbeiten' && (
        <BezirkBearbeitenDialog
          key={dialog.bezirk.id}
          bezirk={dialog.bezirk}
          abschnitte={abschnitte}
          laeuft={bezirkAendernMut.isPending}
          fehler={bezirkAendernMut.error}
          onErfassen={(patch) =>
            bezirkAendernMut.mutateAsync({ bezirkId: dialog.bezirk.id, patch })
          }
          onSchliessen={schliessen}
        />
      )}
      {dialog?.art === 'raeumung' && (
        <RaeumungDialog
          key={dialog.bezirk.id}
          bezirk={dialog.bezirk}
          laeuft={bezirkAendernMut.isPending}
          fehler={bezirkAendernMut.error}
          onErfassen={(patch) =>
            bezirkAendernMut.mutateAsync({ bezirkId: dialog.bezirk.id, patch })
          }
          onSchliessen={schliessen}
        />
      )}
      {dialog?.art === 'stand' && (
        <StandMeldenDialog
          key={dialog.bezirk.id}
          bezirk={dialog.bezirk}
          laeuft={standMut.isPending}
          fehler={standMut.error}
          onErfassen={(body) => standMut.mutateAsync({ bezirkId: dialog.bezirk.id, body })}
          onSchliessen={schliessen}
        />
      )}
      {dialog?.art === 'bezirkStornieren' && (
        <StornierenDialog
          titel={`Bezirk ${dialog.bezirk.bezeichnung} stornieren?`}
          text="Stornieren ist für Fehlanlagen gedacht und lässt sich nicht rückgängig machen. Der Bezirk verschwindet aus der Liste und zählt in keiner Kennzahl mehr; der Nachweis im Einsatztagebuch bleibt. Eine aufgehobene Evakuierung wird stattdessen über „Räumung setzen“ erfasst."
          laeuft={bezirkStornierenMut.isPending}
          fehler={bezirkStornierenMut.error}
          onBestaetigen={() => bezirkStornierenMut.mutate(dialog.bezirk.id)}
          onSchliessen={schliessen}
        />
      )}
      {dialog?.art === 'stelleAnlegen' && (
        <StelleAnlegenDialog
          abschnitte={abschnitte}
          laeuft={stelleAnlegenMut.isPending}
          fehler={stelleAnlegenMut.error}
          onErfassen={(body) => stelleAnlegenMut.mutateAsync(body)}
          onSchliessen={schliessen}
        />
      )}
      {dialog?.art === 'stelleBearbeiten' && (
        <StelleBearbeitenDialog
          key={dialog.stelle.id}
          stelle={dialog.stelle}
          abschnitte={abschnitte}
          laeuft={stelleAendernMut.isPending || leermeldungMut.isPending}
          fehler={leermeldungMut.error ?? stelleAendernMut.error}
          onLeermeldung={() => leermeldungMut.mutateAsync(dialog.stelle.id)}
          onErfassen={(patch) =>
            stelleAendernMut.mutateAsync({ stelleId: dialog.stelle.id, patch })
          }
          onSchliessen={schliessen}
        />
      )}
      {dialog?.art === 'belegung' && (
        <BelegungMeldenDialog
          key={dialog.stelle.id}
          stelle={dialog.stelle}
          laeuft={belegungMut.isPending}
          fehler={belegungMut.error}
          onErfassen={(body) => belegungMut.mutateAsync({ stelleId: dialog.stelle.id, body })}
          onSchliessen={schliessen}
        />
      )}
      {dialog?.art === 'stelleStornieren' && (
        <StornierenDialog
          titel={`Betreuungsstelle ${dialog.stelle.bezeichnung} stornieren?`}
          text="Stornieren ist für Fehlanlagen gedacht und lässt sich nicht rückgängig machen. Die Stelle verschwindet aus der Liste und zählt in keiner Kopfzahl mehr; der Nachweis im Einsatztagebuch bleibt. Eine Stelle, die nur außer Betrieb geht, wird stattdessen geschlossen."
          laeuft={stelleStornierenMut.isPending}
          fehler={stelleStornierenMut.error}
          onBestaetigen={() => stelleStornierenMut.mutate(dialog.stelle.id)}
          onSchliessen={schliessen}
        />
      )}
    </EinsatzSeite>
  );
}
