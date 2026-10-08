import {
  App,
  Breadcrumb,
  Button,
  Form,
  Input,
  InputNumber,
  Popconfirm,
  Space,
  Tag,
  Tree,
  TreeSelect,
  type TreeDataNode,
} from 'antd';
import { Select } from '../components/Select';
import { Link, useParams, useSearchParams } from 'react-router';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ladeEinsatz } from '../api/einsaetze';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { useAuth } from '../auth/AuthContext';
import { einsatzKeys } from '../api/queryKeys';
import { listeEinsatzPersonal } from '../api/einsatzPersonal';
import { listeEinheiten } from '../api/einheiten';
import {
  aktualisiereAbschnitt,
  legeAbschnittAn,
  listeAbschnitte,
  loeseAbschnittAuf,
  type AbschnittEingabe,
} from '../api/einsatzabschnitte';
import type { AbschnittLagezustand, Einheit, Einsatzabschnitt } from '../api/types';
import StaerkeAnzeige from '../anzeige/StaerkeAnzeige';
import { KOMMUNIKATIONSMITTEL_OPTIONEN } from '../components/FunkErreichbarkeit';
import { Liste, ListenEintrag } from '../components/Liste';
import {
  SeitenFehler,
  SeitenLeer,
  SeitenSkeleton,
  SeitenStandVeraltet,
} from '../components/SeitenZustand';
import SprechgruppenPicker from '../components/SprechgruppenPicker';
import { useQueryParamSelektion } from '../routing/useQueryParamSelektion';
import { gemeinsamerDatenstand } from '../components/Datenstand';
import EinsatzSeite from '../components/EinsatzSeite';
import { Augenbraue, Paneel, Segmentleiste, monoStil, useRollen } from '../components/instrument';
import { useViewport } from '../components/useViewport';
import { abschnittStaerken, nachfahrenInkl } from './einsatzabschnitte/abschnittStaerke';
import AbschnittKnoten from './einsatzabschnitte/AbschnittKnoten';
import AbschnittDaten from './einsatzabschnitte/AbschnittDaten';
import { abschnittLagezustand } from '../theme/statusFarben';
import { useFehlerMeldung } from '../components/useFehlerMeldung';
import { abrufZustand } from '../api/abrufZustand';
import {
  einheitenPfad,
  parseAbschnitteAnsicht,
  type AbschnitteAnsicht,
} from '../routing/deeplinks';
import { RechteHinweis } from '../components/SpeicherHinweis';
import { einsatzRechteGrund } from '../components/nurAnsicht';
import { SprungKnopf } from '../components/Sprung';
import { useSprungSperre } from '../einsatz/useSprungSperre';
import type { Quelle } from '../stab/luecken';
import Organigramm from './einsatzabschnitte/Organigramm';
import { modulName } from '../einsatz/modulRegistry';

/** Auswahl des Lagezustands in Stufenfolge — Wortlaut aus dem Farbvertrag, nicht doppelt. */
const LAGEZUSTAND_OPTIONEN = (['planmaessig', 'angespannt', 'kritisch'] as const).map((l) => ({
  value: l,
  label: abschnittLagezustand[l].label,
}));

/**
 * Zwei Ansichten derselben Daten (LFH-626): die Gliederung bearbeitet, das Organigramm liest,
 * druckt und übernimmt. Kein Nutzerschalter Tabelle ↔ Karte — das hier sind zwei Fragen.
 */
const ANSICHT_OPTIONEN = [
  { wert: 'gliederung', label: 'Gliederung' },
  { wert: 'organigramm', label: 'Organigramm' },
] as const satisfies readonly { wert: AbschnitteAnsicht; label: string }[];

/** Vergleichsform der Kurzbezeichnung wie SQLite `NOCASE`: getrimmt, nur A–Z gefaltet. */
const nocase = (s: string) => s.trim().replace(/[A-Z]/g, (c) => c.toLowerCase());

