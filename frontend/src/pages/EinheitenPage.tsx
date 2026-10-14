import { App, Breadcrumb, Button, Form, Input } from 'antd';
import { EINHEIT_NAME_MAX } from '../api/eingabegrenzen';
import EinsatzSeite from '../components/EinsatzSeite';
import Datensicht, { spaltenFuer } from '../components/Datensicht';
import StatusTag from '../components/StatusTag';
import { monoStil } from '../components/instrument';
import { Select } from '../components/Select';
import {
  SeitenFehler,
  SeitenLeer,
  SeitenSkeleton,
  SeitenStandVeraltet,
  nichtGefundenInhalt,
} from '../components/SeitenZustand';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router';
import { Fragment, useMemo, useState, type Key } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ladeEinsatz } from '../api/einsaetze';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { listeEinheitTypen } from '../api/einheitTypen';
import { bildeEinheit, listAufgeloesteEinheiten, listeEinheiten } from '../api/einheiten';
import EntlassenBlock from '../kraefte/EntlassenBlock';
import { einsatzKeys, globalKeys } from '../api/queryKeys';
import { listeAbschnitte } from '../api/einsatzabschnitte';
import { staerkeText } from '../anzeige/staerke';
import {
  einheitAusVorlagePfad,
  einheitDetailPfad,
  kraefteuebersichtPfad,
  parseRouteId,
} from '../routing/deeplinks';
import { loadEinheitVorlagen } from '../api/einheitVorlagen';
import { orderAsTree, vorlagePfad } from '../stammdaten/einheitVorlagenBaum';
import { demoGroupedOptions, SUCHTEXT_SUCHE } from '../stammdaten/demoAuswahl';
import Verdichtungszeile from '../kraefte/Verdichtungszeile';
import KraeftebaumZelle, { type SprungGesperrt } from '../kraefte/KraeftebaumZelle';
import { buildEinheitenGliederung, type GliederungZeile } from '../kraefte/einheitenGliederung';
import { schluesselBisStufe } from '../kraefte/kraeftebaumKern';
import { einheitStaerkeUrteil } from '../theme/statusFarben';
import { useSprungSperre } from '../einsatz/useSprungSperre';
import { ErfassungsModal } from '../components/Erfassung';
import { RechteHinweis } from '../components/SpeicherHinweis';
import { einsatzRechteGrund } from '../components/nurAnsicht';
import { modulName } from '../einsatz/modulRegistry';
import type { EinheitVorlage } from '../api/types';

/**
 * Gliederung der Einheiten eines Einsatzes (LLH-1029): eine Tabelle mit Baum, Zeilen aus dem
 * EINEN Kräftebaum-Kern (`kraefte/einheitenGliederung.ts` über `einheitenBaum`) — dieselben
 * Einheit-Knoten in derselben Folge wie das Meldebild, nur ohne Mittel. Die Frage ist „welche
 * Einheit?“, also Tabelle (`frontend/AGENTS.md`, „Die Liste ist die zweite Frage“), auch am Handy
 * angepasst statt in Karten aufgelöst. Die Detailansicht liegt auf eigener Route
 * (`EinheitDetailPage.tsx`, `/einsaetze/:id/einheiten/:einheitId`).
 */

/**
 * Die Spalten. Keine Sortierung, kein Filter, keine Suche (`VOLLMENGE_PFLICHT` im
 * `datensicht.guard`): die Folge ist die des Kerns, und die Elternzeile trägt die kumulierte Zahl
 * über ihre Kinder — fiele im Primitiv eine Zeile weg, stimmte sie still nicht mehr.
 *
 * AM HANDY (390 px) bleiben Einheit, Ist und Soll: das ist der Vergleich. Einheitsführer weicht
 * unter sm, Abschnitt und Fahrzeuge unter md; der Spaltenschalter zählt sie und holt sie zurück.
 * Die Einheit ist die Fließspalte (LFH-523), alle übrigen tragen eine Zahlbreite.
 */
