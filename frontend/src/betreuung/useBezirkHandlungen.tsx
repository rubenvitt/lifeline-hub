import { App, Modal, Typography } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { listeAbschnitte } from '../api/einsatzabschnitte';
import { aendereBezirk, legeBezirkAn, nimmStandZurueck, storniereBezirk } from '../api/evakuierung';
import { einsatzKeys } from '../api/queryKeys';
import type {
  Evakuierungsbezirk,
  EvakuierungsbezirkEingabe,
  EvakuierungsbezirkPatch,
  Raeumungszustand,
  StandmeldungEingabe,
} from '../api/types';
import { SpeicherFehler } from '../components/SpeicherHinweis';
import { useAuth } from '../auth/AuthContext';
import { zeigeRueckgaengig } from '../kommunikation/rueckgaengig';
import { erfasseStandOfflineFaehig } from '../offline/schreiben';
import { useSprungSperre } from '../einsatz/useSprungSperre';
import { lagekartePfad } from '../routing/deeplinks';
import { raeumungszustand } from '../theme/statusFarben';
import {
  BezirkAnlegenDialog,
  RaeumungDialog,
  StandMeldenDialog,
  StornierenDialog,
} from './BetreuungDialoge';
import type { BezirkAktion } from './BezirkTabelle';
import { personenZahl } from './betreuungText';
import { gebietZeichnenPfad } from './gebietZeichnen';

/**
 * Welcher Dialog offen ist — einer zur Zeit, jeder frisch montiert (`initialValues`). Der Datensatz
 * ist der Stand beim Öffnen und nur Rückfall, falls er aus dem Cache verschwindet (fremd
 * storniert); der Dialog bekommt den aktuellen.
 */
type Dialog =
  | { art: 'anlegen' }
  | { art: 'raeumung'; bezirk: Evakuierungsbezirk }
  | { art: 'aufheben'; bezirk: Evakuierungsbezirk }
  | { art: 'stand'; bezirk: Evakuierungsbezirk }
  | { art: 'stornieren'; bezirk: Evakuierungsbezirk };

export interface BezirkHandlungen {
  /**
   * Einstieg „Evakuierungsbezirk anlegen". Mit der Gebietswahl „Fläche zeichnen“ (LLH-1069) geht es
   * nach dem Anlegen auf die Lagekarte, im Zeichenmodus für eine Fläche des neuen Bezirks.
   */
  oeffneAnlegen: () => void;
  oeffneStand: (bezirk: Evakuierungsbezirk) => void;
  /** Menü einer Zeile (`BezirkTabelle`): Karte, Gebiet zeichnen, Räumung, Stornieren. */
  bezirkAktion: (aktion: BezirkAktion, bezirk: Evakuierungsbezirk) => void;
  /**
   * Ein Räumungsschritt der Detailseite (LLH-1076, design.md D3): `PATCH { raeumung }` gegen den
   * Live-Stand, ohne Dialog. „aufgehoben“ fragt vorher nach (Entscheidung im ETB, der Bezirk fällt
   * aus jeder Kennzahl).
   */
  setzeRaeumung: (bezirk: Evakuierungsbezirk, ziel: Raeumungszustand) => void;
  /** Ziel des laufenden Räumungsschritts (Ladezustand am Knopf), sonst `null`. */
  raeumungLaeuft: Raeumungszustand | null;
  /** Fehler des letzten Räumungsschritts ohne Dialog — gehört über die Seite. */
  raeumungFehler: unknown;
  /**
   * Stammdaten der Detailseite speichern (Bearbeiten in der Ansicht, design.md D6). Der Patch ist
   * schon dreiseitig gerechnet; ein leerer wird nicht gesendet. Lehnt bei Ablehnung ab.
   */
  speichereStammdaten: (bezirkId: number, patch: EvakuierungsbezirkPatch) => Promise<unknown>;
  /** Zustand des Speicherns; der Fehler steht am Formular, nicht über der Seite. */
  stammdaten: { laeuft: boolean; fehler: unknown; reset: () => void };
  /** Abschnitte des Einsatzes als Auswahl (nur mit Schreibrecht geladen). */
  abschnitte: readonly { value: number; label: string }[];
  /** Fehler einer Rücknahme aus dem Toast — gehört über die Seite (`SeitenHinweise`). */
  ruecknahmeFehler: unknown;
  /** Die offenen Dialoge; die Seite hängt sie EINMAL ein. */
  dialoge: ReactNode;
}

