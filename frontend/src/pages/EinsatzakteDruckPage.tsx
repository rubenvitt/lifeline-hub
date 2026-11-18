import { useMemo, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Alert, Breadcrumb, Button, Typography, theme } from 'antd';
import { ApiError } from '../api/client';
import { dokumentAnlageDateiPfad, type AnlagenDokument } from '../api/dokumentAnlagen';
import { ladeEinsatz, ladeModulFreigaben } from '../api/einsaetze';
import { einsatzKeys } from '../api/queryKeys';
import type { DokumentAnlage, Einsatzart } from '../api/types';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { vorlage as befehlVorlage } from '../befehle/vorlagen';
import EinsatzSeite from '../components/EinsatzSeite';
import { SeitenFehler, SeitenSackgasse, SeitenSkeleton } from '../components/SeitenZustand';
import Druckkopf, { druckEinsatzName } from '../components/druck/Druckkopf';
import DruckKnopf from '../components/druck/DruckKnopf';
import { DRUCK_ABFRAGE } from '../druck/abfrageOptionen';
import Bloecke from '../druck/einsatzbericht/Bloecke';
import { verdichteEinsatzbericht } from '../druck/einsatzbericht/verdichtung';
import { akteZustand, ladeEinsatzakte, type DokumentMitAnlagen } from '../druck/einsatzakte/abruf';
import AuftragsListe from '../druck/einsatzakte/AuftragsListe';
import {
  AKTE_BERICHT_BLOECKE,
  KAPITEL,
  akteFreigabe,
  type KapitelSchluessel,
} from '../druck/einsatzakte/quellen';
import AbschnittsText from '../entwurf/AbschnittsText';
import { DokumentAnlagenBlaetter } from '../entwurf/DokumentAnlagen';
import { verteilerNames } from '../entwurf/verteilerKern';
import { isUebung } from '../einsatz/einsatzart';
import EtbDruckTabelle from '../etb/EtbDruckTabelle';
import LageberichtText from '../lageberichte/LageberichtText';
import PersonenDruckTabelle from '../personen/PersonenDruckTabelle';
import { einsatzakteZipPfad, einsatzdatenPfad } from '../routing/deeplinks';

/**
 * Druckansicht der Einsatzakte (LLH-1835, `openspec/changes/archive/2026-11-18-hsdhm2ki-einsatzakte/`): das ganze
 * Einsatzgeschehen als EIN Druckstück, Kapitel für Kapitel mit eigenem Druckkopf, gespeichert
 * über „Als PDF speichern“ im Druckdialog. Daneben das ZIP mit Anhängen und Tabellen.
 *
 * Vollständig oder gar nicht wie der Einsatzbericht: `akteFreigabe` entscheidet VOR dem Abruf,
 * ein gesperrtes Modul führt in die Sackgasse; ein 403 im Abruf ist „kein Zugriff“, ein Fehler
 * sperrt das Drucken bis zum gelungenen neuen Versuch.
 *
 * Schnappschuss: `einsatzKeys.einsatzakteDruck` ist nicht live, „Neu laden“ holt einen neuen
 * Stand. Die Betroffenen kommen protokolliert über `…/personen/druck` — deshalb `DRUCK_ABFRAGE`
 * (kein Retry, beim Öffnen frisch, offline ein Fehler) und `gcTime: 0`.
 */
