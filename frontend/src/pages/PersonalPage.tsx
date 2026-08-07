import { Alert, App, Breadcrumb, Button, Form, Input, Popconfirm, Space, Tag } from 'antd';
import { Select } from '../components/Select';
import { BemerkungZelle } from '../components/BemerkungZelle';
import { ErfassungsModal } from '../components/Erfassung';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useQueryParamSelektion } from '../routing/useQueryParamSelektion';
import { ladeEinsatz } from '../api/einsaetze';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { useAuth } from '../auth/AuthContext';
import { listePersonal, POSITION_LABELS, POSITION_OPTIONEN } from '../api/personal';
import { listePersonalStatus } from '../api/personalStatus';
import {
  aktualisiereDisposition, disponiereAdhoc, disponierePerson, entferneDisposition,
  listeEinsatzPersonal, type AdhocEingabe,
} from '../api/einsatzPersonal';
import { listeEinheiten } from '../api/einheiten';
import { listeEinsatzFahrzeuge } from '../api/einsatzFahrzeuge';
import { einheitenPfad, fahrzeugePfad } from '../routing/deeplinks';
import { ApiError } from '../api/client';
import { einsatzKeys, globalKeys } from '../api/queryKeys';
import type { EinsatzPersonal, StaerkePosition } from '../api/types';
import StatusTag from '../components/StatusTag';
import { nichtGefundenInhalt, SeitenFehler, SeitenSkeleton, SeitenStandVeraltet } from '../components/SeitenZustand';
import EinsatzSeite from '../components/EinsatzSeite';
import { gemeinsamerDatenstand } from '../components/Datenstand';
import Datensicht, { scrolleZurZeile, spaltenFuer } from '../components/Datensicht';
import { KATEGORIE_REIHENFOLGE, KATEGORIE_WERTE, kategorieEtikett, kategorieVon } from '../kraefte/statusAchse';
import { statusKategorie } from '../theme/statusFarben';
import { abstand, flaeche } from '../theme/tokens';

/**
 * Statusanzeige eines disponierten Einsatzpersonals — und zugleich die GRENZE des
 * Statusfarb-Vertrags (LFH-328/A2, Spec §1.3).
 *
 * Die Anzeige hat zwei Achsen, und nur eine davon kann der Vertrag tragen:
 *
 * 1. **DB-Achse** — `status_farbe` ist mandantengepflegter Freitext aus den
 *    Stammdaten-Tabs. Das Backend (`src/routes/personal_status.rs`) trimmt ihn und
 *    prüft sonst NICHTS: kein Enum, kein Hex-Format. Ein getypter `Record` kann das
 *    nicht einfangen. Diese Achse bleibt deshalb unangetastet — wer sie „aufräumt",
 *    nimmt dem Mandanten seine gepflegte Farbe weg. (Dass sie gegen die A0-Rollen
 *    validiert werden sollte, ist ein eigener Befund, Spec §5 Nr. 1.)
 * 2. **Fallback-Achse** — früher `KATEGORIE_FALLBACK`, byte-identisch in dieser und
 *    der Nachbarseite dupliziert. Sie kommt jetzt aus `statusKategorie`.
 *
 * ABWEICHUNG VOM PLANWORTLAUT, bewusst: der Plan sagt „`status_farbe ?? …` bleibt
 * stehen", gemeint als „die DB-Achse bleibt". Aus dem `??` einen Zweig zu machen
 * erhält genau das — und vermeidet den Fehler, den `StatusTag` selbst dokumentiert:
 * antds `color`-Prop rendert einen NICHT-Preset-Wert als Vollfläche mit erzwungen
 * weißem Text. Die Rollenfarbe dort hineinzureichen (`rollenFarbe(...)` liefert Hex,
 * nie einen Preset-Namen) hätte aus jedem Fallback-Tag — dem Normalfall, solange kein
 * Mandant eine Farbe pflegt — eine gefüllte Fläche gemacht, im Dunkelmodus mit weißer
 * Schrift auf aufgehelltem Rot. Der Zweig hält die DB-Achse byte-gleich und stellt die
 * Fallback-Achse auf die Umrissform, die der Rest der Anwendung nach A2 trägt.
 */
