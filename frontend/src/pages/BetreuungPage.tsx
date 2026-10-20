import { App, Breadcrumb, Button } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router';
import {
  aendereStelle,
  ladeBetreuung,
  legeStelleAn,
  meldeBelegung,
  nimmBelegungZurueck,
  storniereStelle,
} from '../api/betreuung';
import { ladeEinsatz } from '../api/einsaetze';
import { listeAbschnitte } from '../api/einsatzabschnitte';
import { einsatzKeys } from '../api/queryKeys';
import { evakuierungPfad, lagekartePfad } from '../routing/deeplinks';
import type {
  BelegungsmeldungEingabe,
  Betreuungsstelle,
  BetreuungsstelleEingabe,
  BetreuungsstellePatch,
} from '../api/types';
import { useAuth } from '../auth/AuthContext';
import {
  BelegungMeldenDialog,
  StelleAnlegenDialog,
  StelleBearbeitenDialog,
  StornierenDialog,
} from '../betreuung/BetreuungDialoge';
import { personenZahl, volleStellenSegment } from '../betreuung/betreuungText';
import StellenBlock, { type StelleAktion } from '../betreuung/StellenBlock';
import { scrolleZurZeile } from '../components/Datensicht';
import EinsatzSeite from '../components/EinsatzSeite';
import { SeitenFehler, SeitenSkeleton, SeitenStandVeraltet } from '../components/SeitenZustand';
import { SeitenHinweise } from '../components/SpeicherHinweis';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { zeigeRueckgaengig } from '../kommunikation/rueckgaengig';
import { erfasseBelegungOfflineFaehig } from '../offline/schreiben';
import { useQueryParamSelektion } from '../routing/useQueryParamSelektion';
import { einsatzRechteGrund } from '../components/nurAnsicht';
import { modulName } from '../einsatz/modulRegistry';

/** Grund der fehlenden Schreibberechtigung (`components/nurAnsicht.ts`). */
const betreuungRechteText = einsatzRechteGrund;

/**
 * Welcher Dialog offen ist — einer zur Zeit, jeder frisch montiert (`initialValues`). Der Datensatz
 * ist der Stand beim Öffnen und nur Rückfall, falls er aus dem Cache verschwindet (fremd
 * storniert); der Dialog bekommt den aktuellen.
 */
type Dialog =
  | { art: 'stelleAnlegen' }
  | { art: 'stelleBearbeiten'; stelle: Betreuungsstelle }
  | { art: 'belegung'; stelle: Betreuungsstelle }
  | { art: 'stelleStornieren'; stelle: Betreuungsstelle };

/**
 * Fachmodul Betreuung (LFH-639): Betreuungsstellen und ihre Belegung, eine Route, keine
 * Detailroute. Die Evakuierungsbezirke sind seit LLH-1034 das eigene Modul Evakuierung
 * (`EvakuierungPage`); ein alter Link `…/betreuung?bezirk=<id>` leitet dorthin um.
 *
 * Tabelle, weil verglichen wird („welche Stelle hat noch Platz?"). Kopf: genau eine Primäraktion,
 * „Betreuungsstelle anlegen".
 *
 * Melden ohne Rückfrage, mit Rückweg: die Belegung hat eine serverseitige Rücknahme. Der Toast
 * nimmt die `meldung_id` der gerade angelegten Meldung.
 *
 * Fehler der Dialoge stehen im Dialog (`SpeicherFehler`), die einer Rücknahme (ohne Dialog) an der
 * Seite (`SeitenHinweise`). Erfolg quittiert der Toast.
 *
 * Live: alle Mutationen und das `betreuung`-Ereignis invalidieren `einsatzKeys.betreuung`. Fremd
 * angelegte Zeilen erscheinen über das Sammelbanner der `Datensicht`, solange der Fokus in einer
 * Sicht liegt.
 */
export default function BetreuungPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const [suche] = useSearchParams();
  const alterBezirk = suche.get('bezirk');
  // Vor jedem Abruf: ein alter Link auf einen Bezirk gehört seit LLH-1034 zur Evakuierung.
  if (alterBezirk != null) {
    const bezirk = Number(alterBezirk);
    return (
      <Navigate
        replace
        to={evakuierungPfad(einsatzId, Number.isInteger(bezirk) ? { bezirk } : {})}
      />
    );
  }
  return <BetreuungInhalt einsatzId={einsatzId} />;
}

