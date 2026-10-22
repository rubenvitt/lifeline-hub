import { App, Breadcrumb, Button } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router';
import {
  ladeBetreuung,
  legeStelleAn,
  nimmBelegungZurueck,
  storniereStelle,
} from '../api/betreuung';
import { ladeEinsatz } from '../api/einsaetze';
import { listeAbschnitte } from '../api/einsatzabschnitte';
import { einsatzKeys } from '../api/queryKeys';
import {
  betreuungPfad,
  betreuungsstellePfad,
  evakuierungPfad,
  lagekartePfad,
} from '../routing/deeplinks';
import type {
  BelegungsmeldungEingabe,
  Betreuungsstelle,
  BetreuungsstelleEingabe,
} from '../api/types';
import { useAuth } from '../auth/AuthContext';
import {
  BelegungMeldenDialog,
  StelleAnlegenDialog,
  StornierenDialog,
} from '../betreuung/BetreuungDialoge';
import { personenZahl, volleStellenSegment } from '../betreuung/betreuungText';
import StellenBlock, { type StelleAktion } from '../betreuung/StellenBlock';
import UnterbringungKennzahlen from '../betreuung/UnterbringungKennzahlen';
import EinsatzSeite from '../components/EinsatzSeite';
import {
  SeitenFehler,
  SeitenLeer,
  SeitenSkeleton,
  SeitenStandVeraltet,
} from '../components/SeitenZustand';
import { SeitenHinweise } from '../components/SpeicherHinweis';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { zeigeRueckgaengig } from '../kommunikation/rueckgaengig';
import { erfasseBelegungOfflineFaehig } from '../offline/schreiben';
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
  | { art: 'belegung'; stelle: Betreuungsstelle }
  | { art: 'stelleStornieren'; stelle: Betreuungsstelle };

/**
 * Fachmodul Betreuung (LFH-639): Übersicht der Betreuungsstellen und ihrer Belegung. Jede Stelle
 * hat seit LLH-1044 eine Detailseite (`BetreuungsstelleDetailPage`); dort stehen Bearbeiten und
 * Status. Ein alter Link `…/betreuung?stelle=<id>` leitet auf sie um. Die Evakuierungsbezirke
 * sind seit LLH-1034 das eigene Modul Evakuierung (`EvakuierungPage`); ein alter Link
 * `…/betreuung?bezirk=<id>` leitet dorthin um.
 *
 * Aufbau (LLH-1050, Lagebild der Unterbringung): Kopf mit genau einer Primäraktion
 * „Betreuungsstelle anlegen" und der Meta „n Stellen · n in Betrieb · n voll", darunter das Band
 * „Unterbringung in Zahlen" (`UnterbringungKennzahlen`), darunter die Tabelle — Tabelle, weil
 * verglichen wird („welche Stelle hat noch Platz?"). Ohne Stelle stehen statt Band und Tabelle
 * „Keine Betreuungsstellen" und der Knopf zum Anlegen (ohne Schreibrecht gesperrt mit Grund).
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
  // Ebenso vor jedem Abruf: `?stelle=` war die Adresse einer Stelle, bis sie eine eigene Seite
  // bekam (LLH-1044). Ein unlesbarer Wert führt auf die Übersicht ohne Parameter.
  const alteStelle = suche.get('stelle');
  if (alteStelle != null) {
    const stelle = Number(alteStelle);
    return (
      <Navigate
        replace
        to={
          Number.isInteger(stelle) && stelle > 0
            ? betreuungsstellePfad(einsatzId, stelle)
            : betreuungPfad(einsatzId)
        }
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
      resetStelleStornieren();
      setDialog({ art: 'stelleStornieren', stelle });
    },
    [resetStelleStornieren, navigate, einsatzId],
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
  const leer = !ladend && stellen.length === 0;
  const inBetrieb = stellen.filter((s) => s.status === 'in_betrieb').length;

  return (
    <EinsatzSeite
      titel={modulName('betreuung')}
      // „n voll" nur über 0 (LFH-678), „n in Betrieb" immer: auch 0 ist eine Aussage (LLH-1050).
      meta={
        betreuungQuery.data
          ? `${stellen.length === 1 ? '1 Stelle' : `${personenZahl(stellen.length)} Stellen`} · ${personenZahl(inBetrieb)} in Betrieb${volleStellenSegment(stellen)}`
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
      ) : leer ? (
        // Ohne Stelle keine Nullen: Band und leere Tabelle entfallen, der Knopf führt heraus.
        <>
          {veraltet && <SeitenStandVeraltet onWiederholen={() => void betreuungQuery.refetch()} />}
          <SeitenLeer
            titel="Keine Betreuungsstellen"
            aktion={{
              label: 'Betreuungsstelle anlegen',
              onClick: oeffneStelleAnlegen,
              gesperrt: darfSchreiben ? undefined : betreuungRechteText(einsatz.status),
            }}
          />
        </>
      ) : (
        <>
          {veraltet && <SeitenStandVeraltet onWiederholen={() => void betreuungQuery.refetch()} />}
          <UnterbringungKennzahlen
            stellen={stellen}
            namentlich={betreuungQuery.data?.namentlich}
            ladend={ladend}
          />
          <StellenBlock
            einsatzId={einsatzId}
            stellen={stellen}
            namentlich={betreuungQuery.data?.namentlich}
            ladend={ladend}
            darfSchreiben={darfSchreiben}
            onBelegungMelden={oeffneBelegung}
            onAktion={stelleAktion}
          />
        </>
      )}

      {/* Dialoge je Ziel frisch montiert: `initialValues` greift nur beim Einhängen, und der
          Speicher von rc-field-form überlebt sonst ein Schließen. */}
      {dialog?.art === 'stelleAnlegen' && (
        <StelleAnlegenDialog
          einsatzId={einsatzId}
          abschnitte={abschnitte}
          laeuft={stelleAnlegenMut.isPending}
          fehler={stelleAnlegenMut.error}
          onErfassen={(body) => stelleAnlegenMut.mutateAsync(body)}
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
          // Der umkehrbare Weg: Status steht auf der Detailseite der Stelle (LLH-1044).
          stattdessen={{
            text: 'Stattdessen Status setzen',
            onKlick: () => navigate(betreuungsstellePfad(einsatzId, dialog.stelle.id)),
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