/**
 * Handlungen an Evakuierungsbezirken (LLH-1034): Mutationen, Dialogzustand und Dialoge in einem
 * Hook. Die Evakuierungsseite nutzt ihn, eine Detailseite eines Bezirks kann denselben nutzen —
 * Wortlaut der Toasts, Offline-Vormerkung und Rückweg stehen so nur einmal.
 *
 * Melden ohne Rückfrage, mit Rückweg: der Toast nimmt die `meldung_id` der gerade angelegten
 * Meldung — nie `bezirk.stand.id`: bei einer nachgetragenen, älteren Meldung ist der aktuelle
 * Stand eine andere, und „Rückgängig" nähme die falsche zurück.
 *
 * Fehler der Dialoge stehen im Dialog (`SpeicherFehler`), der einer Rücknahme (ohne Dialog) an
 * der Seite. Erfolg quittiert der Toast.
 *
 * Nach Anlegen, Räumung und Stornieren zusätzlich den Einsatz invalidieren: die Lagekennzahl
 * `evakuiert` kann kippen. Andere Schirme erfahren das über `einsatz` (LFH-855); der eigene Abruf
 * wirkt auch bei gestörtem Strom. Standmeldungen kippen sie nie.
 */
export function useBezirkHandlungen({
  einsatzId,
  bezirke,
  darfSchreiben,
}: {
  einsatzId: number;
  /** Aktueller Stand der Bezirke: ein Live-Refetch kommt bei offenem Dialog an. */
  bezirke: readonly Evakuierungsbezirk[];
  darfSchreiben: boolean;
}): BezirkHandlungen {
  const navigate = useNavigate();
  const { benutzer } = useAuth();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const schliessen = useCallback(() => setDialog(null), []);
  // Gebiet nach dem Anlegen (LLH-1069): die Lagekarte muss frei sein. Gesperrt steht die Wahl
  // „Fläche zeichnen“ im Dialog gesperrt mit Grund.
  const karteGesperrt = useSprungSperre(einsatzId)('lagekarte');
  /**
   * Der eben angelegte Bezirk, dessen Fläche gezeichnet werden soll — gesetzt nach dem Erfolg des
   * Anlegens, verbraucht beim Schließen des Dialogs. Ein Ref, weil die Erfassungs-Hülle den
   * Dialog erst nach `onErfassen` schließt; der Sprung kommt danach, nicht mitten im Absenden.
   */
  const zeichnenNachAnlegen = useRef<number | null>(null);

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
  const aktuell = (b: Evakuierungsbezirk) => bezirke.find((x) => x.id === b.id) ?? b;

  const invalidiere = useCallback(() => {
    void qc.invalidateQueries({ queryKey: einsatzKeys.evakuierung(einsatzId) });
    void qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
  }, [qc, einsatzId]);
  const invalidiereMitKennzahl = useCallback(() => {
    invalidiere();
    void qc.invalidateQueries({ queryKey: einsatzKeys.einsatz(einsatzId) });
  }, [invalidiere, qc, einsatzId]);

  const raeumungMut = useMutation({
    mutationFn: ({ bezirkId, ziel }: { bezirkId: number; ziel: Raeumungszustand }) =>
      aendereBezirk(einsatzId, bezirkId, { raeumung: ziel }),
    onSuccess: (b) => {
      invalidiereMitKennzahl();
      // Nur die eigene Rückfrage schließen: ein inzwischen geöffneter anderer Dialog bleibt.
      setDialog((d) => (d?.art === 'aufheben' ? null : d));
      message.success(`Räumung ${b.bezeichnung}: ${raeumungszustand[b.raeumung].label}`);
    },
  });
  const stammdatenMut = useMutation({
    mutationFn: ({ bezirkId, patch }: { bezirkId: number; patch: EvakuierungsbezirkPatch }) =>
      aendereBezirk(einsatzId, bezirkId, patch),
    onSuccess: (b) => {
      invalidiereMitKennzahl();
      message.success(`Bezirk ${b.bezeichnung} gespeichert`);
    },
  });
  const anlegenMut = useMutation({
    mutationFn: (body: EvakuierungsbezirkEingabe) => legeBezirkAn(einsatzId, body),
    onSuccess: (b) => {
      invalidiereMitKennzahl();
      message.success(`Evakuierungsbezirk ${b.bezeichnung} angelegt`);
    },
  });
  const aendernMut = useMutation({
    mutationFn: ({ bezirkId, patch }: { bezirkId: number; patch: EvakuierungsbezirkPatch }) =>
      aendereBezirk(einsatzId, bezirkId, patch),
    onSuccess: (b) => {
      invalidiereMitKennzahl();
      message.success(`Bezirk ${b.bezeichnung} gespeichert`);
    },
  });
  const stornierenMut = useMutation({
    mutationFn: (bezirkId: number) => storniereBezirk(einsatzId, bezirkId),
    onSuccess: (b) => {
      invalidiereMitKennzahl();
      setDialog(null);
      message.success(`Bezirk ${b.bezeichnung} storniert`);
    },
  });
  const zurueckMut = useMutation({
    mutationFn: (meldungId: number) => nimmStandZurueck(einsatzId, meldungId),
    onSuccess: (r) => {
      invalidiere();
      message.success(`Meldung zu ${r.bezirk.bezeichnung} zurückgenommen`);
    },
    onError: invalidiere,
  });
  const { reset: resetZurueck, mutate: zuruecknehmen } = zurueckMut;
  // Standmeldungen kommen vom Handschirm, oft ohne Netz: ohne Verbindung werden sie mit dem
  // Erfassungszeitpunkt vorgemerkt und später gesendet. „Vorgemerkt" ist ein Erfolg ohne Rückweg
  // (noch keine `meldung_id`); der Dialog schließt, weil der Wortlaut in IndexedDB liegt.
  const standMut = useMutation({
    // Die Funktion merkt ohne Netz selbst vor; TanStacks Vorgabe hielte die Mutation an
    // (LFH-705, design.md D6).
    networkMode: 'always',
    mutationFn: ({ bezirk, body }: { bezirk: Evakuierungsbezirk; body: StandmeldungEingabe }) => {
      if (!benutzer) throw new Error('Nicht angemeldet');
      return erfasseStandOfflineFaehig(benutzer.id, einsatzId, bezirk, body);
    },
    // Eine neue Meldung räumt den Fehler einer alten Rücknahme über der Seite.
    onMutate: () => resetZurueck(),
    onSuccess: (ergebnis, { bezirk, body }) => {
      if (ergebnis.zustand === 'vorgemerkt') {
        message.warning(`Offline vorgemerkt: Standmeldung ${bezirk.bezeichnung}`);
        return;
      }
      const r = ergebnis.daten;
      invalidiere();
      zeigeRueckgaengig(
        message,
        `Stand ${r.bezirk.bezeichnung} gemeldet: ${personenZahl(body.evakuiert)} evakuiert`,
        () => zuruecknehmen(r.meldung_id),
      );
    },
  });

  // ── Öffnen: jede Öffnung beginnt ohne den Fehler der letzten ──
  const { reset: resetAnlegen } = anlegenMut;
  const { reset: resetAendern } = aendernMut;
  const { reset: resetStornieren } = stornierenMut;
  const { reset: resetStand } = standMut;
  const { reset: resetRaeumung, mutate: raeumungSenden } = raeumungMut;
  const { mutateAsync: stammdatenSenden } = stammdatenMut;

  const oeffneAnlegen = useCallback(() => {
    resetAnlegen();
    zeichnenNachAnlegen.current = null;
    setDialog({ art: 'anlegen' });
  }, [resetAnlegen]);
  const schliesseAnlegen = useCallback(() => {
    const bezirkId = zeichnenNachAnlegen.current;
    zeichnenNachAnlegen.current = null;
    setDialog(null);
    if (bezirkId != null) navigate(gebietZeichnenPfad(einsatzId, bezirkId));
  }, [navigate, einsatzId]);
  const oeffneStand = useCallback(
    (bezirk: Evakuierungsbezirk) => {
      resetStand();
      setDialog({ art: 'stand', bezirk });
    },
    [resetStand],
  );
  const bezirkAktion = useCallback(
    (aktion: BezirkAktion, bezirk: Evakuierungsbezirk) => {
      // Sprung auf die Karte; dort wählt die Seite eine Fläche und räumt den Parameter.
      if (aktion === 'karte') {
        navigate(lagekartePfad(einsatzId, { evakuierungsbezirk: bezirk.id }));
        return;
      }
      // Zeichenmodus auf der Karte, Bezeichnung und Zuordnung vorbelegt (LLH-1069).
      if (aktion === 'zeichnen') {
        navigate(gebietZeichnenPfad(einsatzId, bezirk.id));
        return;
      }
      if (aktion === 'stornieren') {
        resetStornieren();
        setDialog({ art: 'stornieren', bezirk });
        return;
      }
      resetAendern();
      setDialog({ art: 'raeumung', bezirk });
    },
    [resetAendern, resetStornieren, navigate, einsatzId],
  );
  const setzeRaeumung = useCallback(
    (bezirk: Evakuierungsbezirk, ziel: Raeumungszustand) => {
      resetRaeumung();
      // Gegen den Live-Stand: ein Schritt in den Zustand, den der Bezirk schon trägt, sendet nichts.
      const jetzt = bezirke.find((x) => x.id === bezirk.id) ?? bezirk;
      if (jetzt.raeumung === ziel) return;
      if (ziel === 'aufgehoben') {
        setDialog({ art: 'aufheben', bezirk });
        return;
      }
      raeumungSenden({ bezirkId: bezirk.id, ziel });
    },
    [bezirke, resetRaeumung, raeumungSenden],
  );
  const speichereStammdaten = useCallback(
    (bezirkId: number, patch: EvakuierungsbezirkPatch) =>
      Object.keys(patch).length === 0 ? Promise.resolve() : stammdatenSenden({ bezirkId, patch }),
    [stammdatenSenden],
  );

  // Dialoge je Ziel frisch montiert: `initialValues` greift nur beim Einhängen, und der Speicher
  // von rc-field-form überlebt sonst ein Schließen.
  const dialoge = (
    <>
      {dialog?.art === 'anlegen' && (
        <BezirkAnlegenDialog
          abschnitte={abschnitte}
          karteGesperrt={karteGesperrt}
          laeuft={anlegenMut.isPending}
          fehler={anlegenMut.error}
          onErfassen={async (body, gebiet) => {
            const b = await anlegenMut.mutateAsync(body);
            zeichnenNachAnlegen.current = gebiet === 'flaeche' && !karteGesperrt ? b.id : null;
          }}
          onSchliessen={schliesseAnlegen}
        />
      )}
      {dialog?.art === 'aufheben' && (
        // Rückfrage als `<Modal>` außerhalb des Menüs, nicht `Popconfirm` (ein Menüetikett ist Text).
        // Der Fehler bleibt im Dialog, bis zum nächsten Versuch.
        <Modal
          open
          title={`Anordnung für Bezirk ${dialog.bezirk.bezeichnung} aufheben?`}
          okText="Anordnung aufheben"
          cancelText="Abbrechen"
          okButtonProps={{ danger: true }}
          confirmLoading={raeumungMut.isPending}
          onOk={() => raeumungSenden({ bezirkId: dialog.bezirk.id, ziel: 'aufgehoben' })}
          onCancel={() => {
            if (raeumungMut.isPending) return;
            resetRaeumung();
            schliessen();
          }}
          destroyOnHidden
        >
          <Typography.Paragraph>
            Der Bezirk zählt danach in keiner Kennzahl der Räumung mehr. Das Einsatztagebuch
            vermerkt die Entscheidung.
          </Typography.Paragraph>
          <SpeicherFehler fehler={raeumungMut.error} titel="Anordnung nicht aufgehoben" />
        </Modal>
      )}
      {dialog?.art === 'raeumung' && (
        <RaeumungDialog
          key={dialog.bezirk.id}
          bezirk={aktuell(dialog.bezirk)}
          laeuft={aendernMut.isPending}
          fehler={aendernMut.error}
          onErfassen={(patch) => aendernMut.mutateAsync({ bezirkId: dialog.bezirk.id, patch })}
          onSchliessen={schliessen}
        />
      )}
      {dialog?.art === 'stand' && (
        <StandMeldenDialog
          key={dialog.bezirk.id}
          bezirk={aktuell(dialog.bezirk)}
          laeuft={standMut.isPending}
          fehler={standMut.error}
          onErfassen={(body) => standMut.mutateAsync({ bezirk: dialog.bezirk, body })}
          onSchliessen={schliessen}
        />
      )}
      {dialog?.art === 'stornieren' && (
        <StornierenDialog
          titel={`Bezirk ${dialog.bezirk.bezeichnung} stornieren?`}
          text="Nur für Fehlanlagen. Nicht umkehrbar; der ETB-Nachweis bleibt."
          stattdessen={{
            text: 'Stattdessen Räumung setzen',
            onKlick: () => bezirkAktion('raeumung', dialog.bezirk),
          }}
          laeuft={stornierenMut.isPending}
          fehler={stornierenMut.error}
          onBestaetigen={() => stornierenMut.mutate(dialog.bezirk.id)}
          onSchliessen={schliessen}
        />
      )}
    </>
  );

  return {
    oeffneAnlegen,
    oeffneStand,
    bezirkAktion,
    setzeRaeumung,
    raeumungLaeuft: raeumungMut.isPending ? (raeumungMut.variables?.ziel ?? null) : null,
    // Im Rückfragedialog steht der Fehler dort, nicht zusätzlich über der Seite.
    raeumungFehler: dialog?.art === 'aufheben' ? null : raeumungMut.error,
    speichereStammdaten,
    stammdaten: {
      laeuft: stammdatenMut.isPending,
      fehler: stammdatenMut.error,
      reset: stammdatenMut.reset,
    },
    abschnitte,
    ruecknahmeFehler: zurueckMut.error,
    dialoge,
  };
}
