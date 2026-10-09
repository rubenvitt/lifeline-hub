import {
  App,
  Breadcrumb,
  Button,
  Form,
  Input,
  Popconfirm,
  Space,
  Tag,
  TreeSelect,
  theme,
} from 'antd';
import EinsatzSeite from '../components/EinsatzSeite';
import { Paneel, monoStil, useRollen } from '../components/instrument';
import { Select } from '../components/Select';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { useEffect, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ladeEinsatz } from '../api/einsaetze';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import KraftZeitachse from '../kraefte/KraftZeitachse';
import { listeEinheitTypen } from '../api/einheitTypen';
import { listeAbschnitte } from '../api/einsatzabschnitte';
import { listeEinsatzPersonal } from '../api/einsatzPersonal';
import { listeEinsatzFahrzeuge } from '../api/einsatzFahrzeuge';
import { gibMaterialFrei, listeEinsatzMaterial, ordneMaterialZu } from '../api/einsatzMaterial';
import {
  aktualisiereEinheit,
  gibFahrzeugFrei,
  gibPersonalFrei,
  listeEinheiten,
  loeseEinheitAuf,
  ordneFahrzeugZu,
  ordnePersonalZu,
  type EinheitEingabe,
} from '../api/einheiten';
import { einsatzKeys, globalKeys } from '../api/queryKeys';
import type { Einheit, Staerke } from '../api/types';
import { POSITION_LABELS } from '../api/personal';
import StaerkeAnzeige from '../anzeige/StaerkeAnzeige';
import StaerkeEingabe from '../anzeige/StaerkeEingabe';
import SprechgruppenPicker from '../components/SprechgruppenPicker';
import FunkErreichbarkeit, {
  KOMMUNIKATIONSMITTEL_OPTIONEN,
} from '../components/FunkErreichbarkeit';
import SektionHeader from '../components/SektionHeader';
import { gemeinsamerDatenstand } from '../components/Datenstand';
import { leerZuNull } from '../api/patchTriState';
import { einheitenPfad, parseRouteId } from '../routing/deeplinks';
import {
  nichtGefundenInhalt,
  SeitenFehler,
  SeitenLeer,
  SeitenSkeleton,
} from '../components/SeitenZustand';
import './EinheitDetailPage.css';
import { SpeicherFehler, ZeilenFehler } from '../components/SpeicherHinweis';
import { useZeilenFehler, type ZeilenGrund } from '../components/useZeilenFehler';

/**
 * Die echte Höhe zählt: Handschuh-Stufe und umgebrochene Aktionen verändern die Leiste. Der
 * Scrollabstand muss schon vor dem nativen Fokus-Scroll am Ziel stehen.
 */
function beobachteAktionsleiste(leiste: HTMLDivElement | null, abstand: number) {
  const formular = leiste?.closest('form');
  if (!leiste || !formular) return;
  const aktualisiere = () =>
    formular.style.setProperty(
      '--lfh-einheit-fokusabstand',
      `${leiste.getBoundingClientRect().height + abstand}px`,
    );
  aktualisiere();
  const beobachter = new ResizeObserver(aktualisiere);
  beobachter.observe(leiste);
  return () => {
    beobachter.disconnect();
    formular.style.removeProperty('--lfh-einheit-fokusabstand');
  };
}

/**
 * Vollseiten-Detail einer Einheit (LFH-339): mehrere Sektionen, deutlich über fünf Felder,
 * deeplink-würdig — nach LFH-19 eine eigene Route. Referenzmuster sind `BefehlDetailPage` und
 * `PersonenDetailPage`.
 *
 * Die drei Zuordnungen (Personal, Fahrzeuge, Material) wirken sofort — jeder Klick schreibt. Sie
 * liegen deshalb außerhalb des Formulars, je in einem eigenen Paneel, nicht unter einem
 * Speichern-Knopf, der sie nicht betrifft; die zugeordnete Zeile erscheint sofort im Paneel (kein
 * Erklärsatz, LFH-1078). Das Formular endet mit einer sticky Aktionsleiste, sonst wäre der Knopf
 * bei neun Feldern aus dem Bild gescrollt.
 *
 * Der Führer-Wechsel bleibt bei den Mitgliedern und nicht im Formular: er baut seinen PATCH-Body
 * aus dem Server-Stand, ungespeicherte Kopf-Edits gehen nicht mit (Vollersatz-Vertrag der Route).
 */