function StatusBadge({ ep }: { ep: EinsatzPersonal }) {
  if (!ep.status_label || !ep.status_kategorie) return <Tag>kein Status</Tag>;
  if (ep.status_farbe) return <Tag color={ep.status_farbe}>{ep.status_label}</Tag>;
  const meta = statusKategorie[ep.status_kategorie];
  return <StatusTag darstellung={{ ...meta, label: ep.status_label }} />;
}

export default function PersonalPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { benutzer } = useAuth();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [adhocOffen, setAdhocOffen] = useState(false);
  const [highlightId, setHighlightId] = useState<number | null>(null);
  const [form] = Form.useForm<AdhocEingabe>();

  const einsatzQuery = useQuery({ queryKey: einsatzKeys.einsatz(einsatzId), queryFn: () => ladeEinsatz(einsatzId) });
  const epQuery = useQuery({
    queryKey: einsatzKeys.personal(einsatzId),
    queryFn: () => listeEinsatzPersonal(einsatzId),
  });
  const statusQuery = useQuery({ queryKey: globalKeys.personalStatus(), queryFn: listePersonalStatus });
  const poolQuery = useQuery({ queryKey: globalKeys.personalListe('im-dienst'), queryFn: () => listePersonal(true) });
  // LFH-139: Struktur-Listen zum Auflösen von einheit_id/fahrzeug_id → Klartext-Label
  // (Gegenrichtung zur Fahrzeugseite). Reine Anzeige — keine eigene Backend-Erweiterung.
  const einheitenQuery = useQuery({
    queryKey: einsatzKeys.einheiten(einsatzId),
    queryFn: () => listeEinheiten(einsatzId),
  });
  const fahrzeugeQuery = useQuery({
    queryKey: einsatzKeys.fahrzeuge(einsatzId),
    queryFn: () => listeEinsatzFahrzeuge(einsatzId),
  });

  // Cross-Modul-Deeplink (LFH-25): ?personal=<id> (z. B. Lagekarte-Führungskraft) hebt die
  // Zeile hervor und scrollt sie ins Bild (Scroll best-effort, jsdom-No-op).
  useQueryParamSelektion('personal', epQuery.isSuccess, (pid) => {
    if ((epQuery.data ?? []).some((p) => p.id === pid)) setHighlightId(pid);
  });
  useEffect(() => {
    if (highlightId == null) return;
    scrolleZurZeile(highlightId);
  }, [highlightId]);

  function invalidate() {
    qc.invalidateQueries({ queryKey: einsatzKeys.personal(einsatzId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
  }
  const fehler = (e: unknown) => message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');

  const disponiereMutation = useMutation({
    mutationFn: (personalId: number) => disponierePerson(einsatzId, personalId),
    onSuccess: () => { message.success('Personal disponiert'); invalidate(); },
    onError: fehler,
  });
  const adhocMutation = useMutation({
    mutationFn: (daten: AdhocEingabe) => disponiereAdhoc(einsatzId, daten),
    // Nur noch invalidieren: das Schliessen macht `onFertig` am ErfassungsModal, das
    // Leeren die Hülle selbst — und im Serienmodus bleibt der Dialog bewusst offen.
    onSuccess: invalidate,
    onError: fehler,
  });
  const statusMutation = useMutation({
    mutationFn: (v: { epId: number; statusId: number }) =>
      aktualisiereDisposition(einsatzId, v.epId, { status_id: v.statusId }),
    onMutate: async (v) => {
      const queryKey = einsatzKeys.personal(einsatzId);
      await qc.cancelQueries({ queryKey });
      const vorher = qc.getQueryData<EinsatzPersonal[]>(queryKey)?.find((ep) => ep.id === v.epId);
      const status = statusQuery.data?.find((s) => s.id === v.statusId);
      qc.setQueryData<EinsatzPersonal[]>(queryKey, (alt) =>
        alt?.map((ep) => ep.id === v.epId
          ? {
              ...ep,
              status_id: v.statusId,
              status_label: status?.label ?? ep.status_label,
              status_kategorie: status?.kategorie ?? ep.status_kategorie,
              status_farbe: status?.farbe ?? null,
            }
          : ep),
      );
      return { vorher };
    },
    onSuccess: (serverStand) => {
      qc.setQueryData<EinsatzPersonal[]>(einsatzKeys.personal(einsatzId), (alt) =>
        alt?.map((ep) => ep.id === serverStand.id ? serverStand : ep),
      );
    },
    onError: (e, v, kontext) => {
      const vorher = kontext?.vorher;
      if (vorher) {
        qc.setQueryData<EinsatzPersonal[]>(einsatzKeys.personal(einsatzId), (aktuell) =>
          aktuell?.map((ep) => ep.id === v.epId && ep.status_id === v.statusId
            ? {
                ...ep,
                status_id: vorher.status_id,
                status_label: vorher.status_label,
                status_kategorie: vorher.status_kategorie,
                status_farbe: vorher.status_farbe,
              }
            : ep),
        );
      }
      fehler(e);
    },
    onSettled: invalidate,
  });
  const positionMutation = useMutation({
    mutationFn: (v: { epId: number; position: StaerkePosition | null }) =>
      aktualisiereDisposition(einsatzId, v.epId, { staerke_position: v.position }),
    onSuccess: invalidate,
    onError: fehler,
  });
  const bemerkungMutation = useMutation({
    mutationFn: (v: { epId: number; bemerkung: string }) =>
      aktualisiereDisposition(einsatzId, v.epId, { bemerkung: v.bemerkung }),
    onSuccess: invalidate,
    onError: fehler,
  });
  const entfernenMutation = useMutation({
    mutationFn: (epId: number) => entferneDisposition(einsatzId, epId),
    onSuccess: invalidate,
    onError: fehler,
  });

  if (einsatzQuery.isLoading) {
    return <SeitenSkeleton />;
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
  const darfSchreiben = darfImEinsatzSchreiben(einsatz, benutzer);

  const eps = epQuery.data ?? [];

  /**
   * LISTENZUSTAND — zwei Lagen, zwei Antworten (D3). Der Fehler allein reicht als
   * Bedingung NICHT.
   *
   * Ohne Zeilen im Zwischenspeicher tritt der Fehler an die Stelle der Datensicht, sonst
   * behauptet „Noch kein Personal disponiert" eine leere Disposition, wo bloß der Abruf
   * scheiterte. MIT Zeilen bleiben sie stehen und bekommen ein Banner: sie sind echt, nur
   * womöglich alt. Ein Fehler, der die Zeilen wegräumt, nähme der Einsatzkraft Daten, die
   * sie eben noch hatte — das Gegenteil dessen, wofür `SeitenStandVeraltet` gebaut ist.
   *
   * Gemessen an `eps`, der UNGEFILTERTEN Menge (Muster aus `TierePage`/`SchaedenPage`):
   * Suche, Trägerfilter und Gruppenachse leben IM Primitiv, an ihrer Restmenge gemessen
   * kippte die Seite bei jedem engen Filter in den Fehlerzweig — und nähme dem Bediener
   * die Schalter, mit denen er ihn wieder aufmachen könnte.
   *
   * NICHT zu verwechseln mit dem Statuskatalog-Banner weiter unten: das steht ZUSÄTZLICH
   * über der Tabelle und tauscht nichts aus. Eine Mengenbedingung hat dort nichts zu
   * suchen — es verschwindet nichts, also ist auch nichts zu bewahren.
   */
  const listeGescheitert = epQuery.isError && eps.length === 0;
  const standVeraltet = epQuery.isError && eps.length > 0;

  const einheitById = new Map((einheitenQuery.data ?? []).map((e) => [e.id, e] as const));
  const fahrzeugById = new Map((fahrzeugeQuery.data ?? []).map((f) => [f.id, f] as const));
  const stati = statusQuery.data ?? [];
  const disponierteIds = new Set(eps.map((e) => e.personal_id).filter((x): x is number => x != null));
  const poolOptionen = (poolQuery.data ?? [])
    .filter((p) => !disponierteIds.has(p.id))
    .map((p) => ({ value: p.id, label: `${p.name}${p.personalnummer ? ` (${p.personalnummer})` : ''}` }));

  /**
   * Was ein leeres Auswahlfeld bedeutet, hängt daran, OB die Liste überhaupt ankam
   * (LFH-331 · B3). Scheitert der Abruf, filtert der Ausdruck darüber auf die leere Menge
   * und das Feld behauptete „Keine freien Personen" — eine Aussage über den Bestand, die
   * niemand geprüft hat. Ohne Fehler bleibt der Bestandswortlaut byte-gleich stehen.
   *
   * KEIN `kein403`: `src/routes/personal.rs` ist org-lesbar ohne Admin-Schranke.
   */
  const poolInhalt = nichtGefundenInhalt(poolQuery, {
    allgemein: 'Personalliste konnte nicht geladen werden',
  }) ?? 'Keine freien Personen';

  /**
   * Trägerfilter aus den EIGENEN Daten; `undefined` ohne Werte — ein Filterfeld mit null
   * Optionen wäre Rauschen in der Werkzeugzeile.
   *
   * BEWUSSTE FOLGE, damit sie nicht unbenannt bleibt: das Feld erscheint erst mit dem
   * ersten gepflegten Wert, also nach dem Laden — in der umbrechenden Werkzeugzeile eine
   * kleine Verschiebung. Der Tausch ist gewollt: ein dauerhaft leeres Filterfeld sieht wie
   * ein Werkzeug aus und ist keins.
   */
  const traegerWerte = [...new Set(eps.map((e) => e.traegerorganisation).filter((t): t is string => !!t))]
    .sort()
    .map((t) => ({ text: t, value: t }));
  const traegerFilter = traegerWerte.length > 0
    ? { werte: traegerWerte, trifft: (e: EinsatzPersonal, w: string) => e.traegerorganisation === w }
    : undefined;

  /**
   * Spaltenregister der Personalseite — die breiteste Fläche des Repos (9 Spalten) und
   * damit der erste Adressat des Spaltenschalters (LFH-330 · B2).
   *
   * Durch `spaltenFuer<EinsatzPersonal>()` geführt, NICHT annotiert (sonst weitet sich `K`
   * auf `string` und der Kartenplan nimmt jeden Tippfehler an).
   *
   * ── KEIN `abBreite` AUF `position` — und das ist eine Entscheidung ───────────────
   *
   * Die API-Spec schlägt `abBreite: 'xl'` vor. Dagegen steht der Kontext
   * **Führungs-Tablet** aus der Bedien-Leitlinie: 1024–1280 px, und antds `xl` liegt bei
   * 1200 — die Spalte verschwände also genau dort. `position` ist eine von nur zwei
   * Schreib-Bedienungen dieser Seite, und es gibt keine Detailroute, auf die man sie
   * verlagern könnte. Wer sie weghaben will, nimmt `spaltenAusVoreinstellung`; dann steht
   * sie im Schalter, im Zähler, und ein Klick holt sie zurück.
   */
  const spalten = spaltenFuer<EinsatzPersonal>()([
    {
      title: 'Name',
      key: 'name',
      immerSichtbar: true,
      sortWert: (ep) => ep.name,
      suchText: (ep) => ep.name,
      // Der Deeplink der Fahrzeug-/Einheitsspalte wandert NICHT hierher: nur die
      // Titelspalte dürfte `titel.ziel` tragen, und `personalPfad` zeigte auf DIESE Seite.
      render: (_, ep) => (
        <Space>
          {ep.name}
          {ep.ist_adhoc && <Tag color="blue">ad-hoc</Tag>}
        </Space>
      ),
    },
    {
      title: 'Funktion', dataIndex: 'funktion', key: 'funktion',
      sortWert: (ep) => ep.funktion, suchText: (ep) => ep.funktion, render: (t) => t ?? '—',
    },
    {
      title: 'Träger', dataIndex: 'traegerorganisation', key: 'traeger',
      filter: traegerFilter, render: (t) => t ?? '—',
    },
    {
      title: 'Fahrzeug',
      key: 'fahrzeug',
      render: (_, ep) => {
        const f = ep.fahrzeug_id != null ? fahrzeugById.get(ep.fahrzeug_id) : undefined;
        if (!f) return '—';
        const label = f.kennzeichen ? `${f.funkrufname} (${f.kennzeichen})` : f.funkrufname;
        return <Link to={fahrzeugePfad(einsatzId, { fahrzeug: f.id })}>{label}</Link>;
      },
    },
    {
      title: 'Einheit',
      key: 'einheit',
      render: (_, ep) => {
        const e = ep.einheit_id != null ? einheitById.get(ep.einheit_id) : undefined;
        if (!e) return '—';
        return <Link to={einheitenPfad(einsatzId, { einheit: e.id })}>{e.name}</Link>;
      },
    },
    {
      title: 'Position',
      key: 'position',
      render: (_, ep) =>
        darfSchreiben ? (
          <Select
            style={{ minWidth: 130 }}
            value={ep.staerke_position ?? undefined}
            placeholder="—"
            allowClear
            options={POSITION_OPTIONEN}
            onChange={(position) => positionMutation.mutate({ epId: ep.id, position: position ?? null })}
          />
        ) : (
          ep.staerke_position ? POSITION_LABELS[ep.staerke_position] : '—'
        ),
    },
    {
      title: 'Status',
      key: 'status',
      // Gefiltert wird über die KATEGORIE, nicht über `status_id`: die ID kommt aus dem
      // Mandantenkatalog und filterte je Mandant anders — und passte nicht zu den Gruppen.
      filter: {
        werte: KATEGORIE_WERTE,
        trifft: (ep, w) => kategorieVon(ep.status_kategorie) === w,
      },
      render: (_, ep) =>
        darfSchreiben ? (() => {
          const gesperrt = statusMutation.isPending;
          const laeuft = gesperrt && statusMutation.variables?.epId === ep.id;
          return (
            <Select
              style={{ minWidth: 150 }}
              value={laeuft ? statusMutation.variables?.statusId : ep.status_id ?? undefined}
              placeholder="Status wählen"
              options={stati.map((s) => ({ value: s.id, label: s.label }))}
              loading={laeuft}
              disabled={gesperrt}
              onChange={(statusId) => {
                if (!statusMutation.isPending) statusMutation.mutate({ epId: ep.id, statusId });
              }}
            />
          );
        })() : (
          <StatusBadge ep={ep} />
        ),
    },
    {
      title: 'Bemerkung',
      key: 'bemerkung',
      render: (_, ep) => (
        <BemerkungZelle
          wert={ep.bemerkung}
          kennung={ep.name}
          darfSchreiben={darfSchreiben}
          onSpeichern={(val) => bemerkungMutation.mutate({ epId: ep.id, bemerkung: val })}
        />
      ),
    },
    ...(darfSchreiben
      ? [
          {
            title: 'Aktionen',
            key: 'aktionen' as const,
            immerSichtbar: true,
            render: (_: unknown, ep: EinsatzPersonal) => (
              <Popconfirm title="Aus Einsatz entfernen?" onConfirm={() => entfernenMutation.mutate(ep.id)}>
                {/* Kein `danger`: Rot ist Gefahr, nicht Bedienung. Der zweite Handgriff
                    aus Kriterium 4 ist die Rückfrage. */}
                <Button>Entfernen</Button>
              </Popconfirm>
            ),
          },
        ]
      : []),
  ]);

  return (
    <EinsatzSeite
      breite={flaeche.seiteBreit}
      dataUpdatedAt={gemeinsamerDatenstand(
        epQuery.dataUpdatedAt,
        einheitenQuery.dataUpdatedAt,
        fahrzeugeQuery.dataUpdatedAt,
      )}
      titel={
        <Space>
          Personal
          {/* BEFUND wie in `FahrzeugePage`: `EinsatzStatus` hat keine Statusrolle in
              `theme/statusFarben.ts` (Spec §1.3 listet acht Vertrags-Enums, dieses ist
              keins davon). Der Tag bleibt deshalb auf antd-Farbnamen und rohem Enum-Wert
              stehen — erfunden wird hier nichts (Spec §5 Befund 7). */}
          <Tag color={einsatz.status === 'aktiv' ? 'green' : 'default'}>{einsatz.status}</Tag>
        </Space>
      }
      breadcrumb={
        <Breadcrumb
          items={[{ title: <Link to="/einsaetze">Einsätze</Link> }, { title: einsatz.bezeichnung }, { title: 'Personal' }]}
        />
      }
      aktionen={
        darfSchreiben && (
          <Space>
            <Select
              style={{ minWidth: 260 }}
              placeholder="Person aus Pool disponieren …"
              value={null}
              options={poolOptionen}
              notFoundContent={poolInhalt}
              loading={disponiereMutation.isPending}
              disabled={disponiereMutation.isPending}
              onSelect={(personalId) => { if (personalId != null) disponiereMutation.mutate(personalId); }}
            />
            <Button onClick={() => setAdhocOffen(true)}>Ad-hoc-Person</Button>
          </Space>
        )
      }
      hinweis={
        !darfSchreiben && einsatz.status !== 'aktiv' && (
          <Alert type="info" showIcon title="Einsatz ist abgeschlossen — nur Ansicht." />
        )
      }
    >
      {/* `titel` ohne `ziel`: `personalPfad` ist eine Query-Param-Selektion auf DIESE Seite,
          der Link zeigte auf sich selbst — und er machte aus der Namenszelle in beiden
          Zweigen einen Link, was die gepinnte LFH-139-Aussage „in dieser Zeile steht kein
          Link" lautlos umdrehte. Die echten Fremd-Links (Fahrzeug, Einheit) bleiben in ihren
          Zellen.

          `zufluss` bleibt der Default `sammelbanner`: diese Seite trägt ZWEI Auswahlfelder
          in der Zeile (Position, Status), eigener wie fremder Wechsel läuft über eine
          Invalidierung. */}

      {/* Der Statuskatalog trägt die Auswahlliste JEDER Statuszelle. Fällt er aus, steht in
          der Zeile ein Auswahlfeld ohne Einträge — der Statuswechsel ist dann unmöglich, und
          zwar lautlos. Die Meldung steht deshalb über der Tabelle, nicht in der Zelle.

          An `darfSchreiben` gekoppelt, weil das Auswahlfeld selbst es ist: wer nur liest,
          sieht `StatusBadge` aus den Zeilendaten und verliert durch den Katalogausfall
          nichts. (Die Positionsspalte bleibt bedienbar — `POSITION_OPTIONEN` ist ein
          lokales Enum und kommt nicht über die Leitung.) */}
      {darfSchreiben && statusQuery.isError && (
        <div style={{ marginBottom: abstand.md }}>
          <SeitenFehler
            text="Statuskatalog konnte nicht geladen werden — Statuswechsel derzeit nicht möglich"
            ursache={statusQuery.error}
            onWiederholen={() => void statusQuery.refetch()}
          />
        </div>
      )}

      {/* Der Listenfehler tauscht die Datensicht aus, statt durch sie hindurchgereicht zu
          werden (D3): `Datensicht` führt den Kartenzweig an `Liste`, und `ListeProps` kennt
          keinen Fehlerbegriff — ein Prop am Primitiv wirkte nur in einer der beiden Formen.
          Ohne diese Weiche behauptet „Noch kein Personal disponiert" auch dann eine leere
          Disposition, wenn bloß die Verbindung abgerissen ist. */}
      {listeGescheitert ? (
        <SeitenFehler
          text="Disponiertes Personal konnte nicht geladen werden"
          ursache={epQuery.error}
          onWiederholen={() => void epQuery.refetch()}
        />
      ) : (
      <>
      {standVeraltet && <SeitenStandVeraltet onWiederholen={() => void epQuery.refetch()} />}
      <Datensicht
        bezeichnung="Personal im Einsatz"
        spalten={spalten}
        daten={eps}
        zeilenSchluessel="id"
        ladend={epQuery.isLoading}
        leerText="Noch kein Personal disponiert"
        suche={{ platzhalter: 'Name, Funktion' }}
        standardSortierung={{ spalte: 'name', richtung: 'auf' }}
        spaltenAusVoreinstellung={['bemerkung']}
        gruppen={{
          schluessel: (ep) => kategorieVon(ep.status_kategorie),
          etikett: kategorieEtikett,
          reihenfolge: KATEGORIE_REIHENFOLGE,
        }}
        zeilenKlasse={(r) => (r.id === highlightId ? 'zeile-hervorgehoben' : undefined)}
        karte={{
          art: 'plan',
          titel: { spalte: 'name' },
          status: (ep) =>
            ep.status_kategorie
              ? {
                  ...statusKategorie[ep.status_kategorie],
                  label: ep.status_label ?? statusKategorie[ep.status_kategorie].label,
                }
              : null,
          sekundaer: ['funktion', 'einheit', 'fahrzeug'],
          aktion: darfSchreiben
            ? {
                etikett: 'Entfernen',
                bestaetigung: 'Aus Einsatz entfernen?',
                onKlick: (ep) => entfernenMutation.mutate(ep.id),
              }
            : undefined,
        }}
      />
      </>
      )}

      {/*
        * Ad-hoc-Disposition — Schnellerfassung mit Serienmodus (LFH-332/B4). An der
        * Bereitstellung wird eine Helferkette am Stück aufgenommen, deshalb bleibt der
        * Dialog nach „Speichern und nächste" stehen; Trägerorganisation und
        * Stärke-Position überleben das Speichern, weil sie sich über eine Kette hinweg
        * am seltensten ändern (dieselbe Einheit, dieselbe Funktionsebene).
        *
        * FELDBUDGET: hier ist NICHTS eingedampft, und das ist kein Versäumnis — die
        * Maske trägt bereits genau vier Felder (Name, Funktion, Trägerorganisation,
        * Stärke-Position) und liegt damit im Rahmen der Modal-/Schnellerfassungs-
        * Leitlinie (LFH-19: ≤ ~4 Felder). Es gibt nichts wegzunehmen: Name ist Pflicht,
        * die anderen drei sind genau die Angaben, die eine ad-hoc erfasste Person von
        * einer namenlosen Zeile unterscheiden.
        */}
      <ErfassungsModal<AdhocEingabe>
        offen={adhocOffen}
        titel="Ad-hoc-Person disponieren"
        form={form}
        erfassenText="Disponieren"
        laeuft={adhocMutation.isPending}
        serie
        uebernahme={['traegerorganisation', 'staerke_position']}
        onErfassen={(w) => adhocMutation.mutateAsync(w)}
        onFertig={() => setAdhocOffen(false)}
        onAbbrechen={() => setAdhocOffen(false)}
      >
        <Form.Item label="Name" name="name" rules={[{ required: true, whitespace: true }]}>
          <Input placeholder="z. B. Dr. Schmidt" />
        </Form.Item>
        <Form.Item label="Funktion" name="funktion"><Input placeholder="z. B. Notarzt" /></Form.Item>
        <Form.Item label="Trägerorganisation" name="traegerorganisation">
          <Input placeholder="z. B. KV Musterstadt" />
        </Form.Item>
        <Form.Item label="Stärke-Position" name="staerke_position">
          <Select allowClear placeholder="optional" options={POSITION_OPTIONEN} />
        </Form.Item>
      </ErfassungsModal>
    </EinsatzSeite>
  );
}
