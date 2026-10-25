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
  listAufgeloesteEinheiten,
  listeEinheiten,
  loeseEinheitAuf,
  patchEinheitZeichen,
  patcheEinheit,
  setzeEinheitStatus,
  storniereUebernahme,
  type EinheitPatch,
  type EinheitZeichenPatch,
} from '../api/einheiten';
import { ladeOrganisation } from '../api/organisation';
import { einsatzKeys, globalKeys } from '../api/queryKeys';
import type { Einheit, EinsatzAnzeige } from '../api/types';
import StaerkeAnzeige from '../anzeige/StaerkeAnzeige';
import { gemeinsamerDatenstand } from '../components/Datenstand';
import { GewanderteGruende } from '../components/GewanderteGruende';
import { einheitenPfad, nachforderungenPfad, parseRouteId } from '../routing/deeplinks';
import { istKeyFreigegeben } from '../einsatz/modulRegistry';
import { SeitenFehler, SeitenLeer, SeitenSkeleton } from '../components/SeitenZustand';
import {
  buildBesatzungMittel,
  buildEinheitRechte,
  visibleBesatzungRows,
} from './einheit/einheitAnsichtKern';
import EinheitKopf from './einheit/EinheitKopf';
import EinheitFunk from './einheit/EinheitFunk';
import EinheitZeichenPaneel from './einheit/EinheitZeichenPaneel';
import EinheitAufgeloestAnsicht from './einheit/EinheitAufgeloestAnsicht';
import EinheitAufloesen from './einheit/EinheitAufloesen';
import EinheitUebernahme from './einheit/EinheitUebernahme';
import EinheitUebernahmeStorno from './einheit/EinheitUebernahmeStorno';
import EinheitMaterial from './einheit/EinheitMaterial';
import FahrzeugeBesatzung from './einheit/FahrzeugeBesatzung';
import { useBesatzungErrors } from './einheit/useBesatzungErrors';
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
 *
 * Steht die Einheit nicht unter den aktiven, fragt die Seite die aufgelösten und zeigt eine
 * gefundene nur lesend (LLH-1266, `EinheitAufgeloestAnsicht`). Wird die geöffnete Einheit
 * anderswo aufgelöst, verliert die aktive Liste sie, und die Seite fällt von selbst dorthin.
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
  // Die aufgelösten erst, wenn die aktive Liste da ist und die Einheit nicht nennt (LLH-1266).
  // Immer frisch: die Gliederung hält sie im Cache, vielleicht noch aus der Zeit, als diese
  // Einheit aktiv war.
  const aufgeloesteQuery = useQuery({
    queryKey: einsatzKeys.einheitenAufgeloeste(einsatzId),
    queryFn: () => listAufgeloesteEinheiten(einsatzId),
    enabled: idGueltig && einheitenQuery.isSuccess && aktuell == null,
    refetchOnMount: 'always',
  });
  const aufgeloest = aufgeloesteQuery.data?.find((e) => e.id === einheitId) ?? null;
  const freigaben = useModulFreigaben(einsatzId);

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

  if (!aktuell && aufgeloest) {
    return (
      <EinheitAufgeloestAnsicht
        key={einheitId}
        einsatzId={einsatzId}
        einsatz={einsatzQuery.data}
        einheit={aufgeloest}
        rechte={buildEinheitRechte(false, freigaben)}
        stand={aufgeloesteQuery.dataUpdatedAt}
      />
    );
  }
  // Auch während ein veralteter Stand nachlädt: er kennt die eben aufgelöste Einheit noch nicht.
  if (!aktuell && (aufgeloesteQuery.isPending || aufgeloesteQuery.isFetching)) {
    return <SeitenSkeleton />;
  }
  if (!aktuell && aufgeloesteQuery.isError) {
    return (
      <SeitenFehler
        text="Aufgelöste Einheiten konnten nicht geladen werden"
        ursache={aufgeloesteQuery.error}
        onWiederholen={() => void aufgeloesteQuery.refetch()}
      />
    );
  }

  /**
   * Die Listen kamen an, die Einheit ist in keiner (gelöscht oder erfundene ID). Ein anderer Fall
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
  const besatzungPersonal = rechte.hasBesatzung ? personalQuery.data : undefined;
  const besatzungFahrzeuge = rechte.hasBesatzung ? fahrzeugeQuery.data : undefined;
  const besatzungListState =
    personalQuery.isError || fahrzeugeQuery.isError
      ? 'fehler'
      : personalQuery.data && fahrzeugeQuery.data
        ? 'daten'
        : 'laden';
  /*
   * Die Gründe des Paneels „Fahrzeuge und Besatzung“ hält die Seite (LLH-1269): entfernt ein
   * Live-Ereignis die Zeile nach der Ablehnung, steht der Grund im Seitenhinweis. Solange die
   * Besatzung lädt, zeigt das Paneel keine Zeile, und kein Grund hat seinen Ort verloren.
   */
  const besatzungMittel = buildBesatzungMittel(
    aktuell,
    einheiten,
    besatzungPersonal,
    besatzungFahrzeuge,
    rechte,
  );
  const besatzungErrors = useBesatzungErrors(
    rechte.hasBesatzung && besatzungListState === 'laden'
      ? null
      : visibleBesatzungRows(aktuell, besatzungMittel),
  );

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

  // Storno einer Fehlübernahme (LLH-1388, D7): danach ins Board mit der hervorgehobenen Karte, wo
  // die Rücknahme von „Eingetroffen“ der nächste Schritt ist — für angelegte wie verknüpfte gleich.
  const uebernahmeStorno = useMutation({
    mutationFn: () => storniereUebernahme(einsatzId, einheitId),
    onSuccess: (n) => {
      void navigate(nachforderungenPfad(einsatzId, { nachforderung: n.id }));
      invalidate();
      qc.invalidateQueries({ queryKey: einsatzKeys.nachforderungen(einsatzId) });
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
      // Nur mit Inhalt gesetzt: ein leerer Slot rendert in `EinsatzSeite` trotzdem seinen Rahmen.
      hinweis={
        besatzungErrors.orphaned.length > 0 && (
          <GewanderteGruende
            gruende={besatzungErrors.orphaned}
            onSchliessen={besatzungErrors.dismissOrphaned}
          />
        )
      }
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
          nachforderungPfad={
            aktuell.nachforderung_id != null && istKeyFreigegeben('nachforderungen', freigaben)
              ? nachforderungenPfad(einsatzId, { nachforderung: aktuell.nachforderung_id })
              : null
          }
        />

        {/* Offene Übernahme (LLH-1075, D14): direkt unter dem Kopf, nur mit Recht Einheiten;
            Abweisen entlässt die Fahrzeuge und braucht deren Freigabe. Ohne Recht bleibt das
            Kennzeichen im Kopf. */}
        {aktuell.nicht_uebernommen_seit != null && rechte.canEditEinheit && (
          <EinheitUebernahme
            key={aktuell.id}
            einsatzId={einsatzId}
            einheit={aktuell}
            einheiten={einheiten}
            abschnitte={abschnitteQuery.data}
            canAbweisen={rechte.hasFahrzeugLink}
            onAbgewiesen={() => {
              // Wie nach dem Auflösen: die Einheit ist aufgelöst, zurück zur Gliederung.
              void navigate(einheitenPfad(einsatzId));
              qc.setQueryData<Einheit[]>(einsatzKeys.einheiten(einsatzId), (alt) =>
                alt?.filter((x) => x.id !== einheitId),
              );
              invalidate();
            }}
          />
        )}

        {/* Jede Handlung hier wirkt mit dem Klick: die Zeile erscheint, wandert oder
            verschwindet, das quittiert ohne Satz (LFH-1078). */}
        <FahrzeugeBesatzung
          einsatzId={einsatzId}
          einheit={aktuell}
          mittel={besatzungMittel}
          rechte={rechte}
          listState={besatzungListState}
          onReload={() => {
            void personalQuery.refetch();
            void fahrzeugeQuery.refetch();
          }}
          onSetFuehrer={setFuehrer}
          errors={besatzungErrors}
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
                einsatzList={personalQuery}
              />
              <ZuordnenAuswahl
                art="fahrzeug"
                einsatzId={einsatzId}
                einheitId={einheitId}
                rechte={rechte}
                einsatzList={fahrzeugeQuery}
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
          materialList={materialQuery}
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

        {rechte.canEditEinheit &&
          aktuell.nachforderung_id != null &&
          istKeyFreigegeben('nachforderungen', freigaben) && (
            <EinheitUebernahmeStorno
              nachforderungId={aktuell.nachforderung_id}
              onStornieren={() => uebernahmeStorno.mutateAsync()}
            />
          )}
        {rechte.canEditEinheit && <EinheitAufloesen onAufloesen={() => aufloesen.mutateAsync()} />}
      </div>
    </EinsatzSeite>
  );
}
