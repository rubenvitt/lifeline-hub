import { Breadcrumb, Spin, Typography } from 'antd';
import dayjs from 'dayjs';
import { useEffect, useRef } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { lageberichtDetailPfad } from '../routing/deeplinks';
import { ladeEinsatz } from '../api/einsaetze';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { einsatzKeys } from '../api/queryKeys';
import { legeLageberichtAn, listeLageberichte, schreibeLageberichtFort } from '../api/lageberichte';
import type { LageberichtAbschnitt, LageberichtVorlageKey } from '../api/types';
import { anzahl } from '../anzeige/anzahl';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { useZeitEingabe } from '../anzeige/ZeitpunktEingabe';
import { SeitenHinweise } from '../components/SpeicherHinweis';
import {
  SeitenFehler,
  SeitenLeer,
  SeitenSkeleton,
  SeitenStandVeraltet,
} from '../components/SeitenZustand';
import { einsatzRechteGrund } from '../components/nurAnsicht';
import EinsatzSeite from '../components/EinsatzSeite';
import { modulName } from '../einsatz/modulRegistry';
import NeuerLagevortragKnopf, { VORGABE_VORLAGE } from '../lageberichte/NeuerLagevortragKnopf';
import LageberichtUebersicht from '../lageberichte/LageberichtUebersicht';
import { loadStartinhalt } from '../lageberichte/startinhalt';
import { hatNachfolger, teileUebersicht, titelVorschlag } from '../lageberichte/uebersicht';
import { zeitpunkt } from '../anzeige/zeitDarstellung';

/**
 * Lageberichte: Übersicht und Anlegen (LLH-1064).
 *
 * Die Übersicht beantwortet zuerst „was gilt?“ (jüngste Freigabe vorn), dann „was ist in Arbeit?“
 * und zuletzt „was galt früher?“ (`lageberichte/LageberichtUebersicht.tsx`, Ableitung in
 * `lageberichte/uebersicht.ts`).
 *
 * Anlegen ohne Dialog: „Neuer Lagevortrag“ legt mit EINEM POST einen Entwurf an und öffnet ihn;
 * Titel und Zeitstand ändert man dort. Der Pfeil am Knopf wählt eine andere Vorlage. Abgelehnt
 * steht der Grund im Seitenhinweis (LFH-1077), es wird nicht navigiert, und der Server legt nichts
 * an. `abschnitte` reicht einen Startinhalt in denselben POST (Spec `dokument-uebernahme`).
 *
 * Mit Lagebild (LLH-1081, Spec `lagevortrag-uebernahme`): der Klick lädt die Quellen der Vorlage
 * (`lageberichte/startinhalt.ts`) und schickt ihre Texte als Startinhalt im EINEN POST. Laden und
 * Anlegen sind eine Mutation: `loading` und der Riegel decken beides. „Leerer Lagevortrag“ lädt
 * nichts.
 */

interface Anlegen {
  einsatzId: number;
  vorlage: LageberichtVorlageKey;
  /** Startinhalt aus den Quellen der Vorlage laden; ohne ihn legt der Server das leere Skelett an. */
  ausLagebild: boolean;
}