interface KopfWerte {
  name: string;
  typ_id?: number | null;
  abschnitt_id?: number | null;
  ueber_einheit_id?: number | null;
  soll?: Staerke | null;
  bemerkung?: string;
  sprechgruppe_ids?: number[];
  funkrufname?: string;
  kommunikationsmittel?: string;
  erreichbarkeit?: string;
}

/** Menge der Nachfahren-IDs (inkl. self) — für die zyklenfreie Parent-Auswahl. */
function nachfahrenInkl(einheiten: Einheit[], id: number): Set<number> {
  const kinder = new Map<number, number[]>();
  for (const e of einheiten) {
    if (e.ueber_einheit_id != null) {
      if (!kinder.has(e.ueber_einheit_id)) kinder.set(e.ueber_einheit_id, []);
      kinder.get(e.ueber_einheit_id)!.push(e.id);
    }
  }
  const ergebnis = new Set<number>();
  const stack = [id];
  while (stack.length) {
    const n = stack.pop()!;
    if (ergebnis.has(n)) continue;
    ergebnis.add(n);
    for (const c of kinder.get(n) ?? []) stack.push(c);
  }
  return ergebnis;
}

export default function EinheitDetailPage() {
  const { id, einheitId: einheitIdParam } = useParams();
  const einsatzId = Number(id);
  const einheitId = Number(einheitIdParam);
  const idGueltig = parseRouteId(einheitIdParam) != null;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const { rollen } = useRollen();
  const [form] = Form.useForm<KopfWerte>();

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
    queryFn: () => listeEinsatzMaterial(einsatzId),
  });

  function invalidate() {
    qc.invalidateQueries({ queryKey: einsatzKeys.einheiten(einsatzId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.personal(einsatzId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.fahrzeuge(einsatzId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.material(einsatzId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
  }
  /*
   * Jede Handlung meldet ihre Ablehnung an ihrem Ort, kein Toast (LFH-1077, `frontend/AGENTS.md`,
   * „Rückwege und Fehler“): Speichern und Auflösen am Paneel „Kopfdaten“, Zuordnen am Paneel der
   * Zuordnung, Entfernen und „Als Einheitsführer“ an der Zeile. Die Gründe je Zeile und je Paneel
   * kommen aus den Callbacks, nicht aus `mutation.error`/`mutation.variables`
   * (`components/useZeilenFehler.ts`): zwei schnelle Zuordnungen hintereinander, und die
   * Ablehnung der ersten ginge verloren. Entfernen und „Als Einheitsführer“ teilen sich den
   * Speicher der Personalzeile.
   */
  const personalZeilen = useZeilenFehler<number>();
  const fahrzeugZeilen = useZeilenFehler<number>();
  const materialZeilen = useZeilenFehler<number>();
  const zuordnen = useZeilenFehler<'personal' | 'fahrzeug' | 'material'>();

  const einheiten = useMemo(() => einheitenQuery.data ?? [], [einheitenQuery.data]);
  const aktuell = einheiten.find((e) => e.id === einheitId) ?? null;
  const hatEinheitsfuehrer = aktuell?.personal_mitglieder.some((m) => m.ist_fuehrer) ?? false;

  const speichern = useMutation({
    mutationFn: (werte: KopfWerte) => {
      const daten: EinheitEingabe = {
        name: werte.name.trim(),
        typ_id: werte.typ_id ?? null,
        abschnitt_id: werte.abschnitt_id ?? null,
        ueber_einheit_id: werte.ueber_einheit_id ?? null,
        fuehrer_id: aktuell?.fuehrer_id ?? null, // Führer unverändert (authoritativ)
        soll_fuehrer: werte.soll?.fuehrer ?? null,
        soll_unterfuehrer: werte.soll?.unterfuehrer ?? null,
        soll_mannschaft: werte.soll?.mannschaft ?? null,
        bemerkung: leerZuNull(werte.bemerkung),
        sprechgruppe_ids: werte.sprechgruppe_ids ?? [],
        funkrufname: leerZuNull(werte.funkrufname),
        kommunikationsmittel: leerZuNull(werte.kommunikationsmittel),
        erreichbarkeit: leerZuNull(werte.erreichbarkeit),
      };
      return aktualisiereEinheit(einsatzId, einheitId, daten);
    },
    onSuccess: () => {
      invalidate();
      message.success('Gespeichert');
    },
  });

  const aufloesen = useMutation({
    mutationFn: () => loeseEinheitAuf(einsatzId, einheitId),
    // Zurück zur Gliederung: die Einheit, auf die diese Route zeigt, gibt es nicht mehr.
    onSuccess: () => {
      invalidate();
      void navigate(einheitenPfad(einsatzId));
    },
  });
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
    onError: (e, epId) => personalZeilen.melde(epId, e, 'Entfernen fehlgeschlagen'),
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
    onError: (e, efId) => fahrzeugZeilen.melde(efId, e, 'Entfernen fehlgeschlagen'),
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
    onError: (e, emId) => materialZeilen.melde(emId, e, 'Entfernen fehlgeschlagen'),
  });
  const fuehrerSetzen = useMutation({
    // Baut den PATCH-Body aus dem Server-Stand (`aktuell`), nicht aus dem Formular: ungespeicherte
    // Kopf-Edits werden nicht mitgesendet (Vollersatz-Vertrag). Zuerst Kopfdaten „Speichern".
    mutationFn: (epId: number) => {
      const e = aktuell!;
      return aktualisiereEinheit(einsatzId, e.id, {
        name: e.name,
        typ_id: e.typ_id,
        abschnitt_id: e.abschnitt_id,
        ueber_einheit_id: e.ueber_einheit_id,
        fuehrer_id: epId,
        soll_fuehrer: e.soll?.fuehrer ?? null,
        soll_unterfuehrer: e.soll?.unterfuehrer ?? null,
        soll_mannschaft: e.soll?.mannschaft ?? null,
        bemerkung: e.bemerkung,
      });
    },
    onMutate: (epId) => personalZeilen.beginne(epId),
    onSuccess: invalidate,
    onError: (e, epId) => personalZeilen.melde(epId, e, 'Einheitsführer nicht gesetzt'),
  });
  /*
   * Speichern und Auflösen teilen sich den Ort am Paneel „Kopfdaten“: die zuletzt begonnene
   * Handlung zählt, ihr Start räumt den Grund der anderen. Eine laufende bleibt unberührt.
   */
  const kopfFehler = speichern.error ?? aufloesen.error;
  const raeumeKopf = (andere: typeof speichern | typeof aufloesen) => {
    if (!andere.isPending && andere.error != null) andere.reset();
  };

  /*
   * Die Route hat keinen `key`: der Wechsel zu einer anderen Einheit behält diese Seite. Die Gründe
   * der vorigen gehören nicht an die nächste, also räumt jeder Wechsel alle Orte. `reset` und
   * `leere` sind stabil, der Effekt läuft nur mit `einheitId`.
   */
  const { reset: speichernReset } = speichern;
  const { reset: aufloesenReset } = aufloesen;
  const { leere: leerePersonal } = personalZeilen;
  const { leere: leereFahrzeuge } = fahrzeugZeilen;
  const { leere: leereMaterial } = materialZeilen;
  const { leere: leereZuordnen } = zuordnen;
  useEffect(() => {
    speichernReset();
    aufloesenReset();
    leerePersonal();
    leereFahrzeuge();
    leereMaterial();
    leereZuordnen();
  }, [
    einheitId,
    speichernReset,
    aufloesenReset,
    leerePersonal,
    leereFahrzeuge,
    leereMaterial,
    leereZuordnen,
  ]);

  // Formular mit den Kopfdaten füllen, sobald sie da sind bzw. sich ändern.
  useEffect(() => {
    if (aktuell) {
      form.setFieldsValue({
        name: aktuell.name,
        typ_id: aktuell.typ_id ?? undefined,
        abschnitt_id: aktuell.abschnitt_id ?? undefined,
        ueber_einheit_id: aktuell.ueber_einheit_id ?? undefined,
        soll: aktuell.soll,
        bemerkung: aktuell.bemerkung ?? undefined,
        sprechgruppe_ids: aktuell.sprechgruppen?.map((s) => s.id) ?? [],
        funkrufname: aktuell.funkrufname ?? undefined,
        kommunikationsmittel: aktuell.kommunikationsmittel ?? undefined,
        erreichbarkeit: aktuell.erreichbarkeit ?? undefined,
      });
    }
  }, [aktuell, form]);

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
  const einsatz = einsatzQuery.data;
  const darfSchreiben = darfImEinsatzSchreiben(einsatz);

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

  const verbotenAlsParent = nachfahrenInkl(einheiten, aktuell.id);
  const parentOptionen = einheiten
    .filter((e) => !verbotenAlsParent.has(e.id))
    .map((e) => ({ value: e.id, title: e.name }));
  const abschnittOptionen = (abschnitteQuery.data ?? []).map((a) => ({
    value: a.id,
    title: a.name,
  }));

  // Frei-Pool: disponierte Kräfte ohne Einheit.
  const freiesPersonal = (personalQuery.data ?? []).filter((p) => p.einheit_id == null);
  const freieFahrzeuge = (fahrzeugeQuery.data ?? []).filter((f) => f.einheit_id == null);
  const freiesMaterial = (materialQuery.data ?? []).filter((m) => m.einheit_id == null);

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
        einheitenQuery.dataUpdatedAt,
        abschnitteQuery.dataUpdatedAt,
        personalQuery.dataUpdatedAt,
        fahrzeugeQuery.dataUpdatedAt,
        materialQuery.dataUpdatedAt,
      )}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: token.margin }}>
        <Paneel titel="Kopfdaten" koerperPolster>
          <Form<KopfWerte>
            className="lfh-einheit-kopfdaten"
            form={form}
            layout="vertical"
            disabled={!darfSchreiben}
            onFinish={(w) => {
              raeumeKopf(aufloesen);
              speichern.mutate(w);
            }}
          >
            <Form.Item label="Name" name="name" rules={[{ required: true, whitespace: true }]}>
              <Input />
            </Form.Item>
            <Form.Item label="Typ" name="typ_id">
              {/* Der Typkatalog ist die einzige Fremdquelle des Formulars. Fällt er aus, wäre
                  die Typzuordnung lautlos unmöglich; der Ausfall steht deshalb im Feld selbst. */}
              <Select
                allowClear
                placeholder="Typ wählen"
                notFoundContent={nichtGefundenInhalt(typenQuery, {
                  allgemein: 'Einheitentypen konnten nicht geladen werden',
                })}
                options={(typenQuery.data ?? []).map((t) => ({ value: t.id, label: t.label }))}
              />
            </Form.Item>
            <Form.Item label="Abschnitt" name="abschnitt_id">
              <TreeSelect
                allowClear
                placeholder="Abschnitt zuordnen"
                treeData={abschnittOptionen}
                notFoundContent={nichtGefundenInhalt(abschnitteQuery, {
                  allgemein: 'Abschnitte konnten nicht geladen werden',
                })}
              />
            </Form.Item>
            <Form.Item label="Über-Einheit" name="ueber_einheit_id">
              <TreeSelect allowClear placeholder="Unterstellung" treeData={parentOptionen} />
            </Form.Item>

            {/* BOS-Fachsprache: die Größe heißt Soll-Stärke (Führer / Unterführer /
                Mannschaft). Keine Eingaberegel als Satz (LFH-1078): `StaerkeEingabe` zählt ein
                leeres Teilfeld als 0, sobald eines gefüllt ist, und zeigt die Summe live. */}
            <Form.Item label="Soll-Stärke (F/UF/M)">
              <Space align="end" wrap>
                <Form.Item name="soll" noStyle>
                  <StaerkeEingabe />
                </Form.Item>
                <span style={{ color: token.colorTextSecondary }}>
                  Ist: <StaerkeAnzeige wert={aktuell.ist} /> · kumuliert:{' '}
                  <StaerkeAnzeige wert={aktuell.ist_kumuliert} />
                </span>
              </Space>
            </Form.Item>

            <SektionHeader titel="Funk / Kommunikation" ueberschrift="h3" />
            {/* Der Rufname der Einheit, nicht eines ihrer Fahrzeuge. Leer gelassen zeigt das
                Meldebild höchstens den Rufnamen des einzigen Fahrzeugs. */}
            <Form.Item label="Funkrufname" name="funkrufname">
              <Input placeholder="z. B. Florian HM 12/44" allowClear />
            </Form.Item>
            <Form.Item label="Sprechgruppen" name="sprechgruppe_ids">
              <SprechgruppenPicker einsatzId={einsatzId} />
            </Form.Item>
            <Form.Item label="Kommunikationsmittel" name="kommunikationsmittel">
              <Select
                allowClear
                placeholder="Digitalfunk / Mobil / Festnetz"
                options={KOMMUNIKATIONSMITTEL_OPTIONEN}
              />
            </Form.Item>
            <Form.Item label="Erreichbarkeit / Nummer" name="erreichbarkeit">
              <Input placeholder="z. B. 0151 23456" allowClear />
            </Form.Item>
            <Form.Item label="Bemerkung" name="bemerkung">
              <Input.TextArea rows={2} />
            </Form.Item>

            <FunkErreichbarkeit
              sprechgruppen={aktuell.sprechgruppen}
              kommunikationsmittel={aktuell.kommunikationsmittel}
              erreichbarkeit={aktuell.erreichbarkeit}
            />

            {darfSchreiben && (
              /**
               * Sticky am unteren Rand des Formularblocks: bei neun Feldern wäre ein Knopf am
               * Blockende aus dem Bild gescrollt, während man das letzte Feld ausfüllt.
               *
               * `size="middle"` an der Reihe: hier steht ein `danger`-Knopf neben einer neutralen
               * Aktion, und antds Vorgabeabstand (`abstand.xs`) trennt „Speichern" und „Auflösen"
               * zu wenig.
               */
              <div
                ref={(el) => beobachteAktionsleiste(el, token.marginSM)}
                style={{
                  position: 'sticky',
                  bottom: 0,
                  zIndex: 1,
                  background: rollen.paneel,
                  paddingBlock: token.paddingSM,
                  borderTop: `1px solid ${rollen.linie}`,
                }}
              >
                {kopfFehler != null && (
                  <div style={{ marginBottom: token.marginSM }}>
                    <SpeicherFehler
                      fehler={kopfFehler}
                      titel={speichern.error != null ? undefined : 'Nicht aufgelöst'}
                      fallback={speichern.error != null ? undefined : 'Auflösen fehlgeschlagen'}
                    />
                  </div>
                )}
                <Space size="middle" wrap>
                  <Button type="primary" htmlType="submit" loading={speichern.isPending}>
                    Speichern
                  </Button>
                  <Popconfirm
                    title="Einheit auflösen?"
                    description="Mitglieder werden frei, Unter-Einheiten rücken eine Ebene hoch."
                    okText="Einheit auflösen"
                    okButtonProps={{ danger: true }}
                    onConfirm={() => {
                      raeumeKopf(speichern);
                      aufloesen.mutate();
                    }}
                  >
                    <Button danger loading={aufloesen.isPending}>
                      Auflösen
                    </Button>
                  </Popconfirm>
                </Space>
              </div>
            )}
          </Form>
        </Paneel>

        {/* ── Die drei Zuordnungen liegen außerhalb des Formulars ──

            Jede Handlung hier wirkt sofort, es gibt nichts zu speichern: die Zeile erscheint
            bzw. verschwindet im Paneel, das quittiert ohne Satz (LFH-1078). */}
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

        <Paneel titel="Personal" meta={aktuell.personal_mitglieder.length} koerperPolster>
          {aktuell.personal_mitglieder.map((m) =>
            zuordnungsZeile(
              m.ep_id,
              <span>
                {m.name}
                {m.staerke_position ? ` (${POSITION_LABELS[m.staerke_position]})` : ''}
                {/* Die Stärke-Position „Führer“ zählt in F/UF/M, das Merkmal Einheitsführer ist
                    ein eigenes (LFH-946). Ohne den Satz hielte man es für schon gesetzt. Hat die
                    Einheit schon einen Einheitsführer, läse er sich wie ein Auftrag. */}
                {m.staerke_position === 'fuehrer' && !m.ist_fuehrer && !hatEinheitsfuehrer && (
                  <span style={{ color: rollen.gedaempft }}>
                    {' '}
                    · als Führer gezählt, noch nicht als Einheitsführer gesetzt
                  </span>
                )}
                {m.ist_fuehrer && <Tag style={{ marginLeft: token.marginXXS }}>Einheitsführer</Tag>}
              </span>,
              darfSchreiben && (
                <Space size="middle" wrap>
                  {!m.ist_fuehrer && (
                    <Button onClick={() => fuehrerSetzen.mutate(m.ep_id)}>
                      Als Einheitsführer
                    </Button>
                  )}
                  <Button danger onClick={() => personalFrei.mutate(m.ep_id)}>
                    Entfernen
                  </Button>
                </Space>
              ),
              personalZeilen.grund(m.ep_id),
            ),
          )}
          {darfSchreiben && (
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
              darfSchreiben && (
                <Button danger onClick={() => fahrzeugFrei.mutate(m.ef_id)}>
                  Entfernen
                </Button>
              ),
              fahrzeugZeilen.grund(m.ef_id),
            ),
          )}
          {darfSchreiben && (
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

        <Paneel titel="Material" meta={aktuell.material_mitglieder.length} koerperPolster>
          {aktuell.material_mitglieder.map((m) =>
            zuordnungsZeile(
              m.em_id,
              <span>
                {m.bezeichnung} <span style={monoStil(13)}>×{m.menge}</span>
              </span>,
              darfSchreiben && (
                <Button danger onClick={() => materialFrei.mutate(m.em_id)}>
                  Entfernen
                </Button>
              ),
              materialZeilen.grund(m.em_id),
            ),
          )}
          {darfSchreiben && (
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