function gliederungSpalten(einsatzId: number, sprungGesperrt: SprungGesperrt) {
  return spaltenFuer<GliederungZeile>()([
    {
      title: 'Einheit',
      key: 'einheit',
      immerSichtbar: true,
      mindestBreite: 140,
      // Ein langes Wort im Namen („Behandlungsgruppe“) darf die Spalte nicht so breit halten,
      // dass Soll am Handy aus dem Bild läuft: es wird getrennt (`lang="de"`), und wo der Browser
      // kein Trennwörterbuch hat, bricht es notfalls im Wort. Beides erbt die Zelle.
      render: (_t, z) => (
        <div style={{ hyphens: 'auto', overflowWrap: 'anywhere' }}>
          <KraeftebaumZelle zeile={z} einsatzId={einsatzId} gesperrt={sprungGesperrt} />
        </div>
      ),
    },
    {
      title: 'Einheitsführer',
      key: 'fuehrer',
      width: 150,
      abBreite: 'sm',
      render: (_t, z) => z.fuehrer ?? '—',
    },
    {
      title: 'Ist',
      key: 'ist',
      width: 88,
      // Kumuliert (Server), dazu das Urteil gegen das Soll: nur „unterbesetzt“ steht da, als Wort
      // neben der Farbe (WCAG 1.4.1). „Soll erfüllt“ bliebe ein Grün-Teppich.
      render: (_t, z) => (
        <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start' }}>
          <span style={monoStil(12)}>{staerkeText(z.ist)}</span>
          {z.urteil === 'unterbesetzt' && (
            // `umbrechen` nimmt antds Außenrand rechts (8 px) weg: er verbreiterte die Spalte.
            <StatusTag darstellung={einheitStaerkeUrteil.unterbesetzt} umbrechen />
          )}
        </span>
      ),
    },
    {
      title: 'Soll',
      key: 'soll',
      width: 88,
      render: (_t, z) => <span style={monoStil(12)}>{staerkeText(z.soll)}</span>,
    },
    {
      title: 'Abschnitt',
      key: 'abschnitt',
      width: 140,
      abBreite: 'md',
      render: (_t, z) => z.abschnitt ?? '—',
    },
    {
      title: 'Fahrzeuge',
      key: 'fahrzeuge',
      width: 180,
      abBreite: 'md',
      // Anzahl, dann die Funkrufnamen in Mono. Ein Name bricht nie in sich um („Musterstadt
      // 11-|1“ läse sich als zwei Fahrzeuge), nur zwischen den Namen.
      render: (_t, z) =>
        z.fahrzeuge.length > 0 ? (
          <span data-lfh="einheit-fahrzeuge" style={monoStil(12)}>
            {z.fahrzeuge.length} ·{' '}
            {z.fahrzeuge.map((f, i) => (
              <Fragment key={`${i}-${f}`}>
                {i > 0 && ', '}
                <span style={{ whiteSpace: 'nowrap' }}>{f}</span>
              </Fragment>
            ))}
          </span>
        ) : (
          '—'
        ),
    },
  ]);
}

/**
 * Feldsatz des „Einheit bilden"-Dialogs — bewusst wenige Felder (siehe `bilden`). Mit Vorlage
 * (LLH-1049) steht nur sie; Name, Typ und alles Weitere stehen auf der Seite „Aus Vorlage“.
 */
interface BildenWerte {
  vorlage_id?: number | null;
  name: string;
  typ_id?: number | null;
}

/**
 * Optionen des Feldes „Vorlage“ (LLH-1049, design.md D1): Baumfolge, Untervorlagen mit Pfad (sie
 * sind allein bildbar), Demo-Vorlagen hinten über `demoGroupedOptions`. Der Pfad steht auch als
 * `title`, weil das Demo-Label ein Element ist und Auswahl wie Tooltip sonst keinen Text hätten.
 */
function vorlagenOptionen(vorlagen: readonly EinheitVorlage[]) {
  const geordnet = orderAsTree(vorlagen).map((r) => r.vorlage);
  const pfad = new Map(geordnet.map((v) => [v.id, vorlagePfad(vorlagen, v)] as const));
  const text = (v: EinheitVorlage) => pfad.get(v.id) ?? v.name;
  return demoGroupedOptions(geordnet, text, text).map((o) =>
    'options' in o
      ? { ...o, options: o.options.map((x) => ({ ...x, title: pfad.get(x.value) })) }
      : { ...o, title: pfad.get(o.value) },
  );
}