function baueBaum(abschnitte: Einsatzabschnitt[], einheiten: Einheit[]): TreeDataNode[] {
  const kinder = new Map<number | null, Einsatzabschnitt[]>();
  for (const a of abschnitte) {
    const key = a.ueber_abschnitt_id ?? null;
    if (!kinder.has(key)) kinder.set(key, []);
    kinder.get(key)!.push(a);
  }
  const baue = (parent: number | null): TreeDataNode[] =>
    (kinder.get(parent) ?? []).map((a) => ({
      key: a.id,
      title: (
        <AbschnittKnoten
          abschnitt={a}
          staerke={abschnittStaerken(abschnitte, einheiten, a.id).inklUnter}
          anzahlEinheiten={einheiten.filter((e) => e.abschnitt_id === a.id).length}
        />
      ),
      children: baue(a.id),
    }));
  return baue(null);
}

interface AbschnittWerte {
  name: string;
  ueber_abschnitt_id?: number | null;
  leiter_id?: number | null;
  bemerkung?: string;
  sprechgruppe_ids?: number[];
  kommunikationsmittel?: string;
  erreichbarkeit?: string;
  kurzbezeichnung?: string;
  lagezustand?: AbschnittLagezustand | null;
  abschnittsauftrag?: string;
  fortschritt?: number | null;
}

