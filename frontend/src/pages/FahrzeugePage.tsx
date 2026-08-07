import { Alert, App, Breadcrumb, Button, Collapse, Form, Input, Popconfirm, Space, Tag, Typography } from 'antd';
import { Select } from '../components/Select';
import { BemerkungZelle } from '../components/BemerkungZelle';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ladeEinsatz } from '../api/einsaetze';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { useAuth } from '../auth/AuthContext';
import { useQueryParamSelektion } from '../routing/useQueryParamSelektion';
import { listeFahrzeuge } from '../api/fahrzeuge';
import { listeFahrzeugStatus } from '../api/fahrzeugStatus';
import {
  aktualisiereDisposition, disponiereAdhoc, disponiereFahrzeug, entferneDisposition,
  gibBesatzungFrei, listeEinsatzFahrzeuge, ordneBesatzungZu, type AdhocEingabe,
} from '../api/einsatzFahrzeuge';
import { listeEinsatzPersonal } from '../api/einsatzPersonal';
import { ApiError } from '../api/client';
import { einsatzKeys, globalKeys } from '../api/queryKeys';
import type { EinsatzFahrzeug, EinsatzPersonal, Staerke } from '../api/types';
import StaerkeAnzeige from '../anzeige/StaerkeAnzeige';
import StatusTag from '../components/StatusTag';
import EinsatzSeite from '../components/EinsatzSeite';
import { gemeinsamerDatenstand } from '../components/Datenstand';
import Datensicht, { scrolleZurZeile, spaltenFuer } from '../components/Datensicht';
import { ErfassungsModal } from '../components/Erfassung';
import { nichtGefundenInhalt, SeitenFehler, SeitenSkeleton, SeitenStandVeraltet } from '../components/SeitenZustand';
import { KATEGORIE_REIHENFOLGE, KATEGORIE_WERTE, kategorieEtikett, kategorieVon } from '../kraefte/statusAchse';
import { statusKategorie } from '../theme/statusFarben';
import { abstand, flaeche } from '../theme/tokens';

/**
 * Statusanzeige eines disponierten Fahrzeugs — und zugleich die GRENZE des
 * Statusfarb-Vertrags (LFH-328/A2, Spec §1.3).
 *
 * Die Anzeige hat zwei Achsen, und nur eine davon kann der Vertrag tragen:
 *
 * 1. **DB-Achse** — `status_farbe` ist mandantengepflegter Freitext aus den
 *    Stammdaten-Tabs. Das Backend (`src/routes/fahrzeug_status.rs`) trimmt ihn und
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
function StatusBadge({ ef }: { ef: EinsatzFahrzeug }) {
  if (!ef.status_label || !ef.status_kategorie) return <Tag>kein Status</Tag>;
  if (ef.status_farbe) return <Tag color={ef.status_farbe}>{ef.status_label}</Tag>;
  const meta = statusKategorie[ef.status_kategorie];
  return <StatusTag darstellung={{ ...meta, label: ef.status_label }} />;
}

/**
 * Ist-Besatzungsstärke aus den Stärke-Positionen der zugeordneten Kräfte (clientseitig
 * gezählt; LFH-9 hält das bewusst orthogonal zur Einheiten-Stärke — kein Backend-Aggregat).
 *
 * Eine Kraft ohne explizite F/UF-Position (`staerke_position == null`) ist trotzdem physisch
 * auf dem Fahrzeug und zählt zur Stärke — in der BOS-Schreibweise als Mannschaft (Sammeltopf),
 * sodass Σ die tatsächliche Kopfzahl der Besatzung bleibt.
 */
function istBesatzungsStaerke(crew: EinsatzPersonal[]): Staerke {
  const s: Staerke = { fuehrer: 0, unterfuehrer: 0, mannschaft: 0 };
  for (const m of crew) {
    if (m.staerke_position === 'fuehrer') s.fuehrer += 1;
    else if (m.staerke_position === 'unterfuehrer') s.unterfuehrer += 1;
    else s.mannschaft += 1;
  }
  return s;
}

