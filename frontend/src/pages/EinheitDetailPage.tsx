import { App, Breadcrumb, Button, Card, Form, Input, Popconfirm, Space, Tag, TreeSelect, Typography, theme } from 'antd';
import { Select } from '../components/Select';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { useEffect, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ladeEinsatz } from '../api/einsaetze';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { useAuth } from '../auth/AuthContext';
import { listeEinheitTypen } from '../api/einheitTypen';
import { listeAbschnitte } from '../api/einsatzabschnitte';
import { listeEinsatzPersonal } from '../api/einsatzPersonal';
import { listeEinsatzFahrzeuge } from '../api/einsatzFahrzeuge';
import { gibMaterialFrei, listeEinsatzMaterial, ordneMaterialZu } from '../api/einsatzMaterial';
import {
  aktualisiereEinheit, gibFahrzeugFrei, gibPersonalFrei, listeEinheiten, loeseEinheitAuf,
  ordneFahrzeugZu, ordnePersonalZu, type EinheitEingabe,
} from '../api/einheiten';
import { ApiError } from '../api/client';
import { einsatzKeys, globalKeys } from '../api/queryKeys';
import type { Einheit, Staerke } from '../api/types';
import StaerkeAnzeige from '../anzeige/StaerkeAnzeige';
import StaerkeEingabe from '../anzeige/StaerkeEingabe';
import SprechgruppenPicker from '../components/SprechgruppenPicker';
import FunkErreichbarkeit, { KOMMUNIKATIONSMITTEL_OPTIONEN } from '../components/FunkErreichbarkeit';
import SektionHeader from '../components/SektionHeader';
import Datenstand, { gemeinsamerDatenstand } from '../components/Datenstand';
import { leerZuNull } from '../api/patchTriState';
import { einheitenPfad, parseRouteId } from '../routing/deeplinks';
import {
  nichtGefundenInhalt, SeitenFehler, SeitenLeer, SeitenSkeleton,
} from '../components/SeitenZustand';
import './EinheitDetailPage.css';

/** Die echte Höhe zählt: Handschuh-Stufe und umgebrochene Aktionen verändern die Leiste.
 * Der Scrollabstand muss schon VOR dem nativen Fokus-Scroll am Ziel stehen (LFH-446).
 */
