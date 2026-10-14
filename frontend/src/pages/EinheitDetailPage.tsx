import { App, Breadcrumb } from 'antd';
import EinsatzSeite from '../components/EinsatzSeite';
import { Paneel, useRollen } from '../components/instrument';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ladeEinsatz } from '../api/einsaetze';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { useModulFreigaben } from '../einsatz/useSprungSperre';
import KraftZeitachse from '../kraefte/KraftZeitachse';
import { listeEinheitTypen } from '../api/einheitTypen';
import { listeAbschnitte } from '../api/einsatzabschnitte';
import { listeEinsatzPersonal } from '../api/einsatzPersonal';
import { listeEinsatzFahrzeuge } from '../api/einsatzFahrzeuge';
import { listEinsatzMaterial } from '../api/einsatzMaterial';
import {
  listeEinheiten,
  loeseEinheitAuf,
  patchEinheitZeichen,
  patcheEinheit,
  setzeEinheitStatus,
  type EinheitPatch,
  type EinheitZeichenPatch,
} from '../api/einheiten';
import { ladeOrganisation } from '../api/organisation';
import { einsatzKeys, globalKeys } from '../api/queryKeys';
import type { Einheit, EinsatzAnzeige } from '../api/types';
import StaerkeAnzeige from '../anzeige/StaerkeAnzeige';
import { gemeinsamerDatenstand } from '../components/Datenstand';
import { einheitenPfad, parseRouteId } from '../routing/deeplinks';
import { SeitenFehler, SeitenLeer, SeitenSkeleton } from '../components/SeitenZustand';
import { buildEinheitRechte } from './einheit/einheitAnsichtKern';
import EinheitKopf from './einheit/EinheitKopf';
import EinheitFunk from './einheit/EinheitFunk';
import EinheitZeichenPaneel from './einheit/EinheitZeichenPaneel';
import EinheitAufloesen from './einheit/EinheitAufloesen';
import EinheitMaterial from './einheit/EinheitMaterial';
import FahrzeugeBesatzung from './einheit/FahrzeugeBesatzung';
import ZuordnenAuswahl from './einheit/ZuordnenAuswahl';

/**
 * Vollseiten-Ansicht einer Einheit (LFH-339, seit LLH-1036 Spec `einheit-ansicht`): eigene Route,
 * deeplink-würdig. Jede Angabe wird an ihrem Wert geändert und schickt genau ihr Feld
 * (`frontend/AGENTS.md`, „Inline-Bearbeitung und Status“); es gibt kein Formular und keine
 * Speichern-Leiste mehr, also auch keinen Vollersatz, der fremde Änderungen überschriebe.
 *
 * Die Seite lädt die Einheit und reicht sie an {@link EinheitAnsicht} mit `key={einheitId}`: der
 * Wechsel zu einer anderen Einheit baut den Inhalt neu, und kein Grund einer abgelehnten Zeile
 * und keine offene Eingabe gehört dann noch zur vorigen.
 */
export default function EinheitDetailPage() {
  const { id, einheitId: einheitIdParam } = useParams();
  const einsatzId = Number(id);
  const einheitId = Number(einheitIdParam);
  const idGueltig = parseRouteId(einheitIdParam) != null;
  const navigate = useNavigate();

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
    enabled: idGueltig,
  });
  const einheitenQuery = useQuery({
    queryKey: einsatzKeys.einheiten(einsatzId),
    queryFn: () => listeEinheiten(einsatzId),
    enabled: idGueltig,
  });
  const einheiten = useMemo(() => einheitenQuery.data ?? [], [einheitenQuery.data]);
  const aktuell = einheiten.find((e) => e.id === einheitId) ?? null;

  // Ungültige Route-ID führt zurück zur Liste.
  if (!idGueltig) return <Navigate to={einheitenPfad(einsatzId)} replace />;

  if (einsatzQuery.isLoading || einheitenQuery.isLoading) return <SeitenSkeleton />;
  if (einsatzQuery.isError || !einsatzQuery.data) {
    return (
      <SeitenFehler
        text="Einsatz nicht gefunden oder kein Zugriff"
        ursache={einsatzQuery.error}
        onWiederholen={() => void einsatzQuery.refetch()}
      />
    );
  }
  if (einheitenQuery.isError) {
    return (
      <SeitenFehler
        text="Gliederung konnte nicht geladen werden"
        ursache={einheitenQuery.error}
        onWiederholen={() => void einheitenQuery.refetch()}
      />
    );
  }

  /**
   * Die Liste kam an, die Einheit ist nicht darin (aufgelöst oder erfundene ID). Ein anderer Fall
   * als „Abruf gescheitert" und deshalb ein eigener Wortlaut samt Weg zurück.
   */
  if (!aktuell) {
    return (
      <SeitenLeer
        titel="Diese Einheit gibt es nicht (mehr)"
        aktion={{ label: 'Zur Gliederung', onClick: () => void navigate(einheitenPfad(einsatzId)) }}
      />
    );
  }

  return (
    <EinheitAnsicht
      key={einheitId}
      einsatzId={einsatzId}
      einsatz={einsatzQuery.data}
      einheit={aktuell}
      einheiten={einheiten}
      einheitenStand={einheitenQuery.dataUpdatedAt}
    />
  );
}