/** Soll gilt als erfüllt, wenn Ist in JEDER Position (F/UF/M) ≥ Soll ist (Überbesetzung zählt mit). */
function istSollErfuellt(ist: Staerke, soll: Staerke): boolean {
  return ist.fuehrer >= soll.fuehrer
    && ist.unterfuehrer >= soll.unterfuehrer
    && ist.mannschaft >= soll.mannschaft;
}

/**
 * Besatzungs-Ist als Ampel-Badge (LFH-9): blau ohne hinterlegtes Soll (kein „erfüllt"-Urteil
 * möglich), grün bei erfülltem Soll (nur Ist, ohne redundanten Soll-Text), sonst rot mit Soll
 * in Klammern. Die Klammer ist zugleich das nicht-farbliche Signal für Unterbesetzung (a11y),
 * `title` ergänzt grün/blau um ein nicht-farbliches Signal.
 */
function BesatzungsStaerkeBadge({ ist, soll }: { ist: Staerke; soll: Staerke | null }) {
  if (!soll) {
    return <Tag color="blue" title="kein Soll hinterlegt"><StaerkeAnzeige wert={ist} /></Tag>;
  }
  if (istSollErfuellt(ist, soll)) {
    return <Tag color="green" title="Soll erfüllt"><StaerkeAnzeige wert={ist} /></Tag>;
  }
  return (
    <Tag color="red" title="unterbesetzt">
      <StaerkeAnzeige wert={ist} /> (Soll <StaerkeAnzeige wert={soll} />)
    </Tag>
  );
}

/**
 * Besatzungs-Block je disponiertem Fahrzeug (LFH-9): Mitglieder (gefiltert über
 * `fahrzeug_id`), Ist/Soll als `Staerke`, Frei-Pool-Picker (nur `fahrzeug_id == null`).
 * Eine Kraft, die in einer anderen Einheit als das Fahrzeug ist, wird markiert
 * (Transparenz der bewusst orthogonalen Zuordnung).
 */
function BesatzungsBlock({
  ef, personal, darfSchreiben, freiInhalt, onZuordnen, onFreigeben,
}: {
  ef: EinsatzFahrzeug;
  personal: EinsatzPersonal[];
  darfSchreiben: boolean;
  /**
   * Text des Frei-Pools, wenn er nichts anzubieten hat — vom Aufrufer entschieden, weil
   * nur dort bekannt ist, OB die Personalliste überhaupt ankam (LFH-331 · B3). Der Block
   * bekommt einen fertigen String und keine Query: er soll den Zustand anzeigen, nicht
   * über ihn urteilen.
   */
  freiInhalt: string;
  onZuordnen: (epId: number) => void;
  onFreigeben: (epId: number) => void;
}) {
  const crew = personal.filter((p) => p.fahrzeug_id === ef.id);
  const frei = personal.filter((p) => p.fahrzeug_id == null);
  const ist = istBesatzungsStaerke(crew);
  return (
    <div style={{ paddingLeft: 8 }}>
      <Space size={abstand.sm} style={{ marginBottom: abstand.sm }}>
        <Typography.Text type="secondary">Besatzung</Typography.Text>
        <BesatzungsStaerkeBadge ist={ist} soll={ef.soll_besatzung ?? null} />
      </Space>
      {crew.length === 0 ? (
        <div><Typography.Text type="secondary">Keine Besatzung zugeordnet</Typography.Text></div>
      ) : (
        crew.map((m) => (
          <Space key={m.id} style={{ display: 'flex', justifyContent: 'space-between', maxWidth: 420 }}>
            <Space size={abstand.sm}>
              <span>{m.name}{m.staerke_position ? ` (${m.staerke_position})` : ''}</span>
              {m.einheit_id != null && m.einheit_id !== ef.einheit_id && (
                <Tag color="orange" style={{ margin: 0 }}>andere Einheit</Tag>
              )}
            </Space>
            {darfSchreiben && (
              <Button danger onClick={() => onFreigeben(m.id)}>Freigeben</Button>
            )}
          </Space>
        ))
      )}
      {darfSchreiben && (
        <Select
          style={{ width: '100%', maxWidth: 420, marginTop: 8 }}
          placeholder="Kraft zur Besatzung …"
          value={null}
          notFoundContent={freiInhalt}
          options={frei.map((p) => ({ value: p.id, label: p.name }))}
          onSelect={(epId) => onZuordnen(Number(epId))}
        />
      )}
    </div>
  );
}

