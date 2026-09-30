import { Alert, App, Breadcrumb, Button, Popconfirm, Space, Tag } from 'antd';
import { Select } from '../components/Select';
import { BemerkungZelle } from '../components/BemerkungZelle';
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
  aktualisiereDisposition,
  disponierePerson,
  entferneDisposition,
  listeEinsatzPersonal,
} from '../api/einsatzPersonal';
import { listeEinheiten } from '../api/einheiten';
import { listeEinsatzFahrzeuge } from '../api/einsatzFahrzeuge';
import { kraefteuebersichtPfad, einheitenPfad, fahrzeugePfad } from '../routing/deeplinks';
import Verdichtungszeile from '../kraefte/Verdichtungszeile';
import KraftZeitachse from '../kraefte/KraftZeitachse';
import { dauerText, kraftDauern, type KraftDauern } from '../kraefte/zeitachse';
import { listePersonalPerioden } from '../api/kraefteZeitachse';
import { abrufZustand } from '../api/abrufZustand';
import { useUhr } from '../abloesung/useUhr';
import { monoStil } from '../components/instrument';
import AdhocPersonModal from '../kraefte/AdhocPersonModal';
import { einsatzKeys, globalKeys } from '../api/queryKeys';
import type { EinsatzPersonal, StaerkePosition } from '../api/types';
import StatusWahl, { type StatusOption } from '../components/StatusWahl';
import {
  nichtGefundenInhalt,
  SeitenFehler,
  SeitenSkeleton,
  SeitenStandVeraltet,
} from '../components/SeitenZustand';
import EinsatzSeite from '../components/EinsatzSeite';
import { gemeinsamerDatenstand } from '../components/Datenstand';
import Datensicht, { scrolleZurZeile, spaltenFuer } from '../components/Datensicht';
import {
  KATEGORIE_REIHENFOLGE,
  KATEGORIE_WERTE,
  kategorieEtikett,
  kategorieVon,
} from '../kraefte/statusAchse';
import { einsatzStatus, statusKategorie } from '../theme/statusFarben';
import { abstand } from '../theme/tokens';
import StatusTag from '../components/StatusTag';
import { personalStatusDarstellung } from '../kraefte/mittelStatus';
import { useFehlerMeldung } from '../components/useFehlerMeldung';
import {
  katalogStatusWechsel,
  useOptimistischesZeilenUpdate,
} from '../kraefte/useOptimistischesZeilenUpdate';

