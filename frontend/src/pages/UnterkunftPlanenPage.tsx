import { App, Breadcrumb, Button, Space, Typography } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type CSSProperties } from 'react';
import { Link, useParams } from 'react-router';
import { aendereStelle, ladeBetreuung } from '../api/betreuung';
import { ladeEinsatz } from '../api/einsaetze';
import { einsatzKeys } from '../api/queryKeys';
import ErgebnisAnzeige, { menge } from '../betreuung/unterkunft/ErgebnisAnzeige';
import GrundlageEingabe, { leereEingabe } from '../betreuung/unterkunft/GrundlageEingabe';
import NachforderungenDialog, { type Lauf } from '../betreuung/unterkunft/NachforderungenDialog';
import RichtwerteListe from '../betreuung/unterkunft/RichtwerteListe';
import { postenAus } from '../betreuung/unterkunft/posten';
import { rechne, type Eingabe } from '../betreuung/unterkunft/rechnerKern';
import { useRechnerRichtwerte } from '../betreuung/unterkunft/useRechnerRichtwerte';
import EinsatzSeite from '../components/EinsatzSeite';
import {
  Paneel,
  Segmentleiste,
  Stapel,
  useRollen,
  type SegmentOption,
} from '../components/instrument';
import { einsatzRechteGrund } from '../components/nurAnsicht';
import { SeitenFehler, SeitenSkeleton } from '../components/SeitenZustand';
import StelleNichtGefunden from '../betreuung/StelleNichtGefunden';
import { SeitenHinweise } from '../components/SpeicherHinweis';
import { KEINE_BERECHTIGUNG, istKeyFreigegeben, modulName } from '../einsatz/modulRegistry';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { useModulFreigaben } from '../einsatz/useSprungSperre';
import { useOhneVerbindung } from '../offline/verbindung';
import { betreuungPfad, betreuungsstellePfad, parseRouteId } from '../routing/deeplinks';
import { Marke } from '../components/instrument/Marke';
import { ListenRueckweg } from '../components/ListenRueckweg';
import { useAdressWert } from '../routing/useAdressWert';

type Ansicht = 'rechner' | 'richtwerte';
/** Werte von `?ansicht=` (LLH-1826); exhaustiv, Vorgabe `rechner`. */
const ANSICHT_ERLAUBT: Record<Ansicht, true> = { rechner: true, richtwerte: true };

const ANSICHTEN: readonly SegmentOption<Ansicht>[] = [
  { wert: 'rechner', label: 'Rechner' },
  { wert: 'richtwerte', label: 'Richtwerte' },
];

/** Gesperrte Gründe, in wenigen Wörtern (UI-Texte erklären keine Bedienung, LFH-1078). */
export const OHNE_NETZ = 'ohne Netz';
export const NUR_AUS_FLAECHE = 'nur aus Räumen, Fläche oder Zelten';
export const ENTSPRICHT_KAPAZITAET = 'entspricht der Kapazität';
export const KEINE_PLAETZE = 'keine Plätze';

/**
 * Grund, warum „Kapazität übernehmen“ gesperrt ist, oder `null` (Spec `unterkunftsrechner`,
 * „Rechner an der Betreuungsstelle“). Rein, für den Test exportiert.
 */
export function kapazitaetGesperrt(o: {
  weg: Eingabe['weg'];
  plaetze: number;
  kapazitaet: number | null;
  darfSchreiben: boolean;
  rechteGrund: string;
  ohneNetz: boolean;
}): string | null {
  if (o.weg === 'personen') return NUR_AUS_FLAECHE;
  if (!o.darfSchreiben) return o.rechteGrund;
  if (o.ohneNetz) return OHNE_NETZ;
  if (o.plaetze <= 0) return KEINE_PLAETZE;
  if (o.plaetze === o.kapazitaet) return ENTSPRICHT_KAPAZITAET;
  return null;
}