export default function EinsatzakteDruckPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const navigate = useNavigate();
  const { konventionen, zeitpunkt } = useAnzeigeKonventionen();

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const freigabenQuery = useQuery({
    queryKey: einsatzKeys.modulFreigaben(einsatzId),
    queryFn: () => ladeModulFreigaben(einsatzId),
  });
  const freigaben = freigabenQuery.data;
  const freigabe = useMemo(() => (freigaben ? akteFreigabe(freigaben) : null), [freigaben]);
  const gesperrt = freigabe != null && freigabe.gesperrteModule.length > 0;

  const akteQuery = useQuery({
    queryKey: einsatzKeys.einsatzakteDruck(einsatzId),
    queryFn: () => ladeEinsatzakte(einsatzId, freigaben!, freigabe!),
    enabled: freigabe != null && !gesperrt,
    ...DRUCK_ABFRAGE,
    gcTime: 0,
  });

  const roh = akteQuery.data;
  const zustand = roh ? akteZustand(roh) : null;
  const bericht = useMemo(
    () =>
      roh && zustand?.art === 'bereit'
        ? verdichteEinsatzbericht(roh.bericht, konventionen, AKTE_BERICHT_BLOECKE)
        : null,
    [roh, zustand?.art, konventionen],
  );

  if (einsatzQuery.isLoading) return <SeitenSkeleton />;
  if (einsatzQuery.error instanceof ApiError && einsatzQuery.error.status === 403) {
    return (
      <SeitenSackgasse
        titel="Einsatzakte nicht verfügbar"
        hinweis="Kein Zugriff oder Aufbewahrungsfrist abgelaufen"
        rueckweg={{ pfad: '/einsaetze', label: 'Zur Einsatzliste' }}
      />
    );
  }
  if (einsatzQuery.isError || !einsatzQuery.data) {
    return (
      <SeitenFehler
        text="Einsatz nicht gefunden oder kein Zugriff"
        onWiederholen={() => void einsatzQuery.refetch()}
      />
    );
  }
  const einsatz = einsatzQuery.data;
  const zurueck = einsatzdatenPfad(einsatzId);
  const keinZugriff = gesperrt || zustand?.art === 'kein-zugriff';
  const laedt = !roh || akteQuery.isFetching;
  const bereit = !laedt && zustand?.art === 'bereit' && bericht != null;

  let inhalt: ReactNode;
  if (freigabenQuery.isError) {
    inhalt = (
      <SeitenFehler
        text="Freigaben des Einsatzes nicht ermittelbar"
        ursache={freigabenQuery.error}
        onWiederholen={() => void freigabenQuery.refetch()}
      />
    );
  } else if (!freigabe) {
    inhalt = <SeitenSkeleton />;
  } else if (gesperrt) {
    inhalt = (
      <SeitenSackgasse
        titel="Einsatzakte nicht verfügbar"
        hinweis={`Kein Zugriff: ${freigabe.gesperrteModule.join(', ')}`}
        rueckweg={{ pfad: zurueck, label: 'Zu den Einsatzdaten' }}
      />
    );
  } else if (akteQuery.isError) {
    inhalt = (
      <SeitenFehler
        text="Die Einsatzakte konnte nicht geladen werden"
        ursache={akteQuery.error}
        onWiederholen={() => void akteQuery.refetch()}
      />
    );
  } else if (laedt) {
    inhalt = (
      <Typography.Text role="status" aria-live="polite">
        Einsatzakte wird geladen …
      </Typography.Text>
    );
  } else if (zustand?.art === 'kein-zugriff') {
    inhalt = (
      <Alert
        type="info"
        showIcon
        title="Kein Zugriff auf die Einsatzakte"
        description={`Gesperrt: ${zustand.module.join(', ')}`}
      />
    );
  } else if (zustand?.art === 'fehler') {
    inhalt = (
      <Alert
        type="error"
        showIcon
        title="Die Einsatzakte konnte nicht vollständig geladen werden"
        description={`Nicht geladen: ${zustand.module.join(', ')}`}
        action={<Button onClick={() => void akteQuery.refetch()}>Erneut laden</Button>}
      />
    );
  } else if (roh && bericht) {
    const einsatzStand =
      roh.bericht.quellen.einsatz.zustand === 'daten' ? roh.bericht.quellen.einsatz.daten : einsatz;
    const kopfZeilen = [
      { etikett: 'Stand', wert: zeitpunkt(roh.geladenAt) },
      ...(bericht.vorlaeufig ? [{ etikett: 'Status', wert: 'Vorläufig – Einsatz läuft' }] : []),
    ];
    const kapitelKopf = (titel: string, zusatz: { etikett: string; wert: string }[] = []) => (
      <Druckkopf
        dokumentart={titel}
        einsatz={einsatzStand}
        sichtbarkeit="immer"
        ebene={2}
        zeilen={[...zusatz, ...kopfZeilen]}
      />
    );
    const uhsNamen = new Map(
      roh.betroffene.zustand === 'daten'
        ? roh.betroffene.daten.uhs.map((u) => [u.id, u.bezeichnung] as const)
        : [],
    );
    const inhaltJe: Record<KapitelSchluessel, () => ReactNode> = {
      bericht: () => (
        <>
          {kapitelKopf('Einsatzbericht', [{ etikett: 'Umfang', wert: 'Alle Blöcke und Anlagen' }])}
          <Bloecke bericht={bericht} />
        </>
      ),
      etb: () =>
        roh.etb.zustand === 'daten' ? (
          <>
            {kapitelKopf('Einsatztagebuch', [
              { etikett: 'Umfang', wert: `${roh.etb.daten.eintraege.length} Einträge` },
            ])}
            {roh.etb.daten.eintraege.length === 0 ? (
              <Vermerk text="keine Einträge" />
            ) : (
              <EtbDruckTabelle
                laufzeile={`Einsatztagebuch · ${druckEinsatzName(einsatzStand)} · Stand ${zeitpunkt(roh.geladenAt)}`}
                eintraege={roh.etb.daten.eintraege}
                berichtigungen={roh.etb.daten.berichtigungen}
                konventionen={konventionen}
              />
            )}
          </>
        ) : (
          <NichtGenutzt kopf={kapitelKopf('Einsatztagebuch')} />
        ),
      betroffene: () =>
        roh.betroffene.zustand === 'daten' ? (
          <>
            {kapitelKopf('Betroffene', [
              { etikett: 'Umfang', wert: `${roh.betroffene.daten.personen.length} Personen` },
              { etikett: 'Hinweis', wert: 'Personenbezogene Daten' },
            ])}
            {roh.betroffene.daten.personen.length === 0 ? (
              <Vermerk text="keine Einträge" />
            ) : (
              <PersonenDruckTabelle
                personen={roh.betroffene.daten.personen}
                uhsName={(uhsId) => uhsNamen.get(uhsId)}
                konventionen={konventionen}
              />
            )}
          </>
        ) : (
          <NichtGenutzt kopf={kapitelKopf('Betroffene')} />
        ),
      auftraege: () =>
        roh.auftraege.zustand === 'daten' ? (
          <>
            {kapitelKopf('Aufträge', [
              { etikett: 'Umfang', wert: `${roh.auftraege.daten.length} Aufträge` },
            ])}
            {roh.auftraege.daten.length === 0 ? (
              <Vermerk text="keine Einträge" />
            ) : (
              <AuftragsListe auftraege={roh.auftraege.daten} />
            )}
          </>
        ) : (
          <NichtGenutzt kopf={kapitelKopf('Aufträge')} />
        ),
      befehle: () =>
        roh.befehle.zustand === 'daten' ? (
          <Dokumente
            kopf={kapitelKopf('Einsatzbefehle', [
              { etikett: 'Umfang', wert: `${roh.befehle.daten.length} freigegeben` },
            ])}
            art="befehle"
            einsatzId={einsatzId}
            einsatzart={einsatzStand.einsatzart}
            eintraege={roh.befehle.daten}
            text={(b) => (
              <AbschnittsText
                gliederung={befehlVorlage(b.vorlage)?.abschnitte ?? []}
                abschnitte={b.abschnitte}
                unterEbene={3}
              />
            )}
          />
        ) : (
          <NichtGenutzt kopf={kapitelKopf('Einsatzbefehle')} />
        ),
      lageberichte: () =>
        roh.lageberichte.zustand === 'daten' ? (
          <Dokumente
            kopf={kapitelKopf('Lageberichte', [
              { etikett: 'Umfang', wert: `${roh.lageberichte.daten.length} freigegeben` },
            ])}
            art="lageberichte"
            einsatzId={einsatzId}
            einsatzart={einsatzStand.einsatzart}
            eintraege={roh.lageberichte.daten}
            text={(b) => <LageberichtText bericht={b} unterEbene={3} />}
          />
        ) : (
          <NichtGenutzt kopf={kapitelKopf('Lageberichte')} />
        ),
    };
    inhalt = (
      <div data-lfh="druckwurzel">
        {KAPITEL.map((k) => (
          <section key={k.schluessel} data-lfh="druck-kapitel" data-kapitel={k.schluessel}>
            {inhaltJe[k.schluessel]()}
          </section>
        ))}
      </div>
    );
  }

  return (
    <EinsatzSeite
      titel="Einsatzakte – Druckansicht"
      breadcrumb={
        <Breadcrumb
          items={[
            { title: <Link to="/einsaetze">Einsätze</Link> },
            { title: einsatz.bezeichnung },
            { title: <Link to={zurueck}>Einsatzdaten</Link> },
            { title: 'Einsatzakte' },
          ]}
        />
      }
      aktionen={
        <>
          <Button
            href={zurueck}
            onClick={(e) => {
              // Ein Link mit Knopfgestalt: Strg/⌘+Klick öffnet den neuen Tab wie jeder Link.
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
              e.preventDefault();
              navigate(zurueck);
            }}
          >
            Zurück zu den Einsatzdaten
          </Button>
          {freigabe && !keinZugriff && (
            <Button onClick={() => void akteQuery.refetch()} disabled={akteQuery.isFetching}>
              Neu laden
            </Button>
          )}
          {freigabe && !keinZugriff && bereit && (
            // Ein Link, kein Blob im Speicher (design.md D8): das ZIP kann groß sein, der Browser
            // lädt es selbst herunter. Die Rechte prüft der Server.
            <Button href={einsatzakteZipPfad(einsatzId)} download>
              Anhänge und Tabellen (ZIP)
            </Button>
          )}
          {freigabe && !keinZugriff && <DruckKnopf typ="primary" gesperrt={!bereit} />}
        </>
      }
    >
      {inhalt}
    </EinsatzSeite>
  );
}