export default function PersonalPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { benutzer } = useAuth();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [adhocOffen, setAdhocOffen] = useState(false);
  const [highlightId, setHighlightId] = useState<number | null>(null);

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const epQuery = useQuery({
    queryKey: einsatzKeys.personal(einsatzId),
    queryFn: () => listeEinsatzPersonal(einsatzId),
  });
  const statusQuery = useQuery({
    queryKey: globalKeys.personalStatus(),
    queryFn: listePersonalStatus,
  });
  const poolQuery = useQuery({
    queryKey: globalKeys.personalListe('im-dienst'),
    queryFn: () => listePersonal(true),
  });
  // Struktur-Listen zum Auflösen von einheit_id/fahrzeug_id → Klartext-Label (Gegenrichtung zur
  // Fahrzeugseite).
  const einheitenQuery = useQuery({
    queryKey: einsatzKeys.einheiten(einsatzId),
    queryFn: () => listeEinheiten(einsatzId),
  });
  const fahrzeugeQuery = useQuery({
    queryKey: einsatzKeys.fahrzeuge(einsatzId),
    queryFn: () => listeEinsatzFahrzeuge(einsatzId),
  });
  // Kräfte-Zeitachse (LFH-552): Perioden je Person für „Einsatzdauer" und „Ruhe". Scheitert der
  // Abruf, bleiben die Zellen leer — ein „—" behauptete sonst „keine Ereignisse".
  const periodenQuery = useQuery({
    queryKey: einsatzKeys.kraefteZeitachsePersonal(einsatzId),
    queryFn: () => listePersonalPerioden(einsatzId),
  });
  const uhr = useUhr(60_000);

  // Cross-Modul-Deeplink ?personal=<id> hebt die Zeile hervor und scrollt sie ins Bild
  // (best-effort).
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
  const fehler = useFehlerMeldung();

  const disponiereMutation = useMutation({
    mutationFn: (personalId: number) => disponierePerson(einsatzId, personalId),
    onSuccess: () => {
      message.success('Personal disponiert');
      invalidate();
    },
    onError: fehler,
  });
  const statusMutation = useOptimistischesZeilenUpdate<
    EinsatzPersonal,
    { epId: number; statusId: number }
  >({
    queryKey: einsatzKeys.personal(einsatzId),
    mutationFn: (v) => aktualisiereDisposition(einsatzId, v.epId, { status_id: v.statusId }),
    zeilenId: (v) => v.epId,
    ...katalogStatusWechsel<EinsatzPersonal>(statusQuery.data),
    onFehler: fehler,
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
   * Listenzustand — der Fehler allein reicht als Bedingung nicht. Ohne Zeilen im Zwischenspeicher
   * tritt der Fehler an die Stelle der Datensicht, sonst behauptete „Noch kein Personal disponiert"
   * eine leere Disposition. Mit Zeilen bleiben sie stehen und bekommen ein Banner: echt, nur
   * womöglich alt.
   *
   * Gemessen an `eps`, der ungefilterten Menge: Suche, Trägerfilter und Gruppenachse leben im
   * Primitiv; an ihrer Restmenge gemessen kippte die Seite bei jedem engen Filter in den
   * Fehlerzweig.
   *
   * Nicht zu verwechseln mit dem Statuskatalog-Banner weiter unten: das steht zusätzlich über der
   * Tabelle und tauscht nichts aus.
   */
  const listeGescheitert = epQuery.isError && eps.length === 0;
  const standVeraltet = epQuery.isError && eps.length > 0;

  const einheitById = new Map((einheitenQuery.data ?? []).map((e) => [e.id, e] as const));
  const fahrzeugById = new Map((fahrzeugeQuery.data ?? []).map((f) => [f.id, f] as const));
  const stati = statusQuery.data ?? [];

  /**
   * Der Katalog als Menüwerte — einmal gebaut, von Tabellen- und Kartenzweig gelesen.
   * Mandantengepflegt wie beim Fahrzeug; zu viele Werte für eine waagerechte Reihe.
   */
  const statusOptionen: StatusOption<number>[] = stati.map((s) => ({
    wert: s.id,
    label: s.label,
    darstellung: s.kategorie ? statusKategorie[s.kategorie] : undefined,
    farbe: s.farbe,
  }));

  /** Gemeinsamer Bedienweg für beide Zweige — Herleitung in `FahrzeugePage.tsx`. */
  const statusBedienungVon = (ep: EinsatzPersonal) => {
    const laeuft = statusMutation.isPending && statusMutation.variables?.epId === ep.id;
    return {
      optionen: statusOptionen,
      aktuell: laeuft ? statusMutation.variables?.statusId : ep.status_id,
      farbe: ep.status_farbe,
      kennung: ep.name,
      laeuft,
      gesperrt: statusMutation.isPending,
      onWaehlen: (wert: string | number) => {
        if (!statusMutation.isPending)
          statusMutation.mutate({ epId: ep.id, statusId: Number(wert) });
      },
    };
  };

  const disponierteIds = new Set(
    eps.map((e) => e.personal_id).filter((x): x is number => x != null),
  );
  const poolOptionen = (poolQuery.data ?? [])
    .filter((p) => !disponierteIds.has(p.id))
    .map((p) => ({
      value: p.id,
      label: `${p.name}${p.personalnummer ? ` (${p.personalnummer})` : ''}`,
    }));

  /**
   * Was ein leeres Auswahlfeld bedeutet, hängt daran, ob die Liste ankam. Scheitert der Abruf,
   * filtert der Ausdruck darüber auf die leere Menge, und das Feld behauptete „Keine freien
   * Personen". Ohne Fehler bleibt der Bestandswortlaut.
   *
   * Kein `kein403`: die Personal-Route ist org-lesbar ohne Admin-Schranke.
   */
  const poolInhalt =
    nichtGefundenInhalt(poolQuery, {
      allgemein: 'Personalliste konnte nicht geladen werden',
    }) ?? 'Keine freien Personen';

  /**
   * Trägerfilter aus den eigenen Daten; `undefined` ohne Werte. Das Feld erscheint erst mit dem
   * ersten gepflegten Wert, nach dem Laden — gewollt: ein dauerhaft leeres Filterfeld sieht wie ein
   * Werkzeug aus und ist keins.
   */
  const traegerWerte = [
    ...new Set(eps.map((e) => e.traegerorganisation).filter((t): t is string => !!t)),
  ]
    .sort()
    .map((t) => ({ text: t, value: t }));
  const traegerFilter =
    traegerWerte.length > 0
      ? {
          werte: traegerWerte,
          trifft: (e: EinsatzPersonal, w: string) => e.traegerorganisation === w,
        }
      : undefined;

  /**
   * Spaltenregister der Personalseite — die breiteste Fläche (9 Spalten) und damit der erste
   * Adressat des Spaltenschalters. Durch `spaltenFuer<EinsatzPersonal>()` geführt, nicht annotiert.
   *
   * ── Kein `abBreite` auf `position` ──
   *
   * antds `xl` liegt bei 1200 px; auf dem Führungs-Tablet (1024–1280 px) verschwände die Spalte
   * genau dort, wo sie gebraucht wird. `position` ist eine von zwei Schreib-Bedienungen, und es
   * gibt keine Detailroute als Ausweichort. Wer sie weghaben will, nimmt
   * `spaltenAusVoreinstellung`; dann steht sie im Schalter und im Zähler.
   */
  const periodenBereit = abrufZustand(periodenQuery) === 'daten';
  const dauernJePerson = new Map<number, KraftDauern>(
    (periodenQuery.data ?? []).map((p) => [p.personal_id, kraftDauern(p.perioden, uhr.valueOf())]),
  );
  /** Dauerzelle: leer ohne Daten, „—" ohne Ereignis (keine erfundene 0). */
  const dauerZelle = (minuten: number | null | undefined) =>
    periodenBereit ? (
      <span style={{ ...monoStil(12), whiteSpace: 'nowrap' }}>
        {minuten == null ? '—' : dauerText(minuten)}
      </span>
    ) : null;

  const spalten = spaltenFuer<EinsatzPersonal>()([
    {
      title: 'Name',
      key: 'name',
      immerSichtbar: true,
      sortWert: (ep) => ep.name,
      suchText: (ep) => ep.name,
      // Der Deeplink der Fahrzeug-/Einheitsspalte wandert nicht hierher: nur die Titelspalte dürfte
      // `titel.ziel` tragen, und `personalPfad` zeigte auf diese Seite.
      render: (_, ep) => (
        <Space>
          {ep.name}
          {ep.ist_adhoc && <Tag color="blue">ad-hoc</Tag>}
        </Space>
      ),
    },
    {
      title: 'Funktion',
      dataIndex: 'funktion',
      key: 'funktion',
      sortWert: (ep) => ep.funktion,
      suchText: (ep) => ep.funktion,
      render: (t) => t ?? '—',
    },
    {
      title: 'Träger',
      dataIndex: 'traegerorganisation',
      key: 'traeger',
      filter: traegerFilter,
      render: (t) => t ?? '—',
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
            onChange={(position) =>
              positionMutation.mutate({ epId: ep.id, position: position ?? null })
            }
          />
        ) : ep.staerke_position ? (
          POSITION_LABELS[ep.staerke_position]
        ) : (
          '—'
        ),
    },
    {
      title: 'Status',
      key: 'status',
      // Gefiltert wird über die Kategorie, nicht über `status_id`: die ID kommt aus dem
      // Mandantenkatalog und passte nicht zu den Gruppen.
      filter: {
        werte: KATEGORIE_WERTE,
        trifft: (ep, w) => kategorieVon(ep.status_kategorie) === w,
      },
      // Kein `Select` mit Mindestbreite (die 390-px-Karte scheiterte daran). Deskriptor ganz
      // gespreizt — Herleitung in `FahrzeugePage.tsx`.
      render: (_, ep) => (
        <StatusWahl
          darstellung={personalStatusDarstellung(ep)}
          darfSchreiben={darfSchreiben}
          {...statusBedienungVon(ep)}
        />
      ),
    },
    // Einsatzwert im Lagevortrag (LFH-552): laufende Dauer bzw. Ruhe seit der letzten Periode.
    {
      title: 'Einsatzdauer',
      key: 'einsatzdauer',
      width: 104,
      render: (_, ep) => dauerZelle(dauernJePerson.get(ep.id)?.laufend?.minuten),
    },
    {
      title: 'Ruhe',
      key: 'ruhe',
      width: 88,
      render: (_, ep) => dauerZelle(dauernJePerson.get(ep.id)?.ruheMinuten),
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
              <Popconfirm
                title="Aus Einsatz entfernen?"
                onConfirm={() => entfernenMutation.mutate(ep.id)}
              >
                {/* Kein `danger`: Rot ist Gefahr, nicht Bedienung. Der zweite Handgriff ist die
                    Rückfrage. */}
                <Button>Entfernen</Button>
              </Popconfirm>
            ),
          },
        ]
      : []),
  ]);

  return (
    <EinsatzSeite
      meta={epQuery.isSuccess ? `${eps.length} Kräfte` : undefined}
      dataUpdatedAt={gemeinsamerDatenstand(
        epQuery.dataUpdatedAt,
        einheitenQuery.dataUpdatedAt,
        fahrzeugeQuery.dataUpdatedAt,
      )}
      titel={
        <Space>
          Personal
          <StatusTag darstellung={einsatzStatus[einsatz.status]} />
        </Space>
      }
      breadcrumb={
        <Breadcrumb
          items={[
            { title: <Link to="/einsaetze">Einsätze</Link> },
            { title: einsatz.bezeichnung },
            { title: 'Personal' },
          ]}
        />
      }
      aktionen={
        darfSchreiben && (
          // `wrap` plus `maxWidth` — Herleitung in `FahrzeugePage.tsx`.
          <Space wrap style={{ minWidth: 0 }}>
            <Select
              style={{ minWidth: 260, maxWidth: '100%' }}
              placeholder="Person aus Pool disponieren …"
              value={null}
              options={poolOptionen}
              notFoundContent={poolInhalt}
              loading={disponiereMutation.isPending}
              disabled={disponiereMutation.isPending}
              onSelect={(personalId) => {
                if (personalId != null) disponiereMutation.mutate(personalId);
              }}
            />
            <Button onClick={() => setAdhocOffen(true)}>Ad-hoc-Person</Button>
          </Space>
        )
      }
      hinweis={
        !darfSchreiben &&
        einsatz.status !== 'aktiv' && (
          <Alert type="info" showIcon title="Einsatz ist abgeschlossen — nur Ansicht." />
        )
      }
    >
      {/* `titel` ohne `ziel`: `personalPfad` ist eine Query-Param-Selektion auf diese Seite,
          der Link zeigte auf sich selbst und machte die Namenszelle zum Link. Die echten
          Fremd-Links (Fahrzeug, Einheit) bleiben in ihren Zellen.

          `zufluss` bleibt `sammelbanner`: zwei Auswahlfelder in der Zeile (Position, Status),
          eigener wie fremder Wechsel läuft über eine Invalidierung. */}

      {/* Der Statuskatalog trägt die Auswahlliste jeder Statuszelle. Fällt er aus, wäre der
          Statuswechsel lautlos unmöglich; die Meldung steht deshalb über der Tabelle.

          An `darfSchreiben` gekoppelt: wer nur liest, sieht `StatusBadge` aus den Zeilendaten
          und verliert nichts. (Die Positionsspalte bleibt bedienbar — `POSITION_OPTIONEN` ist
          ein lokales Enum.) */}
      {darfSchreiben && statusQuery.isError && (
        <div style={{ marginBottom: abstand.md }}>
          <SeitenFehler
            text="Statuskatalog konnte nicht geladen werden — Statuswechsel derzeit nicht möglich"
            ursache={statusQuery.error}
            onWiederholen={() => void statusQuery.refetch()}
          />
        </div>
      )}

      {/* Der Listenfehler tauscht die Datensicht aus: `Datensicht` führt den Kartenzweig an
          `Liste`, und `ListeProps` kennt keinen Fehlerbegriff. Ohne diese Weiche behauptete
          „Noch kein Personal disponiert" eine leere Disposition, wenn bloß die Verbindung
          abgerissen ist. */}
      {listeGescheitert ? (
        <SeitenFehler
          text="Disponiertes Personal konnte nicht geladen werden"
          ursache={epQuery.error}
          onWiederholen={() => void epQuery.refetch()}
        />
      ) : (
        <>
          {standVeraltet && <SeitenStandVeraltet onWiederholen={() => void epQuery.refetch()} />}
          <Verdichtungszeile einsatzId={einsatzId} pfad={kraefteuebersichtPfad(einsatzId)} />
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
              // Die Gruppenköpfe stehen direkt unter dem Seitentitel (h1).
              unterEbene: 1,
            }}
            zeilenKlasse={(r) => (r.id === highlightId ? 'zeile-hervorgehoben' : undefined)}
            // Zeitachse der Person (LFH-552) ohne Seitenwechsel — Inline-Expander statt Drawer.
            aufklappen={{
              etikett: 'Zeitachse',
              zugaenglicherName: (ep) => `Zeitachse zu ${ep.name}`,
              inhalt: (ep) => (
                <KraftZeitachse
                  einsatzId={einsatzId}
                  art="person"
                  id={ep.id}
                  kennung={ep.name}
                  darfSchreiben={darfSchreiben}
                />
              ),
            }}
            karte={{
              art: 'plan',
              titel: { spalte: 'name' },
              status: (ep) => personalStatusDarstellung(ep),
              // Der Bedienweg sitzt am Status-, nicht am Aktions-Slot: der ist mit „Entfernen"
              // belegt, und `Datensicht` sichert genau eine Primäraktion zu.
              statusBedienung: (ep) => (darfSchreiben ? statusBedienungVon(ep) : null),
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

      {/* Ad-hoc-Disposition mit Serienmodus: an der Bereitstellung wird eine Helferkette am
          Stück aufgenommen. Trägerorganisation und Stärke-Position überleben das Speichern,
          weil sie sich über eine Kette am seltensten ändern. Maske und Feldbudget liegen im
          Bauteil, das auch der Stab öffnet. */}
      <AdhocPersonModal
        offen={adhocOffen}
        einsatzId={einsatzId}
        serie
        onSchliessen={() => setAdhocOffen(false)}
      />
    </EinsatzSeite>
  );
}