interface EinheitAnsichtProps {
  einsatzId: number;
  einsatz: EinsatzAnzeige;
  einheit: Einheit;
  einheiten: readonly Einheit[];
  /** `dataUpdatedAt` der Einheitenliste, für den gemeinsamen Datenstand. */
  einheitenStand: number;
}

/**
 * Der Inhalt einer geladenen Einheit in der Reihenfolge von design.md D2: Kopf, Fahrzeuge und
 * Besatzung (mit „Person zuordnen …“ und „Fahrzeug zuordnen …“), Zeitachse, Material, Funk und
 * Kommunikation, Taktisches Zeichen, zuletzt abgesetzt „Einheit auflösen“. Was bedienbar ist, sagt allein `buildEinheitRechte` (D6).
 */
function EinheitAnsicht({
  einsatzId,
  einsatz,
  einheit: aktuell,
  einheiten,
  einheitenStand,
}: EinheitAnsichtProps) {
  const einheitId = aktuell.id;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const { token } = useRollen();
  const darfSchreiben = darfImEinsatzSchreiben(einsatz);
  const freigaben = useModulFreigaben(einsatzId);
  const rechte = buildEinheitRechte(darfSchreiben, freigaben);

  const typenQuery = useQuery({ queryKey: globalKeys.einheitTypen(), queryFn: listeEinheitTypen });
  const abschnitteQuery = useQuery({
    queryKey: einsatzKeys.abschnitte(einsatzId),
    queryFn: () => listeAbschnitte(einsatzId),
  });
  /*
   * Die Listen nur mit Freigabe ihres Moduls (D5): ein gesperrtes Modul erzeugt keinen 403-Abruf.
   * Gefragt wird erst, wenn die Freigaben da sind; „unbekannt heißt offen“ gilt für Bedienelemente,
   * nicht für Abrufe.
   */
  const freigabenDa = freigaben != null;
  const personalQuery = useQuery({
    queryKey: einsatzKeys.personal(einsatzId),
    queryFn: () => listeEinsatzPersonal(einsatzId),
    enabled: freigabenDa && rechte.hasPersonalLink,
  });
  const fahrzeugeQuery = useQuery({
    queryKey: einsatzKeys.fahrzeuge(einsatzId),
    queryFn: () => listeEinsatzFahrzeuge(einsatzId),
    enabled: freigabenDa && rechte.hasFahrzeugLink,
  });
  const materialQuery = useQuery({
    queryKey: einsatzKeys.material(einsatzId),
    queryFn: () => listEinsatzMaterial(einsatzId),
    enabled: freigabenDa && rechte.hasMaterialListe,
  });
  // Die Vorgabe der Organisation füllt ein Zeichen ohne eigene Organisation, wie auf der Karte.
  const orgQuery = useQuery({ queryKey: globalKeys.organisation(), queryFn: ladeOrganisation });
  const orgDefault = orgQuery.data?.tz_organisation ?? null;

  function invalidate() {
    qc.invalidateQueries({ queryKey: einsatzKeys.einheiten(einsatzId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.personal(einsatzId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.fahrzeuge(einsatzId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.material(einsatzId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
  }
  /**
   * Die Antwort eines Schreibwegs ist die ganze Einheit: sie steht sofort im Cache, damit die Zeile
   * nach dem Speichern den neuen Wert zeigt und nicht kurz den alten bis zum Neuladen.
   */
  function setInCache(neu: Einheit) {
    qc.setQueryData<Einheit[]>(einsatzKeys.einheiten(einsatzId), (alt) =>
      alt?.map((x) => (x.id === neu.id ? neu : x)),
    );
  }

  /*
   * Eine Zeile, ein Feld (D1). Die Ablehnung steht an der Zeile (InlineAngabe), kein Toast
   * (LFH-1077); der Erfolg nennt die Angabe. Der Server schreibt einen Wechsel des
   * Einheitsführers und der Abschnittszuordnung ins Tagebuch, deshalb auch `etb`.
   */
  const patch = useMutation({
    mutationFn: (v: { etikett: string; patch: EinheitPatch }) =>
      patcheEinheit(einsatzId, einheitId, v.patch),
    onSuccess: (neu, v) => {
      setInCache(neu);
      qc.invalidateQueries({ queryKey: einsatzKeys.einheiten(einsatzId) });
      qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
      message.success(`${v.etikett} gespeichert`);
    },
  });
  // Das Zeichen geht über den Lageweg, ohne Tagebuch-Eintrag (D4).
  const patchZeichen = useMutation({
    mutationFn: (v: { etikett: string; patch: EinheitZeichenPatch }) =>
      patchEinheitZeichen(einsatzId, einheitId, v.patch),
    onSuccess: (neu, v) => {
      setInCache(neu);
      qc.invalidateQueries({ queryKey: einsatzKeys.einheiten(einsatzId) });
      message.success(`${v.etikett} gespeichert`);
    },
  });
  const handStatus = useMutation({
    mutationFn: (statusId: number | null) => setzeEinheitStatus(einsatzId, einheitId, statusId),
    onSuccess: (neu) => {
      setInCache(neu);
      qc.invalidateQueries({ queryKey: einsatzKeys.einheiten(einsatzId) });
      message.success('Status gespeichert');
    },
    // Lehnt der Server ab (etwa weil inzwischen ein Fahrzeug zugeordnet ist), holt die Seite den
    // Stand, der die Ablehnung erklärt.
    onError: () => qc.invalidateQueries({ queryKey: einsatzKeys.einheiten(einsatzId) }),
  });
  const aufloesen = useMutation({
    mutationFn: () => loeseEinheitAuf(einsatzId, einheitId),
    // Zurück zur Gliederung: die Einheit ist aufgelöst (oder ohne Spur gelöscht) und steht nur noch
    // im Block „Aufgelöst“ (LLH-1079). Aus dem Cache fällt sie sofort, sonst zeigte die Gliederung
    // sie bis zum Neuladen noch als aktiv.
    onSuccess: () => {
      void navigate(einheitenPfad(einsatzId));
      qc.setQueryData<Einheit[]>(einsatzKeys.einheiten(einsatzId), (alt) =>
        alt?.filter((x) => x.id !== einheitId),
      );
      invalidate();
    },
  });

  /** „Als Einheitsführer“ im Menü einer Person: derselbe Weg wie die Kopfzeile (D1). */
  const setFuehrer = (epId: number) =>
    patch.mutateAsync({ etikett: 'Einheitsführer', patch: { fuehrer_id: epId } });

  return (
    <EinsatzSeite
      breadcrumb={
        <Breadcrumb
          items={[
            { title: <Link to="/einsaetze">Einsätze</Link> },
            { title: einsatz.bezeichnung },
            { title: <Link to={einheitenPfad(einsatzId)}>Einheiten</Link> },
            { title: aktuell.name },
          ]}
        />
      }
      titel={aktuell.name}
      // Typ und Stärke im Mono-Meta des Seitenkopfs. Soll nur, wenn gesetzt — eine erfundene
      // Soll-Stärke wäre eine Behauptung.
      meta={
        <>
          {aktuell.typ_label && <>{aktuell.typ_label} · </>}
          Ist <StaerkeAnzeige wert={aktuell.ist} />
          {aktuell.soll ? (
            <>
              {' '}
              · Soll <StaerkeAnzeige wert={aktuell.soll} />
            </>
          ) : null}
        </>
      }
      /* Der älteste erfolgreiche Stand über alle dargestellten Bestände, nicht der jüngste:
         sonst behauptete der Datenstand Aktualität für ältere Zahlen. */
      dataUpdatedAt={gemeinsamerDatenstand(
        einheitenStand,
        abschnitteQuery.dataUpdatedAt,
        personalQuery.dataUpdatedAt,
        fahrzeugeQuery.dataUpdatedAt,
        materialQuery.dataUpdatedAt,
      )}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: token.margin }}>
        <EinheitKopf
          einheit={aktuell}
          einheiten={einheiten}
          typen={typenQuery}
          abschnitte={abschnitteQuery}
          canEdit={rechte.canEditEinheit}
          orgDefault={orgDefault}
          onPatch={(etikett, p) => patch.mutateAsync({ etikett, patch: p })}
          onSetHandStatus={(statusId) => handStatus.mutateAsync(statusId)}
        />

        {/* Jede Handlung hier wirkt mit dem Klick: die Zeile erscheint, wandert oder
            verschwindet, das quittiert ohne Satz (LFH-1078). */}
        <FahrzeugeBesatzung
          einsatzId={einsatzId}
          einheit={aktuell}
          einheiten={einheiten}
          personal={rechte.hasBesatzung ? personalQuery.data : undefined}
          fahrzeuge={rechte.hasBesatzung ? fahrzeugeQuery.data : undefined}
          rechte={rechte}
          listenZustand={
            personalQuery.isError || fahrzeugeQuery.isError
              ? 'fehler'
              : personalQuery.data && fahrzeugeQuery.data
                ? 'daten'
                : 'laden'
          }
          onNeuladen={() => {
            void personalQuery.refetch();
            void fahrzeugeQuery.refetch();
          }}
          onSetFuehrer={setFuehrer}
        >
          {/* Erst mit den Freigaben: die Auswahl fragt den Stamm nur mit Freigabe ab, und ein
              Feld, das kurz offen und dann gesperrt stünde, spränge unter dem Zeiger. */}
          {freigabenDa && (
            <>
              <ZuordnenAuswahl
                art="personal"
                einsatzId={einsatzId}
                einheitId={einheitId}
                rechte={rechte}
                einsatzListe={personalQuery}
              />
              <ZuordnenAuswahl
                art="fahrzeug"
                einsatzId={einsatzId}
                einheitId={einheitId}
                rechte={rechte}
                einsatzListe={fahrzeugeQuery}
              />
            </>
          )}
        </FahrzeugeBesatzung>

        {/* Kräfte-Zeitachse (LFH-552): Einsatzdauer und Ereignisse der Einheit; ein Nachtrag
            gilt per Fan-out auch für ihre Personen. */}
        <Paneel titel="Zeitachse" koerperPolster>
          <KraftZeitachse
            einsatzId={einsatzId}
            art="einheit"
            id={einheitId}
            kennung={aktuell.name}
            darfSchreiben={darfSchreiben}
          />
        </Paneel>

        <EinheitMaterial
          einsatzId={einsatzId}
          einheit={aktuell}
          rechte={rechte}
          materialListe={materialQuery}
        />

        <EinheitFunk
          einheit={aktuell}
          einsatzId={einsatzId}
          canEdit={rechte.canEditEinheit}
          onPatch={(etikett, p) => patch.mutateAsync({ etikett, patch: p })}
        />

        <EinheitZeichenPaneel
          einheit={aktuell}
          canEdit={rechte.canEditEinheit}
          orgDefault={orgDefault}
          onPatchZeichen={(etikett, p) => patchZeichen.mutateAsync({ etikett, patch: p })}
        />

        {rechte.canEditEinheit && <EinheitAufloesen onAufloesen={() => aufloesen.mutateAsync()} />}
      </div>
    </EinsatzSeite>
  );
}