/**
 * „Unterkunft planen“ an einer Betreuungsstelle (LLH-1520, Spec `unterkunftsrechner`, design.md
 * D4–D6): Grundlage links, Ergebnis rechts, Reiter mit den wirksamen Richtwerten. Gerechnet wird
 * im Browser (`betreuung/unterkunft/rechnerKern.ts`), also auch ohne Netz; die Eingaben leben nur
 * auf der Seite. „Kapazität übernehmen“ setzt die Kapazität der Stelle, „Nachforderungen anlegen“
 * legt je Posten eine Nachforderung mit Bezug zur Stelle an. Belegung, „in Betreuung“ und
 * Verpflegungsbedarf bleiben unberührt.
 */
export default function UnterkunftPlanenPage() {
  const { id, stelleId: stelleParam } = useParams();
  const einsatzId = Number(id);
  const stelleId = parseRouteId(stelleParam);
  // Eine Stelle, die es nicht (mehr) gibt, zeigt das Muster, die Adresse bleibt (LLH-1827).
  if (stelleId == null) return <StelleNichtGefunden einsatzId={einsatzId} />;
  return <Inhalt einsatzId={einsatzId} stelleId={stelleId} />;
}

function Inhalt({ einsatzId, stelleId }: { einsatzId: number; stelleId: number }) {
  const { message } = App.useApp();
  const { token } = useRollen();
  const qc = useQueryClient();
  const ohneNetz = useOhneVerbindung();
  const freigaben = useModulFreigaben(einsatzId);
  // Die Ansicht ist Zustand der Adresse (LLH-1826): sie überlebt Weg und Zurück.
  const [ansicht, setAnsicht] = useAdressWert('ansicht', ANSICHT_ERLAUBT, 'rechner');
  const [eingabe, setEingabe] = useState<Eingabe>(() => leereEingabe('raeume'));
  const [dialog, setDialog] = useState(false);
  // Idempotenzschlüssel der Posten über das Schließen des Dialogs hinaus (LLH-1526).
  const [clientIds] = useState(() => new Map<string, string>());

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const betreuungQuery = useQuery({
    queryKey: einsatzKeys.betreuung(einsatzId),
    queryFn: () => ladeBetreuung(einsatzId),
  });
  const { richtwerte, ebenen, quelle } = useRechnerRichtwerte(einsatzId);
  const ergebnis = useMemo(() => rechne(eingabe, richtwerte), [eingabe, richtwerte]);

  const kapazitaetMut = useMutation({
    mutationFn: (plaetze: number) =>
      aendereStelle(einsatzId, stelleId, { kapazitaet_personen: plaetze }),
    onSuccess: (s) => {
      void qc.invalidateQueries({ queryKey: einsatzKeys.betreuung(einsatzId) });
      void qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
      message.success(`Kapazität ${s.bezeichnung}: ${menge(s.kapazitaet_personen ?? 0)} Plätze`);
    },
  });

  if (einsatzQuery.isLoading || betreuungQuery.isLoading) return <SeitenSkeleton />;
  if (einsatzQuery.isError || !einsatzQuery.data) {
    return (
      <SeitenFehler
        text="Einsatz nicht gefunden oder kein Zugriff"
        ursache={einsatzQuery.error}
        onWiederholen={() => void einsatzQuery.refetch()}
      />
    );
  }
  const stelle = betreuungQuery.data?.stellen.find((s) => s.id === stelleId);
  if (betreuungQuery.data && !stelle) return <StelleNichtGefunden einsatzId={einsatzId} />;
  if (!stelle) {
    return (
      <SeitenFehler
        text="Betreuungsstelle konnte nicht geladen werden"
        ursache={betreuungQuery.error}
        onWiederholen={() => void betreuungQuery.refetch()}
      />
    );
  }

  const einsatz = einsatzQuery.data;
  const darfSchreiben = darfImEinsatzSchreiben(einsatz);
  const rechteGrund = einsatzRechteGrund(einsatz);
  const kapGrund = kapazitaetGesperrt({
    weg: eingabe.weg,
    plaetze: ergebnis.personen,
    kapazitaet: stelle.kapazitaet_personen ?? null,
    darfSchreiben,
    rechteGrund,
    ohneNetz,
  });
  const posten = postenAus(ergebnis);
  const nfFrei = istKeyFreigegeben('nachforderungen', freigaben);
  const nfGrund = !nfFrei
    ? KEINE_BERECHTIGUNG
    : !darfSchreiben
      ? rechteGrund
      : ohneNetz
        ? OHNE_NETZ
        : posten.length === 0
          ? 'kein Bedarf'
          : null;

  const zurueck = betreuungsstellePfad(einsatzId, stelleId);
  const spalten: CSSProperties = {
    display: 'grid',
    gap: token.marginLG,
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 360px), 1fr))',
    alignItems: 'start',
  };

  const aktionen = (
    <Space wrap size="middle">
      <Space size="small">
        <Button
          type="primary"
          disabled={kapGrund != null}
          loading={kapazitaetMut.isPending}
          onClick={() => kapazitaetMut.mutate(ergebnis.personen)}
        >
          {kapGrund == null
            ? `Kapazität übernehmen · ${menge(ergebnis.personen)} Plätze`
            : 'Kapazität übernehmen'}
        </Button>
        {kapGrund && <Typography.Text type="secondary">{kapGrund}</Typography.Text>}
      </Space>
      <Space size="small">
        <Button disabled={nfGrund != null} onClick={() => setDialog(true)}>
          Nachforderungen anlegen
        </Button>
        {nfGrund && <Typography.Text type="secondary">{nfGrund}</Typography.Text>}
      </Space>
    </Space>
  );

  return (
    <EinsatzSeite
      titel={
        <Stapel als="span" richtung="zeile" umbruch abstand="sm" ausrichten="mitte">
          <span>Unterkunft planen</span>
          {quelle === 'basis' && <Marke>Basiswerte</Marke>}
        </Stapel>
      }
      meta={
        stelle.kapazitaet_personen != null
          ? `Kapazität ${menge(stelle.kapazitaet_personen)}`
          : undefined
      }
      breadcrumb={
        <Breadcrumb
          items={[
            { title: <Link to="/einsaetze">Einsätze</Link> },
            { title: einsatz.bezeichnung },
            {
              title: (
                <ListenRueckweg to={betreuungPfad(einsatzId)}>
                  {modulName('betreuung')}
                </ListenRueckweg>
              ),
            },
            { title: <ListenRueckweg to={zurueck}>{stelle.bezeichnung}</ListenRueckweg> },
            { title: 'Unterkunft planen' },
          ]}
        />
      }
      aktionen={aktionen}
      hinweis={
        <SeitenHinweise
          rechteFehlt={!darfSchreiben}
          rechteText={rechteGrund}
          fehler={kapazitaetMut.error}
          fehlerTitel="Kapazität nicht übernommen"
        />
      }
    >
      <Space orientation="vertical" size="large" style={{ width: '100%' }}>
        <Segmentleiste<Ansicht>
          beschriftung="Ansicht"
          rolle="tablist"
          optionen={ANSICHTEN}
          wert={ansicht}
          onWechsel={setAnsicht}
        />
        {ansicht === 'rechner' ? (
          <div style={spalten}>
            <Paneel titel="Grundlage" koerperPolster>
              <GrundlageEingabe eingabe={eingabe} onAendern={setEingabe} />
            </Paneel>
            <ErgebnisAnzeige ergebnis={ergebnis} richtwerte={richtwerte} />
          </div>
        ) : (
          <RichtwerteListe ebenen={ebenen} ebene="anzeige" />
        )}
      </Space>

      {dialog && (
        <NachforderungenDialog
          einsatzId={einsatzId}
          stelleId={stelleId}
          stelleName={stelle.bezeichnung}
          posten={posten}
          clientIds={clientIds}
          onFertig={(lauf: Lauf) => {
            void qc.invalidateQueries({ queryKey: einsatzKeys.nachforderungen(einsatzId) });
            const n = lauf.angelegt.length;
            message.success(
              `${n === 1 ? '1 Nachforderung' : `${n} Nachforderungen`} für ${stelle.bezeichnung} angelegt`,
            );
          }}
          onSchliessen={() => setDialog(false)}
        />
      )}
    </EinsatzSeite>
  );
}