export default function EinheitenPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const [bildenOffen, setBildenOffen] = useState(false);
  const [bildenForm] = Form.useForm<BildenWerte>();
  const sprungGesperrt = useSprungSperre(einsatzId);
  /** Offene Zeilen; `null` heißt Vorgabe: jede Einheit mit Untereinheiten offen. */
  const [offen, setOffen] = useState<Key[] | null>(null);

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const einheitenQuery = useQuery({
    queryKey: einsatzKeys.einheiten(einsatzId),
    queryFn: () => listeEinheiten(einsatzId),
  });
  // Nur für Rang und Namen der Abschnitte: ohne Leserecht oder bei Fehler bleibt die Folge die
  // Eingabefolge, und der Name kommt aus der Einheit (`buildEinheitenGliederung`).
  const abschnitteQuery = useQuery({
    queryKey: einsatzKeys.abschnitte(einsatzId),
    queryFn: () => listeAbschnitte(einsatzId),
  });
  // Aufgelöste Einheiten (LLH-1079): getrennt geliefert, die Gliederung und ihre Zahl kennen sie
  // nicht. Eine aufgelöste Einheit wird nicht wieder aktiv (design.md D5), der Block hat keine
  // Aktion.
  const aufgeloesteQuery = useQuery({
    queryKey: einsatzKeys.einheitenAufgeloeste(einsatzId),
    queryFn: () => listAufgeloesteEinheiten(einsatzId),
  });
  const typenQuery = useQuery({ queryKey: globalKeys.einheitTypen(), queryFn: listeEinheitTypen });
  // Aktive Einheiten-Vorlagen der Organisation (LLH-1049): ohne sie fehlt das Feld „Vorlage“.
  // Beim Seitenaufbau geladen, nicht erst mit dem Dialog: ein später erscheinendes erstes Feld
  // schöbe den Dialog unter dem Fokus.
  const vorlagenQuery = useQuery({
    queryKey: globalKeys.einheitVorlagenListe('aktiv'),
    queryFn: () => loadEinheitVorlagen('aktiv'),
  });
  const vorlagen = vorlagenQuery.data ?? [];
  const gewaehlteVorlage = Form.useWatch('vorlage_id', bildenForm);

  const einheiten = useMemo(() => einheitenQuery.data ?? [], [einheitenQuery.data]);
  const zeilen = useMemo(
    () => buildEinheitenGliederung(einheiten, abschnitteQuery.data ?? []),
    [einheiten, abschnitteQuery.data],
  );
  const vorgabeOffen = useMemo(() => schluesselBisStufe(zeilen, 'einheiten'), [zeilen]);
  const spalten = useMemo(
    () => gliederungSpalten(einsatzId, sprungGesperrt),
    [einsatzId, sprungGesperrt],
  );

  /**
   * Bestands-Deeplink `?einheit=<id>` leitet auf die Item-Route weiter: andere Module verlinken
   * weiterhin mit `?einheit=`.
   *
   * Bewusst nicht über `useQueryParamSelektion`: der Hook ist apply-then-clean und räumt den Param
   * danach mit einem eigenen `setSearchParams(..., { replace: true })`. Diese zweite Navigation
   * überschriebe die Weiterleitung sofort; der Hook ist für eine Selektion auf derselben Seite
   * gebaut.
   *
   * `<Navigate replace>` passiert beim Rendern, und der Zurück-Knopf bleibt nicht in der
   * Weiterleitung hängen. Die ID wird gegen die geladene Liste geprüft — eine erfundene Kennung
   * landet auf der Gliederung, nicht auf einer Detailseite ohne Datensatz.
   */
  const [searchParams] = useSearchParams();
  const deeplinkZiel = parseRouteId(searchParams.get('einheit') ?? undefined);

  /**
   * „Einheit bilden" fragt zuerst: ein sofort geschriebener Platzhalter stünde nach einem Fehlklick
   * in jedem Baum, jeder Zuordnungsliste und jeder Stärkeaggregation.
   *
   * Zwei Felder: Name (Pflicht) und Typ; alles Weitere gehört auf die Detailseite (Feldbudget ~3).
   * Kein `serie`: eine Einheit zu bilden ist keine Minutentakt-Erfassung.
   */
  const bilden = useMutation({
    mutationFn: (werte: Omit<BildenWerte, 'vorlage_id'>) =>
      bildeEinheit(einsatzId, { name: werte.name.trim(), typ_id: werte.typ_id ?? null }),
    onSuccess: (e) => {
      qc.invalidateQueries({ queryKey: einsatzKeys.einheiten(einsatzId) });
      qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
      message.success('Einheit gebildet');
      // Direkt in die frische Einheit: dort stehen die Kopfdaten, die gerade nicht abgefragt
      // wurden.
      void navigate(einheitDetailPfad(einsatzId, e.id));
    },
  });

  // Seitenzustand: nur `einsatzQuery` — ohne sie tragen weder Breadcrumb noch
  // `darfImEinsatzSchreiben` etwas. Alles andere wird an Ort und Stelle entschieden.
  if (einsatzQuery.isLoading) {
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
  const darfSchreiben = darfImEinsatzSchreiben(einsatz);

  // Erst nach dem Laden weiterleiten: vorher ist „gibt es die Einheit?" nicht beantwortbar.
  if (deeplinkZiel != null && einheiten.some((e) => e.id === deeplinkZiel)) {
    return <Navigate to={einheitDetailPfad(einsatzId, deeplinkZiel)} replace />;
  }

  /**
   * Listenzustand der Gliederung — der Fehler allein reicht als Bedingung nicht. Ohne Einheiten im
   * Zwischenspeicher tritt der Fehler an die Stelle der Tabelle; mit Einheiten bleibt sie stehen
   * und bekommt ein Banner, sie ist echt, nur womöglich alt.
   */
  const listeGescheitert = einheitenQuery.isError && einheiten.length === 0;
  const standVeraltet = einheitenQuery.isError && einheiten.length > 0;

  return (
    <EinsatzSeite
      breadcrumb={
        <Breadcrumb
          items={[
            { title: <Link to="/einsaetze">Einsätze</Link> },
            { title: einsatz.bezeichnung },
            { title: modulName('einheiten') },
          ]}
        />
      }
      titel={modulName('einheiten')}
      meta={einheitenQuery.isSuccess ? `${einheiten.length} Einheiten` : undefined}
      dataUpdatedAt={einheitenQuery.dataUpdatedAt}
      aktionen={
        darfSchreiben && (
          <Button type="primary" onClick={() => setBildenOffen(true)}>
            Einheit bilden
          </Button>
        )
      }
      hinweis={
        // Nur gesetzt, wenn er Inhalt hat: ein leerer Slot hielte Abstand frei.
        darfSchreiben ? undefined : (
          <RechteHinweis sichtbar text={einsatzRechteGrund(einsatz.status)} />
        )
      }
    >
      <Verdichtungszeile einsatzId={einsatzId} pfad={kraefteuebersichtPfad(einsatzId)} />

      {/* Drei Zustände, nicht zwei: `einheiten.length === 0` ist auch während des Ladens und im
          Fehlerfall wahr. Gefragt wird deshalb die Query; die Länge entscheidet erst, wenn sie
          etwas bedeutet. Reihenfolge: laden vor Fehler vor leer. Der Fehlerzweig trägt zusätzlich
          die Mengenbedingung (`listeGescheitert`): er verdrängt die Tabelle nur, wenn es keine
          gibt. */}
      {/* Auch auf die Abschnitte wird gewartet: die Folge hängt an ihrem Rang, eine Tabelle in
          vorläufiger Serverfolge spränge nach deren Ankunft um. Scheitern sie, gilt die
          Eingabefolge. */}
      {einheitenQuery.isLoading || abschnitteQuery.isLoading ? (
        <SeitenSkeleton zeilen={3} />
      ) : listeGescheitert ? (
        <SeitenFehler
          text="Gliederung konnte nicht geladen werden"
          ursache={einheitenQuery.error}
          onWiederholen={() => void einheitenQuery.refetch()}
        />
      ) : einheiten.length === 0 ? (
        <SeitenLeer
          titel="Noch keine Einheiten"
          aktion={
            darfSchreiben
              ? // Wortlaut gleich dem Kopfknopf: es ist dieselbe Handlung.
                { label: 'Einheit bilden', onClick: () => setBildenOffen(true) }
              : undefined
          }
        />
      ) : (
        <>
          {standVeraltet && (
            <SeitenStandVeraltet onWiederholen={() => void einheitenQuery.refetch()} />
          )}
          {/* Volle Breite, Baum aus dem Kern; das Bedienziel der Zeile ist der Name (Link in der
              Einheitzelle). Zufluss `sammelbanner`: eine neu gebildete Einheit erscheint als
              Banner, solange Fokus oder Zeiger in der Tabelle liegen. */}
          <Datensicht
            bezeichnung="Gliederung"
            form="tabelle"
            spalten={spalten}
            daten={zeilen}
            zeilenSchluessel="key"
            baum={{
              kinder: 'children',
              aufgeklappt: offen ?? vorgabeOffen,
              onAufgeklappt: setOffen,
            }}
            karte={{ art: 'plan', titel: { spalte: 'einheit' }, sekundaer: ['ist', 'soll'] }}
          />
        </>
      )}

      {/* Unter der Tabelle, wie bei Personal; außerhalb der Zustände, damit er auch steht, wenn
          keine Einheit mehr aktiv ist. Ohne Einträge zeichnet er nichts. */}
      <EntlassenBlock
        titel="Aufgelöst"
        endeWort="aufgelöst"
        eintraege={(aufgeloesteQuery.data ?? []).map((e) => ({
          id: e.id,
          name: e.name,
          zusatz: e.typ_label,
          beendetAt: e.aufgeloest_at,
        }))}
      />

      {/* Zwei Felder; der Rest der Kopfdaten lebt auf der Detailansicht. Der Dialog setzt auf
          allen Auswegen selbst zurück. */}
      <ErfassungsModal<BildenWerte>
        offen={bildenOffen}
        titel="Einheit bilden"
        form={bildenForm}
        laeuft={bilden.isPending}
        // Grund einer Ablehnung im Dialog, bis zum nächsten Absenden; Öffnen und Abbrechen räumen
        // ihn (LFH-1077, `frontend/AGENTS.md`, „Rückwege und Fehler“).
        speicherung={bilden}
        speicherFehlerTitel="Einheit nicht gebildet"
        speicherFehlerFallback="Bilden fehlgeschlagen"
        // `mutateAsync`, nicht `mutate`: die Hülle darf die Felder nur leeren, wenn der Datensatz
        // ankam. Ein 422 kostete sonst den eingegebenen Namen.
        // Mit Vorlage schreibt der Dialog nichts: „Weiter“ öffnet die Seite, auf der gebildet wird
        // (design.md D1). Die Hülle leert danach und schließt wie nach jedem Erfolg.
        onErfassen={(w) => {
          if (w.vorlage_id != null) {
            void navigate(einheitAusVorlagePfad(einsatzId, w.vorlage_id));
            return Promise.resolve();
          }
          return bilden.mutateAsync(w);
        }}
        erfassenText={gewaehlteVorlage != null ? 'Weiter' : 'Bilden'}
        onFertig={() => setBildenOffen(false)}
        onAbbrechen={() => setBildenOffen(false)}
      >
        {vorlagen.length > 0 && (
          <Form.Item label="Vorlage" name="vorlage_id">
            <Select<number>
              allowClear
              showSearch={SUCHTEXT_SUCHE}
              placeholder="ohne Vorlage"
              options={vorlagenOptionen(vorlagen)}
            />
          </Form.Item>
        )}
        {gewaehlteVorlage == null && (
          <>
            <Form.Item label="Name" name="name" rules={[{ required: true, whitespace: true }]}>
              <Input placeholder="z. B. 2. Zug" maxLength={EINHEIT_NAME_MAX} />
            </Form.Item>
            <Form.Item label="Typ" name="typ_id">
              <Select
                allowClear
                placeholder="Typ wählen"
                notFoundContent={nichtGefundenInhalt(typenQuery, {
                  allgemein: 'Einheitentypen konnten nicht geladen werden',
                })}
                options={(typenQuery.data ?? []).map((t) => ({ value: t.id, label: t.label }))}
              />
            </Form.Item>
          </>
        )}
      </ErfassungsModal>
    </EinsatzSeite>
  );
}