function BetreuungInhalt({ einsatzId }: { einsatzId: number }) {
  const navigate = useNavigate();
  const { benutzer } = useAuth();
  const { message } = App.useApp();
  const qc = useQueryClient();

  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [hervorgehoben, setHervorgehoben] = useState<number | null>(null);
  const schliessen = useCallback(() => setDialog(null), []);

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const betreuungQuery = useQuery({
    queryKey: einsatzKeys.betreuung(einsatzId),
    queryFn: () => ladeBetreuung(einsatzId),
  });
  const darfSchreiben = einsatzQuery.data ? darfImEinsatzSchreiben(einsatzQuery.data) : false;
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

  const stellen = useMemo(() => betreuungQuery.data?.stellen ?? [], [betreuungQuery.data]);
  // Ein Live-Refetch kommt bei offenem Dialog an; die Dialoge rechnen gegen diesen Stand.
  const aktuelleStelle = (s: Betreuungsstelle) => stellen.find((x) => x.id === s.id) ?? s;

  // Cross-Modul-Deeplink: `?stelle=` hebt die Zeile hervor.
  useQueryParamSelektion('stelle', betreuungQuery.isSuccess, (sid) => {
    if (stellen.some((s) => s.id === sid)) setHervorgehoben(sid);
  });
  useEffect(() => {
    if (hervorgehoben == null) return;
    scrolleZurZeile(`stelle-${hervorgehoben}`);
  }, [hervorgehoben]);

  const invalidiere = useCallback(() => {
    void qc.invalidateQueries({ queryKey: einsatzKeys.betreuung(einsatzId) });
    void qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
  }, [qc, einsatzId]);
  const belegungZurueckMut = useMutation({
    mutationFn: (meldungId: number) => nimmBelegungZurueck(einsatzId, meldungId),
    onSuccess: (r) => {
      invalidiere();
      message.success(`Meldung zu ${r.stelle.bezeichnung} zurückgenommen`);
    },
    onError: invalidiere,
  });
  // Der Fehler einer Rücknahme steht über der Seite. Ohne Räumen bliebe er dort stehen (die
  // Rücknahme startet aus dem Toast, ein erneutes Absenden gibt es nicht); jede neue Meldung räumt
  // ihn deshalb.
  const { reset: resetBelegungZurueck, mutate: belegungZuruecknehmen } = belegungZurueckMut;
  // ── Betreuungsstellen ──
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
  // Die Leermeldung vor dem Schließen: eigene Mutation ohne Rückgängig-Toast — sie ist Teil des
  // Schließens, ein Rückweg auf die 0 ließe eine geschlossene, belegte Stelle zu (der Server lehnt
  // das mit 422 ab).
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
    // Die Funktion merkt ohne Netz selbst vor; TanStacks Vorgabe hielte die Mutation an
    // (LFH-705, design.md D6).
    networkMode: 'always',
    mutationFn: ({ stelle, body }: { stelle: Betreuungsstelle; body: BelegungsmeldungEingabe }) => {
      if (!benutzer) throw new Error('Nicht angemeldet');
      return erfasseBelegungOfflineFaehig(benutzer.id, einsatzId, stelle, body);
    },
    onMutate: () => resetBelegungZurueck(),
    onSuccess: (ergebnis, { stelle, body }) => {
      if (ergebnis.zustand === 'vorgemerkt') {
        message.warning(`Offline vorgemerkt: Belegungsmeldung ${stelle.bezeichnung}`);
        return;
      }
      const r = ergebnis.daten;
      invalidiere();
      zeigeRueckgaengig(
        message,
        `Belegung ${r.stelle.bezeichnung} gemeldet: ${personenZahl(body.belegt)} untergebracht`,
        () => belegungZuruecknehmen(r.meldung_id),
      );
    },
  });

  // ── Öffnen: jede Öffnung beginnt ohne den Fehler der letzten ──
  const { reset: resetStelleAnlegen } = stelleAnlegenMut;
  const { reset: resetStelleAendern } = stelleAendernMut;
  const { reset: resetLeermeldung } = leermeldungMut;
  const { reset: resetStelleStornieren } = stelleStornierenMut;
  const { reset: resetBelegung } = belegungMut;

  const oeffneStelleAnlegen = useCallback(() => {
    resetStelleAnlegen();
    setDialog({ art: 'stelleAnlegen' });
  }, [resetStelleAnlegen]);
  const oeffneBelegung = useCallback(
    (stelle: Betreuungsstelle) => {
      resetBelegung();
      setDialog({ art: 'belegung', stelle });
    },
    [resetBelegung],
  );
  const stelleAktion = useCallback(
    (aktion: StelleAktion, stelle: Betreuungsstelle) => {
      // Sprung in den Platziermodus der Lagekarte; dort räumt die Karte den Auftrag. Mit Herkunft
      // führt „Zurück zu …“ danach hierher (LLH-1125).
      if (aktion === 'verorten') {
        navigate(
          lagekartePfad(einsatzId, {
            platzieren: { typ: 'betreuungsstelle', id: stelle.id, zurueck: true },
          }),
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

  // Fehler ist nicht leer: ohne Daten tritt der Fehler an die Stelle der Blöcke, mit Daten bleiben
  // sie stehen und bekommen ein Banner.
  const gescheitert = betreuungQuery.isError && betreuungQuery.data == null;
  const veraltet = betreuungQuery.isError && betreuungQuery.data != null;
  const ladend = betreuungQuery.isLoading;

  return (
    <EinsatzSeite
      titel={modulName('betreuung')}
      // „n voll" auch im Seitenkopf: er steht bei langen Tabellen als einzige Zeile über der Falz.
      meta={
        betreuungQuery.data
          ? `${stellen.length} ${stellen.length === 1 ? 'Betreuungsstelle' : 'Betreuungsstellen'}${volleStellenSegment(stellen)}`
          : undefined
      }
      dataUpdatedAt={betreuungQuery.dataUpdatedAt}
      breadcrumb={
        <Breadcrumb
          items={[
            { title: <Link to="/einsaetze">Einsätze</Link> },
            { title: einsatz.bezeichnung },
            { title: modulName('betreuung') },
          ]}
        />
      }
      // Gesperrt statt versteckt: der Hinweis darunter nennt den Grund.
      aktionen={
        <Button type="primary" disabled={!darfSchreiben} onClick={oeffneStelleAnlegen}>
          Betreuungsstelle anlegen
        </Button>
      }
      neueZeile={darfSchreiben ? oeffneStelleAnlegen : undefined}
      hinweis={
        <SeitenHinweise
          rechteFehlt={!darfSchreiben}
          rechteText={betreuungRechteText(einsatz.status)}
          fehler={belegungZurueckMut.error}
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
          <StellenBlock
            einsatzId={einsatzId}
            stellen={stellen}
            namentlich={betreuungQuery.data?.namentlich}
            ladend={ladend}
            darfSchreiben={darfSchreiben}
            hervorgehoben={hervorgehoben}
            onBelegungMelden={oeffneBelegung}
            onAktion={stelleAktion}
          />
        </>
      )}

      {/* Dialoge je Ziel frisch montiert: `initialValues` greift nur beim Einhängen, und der
          Speicher von rc-field-form überlebt sonst ein Schließen. */}
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
          stelle={aktuelleStelle(dialog.stelle)}
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
          stelle={aktuelleStelle(dialog.stelle)}
          laeuft={belegungMut.isPending}
          fehler={belegungMut.error}
          onErfassen={(body) => belegungMut.mutateAsync({ stelle: dialog.stelle, body })}
          onSchliessen={schliessen}
        />
      )}
      {dialog?.art === 'stelleStornieren' && (
        <StornierenDialog
          titel={`Betreuungsstelle ${dialog.stelle.bezeichnung} stornieren?`}
          text="Nur für Fehlanlagen. Nicht umkehrbar; der ETB-Nachweis bleibt."
          stattdessen={{
            text: 'Stattdessen Status setzen',
            onKlick: () => stelleAktion('bearbeiten', dialog.stelle),
          }}
          laeuft={stelleStornierenMut.isPending}
          fehler={stelleStornierenMut.error}
          onBestaetigen={() => stelleStornierenMut.mutate(dialog.stelle.id)}
          onSchliessen={schliessen}
        />
      )}
    </EinsatzSeite>
  );
}
