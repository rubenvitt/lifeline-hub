import { App } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { listeAbschnitte } from '../api/einsatzabschnitte';
import { aendereBezirk, legeBezirkAn, nimmStandZurueck, storniereBezirk } from '../api/evakuierung';
import { einsatzKeys } from '../api/queryKeys';
import type {
  Evakuierungsbezirk,
  EvakuierungsbezirkEingabe,
  EvakuierungsbezirkPatch,
  StandmeldungEingabe,
} from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { zeigeRueckgaengig } from '../kommunikation/rueckgaengig';
import { erfasseStandOfflineFaehig } from '../offline/schreiben';
import { lagekartePfad } from '../routing/deeplinks';
import {
  BezirkAnlegenDialog,
  BezirkBearbeitenDialog,
  RaeumungDialog,
  StandMeldenDialog,
  StornierenDialog,
} from './BetreuungDialoge';
import type { BezirkAktion } from './BezirkTabelle';
import { personenZahl } from './betreuungText';

/**
 * Welcher Dialog offen ist — einer zur Zeit, jeder frisch montiert (`initialValues`). Der Datensatz
 * ist der Stand beim Öffnen und nur Rückfall, falls er aus dem Cache verschwindet (fremd
 * storniert); der Dialog bekommt den aktuellen.
 */
type Dialog =
  | { art: 'anlegen' }
  | { art: 'bearbeiten'; bezirk: Evakuierungsbezirk }
  | { art: 'raeumung'; bezirk: Evakuierungsbezirk }
  | { art: 'stand'; bezirk: Evakuierungsbezirk }
  | { art: 'stornieren'; bezirk: Evakuierungsbezirk };

export interface BezirkHandlungen {
  /**
   * Einstieg „Evakuierungsbezirk anlegen". Eigener Einstieg, damit das Anlegen mit Gebiet (Wahl
   * oder Zeichnung einer Fläche) hier einhängen kann, ohne die Seite umzubauen.
   */
  oeffneAnlegen: () => void;
  oeffneStand: (bezirk: Evakuierungsbezirk) => void;
  /** Menü einer Zeile (`BezirkTabelle`): Karte, Plangröße, Räumung, Stornieren. */
  bezirkAktion: (aktion: BezirkAktion, bezirk: Evakuierungsbezirk) => void;
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

  const oeffneAnlegen = useCallback(() => {
    resetAnlegen();
    setDialog({ art: 'anlegen' });
  }, [resetAnlegen]);
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
      if (aktion === 'stornieren') {
        resetStornieren();
        setDialog({ art: 'stornieren', bezirk });
        return;
      }
      resetAendern();
      setDialog({ art: aktion === 'raeumung' ? 'raeumung' : 'bearbeiten', bezirk });
    },
    [resetAendern, resetStornieren, navigate, einsatzId],
  );

  // Dialoge je Ziel frisch montiert: `initialValues` greift nur beim Einhängen, und der Speicher
  // von rc-field-form überlebt sonst ein Schließen.
  const dialoge = (
    <>
      {dialog?.art === 'anlegen' && (
        <BezirkAnlegenDialog
          abschnitte={abschnitte}
          laeuft={anlegenMut.isPending}
          fehler={anlegenMut.error}
          onErfassen={(body) => anlegenMut.mutateAsync(body)}
          onSchliessen={schliessen}
        />
      )}
      {dialog?.art === 'bearbeiten' && (
        <BezirkBearbeitenDialog
          key={dialog.bezirk.id}
          bezirk={aktuell(dialog.bezirk)}
          abschnitte={abschnitte}
          laeuft={aendernMut.isPending}
          fehler={aendernMut.error}
          onErfassen={(patch) => aendernMut.mutateAsync({ bezirkId: dialog.bezirk.id, patch })}
          onSchliessen={schliessen}
        />
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
    ruecknahmeFehler: zurueckMut.error,
    dialoge,
  };
}