function Vermerk({ text }: { text: string }) {
  const { token } = theme.useToken();
  return (
    <Typography.Paragraph style={{ marginBlockStart: token.margin }}>{text}</Typography.Paragraph>
  );
}

function NichtGenutzt({ kopf }: { kopf: ReactNode }) {
  return (
    <>
      {kopf}
      <Vermerk text="nicht genutzt" />
    </>
  );
}

interface DokumentKopf {
  id: number;
  titel: string;
  version: number;
  zeitstand: string;
  freigegeben_at?: string | null;
  verteiler?: Parameters<typeof verteilerNames>[0];
}

/** Befehle oder Lageberichte: je Dokument Titel, Stand, Text und die Blätter seiner Anlagen. */
function Dokumente<D extends DokumentKopf>({
  kopf,
  art,
  einsatzId,
  einsatzart,
  eintraege,
  text,
}: {
  kopf: ReactNode;
  art: AnlagenDokument;
  einsatzId: number;
  einsatzart?: Einsatzart | null;
  eintraege: readonly DokumentMitAnlagen<D>[];
  text: (dokument: D) => ReactNode;
}) {
  const { token } = theme.useToken();
  const { zeitpunkt } = useAnzeigeKonventionen();
  const uebung = isUebung({ einsatzart });
  return (
    <>
      {kopf}
      {eintraege.length === 0 && <Vermerk text="keine Einträge" />}
      {eintraege.map(({ dokument: d, anlagen }) => {
        const verteiler = verteilerNames(d.verteiler);
        return (
          <article key={d.id} style={{ marginBlockStart: token.marginLG }}>
            <div data-lfh="titelblock">
              <Typography.Title level={3}>
                {d.titel} (Version {d.version})
              </Typography.Title>
              <Typography.Paragraph type="secondary">
                Zeitstand {zeitpunkt(d.zeitstand)}
                {d.freigegeben_at ? ` · freigegeben ${zeitpunkt(d.freigegeben_at)}` : ''}
                {verteiler.length > 0 ? ` · Verteiler: ${verteiler.join(', ')}` : ''}
              </Typography.Paragraph>
            </div>
            {text(d)}
            <DokumentAnlagenBlaetter
              anlagen={anlagen}
              pfad={(a: DokumentAnlage) => dokumentAnlageDateiPfad(art, einsatzId, d.id, a.id)}
              uebung={uebung}
            />
          </article>
        );
      })}
    </>
  );
}
