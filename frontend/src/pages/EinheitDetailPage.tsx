import { App, Breadcrumb, Button, Space, Tag } from 'antd';
import EinsatzSeite from '../components/EinsatzSeite';
import { Paneel, monoStil, useRollen } from '../components/instrument';
import { Select } from '../components/Select';
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
import { gibMaterialFrei, listEinsatzMaterial, ordneMaterialZu } from '../api/einsatzMaterial';
import {
  gibFahrzeugFrei,
  gibPersonalFrei,
  listeEinheiten,
  loeseEinheitAuf,
  ordneFahrzeugZu,
  ordnePersonalZu,
  patchEinheitZeichen,
  patcheEinheit,
  setzeEinheitStatus,
  type EinheitPatch,
  type EinheitZeichenPatch,
} from '../api/einheiten';
import { ladeOrganisation } from '../api/organisation';
import { einsatzKeys, globalKeys } from '../api/queryKeys';
import type { Einheit, EinsatzAnzeige } from '../api/types';
import { POSITION_LABELS } from '../api/personal';
import StaerkeAnzeige from '../anzeige/StaerkeAnzeige';
import { gemeinsamerDatenstand } from '../components/Datenstand';
import { einheitenPfad, parseRouteId } from '../routing/deeplinks';
import {
  nichtGefundenInhalt,
  SeitenFehler,
  SeitenLeer,
  SeitenSkeleton,
} from '../components/SeitenZustand';
import { SpeicherFehler, ZeilenFehler } from '../components/SpeicherHinweis';
import { useZeilenFehler, type ZeilenGrund } from '../components/useZeilenFehler';
import { buildEinheitRechte } from './einheit/einheitAnsichtKern';
import EinheitKopf from './einheit/EinheitKopf';
import EinheitFunk from './einheit/EinheitFunk';
import EinheitZeichenPaneel from './einheit/EinheitZeichenPaneel';
import EinheitAufloesen from './einheit/EinheitAufloesen';
import { ortVon } from '../kraefte/materialPosten';

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
 * Der Inhalt einer geladenen Einheit in der Reihenfolge von design.md D2: Kopf, Personal,
 * Fahrzeuge, Zeitachse, Material, Funk und Kommunikation, Taktisches Zeichen, zuletzt abgesetzt
 * „Einheit auflösen“. Was bedienbar ist, sagt allein `buildEinheitRechte` (D6).
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
  const rechte = buildEinheitRechte(darfSchreiben, useModulFreigaben(einsatzId));

  const typenQuery = useQuery({ queryKey: globalKeys.einheitTypen(), queryFn: listeEinheitTypen });
  const abschnitteQuery = useQuery({
    queryKey: einsatzKeys.abschnitte(einsatzId),
    queryFn: () => listeAbschnitte(einsatzId),
  });
  const personalQuery = useQuery({
    queryKey: einsatzKeys.personal(einsatzId),
    queryFn: () => listeEinsatzPersonal(einsatzId),
  });
  const fahrzeugeQuery = useQuery({
    queryKey: einsatzKeys.fahrzeuge(einsatzId),
    queryFn: () => listeEinsatzFahrzeuge(einsatzId),
  });
  const materialQuery = useQuery({
    queryKey: einsatzKeys.material(einsatzId),
    queryFn: () => listEinsatzMaterial(einsatzId),
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

  /*
   * Jede Zuordnung meldet ihre Ablehnung an ihrem Ort, kein Toast (LFH-1077, `frontend/AGENTS.md`,
   * „Rückwege und Fehler“): Zuordnen am Paneel der Zuordnung, „Aus Einheit lösen“ und „Als
   * Einheitsführer“ an der Zeile. Die Gründe kommen aus den Callbacks, nicht aus
   * `mutation.error`/`mutation.variables` (`components/useZeilenFehler.ts`): zwei schnelle
   * Zuordnungen hintereinander, und die Ablehnung der ersten ginge verloren. „Aus Einheit lösen“
   * und „Als Einheitsführer“ teilen sich den Speicher der Personalzeile.
   */
  const personalZeilen = useZeilenFehler<number>();
  const fahrzeugZeilen = useZeilenFehler<number>();
  const materialZeilen = useZeilenFehler<number>();
  const zuordnen = useZeilenFehler<'personal' | 'fahrzeug' | 'material'>();

  const personalZu = useMutation({
    mutationFn: (epId: number) => ordnePersonalZu(einsatzId, einheitId, epId),
    onMutate: () => zuordnen.beginne('personal'),
    onSuccess: invalidate,
    onError: (e) => zuordnen.melde('personal', e),
  });
  const personalFrei = useMutation({
    mutationFn: (epId: number) => gibPersonalFrei(einsatzId, einheitId, epId),
    onMutate: (epId) => personalZeilen.beginne(epId),
    onSuccess: invalidate,
    onError: (e, epId) => personalZeilen.melde(epId, e, 'Lösen fehlgeschlagen'),
  });
  const fahrzeugZu = useMutation({
    mutationFn: (efId: number) => ordneFahrzeugZu(einsatzId, einheitId, efId),
    onMutate: () => zuordnen.beginne('fahrzeug'),
    onSuccess: invalidate,
    onError: (e) => zuordnen.melde('fahrzeug', e),
  });
  const fahrzeugFrei = useMutation({
    mutationFn: (efId: number) => gibFahrzeugFrei(einsatzId, einheitId, efId),
    onMutate: (efId) => fahrzeugZeilen.beginne(efId),
    onSuccess: invalidate,
    onError: (e, efId) => fahrzeugZeilen.melde(efId, e, 'Lösen fehlgeschlagen'),
  });
  const materialZu = useMutation({
    mutationFn: (emId: number) => ordneMaterialZu(einsatzId, einheitId, emId),
    onMutate: () => zuordnen.beginne('material'),
    onSuccess: invalidate,
    onError: (e) => zuordnen.melde('material', e),
  });
  const materialFrei = useMutation({
    mutationFn: (emId: number) => gibMaterialFrei(einsatzId, einheitId, emId),
    onMutate: (emId) => materialZeilen.beginne(emId),
    onSuccess: invalidate,
    onError: (e, emId) => materialZeilen.melde(emId, e, 'Lösen fehlgeschlagen'),
  });

  /**
   * „Als Einheitsführer“ an der Personzeile schickt nur `fuehrer_id` (D1) — derselbe Weg wie die
   * Zeile „Einheitsführer“ im Kopf; die Ablehnung steht an der Personzeile.
   */
  function setFuehrer(epId: number) {
    personalZeilen.beginne(epId);
    patch
      .mutateAsync({ etikett: 'Einheitsführer', patch: { fuehrer_id: epId } })
      .catch((e: unknown) => personalZeilen.melde(epId, e, 'Einheitsführer nicht gesetzt'));
  }

  // Frei-Pool: disponierte Kräfte ohne Einheit.
  const freiesPersonal = (personalQuery.data ?? []).filter((p) => p.einheit_id == null);
  const freieFahrzeuge = (fahrzeugeQuery.data ?? []).filter((f) => f.einheit_id == null);
  // Frei heißt beim Material „ohne Ort“ (LLH-1224 D6): ein Posten an einer UHS ist nicht frei.
  const freiesMaterial = (materialQuery.data ?? []).filter((m) => ortVon(m) === null);

  /**
   * Was ein leerer Zuordnungs-Pool bedeutet, hängt daran, ob die Liste ankam. Scheitert der Abruf,
   * filtern die Ausdrücke oben auf die leere Menge, und das Auswahlfeld behauptete „Keine freien
   * Personen".
   */
  const personalInhalt =
    nichtGefundenInhalt(personalQuery, {
      allgemein: 'Kräfte konnten nicht geladen werden',
    }) ?? 'Keine freien Personen';
  const fahrzeugInhalt =
    nichtGefundenInhalt(fahrzeugeQuery, {
      allgemein: 'Fahrzeuge konnten nicht geladen werden',
    }) ?? 'Keine freien Fahrzeuge';
  const materialInhalt =
    nichtGefundenInhalt(materialQuery, {
      allgemein: 'Material konnte nicht geladen werden',
    }) ?? 'Kein freies Material';

  /**
   * Eine Zuordnungszeile — Bezeichnung links, Aktionen rechts, darunter der Grund einer
   * abgelehnten Zeilenaktion.
   */
  const zuordnungsZeile = (
    schluessel: string | number,
    inhalt: React.ReactNode,
    aktionen: React.ReactNode,
    fehlerGrund: ZeilenGrund | null,
  ) => (
    <div
      key={schluessel}
      data-lfh="einheit-zuordnung"
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: token.margin,
        flexWrap: 'wrap',
        // Bedienziel-Boden aus der Dichteachse: eine handgebaute Zeile schuldet `minHeight` plus
        // Polsterung.
        minHeight: token.controlHeight,
        paddingBlock: token.paddingXXS,
      }}
    >
      {inhalt}
      {aktionen}
      {fehlerGrund && (
        <div style={{ flexBasis: '100%' }}>
          <ZeilenFehler fehler={fehlerGrund.fehler} fallback={fehlerGrund.fallback} />
        </div>
      )}
    </div>
  );

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

        {/* ── Die Zuordnungen wirken sofort ──
            Jede Handlung hier schreibt mit dem Klick: die Zeile erscheint bzw. verschwindet im
            Paneel, das quittiert ohne Satz (LFH-1078). */}
        <Paneel titel="Personal" meta={aktuell.personal_mitglieder.length} koerperPolster>
          {aktuell.personal_mitglieder.map((m) =>
            zuordnungsZeile(
              m.ep_id,
              <span>
                {m.name}
                {/* Die Stärke-Position „Führer“ zählt in F/UF/M, das Merkmal Einheitsführer ist
                    ein eigenes (LFH-946); die Zeile „Einheitsführer“ im Kopf zeigt die Lücke. */}
                {m.staerke_position ? ` (${POSITION_LABELS[m.staerke_position]})` : ''}
                {m.ist_fuehrer && <Tag style={{ marginLeft: token.marginXXS }}>Einheitsführer</Tag>}
              </span>,
              rechte.canEditEinheit && (
                /* `size="middle"`: ein `danger`-Knopf neben einer neutralen Aktion braucht mehr
                   als antds Vorgabeabstand. */
                <Space size="middle" wrap>
                  {!m.ist_fuehrer && (
                    <Button onClick={() => setFuehrer(m.ep_id)}>Als Einheitsführer</Button>
                  )}
                  <Button danger onClick={() => personalFrei.mutate(m.ep_id)}>
                    Aus Einheit lösen
                  </Button>
                </Space>
              ),
              personalZeilen.grund(m.ep_id),
            ),
          )}
          {rechte.canZuordnenPersonalEinsatz && (
            <Select
              style={{ width: '100%', marginTop: token.marginSM }}
              placeholder="Person zuordnen …"
              value={null}
              notFoundContent={personalInhalt}
              options={freiesPersonal.map((p) => ({ value: p.id, label: p.name }))}
              onSelect={(epId) => personalZu.mutate(Number(epId))}
            />
          )}
          <ZuordnenFehler grund={zuordnen.grund('personal')} />
        </Paneel>

        <Paneel titel="Fahrzeuge" meta={aktuell.fahrzeug_mitglieder.length} koerperPolster>
          {aktuell.fahrzeug_mitglieder.map((m) =>
            zuordnungsZeile(
              m.ef_id,
              <span>
                <span style={monoStil(13)}>{m.funkrufname}</span>
                {m.fahrzeugtyp ? ` (${m.fahrzeugtyp})` : ''}
              </span>,
              rechte.canEditEinheit && (
                <Button danger onClick={() => fahrzeugFrei.mutate(m.ef_id)}>
                  Aus Einheit lösen
                </Button>
              ),
              fahrzeugZeilen.grund(m.ef_id),
            ),
          )}
          {rechte.canZuordnenFahrzeugEinsatz && (
            <Select
              style={{ width: '100%', marginTop: token.marginSM }}
              placeholder="Fahrzeug zuordnen …"
              value={null}
              notFoundContent={fahrzeugInhalt}
              options={freieFahrzeuge.map((f) => ({ value: f.id, label: f.funkrufname }))}
              onSelect={(efId) => fahrzeugZu.mutate(Number(efId))}
            />
          )}
          <ZuordnenFehler grund={zuordnen.grund('fahrzeug')} />
        </Paneel>

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

        <Paneel titel="Material" meta={aktuell.material_mitglieder.length} koerperPolster>
          {aktuell.material_mitglieder.map((m) =>
            zuordnungsZeile(
              m.em_id,
              <span>
                {m.bezeichnung} <span style={monoStil(13)}>×{m.menge}</span>
              </span>,
              rechte.canEditEinheit && (
                <Button danger onClick={() => materialFrei.mutate(m.em_id)}>
                  Aus Einheit lösen
                </Button>
              ),
              materialZeilen.grund(m.em_id),
            ),
          )}
          {rechte.canZuordnenMaterial && (
            <Select
              style={{ width: '100%', marginTop: token.marginSM }}
              placeholder="Material zuordnen …"
              value={null}
              notFoundContent={materialInhalt}
              options={freiesMaterial.map((m) => ({
                value: m.id,
                label: `${m.bezeichnung} ×${m.menge}`,
              }))}
              onSelect={(emId) => materialZu.mutate(Number(emId))}
            />
          )}
          <ZuordnenFehler grund={zuordnen.grund('material')} />
        </Paneel>

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

/**
 * Grund einer abgelehnten Zuordnung unter dem Auswahlfeld ihres Paneels, bis zur nächsten Auswahl
 * (deren `onMutate` räumt ihn).
 */
function ZuordnenFehler({ grund }: { grund: ZeilenGrund | null }) {
  const { token } = useRollen();
  if (grund == null) return null;
  return (
    <div style={{ marginTop: token.marginSM }}>
      <SpeicherFehler
        fehler={grund.fehler}
        titel="Nicht zugeordnet"
        fallback="Zuordnen fehlgeschlagen"
      />
    </div>
  );
}
