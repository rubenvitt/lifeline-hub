import { App, Breadcrumb, Button, Input, Popconfirm, Space, Tag, Typography } from 'antd';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { Fragment, useId, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { ladeEinsatz } from '../api/einsaetze';
import {
  entlasseDisposition,
  listeEinsatzPersonal,
  listEntlassenesPersonal,
  reaktiviereDisposition,
  storniereDisposition,
  updateDisposition,
} from '../api/einsatzPersonal';
import { listeEinheiten } from '../api/einheiten';
import { listeEinsatzFahrzeuge } from '../api/einsatzFahrzeuge';
import { listeUhs } from '../api/einsatzUhs';
import { listeAbschnitte } from '../api/einsatzabschnitte';
import { listePersonalStatus } from '../api/personalStatus';
import { listeQualifikationen } from '../api/qualifikationen';
import { listePersonalPerioden } from '../api/kraefteZeitachse';
import { PERSONAL_ADHOC_TEXT_MAX, PERSONAL_BEMERKUNG_MAX } from '../api/eingabegrenzen';
import { einsatzKeys, globalKeys } from '../api/queryKeys';
import type { EinsatzPersonal } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { useUhr } from '../abloesung/useUhr';
import EinsatzSeite from '../components/EinsatzSeite';
import { gemeinsamerDatenstand } from '../components/Datenstand';
import DemoMarke from '../components/DemoMarke';
import { InlineAngabe } from '../components/InlineAngabe';
import { DetailSprung } from '../components/ListeDetail';
import { Select } from '../components/Select';
import StatusWahl, { type StatusOption } from '../components/StatusWahl';
import {
  RechteHinweis,
  SeitenHinweise,
  SpeicherFehler,
  ZeilenFehler,
} from '../components/SpeicherHinweis';
import { SeitenFehler, SeitenLeer, SeitenSkeleton } from '../components/SeitenZustand';
import { Datenfeld, Datenraster, Paneel, monoStil, useRollen } from '../components/instrument';
import { einsatzRechteGrund } from '../components/nurAnsicht';
import { useZeilenFehler } from '../components/useZeilenFehler';
import { istZuLang, zeichenGrenze } from '../components/zeichenGrenze';
import { darfImEinsatzSchreiben, darfVerwaltung } from '../einsatz/schreibrecht';
import { istKeyFreigegeben, istSprungGesperrt, modulName } from '../einsatz/modulRegistry';
import { useModulFreigaben } from '../einsatz/useSprungSperre';
import EinheitAngabe from '../kraefte/EinheitAngabe';
import EinsatzfunktionZelle from '../kraefte/EinsatzfunktionZelle';
import FahrzeugAngabe from '../kraefte/FahrzeugAngabe';
import KraftZeitachse from '../kraefte/KraftZeitachse';
import PositionAngabe from '../kraefte/PositionAngabe';
import { buildEinheitOptions } from '../kraefte/einteilungKern';
import { einsatzfunktionVorschlaege, funktionText } from '../kraefte/einsatzfunktionKern';
import { personalStatusDarstellung } from '../kraefte/mittelStatus';
import { useEinteilungSchreiben } from '../kraefte/useEinteilungSchreiben';
import {
  katalogStatusWechsel,
  useOptimistischesZeilenUpdate,
} from '../kraefte/useOptimistischesZeilenUpdate';
import { dauerText, kraftDauern } from '../kraefte/zeitachse';
import { zeigeRueckgaengig } from '../kommunikation/rueckgaengig';
import {
  einheitDetailPfad,
  kraefteuebersichtPfad,
  parseRouteId,
  personalPfad,
} from '../routing/deeplinks';
import { personalDetailPfad } from '../stammdaten/stammdatenDetail';
import { statusKategorie } from '../theme/statusFarben';
import './EinsatzkraftPage.css';

dayjs.extend(utc);

/** Storno einer Fehldisposition: nur in den ersten 15 Minuten (LLH-1079, Spec `kraefte-entlassung`). */
const STORNO_FRIST_MIN = 15;

/** Leerer Freitext gilt als keine Angabe; verglichen wird getrimmt. */
const isEmpty = (w: string) => w.trim() === '';
const isEqualTrimmed = (a: string, b: string) => a.trim() === b.trim();

/**
 * Personenansicht einer Einsatzkraft (LLH-1060, Spec `personal-ansicht`, design.md D1, D9–D12):
 * Vollseite mit eigener Route (Regel LFH-19: über fünf Felder, Sektionen, deeplink-würdig).
 * Folge: Kopf, „Einteilung“, „Person“, „Zeitachse“, zuletzt „Aus dem Einsatz“.
 *
 * GELESEN AUS DEN LISTEN wie `EinheitDetailPage`: Personal, Entlassene, Einheiten, Fahrzeuge, UHS,
 * Perioden — kein Einzel-GET, kein neuer Query-Key. Ohne Netz bleibt die Ansicht lesbar, soweit
 * die Listen auf der Platte liegen. Abrufe fremder Module nur bei ihrer Freigabe; ohne Freigabe
 * entfällt die Zeile, statt „—“ zu behaupten.
 *
 * JEDE ANGABE EINZELN (D4): `InlineAngabe` je Zeile, über denselben Schreibweg wie in der Liste
 * (`useEinteilungSchreiben`), Erfolg als Toast „Gespeichert: <Angabe>“, Ablehnung an der Zeile.
 * Kein Kopfknopf: die Seite öffnet nichts, und Speichern gehört in die Zeile.
 *
 * ENTLASSEN UND STORNIEREN (D11) stehen nur hier, im letzten Abschnitt: Entlassen ohne Rückfrage
 * mit Rückgängig-Toast, Stornieren mit `Popconfirm` am sichtbaren Knopf (LFH-363; die `<Modal>`
 * aus LLH-1079 galt dem Zeilenmenü). Eine entlassene Person steht nur lesend da (D12).
 */
export default function EinsatzkraftPage() {
  const { id, epId: epIdParam } = useParams();
  const einsatzId = Number(id);
  const epIdGelesen = parseRouteId(epIdParam);
  const epId = epIdGelesen ?? 0;
  const idGueltig = epIdGelesen != null;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const { token, rollen } = useRollen();
  const { benutzer } = useAuth();
  const { formatZeitKurz } = useAnzeigeKonventionen();
  const uhr = useUhr(60_000);
  const schreiben = useEinteilungSchreiben(einsatzId);
  const fristId = useId();

  const freigaben = useModulFreigaben(einsatzId);
  const einheitenFrei = istKeyFreigegeben('einheiten', freigaben);
  const fahrzeugeFrei = istKeyFreigegeben('fahrzeuge', freigaben);
  const uhsFrei = istKeyFreigegeben('unfallhilfsstellen', freigaben);
  const abschnitteFrei = istKeyFreigegeben('einsatzabschnitte', freigaben);

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
    enabled: idGueltig,
  });
  const epQuery = useQuery({
    queryKey: einsatzKeys.personal(einsatzId),
    queryFn: () => listeEinsatzPersonal(einsatzId),
    enabled: idGueltig,
  });
  const entlasseneQuery = useQuery({
    queryKey: einsatzKeys.personalEntlassene(einsatzId),
    queryFn: () => listEntlassenesPersonal(einsatzId),
    enabled: idGueltig,
  });
  const statusQuery = useQuery({
    queryKey: globalKeys.personalStatus(),
    queryFn: listePersonalStatus,
  });
  const qualifikationenQuery = useQuery({
    queryKey: globalKeys.qualifikationen(),
    queryFn: listeQualifikationen,
  });
  const einheitenQuery = useQuery({
    queryKey: einsatzKeys.einheiten(einsatzId),
    queryFn: () => listeEinheiten(einsatzId),
    enabled: idGueltig && einheitenFrei,
  });
  const abschnitteQuery = useQuery({
    queryKey: einsatzKeys.abschnitte(einsatzId),
    queryFn: () => listeAbschnitte(einsatzId),
    enabled: idGueltig && einheitenFrei && abschnitteFrei,
  });
  const fahrzeugeQuery = useQuery({
    queryKey: einsatzKeys.fahrzeuge(einsatzId),
    queryFn: () => listeEinsatzFahrzeuge(einsatzId),
    enabled: idGueltig && fahrzeugeFrei,
  });
  const uhsQuery = useQuery({
    queryKey: einsatzKeys.uhs(einsatzId),
    queryFn: () => listeUhs(einsatzId),
    enabled: idGueltig && uhsFrei,
  });
  const periodenQuery = useQuery({
    queryKey: einsatzKeys.kraefteZeitachsePersonal(einsatzId),
    queryFn: () => listePersonalPerioden(einsatzId),
    enabled: idGueltig,
  });

  /** Gründe am Ort: Status an seiner Zeile, Entlassen/Stornieren/Erneut am Abschnitt. */
  const orte = useZeilenFehler<'status' | 'aus'>();
  const statusMutation = useOptimistischesZeilenUpdate<
    EinsatzPersonal,
    { epId: number; statusId: number }
  >({
    queryKey: einsatzKeys.personal(einsatzId),
    mutationFn: (v) => updateDisposition(einsatzId, v.epId, { status_id: v.statusId }),
    zeilenId: (v) => v.epId,
    ...katalogStatusWechsel<EinsatzPersonal>(statusQuery.data),
    onBeginn: () => orte.beginne('status'),
    onFehler: (e) => orte.melde('status', e, 'Status nicht geändert'),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: einsatzKeys.personal(einsatzId) });
      void qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
    },
  });

  /** Nach Entlassen und erneutem Disponieren wechselt die Zeile die Liste ohne Lücke dazwischen. */
  const moveZeile = (neu: EinsatzPersonal, nach: 'aktiv' | 'entlassen') => {
    const raus = nach === 'aktiv' ? einsatzKeys.personalEntlassene : einsatzKeys.personal;
    const rein = nach === 'aktiv' ? einsatzKeys.personal : einsatzKeys.personalEntlassene;
    qc.setQueryData<EinsatzPersonal[]>(raus(einsatzId), (l) => l?.filter((x) => x.id !== neu.id));
    qc.setQueryData<EinsatzPersonal[]>(rein(einsatzId), (l) =>
      l ? [...l.filter((x) => x.id !== neu.id), neu] : l,
    );
    void qc.invalidateQueries({ queryKey: einsatzKeys.personal(einsatzId) });
    void qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
  };

  const [rueckgaengigFehler, setRueckgaengigFehler] = useState<unknown>(null);
  const rueckgaengigMutation = useMutation({
    mutationFn: () => reaktiviereDisposition(einsatzId, epId),
    onMutate: () => setRueckgaengigFehler(null),
    onSuccess: (neu) => moveZeile(neu, 'aktiv'),
    onError: (e) => setRueckgaengigFehler(e),
  });
  const entlassenMutation = useMutation({
    mutationFn: () => entlasseDisposition(einsatzId, epId),
    onMutate: () => orte.beginne('aus'),
    onSuccess: (neu) => {
      moveZeile(neu, 'entlassen');
      zeigeRueckgaengig(message, `${neu.name} entlassen`, () => rueckgaengigMutation.mutate());
    },
    onError: (e) => orte.melde('aus', e, 'Nicht entlassen'),
  });
  const stornierenMutation = useMutation({
    mutationFn: (name: string) => storniereDisposition(einsatzId, epId).then(() => name),
    onMutate: () => orte.beginne('aus'),
    onSuccess: (name) => {
      void qc.invalidateQueries({ queryKey: einsatzKeys.personal(einsatzId) });
      void qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
      message.success(`${name} storniert`);
      void navigate(personalPfad(einsatzId));
    },
    onError: (e) => orte.melde('aus', e, 'Nicht storniert'),
  });
  const reaktivierenMutation = useMutation({
    mutationFn: () => reaktiviereDisposition(einsatzId, epId),
    onMutate: () => orte.beginne('aus'),
    onSuccess: (neu) => moveZeile(neu, 'aktiv'),
    onError: (e) => orte.melde('aus', e, 'Nicht erneut disponiert'),
  });

  if (!idGueltig) return <Navigate to={personalPfad(einsatzId)} replace />;
  // Die Perioden tragen die Einsatzdauer im Kopf: kämen sie nach dem ersten Bild, wüchse die
  // Meta in der Titelzeile, und alles darunter rückte (CLS 0,22 bei 1280 px, LLH-1060).
  if (einsatzQuery.isLoading || epQuery.isLoading || periodenQuery.isLoading) {
    return <SeitenSkeleton />;
  }
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
  const aktiv = epQuery.data?.find((x) => x.id === epId);
  const entlassen = aktiv ? undefined : entlasseneQuery.data?.find((x) => x.id === epId);
  if (!aktiv && !entlassen) {
    if (epQuery.isError) {
      return (
        <SeitenFehler
          text="Disponiertes Personal konnte nicht geladen werden"
          ursache={epQuery.error}
          onWiederholen={() => void epQuery.refetch()}
        />
      );
    }
    if (entlasseneQuery.isLoading) return <SeitenSkeleton />;
    // Unbekannt oder storniert: kein Abruf scheiterte, die Person steht in keiner Liste.
    return (
      <SeitenLeer
        titel="Nicht (mehr) im Einsatz"
        aktion={{ label: 'Zur Personalliste', pfad: personalPfad(einsatzId) }}
      />
    );
  }
  const ep = (aktiv ?? entlassen)!;
  const isEntlassen = !aktiv;
  const imEinsatzSchreiben = darfImEinsatzSchreiben(einsatz);
  /** Eine entlassene Kraft lehnt der Server bei jedem Schreibweg ab (409, D12). */
  const darfSchreiben = imEinsatzSchreiben && !isEntlassen;
  const rechteText = isEntlassen ? 'entlassen' : einsatzRechteGrund(einsatz.status);

  const einheiten = einheitenQuery.data ?? [];
  const einheitOptionen = buildEinheitOptions(einheiten, abschnitteQuery.data ?? []);
  const eigeneEinheit =
    ep.einheit_id != null ? einheiten.find((e) => e.id === ep.einheit_id) : undefined;
  const fuehrtEinheit = eigeneEinheit != null && eigeneEinheit.fuehrer_id === ep.id;
  const fahrzeuge = fahrzeugeQuery.data ?? [];
  const uhsListe = uhsQuery.data ?? [];
  const uhsOptionen = uhsListe
    .filter((u) => u.status !== 'aufgeloest' && !u.storniert_at)
    .map((u) => ({ value: u.id, label: u.bezeichnung }));

  const dauern = kraftDauern(
    periodenQuery.data?.find((p) => p.personal_id === ep.id)?.perioden,
    uhr.valueOf(),
  );
  const dauerMeta =
    dauern.laufend != null
      ? `im Einsatz ${dauerText(dauern.laufend.minuten)}`
      : dauern.ruheMinuten != null
        ? `Ruhe ${dauerText(dauern.ruheMinuten)}`
        : null;
  const funktion = funktionText(ep);
  const metaTeile = [funktion, ep.traegerorganisation, dauerMeta].filter((t): t is string =>
    Boolean(t),
  );

  const vorschlaege = einsatzfunktionVorschlaege({
    vergeben: (epQuery.data ?? []).map((x) => x.einsatzfunktion),
    qualifikationen: (qualifikationenQuery.data ?? []).map((q) => q.label),
  });

  const statusOptionen: StatusOption<number>[] = (statusQuery.data ?? []).map((s) => ({
    wert: s.id,
    label: s.label,
    darstellung: s.kategorie ? statusKategorie[s.kategorie] : undefined,
    farbe: s.farbe,
  }));
  const statusLaeuft = statusMutation.isPending;

  /** Erfolg einer Angabe als Toast; die Ablehnung bleibt an der Zeile (`InlineAngabe`). */
  const mitToast =
    <A extends unknown[]>(angabe: string, speichern: (...a: A) => Promise<unknown>) =>
    async (...a: A) => {
      await speichern(...a);
      message.success(`Gespeichert: ${angabe}`);
    };
  const patch = (angabe: string, felder: Parameters<typeof schreiben.angabe>[1]) =>
    mitToast(angabe, () => schreiben.angabe(ep.id, felder))();

  /** Freitext einer Ad-hoc-Person (Name Pflicht, Qualifikation, Träger). */
  const textAngabe = (
    etikett: string,
    wert: string | null | undefined,
    feld: 'name' | 'funktion' | 'traegerorganisation',
  ) => (
    <InlineAngabe<string>
      etikett={etikett}
      wert={wert ?? ''}
      anzeige={wert}
      leer={isEmpty}
      gleich={isEqualTrimmed}
      pflicht={feld === 'name'}
      isValid={(w) => !istZuLang(w, PERSONAL_ADHOC_TEXT_MAX)}
      darfSchreiben={darfSchreiben}
      onSpeichern={(w) =>
        patch(etikett, feld === 'name' ? { name: w.trim() } : { [feld]: w.trim() || null })
      }
      eingabe={({ feld: f, value, onChange }) => (
        <Input
          {...f}
          value={value}
          count={zeichenGrenze(PERSONAL_ADHOC_TEXT_MAX)}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    />
  );

  const fristAbgelaufen = dayjs.utc(ep.disponiert_at).add(STORNO_FRIST_MIN, 'minute').isBefore(uhr);
  const ausLaeuft =
    entlassenMutation.isPending || stornierenMutation.isPending || reaktivierenMutation.isPending;
  const ausGrund = orte.grund('aus');
  const statusGrund = orte.grund('status');
  const meldebildGesperrt = istSprungGesperrt('kraefteuebersicht', freigaben);
  const einheitGesperrt = istSprungGesperrt('einheiten', freigaben);

  const titel: ReactNode = (
    <Space size={8} wrap>
      {ep.name}
      {ep.ist_adhoc && <Tag>ad-hoc</Tag>}
      {ep.ist_demo && <DemoMarke />}
      {isEntlassen && <Tag>entlassen</Tag>}
    </Space>
  );

  return (
    <EinsatzSeite
      titel={titel}
      // Unter `md` bricht die Kopf-Meta um (`EinsatzkraftPage.css`): `seitenMetaStil` hält sie in
      // einer Zeile, und Funktion, Träger und Dauer liefen bei 390 px quer über die Seite. Ab `md`
      // bleibt sie einzeilig, sonst bräche sie beim Eintreffen der Dauer in der Titelzeile um.
      // Nur die Dauer bleibt immer beisammen.
      meta={
        metaTeile.length > 0 ? (
          <span className="lfh-personenkopf-meta" style={monoStil(12)}>
            {metaTeile.map((teil, i) => (
              <Fragment key={i}>
                {i > 0 && ' · '}
                <span style={teil === dauerMeta ? { whiteSpace: 'nowrap' } : undefined}>
                  {teil}
                </span>
              </Fragment>
            ))}
          </span>
        ) : undefined
      }
      breadcrumb={
        <Breadcrumb
          items={[
            { title: <Link to="/einsaetze">Einsätze</Link> },
            { title: einsatz.bezeichnung },
            {
              title: (
                <Link to={personalPfad(einsatzId, { personal: ep.id })}>
                  {modulName('personal')}
                </Link>
              ),
            },
            { title: ep.name },
          ]}
        />
      }
      dataUpdatedAt={gemeinsamerDatenstand(
        isEntlassen ? entlasseneQuery.dataUpdatedAt : epQuery.dataUpdatedAt,
        einheitenQuery.dataUpdatedAt,
        fahrzeugeQuery.dataUpdatedAt,
      )}
      hinweis={
        !darfSchreiben || rueckgaengigFehler != null ? (
          <Space orientation="vertical" style={{ width: '100%' }}>
            <RechteHinweis text={rechteText} sichtbar={!darfSchreiben} />
            <SeitenHinweise
              fehler={rueckgaengigFehler}
              fehlerTitel="Nicht erneut disponiert"
              fehlerFallback="Rückgängig fehlgeschlagen"
            />
          </Space>
        ) : null
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: token.margin }}>
        <Paneel titel="Einteilung" koerperPolster>
          <Datenraster spalten={2} beschriftung="Einteilung">
            <Datenfeld label="Status">
              {isEntlassen ? (
                <Typography.Text>entlassen</Typography.Text>
              ) : (
                <StatusWahl
                  darstellung={personalStatusDarstellung(ep)}
                  darfSchreiben={darfSchreiben}
                  optionen={statusOptionen}
                  aktuell={statusLaeuft ? statusMutation.variables?.statusId : ep.status_id}
                  farbe={ep.status_farbe}
                  kennung={ep.name}
                  laeuft={statusLaeuft}
                  gesperrt={statusLaeuft}
                  onWaehlen={(wert) => {
                    if (!statusLaeuft)
                      statusMutation.mutate({ epId: ep.id, statusId: Number(wert) });
                  }}
                />
              )}
              {statusGrund && (
                <ZeilenFehler fehler={statusGrund.fehler} fallback={statusGrund.fallback} />
              )}
            </Datenfeld>
            <Datenfeld label="Einsatzfunktion">
              <EinsatzfunktionZelle
                name={ep.name}
                einsatzfunktion={ep.einsatzfunktion}
                vorschlaege={vorschlaege}
                darfSchreiben={darfSchreiben}
                onSpeichern={(einsatzfunktion) => patch('Einsatzfunktion', { einsatzfunktion })}
              />
            </Datenfeld>
            {einheitenFrei && (
              <Datenfeld label="Einheit">
                <EinheitAngabe
                  wert={ep.einheit_id ?? null}
                  optionen={einheitOptionen}
                  darfSchreiben={darfSchreiben}
                  marke={fuehrtEinheit ? <Tag>Einheitsführer</Tag> : undefined}
                  onSpeichern={mitToast('Einheit', schreiben.einheit(ep.id))}
                />
              </Datenfeld>
            )}
            {fahrzeugeFrei && (
              <Datenfeld label="Fahrzeug">
                <FahrzeugAngabe
                  wert={ep.fahrzeug_id ?? null}
                  einheitId={ep.einheit_id ?? null}
                  fahrzeuge={fahrzeuge}
                  einheiten={einheiten}
                  darfSchreiben={darfSchreiben}
                  onSpeichern={mitToast('Fahrzeug', schreiben.fahrzeug(ep.id))}
                />
              </Datenfeld>
            )}
            {uhsFrei && (
              <Datenfeld label="Unfallhilfsstelle">
                <InlineAngabe<number | null>
                  etikett="Unfallhilfsstelle"
                  wert={ep.uhs_id ?? null}
                  anzeige={uhsListe.find((u) => u.id === ep.uhs_id)?.bezeichnung ?? 'nicht geladen'}
                  leer={(w) => w == null}
                  darfSchreiben={darfSchreiben}
                  onSpeichern={(neu) =>
                    mitToast('Unfallhilfsstelle', schreiben.uhs(ep.id))(neu, ep.uhs_id ?? null)
                  }
                  eingabe={({ feld, value, onChange, popup }) => (
                    <Select<number | null>
                      {...feld}
                      {...popup}
                      value={value ?? undefined}
                      allowClear
                      placeholder="an keiner"
                      onChange={(v) => onChange(v ?? null)}
                      options={uhsOptionen}
                      style={{ width: '100%' }}
                    />
                  )}
                />
              </Datenfeld>
            )}
            <Datenfeld label="Position">
              <PositionAngabe
                wert={ep.staerke_position ?? null}
                ausgeschrieben
                darfSchreiben={darfSchreiben}
                onSpeichern={(staerke_position) => patch('Position', { staerke_position })}
              />
            </Datenfeld>
            <Datenfeld label="Bemerkung" breit>
              <InlineAngabe<string>
                etikett="Bemerkung"
                wert={ep.bemerkung ?? ''}
                anzeige={<span style={{ whiteSpace: 'pre-wrap' }}>{ep.bemerkung}</span>}
                leer={isEmpty}
                gleich={isEqualTrimmed}
                mehrzeilig
                isValid={(w) => !istZuLang(w, PERSONAL_BEMERKUNG_MAX)}
                darfSchreiben={darfSchreiben}
                onSpeichern={(w) => patch('Bemerkung', { bemerkung: w.trim() })}
                eingabe={({ feld, value, onChange }) => (
                  <Input.TextArea
                    {...feld}
                    autoSize={{ minRows: 2 }}
                    value={value}
                    count={zeichenGrenze(PERSONAL_BEMERKUNG_MAX)}
                    onChange={(e) => onChange(e.target.value)}
                  />
                )}
              />
            </Datenfeld>
          </Datenraster>
          {/* Sprünge sind keine Handlung (LFH-616): eine Zeile mit Pfeil, gesperrte Ziele fehlen. */}
          {(!meldebildGesperrt || (eigeneEinheit && !einheitGesperrt)) && (
            <Space size="middle" wrap style={{ marginTop: token.marginSM }}>
              {!meldebildGesperrt && (
                <DetailSprung ziel={kraefteuebersichtPfad(einsatzId)}>
                  {modulName('kraefteuebersicht')}
                </DetailSprung>
              )}
              {eigeneEinheit && !einheitGesperrt && (
                <DetailSprung ziel={einheitDetailPfad(einsatzId, eigeneEinheit.id)}>
                  Einheit
                </DetailSprung>
              )}
            </Space>
          )}
        </Paneel>

        <Paneel titel="Person" koerperPolster>
          <Datenraster spalten={2} beschriftung="Person">
            {ep.ist_adhoc ? (
              <>
                <Datenfeld label="Name">{textAngabe('Name', ep.name, 'name')}</Datenfeld>
                <Datenfeld label="Qualifikation">
                  {textAngabe('Qualifikation', ep.funktion, 'funktion')}
                </Datenfeld>
                <Datenfeld label="Träger">
                  {textAngabe('Träger', ep.traegerorganisation, 'traegerorganisation')}
                </Datenfeld>
              </>
            ) : (
              <>
                <Datenfeld label="Name">{ep.name}</Datenfeld>
                <Datenfeld label="Qualifikation">{ep.funktion || '—'}</Datenfeld>
                <Datenfeld label="Träger">{ep.traegerorganisation || '—'}</Datenfeld>
              </>
            )}
          </Datenraster>
          {!ep.ist_adhoc && (
            <Space size="middle" wrap style={{ marginTop: token.marginSM }}>
              <span style={{ color: rollen.gedaempft }}>aus dem Stamm</span>
              {ep.personal_id != null && darfVerwaltung(benutzer) && (
                <DetailSprung ziel={personalDetailPfad(ep.personal_id)}>
                  im Stamm ändern
                </DetailSprung>
              )}
            </Space>
          )}
        </Paneel>

        {/* Kräfte-Zeitachse (LFH-552) nach Einteilung und Person (Spec `kraefte-zeitachse`). */}
        <Paneel titel="Zeitachse" koerperPolster>
          <KraftZeitachse
            einsatzId={einsatzId}
            art="person"
            id={ep.id}
            kennung={ep.name}
            darfSchreiben={darfSchreiben}
            rechteText={rechteText}
          />
        </Paneel>

        <Paneel titel="Aus dem Einsatz" koerperPolster>
          <div style={{ display: 'flex', flexDirection: 'column', gap: token.marginSM }}>
            {isEntlassen ? (
              <Space size="middle" wrap>
                <span>
                  entlassen <span style={monoStil(13)}>{formatZeitKurz(ep.beendet_at)}</span>
                </span>
                {imEinsatzSchreiben && (
                  <Button
                    loading={reaktivierenMutation.isPending}
                    onClick={() => reaktivierenMutation.mutate()}
                  >
                    Erneut disponieren
                  </Button>
                )}
              </Space>
            ) : darfSchreiben ? (
              <Space size="middle" wrap>
                {/* Umkehrbar: rot mit Abstand, ohne Rückfrage, Rückgängig im Toast (LFH-363). */}
                <Button
                  danger
                  loading={entlassenMutation.isPending}
                  disabled={ausLaeuft}
                  aria-label={`${ep.name} entlassen`}
                  onClick={() => entlassenMutation.mutate()}
                >
                  Entlassen
                </Button>
                {/* Unumkehrbar: Rückfrage mit benanntem Knopf. Was der Server sicher ablehnt (Frist
                    abgelaufen), steht gesperrt mit Kurzgrund (LFH-966). */}
                <Space size="small" wrap>
                  <Popconfirm
                    title={`${ep.name} stornieren?`}
                    description="Die Person erscheint danach in keiner Liste und keinem Nachweis."
                    okText="Stornieren"
                    okButtonProps={{ danger: true }}
                    cancelText="Abbrechen"
                    disabled={fristAbgelaufen || ausLaeuft}
                    onConfirm={() => stornierenMutation.mutate(ep.name)}
                  >
                    <Button
                      danger
                      loading={stornierenMutation.isPending}
                      disabled={fristAbgelaufen || ausLaeuft}
                      aria-describedby={fristAbgelaufen ? fristId : undefined}
                    >
                      Stornieren
                    </Button>
                  </Popconfirm>
                  {fristAbgelaufen && (
                    <span id={fristId} style={{ color: rollen.gedaempft }}>
                      nur in den ersten {STORNO_FRIST_MIN} Minuten
                    </span>
                  )}
                </Space>
              </Space>
            ) : (
              <Typography.Text type="secondary">im Einsatz</Typography.Text>
            )}
            {ausGrund && (
              <SpeicherFehler
                fehler={ausGrund.fehler}
                titel={ausGrund.fallback}
                fallback={ausGrund.fallback}
              />
            )}
          </div>
        </Paneel>
      </div>
    </EinsatzSeite>
  );
}