export default function EinsatzabschnittePage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { benutzer } = useAuth();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [gewaehlt, setGewaehlt] = useState<number | null>(null);
  const [bearbeiten, setBearbeiten] = useState(false);
  const [entwurf, setEntwurf] = useState(false);
  const [form] = Form.useForm<AbschnittWerte>();
  const { abBreite } = useViewport();
  const breit = abBreite('md');
  const { token, rollen } = useRollen();
  // Je Einsatz, damit ein Einsatzwechsel in derselben Instanz nicht die Ansicht des vorigen
  // mitnimmt (Muster `FahrzeugePage`).
  const [ansichtNachEinsatz, setAnsichtNachEinsatz] = useState<Record<number, AbschnitteAnsicht>>(
    {},
  );
  const ansicht = ansichtNachEinsatz[einsatzId] ?? 'gliederung';
  const setzeAnsicht = (a: AbschnitteAnsicht) =>
    setAnsichtNachEinsatz((alt) => ({ ...alt, [einsatzId]: a }));

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const abschnitteQuery = useQuery({
    queryKey: einsatzKeys.abschnitte(einsatzId),
    queryFn: () => listeAbschnitte(einsatzId),
  });
  const personalQuery = useQuery({
    queryKey: einsatzKeys.personal(einsatzId),
    queryFn: () => listeEinsatzPersonal(einsatzId),
  });
  const einheitenQuery = useQuery({
    queryKey: einsatzKeys.einheiten(einsatzId),
    queryFn: () => listeEinheiten(einsatzId),
  });

  // Cross-Modul-Deeplink: ?abschnitt=<id> selektiert den Abschnitt, sofern vorhanden. Spiegelt
  // `Tree onSelect`: ein danach feuernder Deeplink darf einen offenen Entwurf nicht überleben
  // lassen, sonst nähme `speichern` wegen `!entwurf === false` fälschlich den POST-Zweig.
  useQueryParamSelektion('abschnitt', abschnitteQuery.isSuccess, (zid) => {
    if ((abschnitteQuery.data ?? []).some((a) => a.id === zid)) {
      setEntwurf(false);
      setGewaehlt(zid);
      // Aus dem Organigramm: das Detail steht in der Gliederung (LFH-626, D7).
      setAnsichtNachEinsatz((alt) => ({ ...alt, [einsatzId]: 'gliederung' }));
    }
  });

  // Schnellaktion: ?neu=1 öffnet den Entwurf eines neuen Abschnitts (Sprungpalette, LFH-506) —
  // dieselben Schritte wie `entwurfOeffnen`, hier ausgeschrieben, weil die Funktion je Render neu
  // entsteht. Warten bis der Einsatz geladen ist; Param immer löschen, Entwurf nur bei
  // Schreibrecht.
  const [searchParams, setSearchParams] = useSearchParams();
  const darfSchreibenRoh = darfImEinsatzSchreiben(einsatzQuery.data, benutzer);
  useEffect(() => {
    if (searchParams.get('neu') !== '1') return;
    if (einsatzQuery.isLoading) return;
    if (darfSchreibenRoh) {
      setGewaehlt(null);
      setBearbeiten(false);
      form.resetFields();
      setEntwurf(true);
      // Der Entwurf steht in der Gliederung; aus dem Organigramm sähe ihn sonst niemand.
      setAnsichtNachEinsatz((alt) => ({ ...alt, [einsatzId]: 'gliederung' }));
    }
    const naechste = new URLSearchParams(searchParams);
    naechste.delete('neu');
    setSearchParams(naechste, { replace: true });
  }, [searchParams, setSearchParams, einsatzQuery.isLoading, darfSchreibenRoh, form, einsatzId]);

  // Sichtvorgabe ?ansicht= (LFH-626), apply-then-clean wie auf der Fahrzeugseite. Geräumt wird
  // auch ein unbrauchbarer Wert, sonst stünde er beim Teilen des Links wieder im Auftrag.
  useEffect(() => {
    if (!searchParams.has('ansicht')) return;
    // `?neu=1` gewinnt: ein Entwurf braucht die Gliederung (Review LFH-626).
    const vorgabe =
      searchParams.get('neu') === '1' ? undefined : parseAbschnitteAnsicht(searchParams);
    if (vorgabe) setAnsichtNachEinsatz((alt) => ({ ...alt, [einsatzId]: vorgabe }));
    const rest = new URLSearchParams(searchParams);
    rest.delete('ansicht');
    setSearchParams(rest, { replace: true });
  }, [searchParams, setSearchParams, einsatzId]);

  function invalidate() {
    qc.invalidateQueries({ queryKey: einsatzKeys.abschnitte(einsatzId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.einheiten(einsatzId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
  }
  const fehler = useFehlerMeldung();

  const abschnitte = useMemo(() => abschnitteQuery.data ?? [], [abschnitteQuery.data]);
  const istGesperrt = useSprungSperre(einsatzId);
  // Für das Organigramm: eine fehlende Liste ist kein leerer Bestand (Stärke „—“ mit Grund).
  const einheitenZustand =
    einheitenQuery.data != null ? ('daten' as const) : abrufZustand(einheitenQuery);
  const einheitenQuelle: Quelle<Einheit> = useMemo(
    () => ({ zustand: einheitenZustand, daten: einheitenQuery.data ?? [] }),
    [einheitenZustand, einheitenQuery.data],
  );
  /**
   * Ohne Wahl steht der erste Abschnitt der Gliederung im Detail (LFH-1078): statt einer
   * Aufforderung „Wähle einen Abschnitt im Baum“ zeigt die Seite gleich einen. Ein offener Entwurf
   * hat keinen. `gewaehlt` bleibt die Wahl der Person; die Vorwahl ist nur ihr Rückfall.
   */
  const aktuell = entwurf
    ? null
    : gewaehlt != null
      ? (abschnitte.find((a) => a.id === gewaehlt) ?? null)
      : (abschnitte.find((a) => a.ueber_abschnitt_id == null) ?? null);

  const speichern = useMutation({
    mutationFn: (werte: AbschnittWerte) => {
      const daten: AbschnittEingabe = {
        name: werte.name.trim(),
        ueber_abschnitt_id: werte.ueber_abschnitt_id ?? null,
        leiter_id: werte.leiter_id ?? null,
        bemerkung: werte.bemerkung?.trim() || null,
        sprechgruppe_ids: werte.sprechgruppe_ids ?? [],
        kommunikationsmittel: werte.kommunikationsmittel || null,
        erreichbarkeit: werte.erreichbarkeit?.trim() || null,
        kurzbezeichnung: werte.kurzbezeichnung?.trim() || null,
        lagezustand: werte.lagezustand ?? null,
        abschnittsauftrag: werte.abschnittsauftrag?.trim() || null,
        fortschritt: werte.fortschritt ?? null,
      };
      return aktuell && !entwurf
        ? aktualisiereAbschnitt(einsatzId, aktuell.id, daten)
        : legeAbschnittAn(einsatzId, daten);
    },
    onSuccess: (a) => {
      invalidate();
      setEntwurf(false);
      setGewaehlt(a.id);
      setBearbeiten(false);
      message.success('Gespeichert');
    },
    onError: fehler,
  });
  const aufloesen = useMutation({
    mutationFn: (aid: number) => loeseAbschnittAuf(einsatzId, aid),
    onSuccess: () => {
      invalidate();
      setGewaehlt(null);
      setBearbeiten(false);
    },
    onError: fehler,
  });

  // Beim Wechsel des angezeigten Abschnitts zurück in die Lese-Ansicht — auch wenn die Vorwahl
  // wechselt, weil ein anderer Arbeitsplatz den Abschnitt aufgelöst hat; sonst füllte das Formular
  // still den nächsten und Speichern träfe ihn.
  const aktuellId = aktuell?.id;
  useEffect(() => {
    setBearbeiten(false);
  }, [aktuellId]);

  // Formular mit den Werten des aktuellen Abschnitts vorbelegen, sobald der Edit-Modus öffnet.
  useEffect(() => {
    if (aktuell && bearbeiten && !entwurf) {
      form.setFieldsValue({
        name: aktuell.name,
        ueber_abschnitt_id: aktuell.ueber_abschnitt_id ?? undefined,
        leiter_id: aktuell.leiter_id ?? undefined,
        bemerkung: aktuell.bemerkung ?? undefined,
        sprechgruppe_ids: aktuell.sprechgruppen?.map((s) => s.id) ?? [],
        kommunikationsmittel: aktuell.kommunikationsmittel ?? undefined,
        erreichbarkeit: aktuell.erreichbarkeit ?? undefined,
        kurzbezeichnung: aktuell.kurzbezeichnung ?? undefined,
        lagezustand: aktuell.lagezustand ?? undefined,
        abschnittsauftrag: aktuell.abschnittsauftrag ?? undefined,
        fortschritt: aktuell.fortschritt ?? undefined,
      });
    }
  }, [aktuell, bearbeiten, entwurf, form]);

  /**
   * Lokaler Entwurf statt Server-Datensatz: der POST — und damit der ETB-Eintrag — entsteht erst
   * beim Speichern. Abbrechen hinterlässt nichts.
   */
  function entwurfOeffnen() {
    setGewaehlt(null);
    setBearbeiten(false);
    form.resetFields();
    setEntwurf(true);
    setzeAnsicht('gliederung');
  }

  const baumDaten = useMemo(() => {
    const knoten = baueBaum(abschnitte, einheitenQuery.data ?? []);
    return entwurf
      ? [
          ...knoten,
          { key: 'entwurf', title: <i>Neuer Abschnitt (ungespeichert)</i>, selectable: false },
        ]
      : knoten;
  }, [abschnitte, einheitenQuery.data, entwurf]);
  const verboten = aktuell ? nachfahrenInkl(abschnitte, aktuell.id) : new Set<number>();
  const parentOptionen = abschnitte
    .filter((a) => !verboten.has(a.id))
    .map((a) => ({ value: a.id, title: a.name }));
  const personalOptionen = (personalQuery.data ?? []).map((p) => ({ value: p.id, label: p.name }));
  const zugeordneteEinheiten = (einheitenQuery.data ?? []).filter(
    (e) => e.abschnitt_id === aktuell?.id,
  );

  // Zwei Werte, getrennt beschriftet: „eigene" (Bedeutung der Bestandszeile) und „inkl.
  // Unterabschnitte".
  const staerken = aktuell
    ? abschnittStaerken(abschnitte, einheitenQuery.data ?? [], aktuell.id)
    : { eigene: null, inklUnter: null };

  // Zwei Ebenen, getrennt gehalten:
  //
  // Seitenzustand — nur `einsatzQuery`. Ohne sie rendern weder Breadcrumb noch
  // `darfImEinsatzSchreiben(...)`; nur diese Query rechtfertigt einen Frühausstieg.
  //
  // Listenzustand — `abschnitteQuery` und alles Weitere entscheidet an der Stelle der Daten, nie
  // als Frühausstieg: sonst risse ein gescheiterter Nebenabruf die ganze Seite weg.
  if (einsatzQuery.isLoading) return <SeitenSkeleton />;
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
  const darfSchreiben = darfImEinsatzSchreiben(einsatz, benutzer);

  /**
   * Listenzustand der Gliederungs-Karte — der Fehler allein reicht als Bedingung nicht. Ohne
   * Abschnitte im Zwischenspeicher tritt der Fehler an die Stelle des Baums; mit Abschnitten bleibt
   * der Baum stehen und bekommt ein Banner: er ist echt, nur womöglich alt.
   *
   * Gemessen an der ungefilterten Menge (Muster aus `TierePage`/`SchaedenPage`).
   */
  const listeGescheitert = abschnitteQuery.isError && abschnitte.length === 0;
  const standVeraltet = abschnitteQuery.isError && abschnitte.length > 0;

  const einheitenListe = (
    <>
      <Augenbraue
        als="h3"
        style={{ display: 'block', marginTop: token.marginLG, marginBottom: token.marginXS }}
      >
        Zugeordnete Einheiten
      </Augenbraue>
      <Liste
        size="small"
        emptyText="Keine Einheiten zugeordnet"
        dataSource={zugeordneteEinheiten}
        renderItem={(e) => (
          <ListenEintrag>
            <Space>
              <span>{e.name}</span>
              {e.typ_label && <Tag>{e.typ_label}</Tag>}
              <span style={{ ...monoStil(12), color: rollen.gedaempft }}>
                kumuliert <StaerkeAnzeige wert={e.ist_kumuliert} />
              </span>
            </Space>
          </ListenEintrag>
        )}
      />
      {/* Die Zuordnung setzt die Einheit (Feld „Abschnitt“ ihrer Detailseite): ein Sprung
          dorthin statt eines Satzes (LFH-1078). */}
      <div style={{ marginTop: token.marginXS }}>
        <SprungKnopf to={einheitenPfad(einsatzId)} gesperrt={istGesperrt('einheiten')}>
          Zu den Einheiten
        </SprungKnopf>
      </div>
    </>
  );

  return (
    <EinsatzSeite
      titel={modulName('einsatzabschnitte')}

      meta={abschnitteQuery.isSuccess ? `${abschnitte.length} Abschnitte` : undefined}
      dataUpdatedAt={gemeinsamerDatenstand(
        abschnitteQuery.dataUpdatedAt,
        einheitenQuery.dataUpdatedAt,
        personalQuery.dataUpdatedAt,
      )}
      breadcrumb={
        <Breadcrumb
          items={[
            { title: <Link to="/einsaetze">Einsätze</Link> },
            { title: einsatz.bezeichnung },
            { title: modulName('einsatzabschnitte') },
          ]}
        />
      }
      aktionen={
        <Space wrap style={{ minWidth: 0 }}>
          {/* Der Umschalter steht auch ohne Schreibrecht: lesen kann jeder beide Ansichten. */}
          <Segmentleiste<AbschnitteAnsicht>
            beschriftung="Ansicht"
            optionen={ANSICHT_OPTIONEN}
            wert={ansicht}
            onWechsel={setzeAnsicht}
          />
          {darfSchreiben && (
            <Button type="primary" onClick={entwurfOeffnen}>
              Abschnitt anlegen
            </Button>
          )}
        </Space>
      }
      hinweis={
        // Nur gesetzt, wenn er Inhalt hat: ein leerer Slot hielte Abstand frei.
        darfSchreiben ? undefined : (
          <RechteHinweis sichtbar text={einsatzRechteGrund(einsatz.status)} />
        )
      }
    >
      {ansicht === 'organigramm' ? (
        abschnitteQuery.isLoading ? (
          <SeitenSkeleton />
        ) : listeGescheitert ? (
          <SeitenFehler
            text="Abschnitte konnten nicht geladen werden"
            ursache={abschnitteQuery.error}
            onWiederholen={() => void abschnitteQuery.refetch()}
          />
        ) : abschnitte.length === 0 &&
          einheitenQuelle.zustand === 'daten' &&
          einheitenQuelle.daten.length === 0 ? (
          // Leer nur, wenn BEIDE Quellen da sind: ohne Einheiten wäre „keine Abschnitte“ eine
          // Aussage über eine Lage, die niemand geprüft hat.
          <SeitenLeer
            titel="Noch keine Abschnitte"
            aktion={
              darfSchreiben ? { label: 'Abschnitt anlegen', onClick: entwurfOeffnen } : undefined
            }
          />
        ) : (
          <>
            {standVeraltet && (
              <SeitenStandVeraltet onWiederholen={() => void abschnitteQuery.refetch()} />
            )}
            <Organigramm
              einsatz={einsatz}
              abschnitte={abschnitte}
              einheiten={einheitenQuelle}
              datenstand={gemeinsamerDatenstand(
                abschnitteQuery.dataUpdatedAt,
                einheitenQuery.dataUpdatedAt,
              )}
            />
          </>
        )
      ) : (
        /* Unter `md` stapeln statt einer 360-px-Spalte neben dem Detail. Kein Collapse:
          gestapelt trägt die Gliederung dieselbe Bedienung wie breit. */
        <div
          data-testid="abschnitte-rahmen"
          style={{
            display: 'flex',
            flexDirection: breit ? 'row' : 'column',
            gap: token.margin,
            alignItems: breit ? 'flex-start' : 'stretch',
          }}
        >
          <div
            data-testid="abschnitte-gliederung"
            style={breit ? { flex: '0 0 360px', minWidth: 0 } : { width: '100%' }}
          >
            <Paneel
              titel="Gliederung"
              meta={abschnitteQuery.isSuccess ? String(abschnitte.length) : undefined}
              koerperPolster
            >
              {/* Drei Zustände in dieser Reihenfolge: eine Weiche auf die Länge der Liste wäre
                auch beim Laden und im Fehlerfall wahr. Solange geladen wird, wird über die
                Menge nichts behauptet.

                Der Fehlerzweig trägt zusätzlich die Mengenbedingung (`listeGescheitert`): er
                verdrängt den Baum nur, wenn es keinen gibt. */}
              {abschnitteQuery.isLoading ? (
                <SeitenSkeleton />
              ) : listeGescheitert ? (
                <SeitenFehler
                  text="Abschnitte konnten nicht geladen werden"
                  ursache={abschnitteQuery.error}
                  onWiederholen={() => void abschnitteQuery.refetch()}
                />
              ) : abschnitte.length === 0 && !entwurf ? (
                <SeitenLeer
                  titel="Noch keine Abschnitte"
                  /* Derselbe Wortlaut wie der Kopfknopf. Ohne Schreibrecht keine Aktion — ein
                   Knopf, der nur eine Fehlermeldung auslöst, ist kein Weg aus dem Leerzustand. */
                  aktion={
                    darfSchreiben
                      ? { label: 'Abschnitt anlegen', onClick: entwurfOeffnen }
                      : undefined
                  }
                />
              ) : (
                <>
                  {standVeraltet && (
                    <SeitenStandVeraltet onWiederholen={() => void abschnitteQuery.refetch()} />
                  )}
                  <Tree
                    treeData={baumDaten}
                    selectedKeys={entwurf ? ['entwurf'] : aktuell ? [aktuell.id] : []}
                    defaultExpandAll
                    onSelect={(keys) => {
                      setEntwurf(false);
                      setGewaehlt(keys.length ? Number(keys[0]) : null);
                    }}
                  />
                </>
              )}
            </Paneel>
          </div>

          <Paneel
            style={{ flex: 1, width: breit ? undefined : '100%' }}
            koerperPolster
            titel={
              entwurf
                ? 'Neuer Abschnitt'
                : aktuell
                  ? `Abschnitt: ${aktuell.name}`
                  : 'Kein Abschnitt gewählt'
            }
          >
            {/* Ohne Abschnitt (leere Gliederung, Ladefehler) trägt der Titel den Zustand; den
                Weg hinaus zeigt der Leerzustand der Gliederung. */}
            {!aktuell && !entwurf ? null : entwurf || bearbeiten ? (
              <Form<AbschnittWerte>
                form={form}
                layout="vertical"
                onFinish={(w) => speichern.mutate(w)}
              >
                <Form.Item label="Name" name="name" rules={[{ required: true, whitespace: true }]}>
                  <Input autoFocus />
                </Form.Item>
                {/* Eindeutig je Einsatz ohne Groß-/Kleinschreibung wie der Index
                    `einsatzabschnitt_kurzbezeichnung_eindeutig` (NOCASE): als Prüfung am Feld,
                    nicht als Satz (LFH-1078). Der Server bleibt die Wahrheit. */}
                <Form.Item
                  label="Kurzbezeichnung"
                  name="kurzbezeichnung"
                  rules={[
                    {
                      validator: (_, wert?: string) => {
                        const kurz = wert ? nocase(wert) : undefined;
                        const belegt = kurz
                          ? abschnitte.find(
                              (a) =>
                                a.id !== aktuell?.id &&
                                a.kurzbezeichnung != null &&
                                nocase(a.kurzbezeichnung) === kurz,
                            )
                          : undefined;
                        return belegt
                          ? Promise.reject(new Error(`Schon vergeben (${belegt.name})`))
                          : Promise.resolve();
                      },
                    },
                  ]}
                >
                  <Input maxLength={20} allowClear placeholder="z. B. EA-N" />
                </Form.Item>
                <Form.Item label="Über-Abschnitt" name="ueber_abschnitt_id">
                  <TreeSelect
                    allowClear
                    placeholder="Übergeordneter Abschnitt"
                    treeData={parentOptionen}
                  />
                </Form.Item>
                <Form.Item label="Abschnittsleiter" name="leiter_id">
                  <Select allowClear placeholder="Disponierte Person" options={personalOptionen} />
                </Form.Item>

                <Augenbraue
                  als="h3"
                  style={{
                    display: 'block',
                    marginTop: token.marginXS,
                    marginBottom: token.marginSM,
                  }}
                >
                  Lage
                </Augenbraue>
                <Form.Item label="Lagezustand" name="lagezustand">
                  <Select allowClear placeholder="nicht beurteilt" options={LAGEZUSTAND_OPTIONEN} />
                </Form.Item>
                <Form.Item label="Abschnittsauftrag" name="abschnittsauftrag">
                  <Input.TextArea rows={2} placeholder="Fester Auftrag des Abschnitts" />
                </Form.Item>
                <Form.Item label="Fortschritt" name="fortschritt">
                  <InputNumber
                    min={0}
                    max={100}
                    precision={0}
                    suffix="%"
                    placeholder="nicht eingeschätzt"
                  />
                </Form.Item>

                <Augenbraue
                  als="h3"
                  style={{
                    display: 'block',
                    marginTop: token.marginXS,
                    marginBottom: token.marginSM,
                  }}
                >
                  Funk / Kommunikation
                </Augenbraue>
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
                <Space size="middle">
                  <Button type="primary" htmlType="submit" loading={speichern.isPending}>
                    Speichern
                  </Button>
                  <Button
                    onClick={() => {
                      setEntwurf(false);
                      setBearbeiten(false);
                    }}
                  >
                    Abbrechen
                  </Button>
                  {!entwurf && aktuell && (
                    <Popconfirm
                      title="Abschnitt auflösen?"
                      description={
                        'Unter-Abschnitte rücken hoch, zugeordnete Einheiten werden „nicht zugeordnet“.'
                      }
                      okButtonProps={{ danger: true }}
                      onConfirm={() => aufloesen.mutate(aktuell.id)}
                    >
                      <Button danger>Auflösen</Button>
                    </Popconfirm>
                  )}
                </Space>
              </Form>
            ) : aktuell ? (
              <>
                <AbschnittDaten abschnitt={aktuell} staerken={staerken} />

                {darfSchreiben && (
                  <Space size="middle" style={{ marginTop: 12 }}>
                    <Button type="primary" onClick={() => setBearbeiten(true)}>
                      Bearbeiten
                    </Button>
                    <Popconfirm
                      title="Abschnitt auflösen?"
                      description={
                        'Unter-Abschnitte rücken hoch, zugeordnete Einheiten werden „nicht zugeordnet“.'
                      }
                      okButtonProps={{ danger: true }}
                      onConfirm={() => aufloesen.mutate(aktuell.id)}
                    >
                      <Button danger>Auflösen</Button>
                    </Popconfirm>
                  </Space>
                )}

                {einheitenListe}
              </>
            ) : null}
          </Paneel>
        </div>
      )}
    </EinsatzSeite>
  );
}