function beobachteAktionsleiste(leiste: HTMLDivElement | null, abstand: number) {
  const formular = leiste?.closest('form');
  if (!leiste || !formular) return;
  const aktualisiere = () => formular.style.setProperty(
    '--lfh-einheit-fokusabstand', `${leiste.getBoundingClientRect().height + abstand}px`,
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
 * Vollseiten-Detail einer Einheit (LFH-339 · C4, Befund M26).
 *
 * ── WARUM EINE EIGENE ROUTE ────────────────────────────────────────────────────────────
 *
 * Die Ansicht lag bis hierher in der rechten Hälfte der Listenseite und trug dort NEUN
 * Formularfelder plus DREI Zuordnungslisten in einer Karte — mit dem Speichern-Knopf
 * mitten im Inhalt. Nach LFH-19 ist das keine Auswahl in einer Listenhälfte mehr, sondern
 * eine Detail-/Bearbeitungsansicht: mehrere Sektionen, deutlich über fünf Felder,
 * Deep-Link-würdig. Referenzmuster sind `BefehlDetailPage` und `PersonenDetailPage`.
 *
 * ── DIE ENTWIRRUNG IST DER EIGENTLICHE INHALT ──────────────────────────────────────────
 *
 * Die drei Zuordnungen (Personal, Fahrzeuge, Material) wirken SOFORT — jeder Klick auf
 * „Zuordnen" oder „Entfernen" schreibt. Sie standen trotzdem INNERHALB des `<Form>`, unter
 * einem Speichern-Knopf, der sie nicht betrifft. Das ist zweierlei Bedienlogik unter einer
 * Überschrift, und von aussen ist nicht zu sehen, welche Handlung wann wirkt.
 *
 * Sie liegen deshalb jetzt ausserhalb des Formulars, je unter einem `SektionHeader` mit
 * ausdrücklichem Hinweis „wirkt sofort". Das Formular endet vorher mit einer STICKY
 * Aktionsleiste — bei neun Feldern ist der Knopf sonst aus dem Bild gescrollt, während man
 * das letzte Feld ausfüllt.
 *
 * Der Führer-Wechsel bleibt bewusst bei den Mitgliedern und NICHT im Formular: er baut
 * seinen PATCH-Body aus dem Server-Stand, nicht aus den Formularwerten — ungespeicherte
 * Kopf-Edits werden dabei nicht mitgesendet (Vollersatz-Vertrag der Route).
 */

interface KopfWerte {
  name: string;
  typ_id?: number | null;
  abschnitt_id?: number | null;
  ueber_einheit_id?: number | null;
  soll?: Staerke | null;
  bemerkung?: string;
  sprechgruppe_ids?: number[];
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
  const { benutzer } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const { token } = theme.useToken();
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
    queryKey: einsatzKeys.abschnitte(einsatzId), queryFn: () => listeAbschnitte(einsatzId),
  });
  const personalQuery = useQuery({
    queryKey: einsatzKeys.personal(einsatzId), queryFn: () => listeEinsatzPersonal(einsatzId),
  });
  const fahrzeugeQuery = useQuery({
    queryKey: einsatzKeys.fahrzeuge(einsatzId), queryFn: () => listeEinsatzFahrzeuge(einsatzId),
  });
  const materialQuery = useQuery({
    queryKey: einsatzKeys.material(einsatzId), queryFn: () => listeEinsatzMaterial(einsatzId),
  });

  function invalidate() {
    qc.invalidateQueries({ queryKey: einsatzKeys.einheiten(einsatzId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.personal(einsatzId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.fahrzeuge(einsatzId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.material(einsatzId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
  }
  const fehler = (e: unknown) => message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');

  const einheiten = useMemo(() => einheitenQuery.data ?? [], [einheitenQuery.data]);
  const aktuell = einheiten.find((e) => e.id === einheitId) ?? null;

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
        kommunikationsmittel: leerZuNull(werte.kommunikationsmittel),
        erreichbarkeit: leerZuNull(werte.erreichbarkeit),
      };
      return aktualisiereEinheit(einsatzId, einheitId, daten);
    },
    onSuccess: () => { invalidate(); message.success('Gespeichert'); },
    onError: fehler,
  });

  const aufloesen = useMutation({
    mutationFn: () => loeseEinheitAuf(einsatzId, einheitId),
    // Zurück zur Gliederung: die Einheit, auf die diese Route zeigt, gibt es nicht mehr.
    onSuccess: () => { invalidate(); void navigate(einheitenPfad(einsatzId)); },
    onError: fehler,
  });
  const personalZu = useMutation({
    mutationFn: (epId: number) => ordnePersonalZu(einsatzId, einheitId, epId),
    onSuccess: invalidate, onError: fehler,
  });
  const personalFrei = useMutation({
    mutationFn: (epId: number) => gibPersonalFrei(einsatzId, einheitId, epId),
    onSuccess: invalidate, onError: fehler,
  });
  const fahrzeugZu = useMutation({
    mutationFn: (efId: number) => ordneFahrzeugZu(einsatzId, einheitId, efId),
    onSuccess: invalidate, onError: fehler,
  });
  const fahrzeugFrei = useMutation({
    mutationFn: (efId: number) => gibFahrzeugFrei(einsatzId, einheitId, efId),
    onSuccess: invalidate, onError: fehler,
  });
  const materialZu = useMutation({
    mutationFn: (emId: number) => ordneMaterialZu(einsatzId, einheitId, emId),
    onSuccess: invalidate, onError: fehler,
  });
  const materialFrei = useMutation({
    mutationFn: (emId: number) => gibMaterialFrei(einsatzId, einheitId, emId),
    onSuccess: invalidate, onError: fehler,
  });
  const fuehrerSetzen = useMutation({
    // Baut den PATCH-Body bewusst aus dem Server-Stand (`aktuell`), nicht aus dem
    // Formular: ungespeicherte Kopf-Edits werden NICHT mitgesendet (Vollersatz-Vertrag).
    // Führer-Markieren ist eine eigenständige Aktion; zuerst Kopfdaten „Speichern".
    mutationFn: (epId: number | null) => {
      const e = aktuell!;
      return aktualisiereEinheit(einsatzId, e.id, {
        name: e.name, typ_id: e.typ_id, abschnitt_id: e.abschnitt_id, ueber_einheit_id: e.ueber_einheit_id,
        fuehrer_id: epId, soll_fuehrer: e.soll?.fuehrer ?? null, soll_unterfuehrer: e.soll?.unterfuehrer ?? null,
        soll_mannschaft: e.soll?.mannschaft ?? null, bemerkung: e.bemerkung,
      });
    },
    onSuccess: invalidate, onError: fehler,
  });

  // Formular mit den Kopfdaten füllen, sobald sie da sind bzw. sich ändern.
  useEffect(() => {
    if (aktuell) {
      form.setFieldsValue({
        name: aktuell.name, typ_id: aktuell.typ_id ?? undefined, abschnitt_id: aktuell.abschnitt_id ?? undefined,
        ueber_einheit_id: aktuell.ueber_einheit_id ?? undefined, soll: aktuell.soll,
        bemerkung: aktuell.bemerkung ?? undefined,
        sprechgruppe_ids: aktuell.sprechgruppen?.map((s) => s.id) ?? [],
        kommunikationsmittel: aktuell.kommunikationsmittel ?? undefined,
        erreichbarkeit: aktuell.erreichbarkeit ?? undefined,
      });
    }
  }, [aktuell, form]);

  // Ungültige Route-ID führt zurück zur Liste (Muster `parseRouteId`, LFH-25).
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
  const darfSchreiben = darfImEinsatzSchreiben(einsatz, benutzer);

  /**
   * Die Liste kam an, die Einheit ist nicht darin: sie wurde aufgelöst oder die ID ist
   * erfunden. Das ist ein anderer Fall als „Abruf gescheitert" (darüber) und bekommt
   * deshalb einen eigenen Wortlaut samt Weg zurück — ein Fehler-Alert behauptete hier
   * einen Ausfall, den es nicht gab.
   */
  if (!aktuell) {
    return (
      <SeitenLeer
        titel="Diese Einheit gibt es nicht (mehr)"
        hinweis="Sie kann aufgelöst worden sein, oder die Adresse zeigt auf eine fremde Kennung."
        aktion={{ label: 'Zur Gliederung', onClick: () => void navigate(einheitenPfad(einsatzId)) }}
      />
    );
  }

  const verbotenAlsParent = nachfahrenInkl(einheiten, aktuell.id);
  const parentOptionen = einheiten
    .filter((e) => !verbotenAlsParent.has(e.id))
    .map((e) => ({ value: e.id, title: e.name }));
  const abschnittOptionen = (abschnitteQuery.data ?? []).map((a) => ({ value: a.id, title: a.name }));

  // Frei-Pool: disponierte Kräfte ohne Einheit.
  const freiesPersonal = (personalQuery.data ?? []).filter((p) => p.einheit_id == null);
  const freieFahrzeuge = (fahrzeugeQuery.data ?? []).filter((f) => f.einheit_id == null);
  const freiesMaterial = (materialQuery.data ?? []).filter((m) => m.einheit_id == null);

  /**
   * Was ein leerer Zuordnungs-Pool bedeutet, hängt daran, OB die Liste überhaupt ankam
   * (LFH-331 · B3). Scheitert der Abruf, filtern die drei Ausdrücke oben auf die leere
   * Menge, und das Auswahlfeld behauptete „Keine freien Personen" — eine Aussage über den
   * Bestand, die niemand geprüft hat.
   */
  const personalInhalt = nichtGefundenInhalt(personalQuery, {
    allgemein: 'Kräfte konnten nicht geladen werden',
  }) ?? 'Keine freien Personen';
  const fahrzeugInhalt = nichtGefundenInhalt(fahrzeugeQuery, {
    allgemein: 'Fahrzeuge konnten nicht geladen werden',
  }) ?? 'Keine freien Fahrzeuge';
  const materialInhalt = nichtGefundenInhalt(materialQuery, {
    allgemein: 'Material konnte nicht geladen werden',
  }) ?? 'Kein freies Material';

  /** Eine Zuordnungszeile — Bezeichnung links, Aktionen rechts. */
  const zuordnungsZeile = (schluessel: string | number, inhalt: React.ReactNode, aktionen: React.ReactNode) => (
    <div
      key={schluessel}
      style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        gap: token.margin, flexWrap: 'wrap',
        // Bedienziel-Boden aus der Dichteachse (LFH-365): eine handgebaute Zeile schuldet
        // `minHeight` PLUS Polsterung — die Polsterung allein trägt den Boden nicht.
        minHeight: token.controlHeight, paddingBlock: token.paddingXXS,
      }}
    >
      {inhalt}
      {aktionen}
    </div>
  );

  return (
    <div>
      <Breadcrumb
        style={{ marginBottom: token.marginSM }}
        items={[
          { title: <Link to="/einsaetze">Einsätze</Link> },
          { title: einsatz.bezeichnung },
          { title: <Link to={einheitenPfad(einsatzId)}>Einheiten</Link> },
          { title: aktuell.name },
        ]}
      />

      <Space orientation="vertical" size={0} style={{ marginBottom: token.margin }}>
        <Space align="center" wrap>
          <Typography.Title level={3} style={{ margin: 0 }}>{aktuell.name}</Typography.Title>
          {aktuell.typ_label && <Tag>{aktuell.typ_label}</Tag>}
          <Tag color="blue">
            <StaerkeAnzeige wert={aktuell.ist} />
            {aktuell.soll ? <> / Soll <StaerkeAnzeige wert={aktuell.soll} /></> : null}
          </Tag>
        </Space>
        {/* Der ÄLTESTE erfolgreiche Stand über alle hier dargestellten Bestände — nicht
            der jüngste. Diese Seite zeigt Einheit, Abschnitte und die drei Zuordnungspools
            nebeneinander; ein Datenstand, der nur die frischeste Quelle nennt, behauptete
            Aktualität für Zahlen, die älter sind. Die Zusicherung ist mit der Ansicht von
            der Listenseite hierher gezogen (LFH-339 · C4). */}
        <Datenstand dataUpdatedAt={gemeinsamerDatenstand(
          einheitenQuery.dataUpdatedAt,
          abschnitteQuery.dataUpdatedAt,
          personalQuery.dataUpdatedAt,
          fahrzeugeQuery.dataUpdatedAt,
          materialQuery.dataUpdatedAt,
        )} />
      </Space>

      <Card size="small" style={{ marginBottom: token.margin }}>
        <Form<KopfWerte> className="lfh-einheit-kopfdaten" form={form} layout="vertical" disabled={!darfSchreiben} onFinish={(w) => speichern.mutate(w)}>
          <SektionHeader titel="Kopfdaten" />
          <Form.Item label="Name" name="name" rules={[{ required: true, whitespace: true }]}><Input /></Form.Item>
          <Form.Item label="Typ" name="typ_id">
            {/* Der Typkatalog ist die einzige Fremdquelle dieses Formulars. Fällt er aus,
                stünde hier ein Auswahlfeld ohne Einträge — die Typzuordnung wäre unmöglich,
                und zwar lautlos. Der Ausfall steht deshalb im Feld selbst. */}
            <Select allowClear placeholder="Typ wählen"
              notFoundContent={nichtGefundenInhalt(typenQuery, {
                allgemein: 'Einheitentypen konnten nicht geladen werden',
              })}
              options={(typenQuery.data ?? []).map((t) => ({ value: t.id, label: t.label }))} />
          </Form.Item>
          <Form.Item label="Abschnitt" name="abschnitt_id">
            <TreeSelect allowClear placeholder="Abschnitt zuordnen" treeData={abschnittOptionen}
              notFoundContent={nichtGefundenInhalt(abschnitteQuery, {
                allgemein: 'Abschnitte konnten nicht geladen werden',
              })} />
          </Form.Item>
          <Form.Item label="Über-Einheit" name="ueber_einheit_id">
            <TreeSelect allowClear placeholder="Unterstellung" treeData={parentOptionen} />
          </Form.Item>

          {/* BOS-Fachsprache (Befund N6): die Größe heißt Soll-Stärke und wird als
              Führer / Unterführer / Mannschaft angegeben. Die Eingaberegel steht als
              gedämpfte Hilfszeile, nicht in Klammern im Etikett. */}
          <Form.Item
            label="Soll-Stärke (F/UF/M)"
            extra="Entweder alle drei Werte angeben oder alle leer lassen — teilweise gefüllt wird nicht übernommen."
          >
            <Space align="end" wrap>
              <Form.Item name="soll" noStyle><StaerkeEingabe /></Form.Item>
              <span style={{ color: token.colorTextSecondary }}>
                Ist: <StaerkeAnzeige wert={aktuell.ist} /> · kumuliert: <StaerkeAnzeige wert={aktuell.ist_kumuliert} />
              </span>
            </Space>
          </Form.Item>

          <SektionHeader titel="Funk / Kommunikation" />
          <Form.Item label="Sprechgruppen" name="sprechgruppe_ids">
            <SprechgruppenPicker einsatzId={einsatzId} />
          </Form.Item>
          <Form.Item label="Kommunikationsmittel" name="kommunikationsmittel">
            <Select allowClear placeholder="Digitalfunk / Mobil / Festnetz" options={KOMMUNIKATIONSMITTEL_OPTIONEN} />
          </Form.Item>
          <Form.Item label="Erreichbarkeit / Nummer" name="erreichbarkeit">
            <Input placeholder="z. B. 0151 23456" allowClear />
          </Form.Item>
          <Form.Item label="Bemerkung" name="bemerkung"><Input.TextArea rows={2} /></Form.Item>

          <FunkErreichbarkeit
            sprechgruppen={aktuell.sprechgruppen}
            kommunikationsmittel={aktuell.kommunikationsmittel}
            erreichbarkeit={aktuell.erreichbarkeit}
          />

          {darfSchreiben && (
            /**
             * STICKY am unteren Rand des Formularblocks (Befund M26): bei neun Feldern ist
             * ein Knopf am Blockende aus dem Bild gescrollt, während man das letzte Feld
             * ausfüllt — und dort stand er vorher auch noch MITTEN im Inhalt, mit drei
             * Zuordnungslisten darunter.
             *
             * `size="middle"` an der Reihe, nicht der Vorgabewert: hier steht ein
             * `danger`-Knopf neben einer neutralen Aktion, und antds Vorgabe-`small`
             * bindet auf `abstand.xs` (3/5/7 px je Dichtestufe) — zu wenig Trennung
             * zwischen „Speichern" und „Auflösen".
             */
            <div
              ref={(el) => beobachteAktionsleiste(el, token.marginSM)}
              style={{
                position: 'sticky', bottom: 0, zIndex: 1,
                background: token.colorBgContainer,
                paddingBlock: token.paddingSM,
                borderTop: `1px solid ${token.colorBorderSecondary}`,
              }}
            >
              <Space size="middle" wrap>
                <Button type="primary" htmlType="submit" loading={speichern.isPending}>Speichern</Button>
                <Popconfirm
                  title="Einheit auflösen?"
                  description="Mitglieder werden frei, Unter-Einheiten rücken eine Ebene hoch."
                  okButtonProps={{ danger: true }}
                  onConfirm={() => aufloesen.mutate()}
                >
                  <Button danger loading={aufloesen.isPending}>Auflösen</Button>
                </Popconfirm>
              </Space>
            </div>
          )}
        </Form>
      </Card>

      {/**
        * ── DIE DREI ZUORDNUNGEN LIEGEN AUSSERHALB DES FORMULARS ─────────────────────────
        *
        * Das ist der Kern von Befund M26. Jede Handlung hier wirkt SOFORT — es gibt nichts
        * zu speichern. Innerhalb des `<Form>` standen sie unter einem Speichern-Knopf, der
        * sie nicht betrifft: zweierlei Bedienlogik unter einer Überschrift, von aussen
        * nicht unterscheidbar. Der Hinweis in jedem `SektionHeader` sagt es zusätzlich in
        * Worten, weil die Trennung allein durch Position eine Vermutung bliebe.
        */}
      <Card size="small" style={{ marginBottom: token.margin }}>
        <SektionHeader titel="Personal" beschreibung="Zuordnungen wirken sofort — hier gibt es nichts zu speichern." />
        {aktuell.personal_mitglieder.map((m) =>
          zuordnungsZeile(
            m.ep_id,
            <span>
              {m.name}{m.staerke_position ? ` (${m.staerke_position})` : ''}
              {m.ist_fuehrer && <Tag color="gold" style={{ marginLeft: token.marginXXS }}>Einheitsführer</Tag>}
            </span>,
            darfSchreiben && (
              <Space size="middle" wrap>
                {!m.ist_fuehrer && <Button onClick={() => fuehrerSetzen.mutate(m.ep_id)}>Als Einheitsführer</Button>}
                <Button danger onClick={() => personalFrei.mutate(m.ep_id)}>Entfernen</Button>
              </Space>
            ),
          ),
        )}
        {darfSchreiben && (
          <Select style={{ width: '100%', marginTop: token.marginSM }} placeholder="Person zuordnen …" value={null}
            notFoundContent={personalInhalt}
            options={freiesPersonal.map((p) => ({ value: p.id, label: p.name }))}
            onSelect={(epId) => personalZu.mutate(Number(epId))} />
        )}
      </Card>

      <Card size="small" style={{ marginBottom: token.margin }}>
        <SektionHeader titel="Fahrzeuge" beschreibung="Zuordnungen wirken sofort — hier gibt es nichts zu speichern." />
        {aktuell.fahrzeug_mitglieder.map((m) =>
          zuordnungsZeile(
            m.ef_id,
            <span>{m.funkrufname}{m.fahrzeugtyp ? ` (${m.fahrzeugtyp})` : ''}</span>,
            darfSchreiben && <Button danger onClick={() => fahrzeugFrei.mutate(m.ef_id)}>Entfernen</Button>,
          ),
        )}
        {darfSchreiben && (
          <Select style={{ width: '100%', marginTop: token.marginSM }} placeholder="Fahrzeug zuordnen …" value={null}
            notFoundContent={fahrzeugInhalt}
            options={freieFahrzeuge.map((f) => ({ value: f.id, label: f.funkrufname }))}
            onSelect={(efId) => fahrzeugZu.mutate(Number(efId))} />
        )}
      </Card>

      <Card size="small">
        <SektionHeader titel="Material" beschreibung="Zuordnungen wirken sofort — hier gibt es nichts zu speichern." />
        {aktuell.material_mitglieder.map((m) =>
          zuordnungsZeile(
            m.em_id,
            <span>{m.bezeichnung} ×{m.menge}</span>,
            darfSchreiben && <Button danger onClick={() => materialFrei.mutate(m.em_id)}>Entfernen</Button>,
          ),
        )}
        {darfSchreiben && (
          <Select style={{ width: '100%', marginTop: token.marginSM }} placeholder="Material zuordnen …" value={null}
            notFoundContent={materialInhalt}
            options={freiesMaterial.map((m) => ({ value: m.id, label: `${m.bezeichnung} ×${m.menge}` }))}
            onSelect={(emId) => materialZu.mutate(Number(emId))} />
        )}
      </Card>
    </div>
  );
}