export default function LageberichtePage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { formatiere } = useZeitEingabe();
  const { konventionen } = useAnzeigeKonventionen();

  // Der Einsatz, in dem die Seite gerade steht: eine Antwort aus einem verlassenen Einsatz
  // navigiert nicht und meldet nicht am neuen Ort (`frontend/AGENTS.md`, „Rückwege und Fehler“).
  const aktuellerEinsatz = useRef(einsatzId);
  const eingehaengt = useRef(true);
  // Riegel gegen den Doppelklick: zwischen Klick und Render der Ladeanzeige läge sonst ein
  // zweiter POST, und es entstünden zwei Entwürfe. Nach einem Erfolg bleibt er bis zum Wechsel
  // auf den Entwurf zu; ein Einsatzwechsel löst ihn.
  const sendetRef = useRef(false);
  useEffect(() => {
    aktuellerEinsatz.current = einsatzId;
    sendetRef.current = false;
  }, [einsatzId]);
  useEffect(() => {
    eingehaengt.current = true;
    return () => {
      eingehaengt.current = false;
    };
  }, []);

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const berichteQuery = useQuery({
    queryKey: einsatzKeys.lageberichte(einsatzId),
    queryFn: () => listeLageberichte(einsatzId),
  });

  const oeffne = (vars: { einsatzId: number }, neuId: number) => {
    void qc.invalidateQueries({ queryKey: einsatzKeys.lageberichte(vars.einsatzId) });
    if (eingehaengt.current && aktuellerEinsatz.current === vars.einsatzId) {
      void navigate(lageberichtDetailPfad(vars.einsatzId, neuId));
    } else {
      sendetRef.current = false;
    }
  };
  const loese = () => {
    sendetRef.current = false;
  };

  // Kein `onError`: der Grund steht im Seitenhinweis, bis zum nächsten Versuch.
  const anlegenMutation = useMutation({
    mutationFn: async (a: Anlegen) => {
      const titel = titelVorschlag(a.vorlage, dayjs(), formatiere);
      // Scheitert nicht: was fehlt, steht als „— (Grund)“ im Abschnitt.
      const abschnitte: LageberichtAbschnitt[] | undefined = a.ausLagebild
        ? await loadStartinhalt(a.vorlage, {
            qc,
            einsatzId: a.einsatzId,
            dtg: (iso) => zeitpunkt(iso, konventionen),
          })
        : undefined;
      return legeLageberichtAn(a.einsatzId, {
        vorlage: a.vorlage,
        titel,
        // Kein Zeitstand: der Server setzt jetzt (`routes/vorlagendokument.rs`).
        ...(abschnitte ? { abschnitte } : {}),
      });
    },
    onSuccess: (neu, vars) => oeffne(vars, neu.id),
  });
  const fortschreibenMutation = useMutation({
    mutationFn: (f: { einsatzId: number; id: number }) =>
      schreibeLageberichtFort(f.einsatzId, f.id),
    onSuccess: (neu, vars) => oeffne(vars, neu.id),
  });

  const lege = (vorlage: LageberichtVorlageKey, ausLagebild: boolean) => {
    if (sendetRef.current) return;
    sendetRef.current = true;
    fortschreibenMutation.reset();
    anlegenMutation.mutate({ einsatzId, vorlage, ausLagebild }, { onError: loese });
  };
  const schreibeFort = (berichtId: number) => {
    if (sendetRef.current) return;
    sendetRef.current = true;
    anlegenMutation.reset();
    fortschreibenMutation.mutate({ einsatzId, id: berichtId }, { onError: loese });
  };

  if (einsatzQuery.isLoading) {
    return (
      <div style={{ textAlign: 'center', paddingTop: 80 }}>
        <Spin size="large" />
      </div>
    );
  }
  if (einsatzQuery.isError || !einsatzQuery.data) {
    return (
      <Typography.Text type="danger">Einsatz nicht gefunden oder kein Zugriff.</Typography.Text>
    );
  }
  const einsatz = einsatzQuery.data;
  const darfSchreiben = darfImEinsatzSchreiben(einsatz);

  const berichte = berichteQuery.data ?? [];
  const uebersicht = teileUebersicht(berichte);

  // Nur der Grund aus DIESEM Einsatz; ein Wechsel räumt ihn so von selbst.
  const anlegenFehler =
    anlegenMutation.variables?.einsatzId === einsatzId ? anlegenMutation.error : null;
  const fortschreibenFehler =
    fortschreibenMutation.variables?.einsatzId === einsatzId ? fortschreibenMutation.error : null;

  const aktuell = uebersicht.aktuell;
  const fortschreiben =
    aktuell && darfSchreiben && !hatNachfolger(berichte, aktuell.id)
      ? {
          onKlick: () => schreibeFort(aktuell.id),
          laeuft: fortschreibenMutation.isPending,
        }
      : null;

  const inhalt = (() => {
    if (berichteQuery.isLoading) return <SeitenSkeleton />;
    if (berichteQuery.isError && !berichteQuery.data) {
      return (
        <SeitenFehler
          text="Lageberichte nicht abrufbar · Stand unbekannt"
          ursache={berichteQuery.error}
          onWiederholen={() => void berichteQuery.refetch()}
        />
      );
    }
    if (berichte.length === 0) {
      return (
        <SeitenLeer
          titel="Noch keine Lageberichte"
          aktion={
            darfSchreiben
              ? { label: 'Neuer Lagevortrag', onClick: () => lege(VORGABE_VORLAGE, true) }
              : undefined
          }
        />
      );
    }
    return (
      <>
        {berichteQuery.isError && (
          <SeitenStandVeraltet onWiederholen={() => void berichteQuery.refetch()} />
        )}
        <LageberichtUebersicht
          einsatzId={einsatzId}
          uebersicht={uebersicht}
          fortschreiben={fortschreiben}
        />
      </>
    );
  })();

  return (
    <EinsatzSeite
      titel={modulName('lageberichte')}
      meta={
        berichteQuery.data
          ? `${anzahl(berichte.length, 'Bericht', 'Berichte')} · ${uebersicht.inArbeit.length} in Arbeit`
          : undefined
      }
      dataUpdatedAt={berichteQuery.dataUpdatedAt}
      breadcrumb={
        <Breadcrumb
          items={[
            { title: <Link to="/einsaetze">Einsätze</Link> },
            { title: einsatz.bezeichnung },
            { title: modulName('lageberichte') },
          ]}
        />
      }
      aktionen={
        <NeuerLagevortragKnopf
          onAnlegen={lege}
          laeuft={anlegenMutation.isPending}
          gesperrt={!darfSchreiben || fortschreibenMutation.isPending}
        />
      }
      hinweis={
        <SeitenHinweise
          fehler={anlegenFehler ?? fortschreibenFehler}
          fehlerTitel={anlegenFehler ? 'Nicht angelegt' : 'Nicht fortgeschrieben'}
          fehlerFallback={anlegenFehler ? 'Anlegen fehlgeschlagen' : 'Fortschreiben fehlgeschlagen'}
          rechteFehlt={!darfSchreiben}
          rechteText={einsatzRechteGrund(einsatz.status)}
        />
      }
    >
      {inhalt}
    </EinsatzSeite>
  );
}