export default function FahrzeugePage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { benutzer } = useAuth();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [adhocOffen, setAdhocOffen] = useState(false);
  const [highlightId, setHighlightId] = useState<number | null>(null);
  const [form] = Form.useForm<AdhocEingabe>();

  const einsatzQuery = useQuery({ queryKey: einsatzKeys.einsatz(einsatzId), queryFn: () => ladeEinsatz(einsatzId) });
  const efQuery = useQuery({
    queryKey: einsatzKeys.fahrzeuge(einsatzId),
    queryFn: () => listeEinsatzFahrzeuge(einsatzId),
  });
  const statusQuery = useQuery({ queryKey: globalKeys.fahrzeugStatus(), queryFn: listeFahrzeugStatus });
  const poolQuery = useQuery({ queryKey: globalKeys.fahrzeugeListe('im-dienst'), queryFn: () => listeFahrzeuge(true) });
  const personalQuery = useQuery({
    queryKey: einsatzKeys.personal(einsatzId),
    queryFn: () => listeEinsatzPersonal(einsatzId),
  });

  // Cross-Modul-Deeplink (LFH-25): ?fahrzeug=<id> hebt die Zeile hervor (Scroll best-effort).
  useQueryParamSelektion('fahrzeug', efQuery.isSuccess, (fid) => {
    if ((efQuery.data ?? []).some((f) => f.id === fid)) setHighlightId(fid);
  });
  useEffect(() => {
    if (highlightId == null) return;
    scrolleZurZeile(highlightId);
  }, [highlightId]);

  function invalidate() {
    qc.invalidateQueries({ queryKey: einsatzKeys.fahrzeuge(einsatzId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.personal(einsatzId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
  }
  const fehler = (e: unknown) => message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');

  const disponiereMutation = useMutation({
    mutationFn: (fahrzeugId: number) => disponiereFahrzeug(einsatzId, fahrzeugId),
    onSuccess: () => { message.success('Fahrzeug disponiert'); invalidate(); },
    onError: fehler,
  });
  // Schliessen und Leeren gehoeren seit LFH-332/B4 der Erfassungshuelle: sie schliesst ueber
  // `onFertig` (nur beim Einzel-Erfassen) und setzt auf BEIDEN Wegen zurueck. Ein Reset hier
  // waere doppelt — und im Serienmodus falsch, weil er die uebernommenen Werte mitloeschte.
  const adhocMutation = useMutation({
    mutationFn: (daten: AdhocEingabe) => disponiereAdhoc(einsatzId, daten),
    onSuccess: invalidate,
    onError: fehler,
  });
  const statusMutation = useMutation({
    mutationFn: (v: { efId: number; statusId: number }) =>
      aktualisiereDisposition(einsatzId, v.efId, { status_id: v.statusId }),
    onMutate: async (v) => {
      const queryKey = einsatzKeys.fahrzeuge(einsatzId);
      await qc.cancelQueries({ queryKey });
      const vorher = qc.getQueryData<EinsatzFahrzeug[]>(queryKey)?.find((ef) => ef.id === v.efId);
      const status = statusQuery.data?.find((s) => s.id === v.statusId);
      qc.setQueryData<EinsatzFahrzeug[]>(queryKey, (alt) =>
        alt?.map((ef) => ef.id === v.efId
          ? {
              ...ef,
              status_id: v.statusId,
              status_label: status?.label ?? ef.status_label,
              status_kategorie: status?.kategorie ?? ef.status_kategorie,
              status_farbe: status?.farbe ?? null,
            }
          : ef),
      );
      return { vorher };
    },
    onSuccess: (serverStand) => {
      qc.setQueryData<EinsatzFahrzeug[]>(einsatzKeys.fahrzeuge(einsatzId), (alt) =>
        alt?.map((ef) => ef.id === serverStand.id ? serverStand : ef),
      );
    },
    onError: (e, v, kontext) => {
      const vorher = kontext?.vorher;
      if (vorher) {
        qc.setQueryData<EinsatzFahrzeug[]>(einsatzKeys.fahrzeuge(einsatzId), (aktuell) =>
          aktuell?.map((ef) => ef.id === v.efId && ef.status_id === v.statusId
            ? {
                ...ef,
                status_id: vorher.status_id,
                status_label: vorher.status_label,
                status_kategorie: vorher.status_kategorie,
                status_farbe: vorher.status_farbe,
              }
            : ef),
        );
      }
      fehler(e);
    },
    onSettled: invalidate,
  });
  const bemerkungMutation = useMutation({
    mutationFn: (v: { efId: number; bemerkung: string }) =>
      aktualisiereDisposition(einsatzId, v.efId, { bemerkung: v.bemerkung }),
    onSuccess: invalidate,
    onError: fehler,
  });
  const entfernenMutation = useMutation({
    mutationFn: (efId: number) => entferneDisposition(einsatzId, efId),
    onSuccess: invalidate,
    onError: fehler,
  });
  const besatzungZuMutation = useMutation({
    mutationFn: (v: { efId: number; epId: number }) => ordneBesatzungZu(einsatzId, v.efId, v.epId),
    onSuccess: invalidate,
    onError: fehler,
  });
  const besatzungFreiMutation = useMutation({
    mutationFn: (v: { efId: number; epId: number }) => gibBesatzungFrei(einsatzId, v.efId, v.epId),
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

  const efs = efQuery.data ?? [];

  /**
   * LISTENZUSTAND — zwei Lagen, zwei Antworten (D3). Der Fehler allein reicht als
   * Bedingung NICHT.
   *
   * Ohne Zeilen im Zwischenspeicher tritt der Fehler an die Stelle der Datensicht, sonst
   * behauptet „Noch keine Fahrzeuge disponiert" eine leere Disposition, wo bloß der Abruf
   * scheiterte. MIT Zeilen bleiben sie stehen und bekommen ein Banner: sie sind echt, nur
   * womöglich alt. Ein Fehler, der die Zeilen wegräumt, nähme der Einsatzkraft Daten, die
   * sie eben noch hatte — das Gegenteil dessen, wofür `SeitenStandVeraltet` gebaut ist.
   *
   * Gemessen an `efs`, der UNGEFILTERTEN Menge (Muster aus `TierePage`/`SchaedenPage`):
   * Suche, Trägerfilter und Gruppenachse leben IM Primitiv, an ihrer Restmenge gemessen
   * kippte die Seite bei jedem engen Filter in den Fehlerzweig — und nähme dem Bediener
   * die Schalter, mit denen er ihn wieder aufmachen könnte.
   *
   * NICHT zu verwechseln mit dem Statuskatalog-Banner weiter unten: das steht ZUSÄTZLICH
   * über der Tabelle und tauscht nichts aus. Eine Mengenbedingung hat dort nichts zu
   * suchen — es verschwindet nichts, also ist auch nichts zu bewahren.
   */
  const listeGescheitert = efQuery.isError && efs.length === 0;
  const standVeraltet = efQuery.isError && efs.length > 0;

  const stati = statusQuery.data ?? [];
  const personal = personalQuery.data ?? [];
  const disponierteIds = new Set(efs.map((e) => e.fahrzeug_id).filter((x): x is number => x != null));
  const poolOptionen = (poolQuery.data ?? [])
    .filter((f) => !disponierteIds.has(f.id))
    .map((f) => ({ value: f.id, label: `${f.funkrufname}${f.fahrzeugtyp ? ` (${f.fahrzeugtyp})` : ''}` }));

  /**
   * Was ein leeres Auswahlfeld bedeutet, hängt daran, OB die Liste überhaupt ankam
   * (LFH-331 · B3). Scheitert der Abruf, filtert der Ausdruck darüber auf die leere Menge
   * und das Feld behauptete „Keine freien Fahrzeuge" — eine Aussage über den Bestand, die
   * niemand geprüft hat. `nichtGefundenInhalt` liefert nur im Fehlerfall einen Text; sonst
   * bleibt der Bestandswortlaut byte-gleich stehen.
   *
   * KEIN `kein403`: `src/routes/fahrzeug.rs` und `personal.rs` sind org-lesbar ohne
   * Admin-Schranke (nur `benutzer.rs` trägt eine). Ein „nur für Admins" am Fahrzeug-Pool
   * wäre ein erfundener Fehlerfall.
   */
  const poolInhalt = nichtGefundenInhalt(poolQuery, {
    allgemein: 'Fahrzeugliste konnte nicht geladen werden',
  }) ?? 'Keine freien Fahrzeuge';
  const besatzungInhalt = nichtGefundenInhalt(personalQuery, {
    allgemein: 'Kräfte konnten nicht geladen werden',
  }) ?? 'Keine freien Kräfte';

  /**
   * Trägerfilter aus den EIGENEN Daten (Muster der Kräfteübersicht). `undefined`, wenn
   * kein Fahrzeug eine Trägerorganisation trägt — ein Filterfeld mit null Optionen wäre
   * Rauschen in der Werkzeugzeile, kein Werkzeug.
   *
   * BEWUSSTE FOLGE, damit sie nicht unbenannt bleibt: das Feld erscheint erst mit dem
   * ersten gepflegten Wert, also nach dem Laden — in der umbrechenden Werkzeugzeile eine
   * kleine Verschiebung. Der Tausch ist gewollt: ein dauerhaft leeres Filterfeld sieht wie
   * ein Werkzeug aus und ist keins.
   */
  const traegerWerte = [...new Set(efs.map((e) => e.traegerorganisation).filter((t): t is string => !!t))]
    .sort()
    .map((t) => ({ text: t, value: t }));
  const traegerFilter = traegerWerte.length > 0
    ? { werte: traegerWerte, trifft: (e: EinsatzFahrzeug, w: string) => e.traegerorganisation === w }
    : undefined;

  /**
   * Spaltenregister der Fahrzeugseite (LFH-330 · B2).
   *
   * Durch `spaltenFuer<EinsatzFahrzeug>()` geführt und NICHT annotiert: eine Annotation
   * weitet die Schlüsselliterale auf `string`, und der Kartenplan nähme danach jeden
   * Tippfehler ohne Meldung an.
   *
   * ── `abBreite` NUR FÜR LESENDE SPALTEN ──────────────────────────────────────────
   *
   * `abBreite` versteckt eine Spalte, ohne dass der Nutzer sie zurückholen kann.
   * Schreibtragende Spalten (`status`, `bemerkung`, `aktionen`) bekommen deshalb NIE eins;
   * soll eine davon weichen, dann über `spaltenAusVoreinstellung` — dann steht sie im
   * Spaltenschalter, im Zähler, und ein Klick holt sie zurück. Genau deshalb hat
   * `bemerkung` hier KEIN `abBreite`, obwohl die API-Spec eins vorschlägt.
   */
  const spalten = spaltenFuer<EinsatzFahrzeug>()([
    {
      title: 'Funkrufname',
      key: 'funkrufname',
      immerSichtbar: true,
      sortWert: (ef) => ef.funkrufname,
      suchText: (ef) => ef.funkrufname,
      render: (_, ef) => (
        <Space>
          {ef.funkrufname}
          {ef.ist_adhoc && <Tag color="blue">ad-hoc</Tag>}
        </Space>
      ),
    },
    {
      title: 'Typ', dataIndex: 'fahrzeugtyp', key: 'typ',
      sortWert: (ef) => ef.fahrzeugtyp, suchText: (ef) => ef.fahrzeugtyp,
      render: (t) => t ?? '—',
    },
    {
      title: 'Kennzeichen', dataIndex: 'kennzeichen', key: 'kennzeichen', abBreite: 'lg',
      suchText: (ef) => ef.kennzeichen, render: (t) => t ?? '—',
    },
    {
      title: 'Träger', dataIndex: 'traegerorganisation', key: 'traeger',
      filter: traegerFilter, render: (t) => t ?? '—',
    },
    {
      title: 'Status',
      key: 'status',
      // Gefiltert wird über die KATEGORIE, nicht über `status_id`: die ID kommt aus dem
      // Mandantenkatalog und filterte je Mandant anders — und stimmte nicht mit den
      // Gruppen überein, die dieselbe Achse benutzen.
      filter: {
        werte: KATEGORIE_WERTE,
        trifft: (ef, w) => kategorieVon(ef.status_kategorie) === w,
      },
      render: (_, ef) =>
        darfSchreiben ? (() => {
          const gesperrt = statusMutation.isPending;
          const laeuft = gesperrt && statusMutation.variables?.efId === ef.id;
          return (
            <Select
              style={{ minWidth: 150 }}
              value={laeuft ? statusMutation.variables?.statusId : ef.status_id ?? undefined}
              placeholder="Status wählen"
              options={stati.map((s) => ({ value: s.id, label: s.label }))}
              loading={laeuft}
              disabled={gesperrt}
              onChange={(statusId) => {
                if (!statusMutation.isPending) statusMutation.mutate({ efId: ef.id, statusId });
              }}
            />
          );
        })() : (
          <StatusBadge ef={ef} />
        ),
    },
    {
      title: 'Besatzung',
      key: 'besatzung',
      render: (_, ef) => (
        <BesatzungsStaerkeBadge
          ist={istBesatzungsStaerke(personal.filter((p) => p.fahrzeug_id === ef.id))}
          soll={ef.soll_besatzung ?? null}
        />
      ),
    },
    {
      title: 'Bemerkung',
      key: 'bemerkung',
      render: (_, ef) => (
        <BemerkungZelle
          wert={ef.bemerkung}
          kennung={ef.funkrufname}
          darfSchreiben={darfSchreiben}
          onSpeichern={(val) => bemerkungMutation.mutate({ efId: ef.id, bemerkung: val })}
        />
      ),
    },
    ...(darfSchreiben
      ? [
          {
            title: 'Aktionen',
            key: 'aktionen' as const,
            immerSichtbar: true,
            render: (_: unknown, ef: EinsatzFahrzeug) => (
              <Popconfirm title="Aus Einsatz entfernen?" onConfirm={() => entfernenMutation.mutate(ef.id)}>
                {/* Kein `danger`: Rot ist Gefahr, nicht Bedienung (LFH-352/LFH-315). Der
                    zweite Handgriff aus Kriterium 4 ist die Rückfrage, nicht die Farbe. */}
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
      dataUpdatedAt={gemeinsamerDatenstand(efQuery.dataUpdatedAt, personalQuery.dataUpdatedAt)}
      titel={
        <Space>
          Fahrzeuge
          {/* BEFUND (LFH-328/A2): der Einsatz-Status trägt hier weiterhin antd-Farbnamen und
              den ROHEN Enum-String statt einer Statusrolle. `statusFarben.ts` hat für
              `EinsatzStatus` keinen Eintrag — die Vertragstabelle der Spec (§1.3) listet acht
              Enums, dieses ist keins davon. Die Zuordnung ist zwar entschieden (Spec §6,
              Prüflistenzeile 7), steht aber als lokale Map in `EinsaetzePage`. Sie hierher zu
              kopieren wäre eine dritte Wahrheit, sie nach `statusFarben.ts` zu heben eine
              Vertragserweiterung — beides ist nicht A2s Auftrag (Spec §5 Befund 7). */}
          <Tag color={einsatz.status === 'aktiv' ? 'green' : 'default'}>{einsatz.status}</Tag>
        </Space>
      }
      breadcrumb={
        <Breadcrumb
          items={[{ title: <Link to="/einsaetze">Einsätze</Link> }, { title: einsatz.bezeichnung }, { title: 'Fahrzeuge' }]}
        />
      }
      aktionen={
        darfSchreiben && (
          <Space>
            <Select
              style={{ minWidth: 260 }}
              placeholder="Stamm-Fahrzeug disponieren …"
              value={null}
              options={poolOptionen}
              notFoundContent={poolInhalt}
              loading={disponiereMutation.isPending}
              disabled={disponiereMutation.isPending}
              onSelect={(fahrzeugId) => { if (fahrzeugId != null) disponiereMutation.mutate(fahrzeugId); }}
            />
            <Button onClick={() => setAdhocOffen(true)}>Ad-hoc-Fahrzeug</Button>
          </Space>
        )
      }
      hinweis={
        !darfSchreiben && einsatz.status !== 'aktiv' && (
          <Alert type="info" showIcon title="Einsatz ist abgeschlossen — nur Ansicht." />
        )
      }
    >
      {/* `karte.titel` trägt bewusst KEIN `ziel`: `fahrzeugePfad` ist eine
          Query-Param-Selektion auf DIESE Seite (Deeplink-Muster), der Link zeigte also auf
          sich selbst — und er brach die gepinnte LFH-139-Aussage „in dieser Zeile steht kein
          Link". Tastaturziel der Karte ist damit die Primäraktion. Benannte Folge: eine
          Karte im Nur-Lese-Modus hat unter `md` kein fokussierbares Element; Kriterium 1
          wird im Kartenzweig am Aktionsknopf und am Spaltenschalter gemessen.

          `zufluss` bleibt der Default `sammelbanner` — das ist die Kriterium-12-Antwort für
          genau diese Fläche: der Status wird IN der Zeile gewechselt, eigen wie fremd über
          eine Invalidierung. */}

      {/* Der Statuskatalog trägt die Auswahlliste JEDER Statuszelle. Fällt er aus, steht in
          der Zeile ein Auswahlfeld ohne Einträge — der Statuswechsel ist dann unmöglich, und
          zwar lautlos. Die Meldung steht deshalb über der Tabelle, nicht in der Zelle.

          An `darfSchreiben` gekoppelt, weil das Auswahlfeld selbst es ist: wer nur liest,
          sieht `StatusBadge` (aus den Zeilendaten) und verliert durch den Katalogausfall
          nichts. Ihm eine verlorene Fähigkeit anzukündigen, die er nie hatte, wäre falsch. */}
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
          Ohne diese Weiche behauptet „Noch keine Fahrzeuge disponiert" auch dann eine leere
          Disposition, wenn bloß die Verbindung abgerissen ist. */}
      {listeGescheitert ? (
        <SeitenFehler
          text="Disponierte Fahrzeuge konnten nicht geladen werden"
          ursache={efQuery.error}
          onWiederholen={() => void efQuery.refetch()}
        />
      ) : (
      <>
      {standVeraltet && <SeitenStandVeraltet onWiederholen={() => void efQuery.refetch()} />}
      <Datensicht
        bezeichnung="Fahrzeuge im Einsatz"
        spalten={spalten}
        daten={efs}
        zeilenSchluessel="id"
        ladend={efQuery.isLoading}
        leerText="Noch keine Fahrzeuge disponiert"
        suche={{ platzhalter: 'Funkrufname, Typ, Kennzeichen' }}
        standardSortierung={{ spalte: 'funkrufname', richtung: 'auf' }}
        spaltenAusVoreinstellung={['bemerkung']}
        gruppen={{
          schluessel: (ef) => kategorieVon(ef.status_kategorie),
          etikett: kategorieEtikett,
          reihenfolge: KATEGORIE_REIHENFOLGE,
        }}
        zeilenKlasse={(r) => (r.id === highlightId ? 'zeile-hervorgehoben' : undefined)}
        // Besatzung je Fahrzeug standardmäßig eingeklappt, per Icon aufklappbar; die
        // kompakte Ist/Soll-Stärke steht dauerhaft in der Besatzungs-Spalte. Läuft nur im
        // Tabellenzweig — unter `md` fehlt der Block, und das ist an dieser Stelle sichtbar.
        aufklappzeile={(ef) => (
          <BesatzungsBlock
            ef={ef}
            personal={personal}
            darfSchreiben={darfSchreiben}
            freiInhalt={besatzungInhalt}
            onZuordnen={(epId) => besatzungZuMutation.mutate({ efId: ef.id, epId })}
            onFreigeben={(epId) => besatzungFreiMutation.mutate({ efId: ef.id, epId })}
          />
        )}
        karte={{
          art: 'plan',
          titel: { spalte: 'funkrufname' },
          // NICHT das `render` der Statusspalte: dort steht im Schreibmodus ein
          // Auswahlfeld mit `minWidth: 150`, das eine 390-px-Karte breit drückt. Der Slot
          // nimmt die Vertragsachse mit dem Mandantenlabel — der TEXT ist damit in beiden
          // Zweigen identisch, die Farbe weicht ab, wenn der Mandant `status_farbe` pflegt
          // (ungeprüfter Freitext außerhalb des A2-Vertrags).
          status: (ef) =>
            ef.status_kategorie
              ? {
                  ...statusKategorie[ef.status_kategorie],
                  label: ef.status_label ?? statusKategorie[ef.status_kategorie].label,
                }
              : null,
          sekundaer: ['typ', 'traeger', 'besatzung'],
          aktion: darfSchreiben
            ? {
                etikett: 'Entfernen',
                bestaetigung: 'Aus Einsatz entfernen?',
                onKlick: (ef) => entfernenMutation.mutate(ef.id),
              }
            : undefined,
        }}
      />
      </>
      )}

      {/**
        * Ad-hoc-Disposition als Schnellerfassung (LFH-332 · B4).
        *
        * SERIENMODUS, weil hier der Regelfall eine MENGE ist: trifft eine fremde Einheit ein,
        * werden ihre Fahrzeuge nacheinander erfasst. „Speichern und nächste" hält den Dialog
        * offen und den Fokus im Funkrufnamen; `Trägerorganisation` und `Fahrzeugtyp` überleben
        * das Speichern (`uebernahme`) — beim Zug einer Einheit ist der Träger für alle gleich
        * und der Typ oft auch, und genau diese beiden Wiederholfelder kosten sonst je Fahrzeug
        * einen zweiten Tippdurchgang.
        *
        * FELDBUDGET: vier sichtbare Felder, `OPTA` liegt zugeklappt unter „Weitere Angaben".
        * Die OPTA ist die taktisch-technische Betriebsstelle — bei einem ad-hoc erfassten
        * Fremdfahrzeug ist sie im Erfassungsmoment meist unbekannt, während Funkrufname, Typ,
        * Träger und Kennzeichen am Fahrzeug ablesbar sind.
        *
        * `forceRender` am Klapp-Bereich: das eingeklappte Feld bleibt im Baum, damit ein
        * eingetragener und danach zugeklappter Wert beim Absenden mitgeht. (antds `preserve`
        * hielte den WERT zwar ohnehin, aber erst nach einem ersten Rendern — und ohne
        * `forceRender` ist das Feld für Tastatur und Prüfung schlicht nicht da.)
        */}
      <ErfassungsModal<AdhocEingabe>
        offen={adhocOffen}
        titel="Ad-hoc-Fahrzeug disponieren"
        form={form}
        erfassenText="Disponieren"
        serie
        uebernahme={['traegerorganisation', 'fahrzeugtyp']}
        laeuft={adhocMutation.isPending}
        // `mutateAsync`, nicht `mutate`: die Hülle darf die Felder nur leeren, wenn der
        // Datensatz wirklich ankam. Den Fehlertext meldet weiterhin `onError` der Mutation.
        onErfassen={(w) => adhocMutation.mutateAsync(w)}
        onFertig={() => setAdhocOffen(false)}
        onAbbrechen={() => setAdhocOffen(false)}
      >
        <Form.Item label="Funkrufname" name="funkrufname" rules={[{ required: true, whitespace: true }]}>
          <Input placeholder="z. B. Florian Nachbarstadt 44/1" />
        </Form.Item>
        <Form.Item label="Fahrzeugtyp" name="fahrzeugtyp"><Input /></Form.Item>
        <Form.Item label="Trägerorganisation" name="traegerorganisation">
          <Input placeholder="z. B. Feuerwehr Nachbarstadt" />
        </Form.Item>
        <Form.Item label="Kennzeichen" name="kennzeichen"><Input /></Form.Item>
        <Collapse
          ghost
          items={[{
            key: 'weitere',
            label: 'Weitere Angaben',
            forceRender: true,
            children: <Form.Item label="OPTA" name="opta"><Input /></Form.Item>,
          }]}
        />
      </ErfassungsModal>
    </EinsatzSeite>
  );
}
