import {
  App,
  AutoComplete,
  Button,
  Card,
  DatePicker,
  Form,
  Input,
  Space,
  Tag,
  Typography,
  theme,
} from 'antd';
import { EnvironmentOutlined, PlusOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { useEffect, useState, type CSSProperties } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Einsatzart, EinsatzAnzeige } from '../api/types';
import { ApiError } from '../api/client';
import { legeEinsatzAn, listeEinsaetze } from '../api/einsaetze';
import { listeStichwortVorschlaege } from '../api/stichwortVorschlaege';
import { formatZeitKurz } from '../anzeige/format';
import { EINSATZART_LABELS, EINSATZART_OPTIONEN } from '../einsatz/einsatzart';
import { EINSATZ_STATUS } from '../einsatz/einsatzStatus';
import { ErfassungsModal } from '../components/Erfassung';
import { Select } from '../components/Select';
import { useAuth } from '../auth/AuthContext';
import { darfVerwaltung } from '../einsatz/schreibrecht';
import { globalKeys } from '../api/queryKeys';
import { einsatzPfad } from '../routing/deeplinks';
import EinsatzSeite from '../components/EinsatzSeite';
import SektionHeader from '../components/SektionHeader';
import StatusTag from '../components/StatusTag';
import { SeitenFehler, SeitenLeer } from '../components/SeitenZustand';
import { abstand, flaeche } from '../theme/tokens';
// Die Skelettform lebt als Klasse in der Gestaltungssprache. Der Import steht
// bewusst HIER und nicht nur transitiv über `SeitenZustand`/`EinsatzSeite`: ohne
// ihn wären die Balken 0 px hoch, und jsdom rechnet kein Layout — der Ausfall
// wäre in keinem Test sichtbar (dieselbe Falle wie `SeitenZustand.tsx:3-7`).
import '../theme/sprache.css';

/** Werte des Anlegedialogs (`begonnen_at` als Dayjs aus dem `DatePicker`). */
interface AnlegeWerte {
  bezeichnung: string;
  stichwort?: string;
  einsatzart: Einsatzart;
  begonnen_at: Dayjs;
}

/**
 * Mindesthöhe einer Kachel. KEIN neuer Wert — die 120 px standen schon am
 * Anlegen-Knopf; sie sind hier nur an EINE Stelle gehoben, damit Skelett, Karte und
 * Anlegen-Kachel dieselbe Höhe tragen (Prüfliste Kriterium 12, kein Sprung beim
 * Wechsel Laden → Daten). BEFUND: `flaeche` kennt `kachelMin`/`kachelMinKlein`
 * (Breiten), aber keine Kachel-Höhenrolle — erfunden wird hier keine.
 */
const KACHEL_MIN_HOEHE = 120;

/**
 * Ab wie vielen aktiven Einsätzen ein Suchfeld erscheint.
 *
 * Acht, weil das Raster darunter auf dem Fükw-Schirm zwei Reihen füllt — bis
 * dahin ist Suchen langsamer als Hinsehen. Ein dauerhaft stehendes Suchfeld über
 * drei Karten wäre Bedienlast ohne Nutzen.
 */
const SUCHE_AB = 8;

/**
 * Der Titel-Link der Einsatzkarte als Bedienziel auf der Dichte-Staffel (LFH-396, Gate 3).
 *
 * GEMESSEN im Browser (`e2e/gate3-trefflaeche.spec.ts`, Stand vor dem Fix): 17 px in jeder
 * Stufe — ein nacktes Inline-`<a>` im Kartenkopf ist so hoch wie seine Zeile und
 * unterschreitet damit schon in `kompakt` den 24-px-Boden. Die Karte selbst ist 120 px hoch
 * und klickbar, der Link aber ist das TASTATURziel (Tab erreicht ihn, Enter navigiert), und
 * Gate 3 misst jedes fokussierbare Element.
 *
 * ZWEI Angaben, nicht eine (LFH-365): `minHeight` aus `controlHeight` trägt den Boden
 * (30 / 48 / 72), die Polsterung zieht mit. Sie liegt nur auf der SENKRECHTEN Achse —
 * waagerecht polstert der Kartenkopf selbst, ein Versatz des Titels gegenüber dem
 * Kartenkörper wäre eine Sichtänderung, keine Trefflächenänderung. `display: flex` statt
 * `inline-flex`, damit der Text darin als eigenes Flex-Item weiterhin per Ellipsis
 * abschneidet (der Kopf ist `white-space: nowrap`): ein atomarer Inline-Kasten würde vom
 * Kopf hart geclippt, ohne „…".
 *
 * Rein und exportiert nach dem Muster von `bedienzielStil` (`pages/lagekarte/Sidebar.tsx`):
 * nur so ist die Zusicherung über zwei Dichtestufen ohne Rendern prüfbar — `test/utils.tsx`
 * montiert ein nacktes `ConfigProvider` ohne unser Theme.
 */
export function kartenTitelStil(token: { controlHeight: number; paddingSM: number }) {
  return {
    display: 'flex',
    alignItems: 'center',
    minHeight: token.controlHeight,
    padding: `${token.paddingSM}px 0`,
  } as const;
}

/** Der Text im Titel-Link: schneidet als Flex-Item per Ellipsis ab (siehe {@link kartenTitelStil}). */
const kartenTitelTextStil: CSSProperties = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

/** Ein Kartenraster; die Mindestbreite kommt aus `flaeche`, der Abstand aus `abstand`. */
function rasterStil(minBreite: number, luft: number): CSSProperties {
  return {
    display: 'grid',
    gridTemplateColumns: `repeat(auto-fill, minmax(${minBreite}px, 1fr))`,
    gap: luft,
  };
}

/**
 * Ladeplatzhalter in Kachelform.
 *
 * Bewusst NICHT `SeitenSkeleton`: das Primitiv trägt `paddingTop:
 * flaeche.zustandOben` (80 px) für den Seiten-Ladezustand — in einer Rasterzelle
 * wüchse damit jede Kachel um 80 px, und genau der Sprung Skelett → Karte, den
 * Kriterium 12 klein halten soll, wäre wieder da. Eine Kachel-Variante am Primitiv
 * ist der Zielzustand (Ticket B3, Datenzustands-Primitive).
 */
function KachelSkelett() {
  return (
    <Card style={{ minHeight: KACHEL_MIN_HOEHE }}>
      <div className="lfh-skelett">
        <span className="lfh-skelett__balken lfh-skelett__balken--gross" />
        <span className="lfh-skelett__balken" />
        <span className="lfh-skelett__balken lfh-skelett__balken--kurz" />
      </div>
    </Card>
  );
}

export default function EinsaetzePage() {
  const navigate = useNavigate();
  const { token } = theme.useToken();
  const { benutzer } = useAuth();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [dialogOffen, setDialogOffen] = useState(false);
  const [form] = Form.useForm<AnlegeWerte>();

  const darfAnlegen = darfVerwaltung(benutzer);

  // `isPending` (erster Abruf), NICHT `isFetching`: nach dem Anlegen invalidiert die
  // Mutation die Liste — ein Ladezweig an `isFetching` nähme den Anlegen-Knopf
  // mitten im Hintergrund-Nachladen wieder weg.
  const {
    data: einsaetze = [],
    dataUpdatedAt: einsaetzeAktualisiertAt,
    isPending,
    isError,
    refetch,
  } = useQuery({
    queryKey: globalKeys.einsaetze(),
    queryFn: listeEinsaetze,
  });

  const { data: stichwortVorschlaege = [] } = useQuery({
    queryKey: globalKeys.stichwortVorschlaege(),
    queryFn: listeStichwortVorschlaege,
  });
  const stichwortOptionen = stichwortVorschlaege.map((v) => ({ value: v.text }));

  const anlegen = useMutation({
    mutationFn: (werte: AnlegeWerte) =>
      legeEinsatzAn({
        bezeichnung: werte.bezeichnung,
        stichwort: werte.stichwort,
        einsatzart: werte.einsatzart,
        // `.utc()` VOR dem Formatieren — `begonnen_at` ist ein UTC-Wirestring, und
        // gelesen wird er auch so (`anzeige/format.ts:46` parst mit `dayjs.utc`).
        // Ohne die Umrechnung landete die lokale Wanduhrzeit als UTC in der Spalte,
        // und jeder neue Einsatz trüge eine um den Zonenversatz verschobene
        // Alarmzeit — in Berlin zwei Stunden NACH seinem eigenen Anlagezeitpunkt.
        // Dieselbe Form wie bei allen anderen Zeit-Sendern des Frontends
        // (`MeldungFormular`, `AuftragFormular`, `WiedervorlageModal`, ETB).
        begonnen_at: werte.begonnen_at?.utc().format('YYYY-MM-DD HH:mm:ss'),
      }),
    onSuccess: (neuerEinsatz) => {
      qc.invalidateQueries({ queryKey: globalKeys.einsaetze() });
      navigate(einsatzPfad(neuerEinsatz.id));
    },
    onError: (e) =>
      message.error(e instanceof ApiError ? e.message : 'Einsatz konnte nicht angelegt werden'),
  });

  const [suche, setSuche] = useState('');

  // Der jüngste Einsatz zuerst: wer die Auswahl öffnet, sucht in aller Regel den,
  // der gerade läuft. Absteigend nach `begonnen_at` — der Wirestring ist
  // sortierbar (`YYYY-MM-DD HH:mm:ss`), ein Date-Parse wäre hier überflüssig.
  const aktive = einsaetze
    .filter((e: EinsatzAnzeige) => e.status === 'aktiv')
    .sort((a, b) => (a.begonnen_at === b.begonnen_at ? 0 : a.begonnen_at < b.begonnen_at ? 1 : -1));
  const abgeschlossene = einsaetze.filter((e: EinsatzAnzeige) => e.status === 'abgeschlossen');

  const suchbegriff = suche.trim().toLowerCase();
  const passt = (e: EinsatzAnzeige) =>
    !suchbegriff ||
    [e.bezeichnung, e.einsatzort, e.stichwort].some((f) =>
      (f ?? '').toLowerCase().includes(suchbegriff),
    );
  const sichtbareAktive = aktive.filter(passt);
  const sucheZeigen = aktive.length >= SUCHE_AB;

  // Befund M6 (Abschluss-Review): fällt die Zahl aktiver Einsätze unter SUCHE_AB,
  // während ein Suchbegriff im Zustand steht (react-query lädt bei Fensterfokus neu
  // — `refetchOnWindowFocus` ist nicht abgeschaltet), verschwand bisher das Suchfeld
  // samt `allowClear`, der Filter wirkte aber unbeirrt weiter — Sackgasse: leeres
  // Raster, kein Hinweis, kein Ausweg. Gewählter Fix: `suche` wird zurückgesetzt,
  // sobald das Feld selbst verschwindet — NICHT die Alternative „keineTreffer von
  // sucheZeigen entkoppeln", denn die hätte nur den Hinweistext zurückgebracht, aber
  // weiterhin keinen Ausweg (das `allowClear` steht ja am unsichtbaren Feld). Ein
  // zurückgesetzter Suchbegriff macht die Sackgasse ganz zu: der Filter wirkt nicht
  // mehr, das Raster zeigt wieder alle aktiven Einsätze.
  useEffect(() => {
    if (!sucheZeigen && suche !== '') {
      setSuche('');
    }
  }, [sucheZeigen, suche]);

  // Dritte Sorte stummer Fläche neben „lädt" und „keine Einsätze überhaupt" (Ticket-Leitmotiv:
  // „Fehler sieht aus wie leer" darf hier nicht wiederkehren): filtert die Suche ALLE aktiven
  // Einsätze weg, ist `leer` unten weiterhin false (es GIBT ja Einsätze), das Raster zeigte ohne
  // diesen Zweig nur noch den „Neuer Einsatz"-Knopf oder gar nichts.
  const keineTreffer = sucheZeigen && suchbegriff !== '' && sichtbareAktive.length === 0;

  const renderKarte = (e: EinsatzAnzeige, klein = false) => (
    <Card
      key={e.id}
      hoverable
      title={
        <Link
          to={einsatzPfad(e.id)}
          onClick={(event) => event.stopPropagation()}
          style={kartenTitelStil(token)}
        >
          <span style={kartenTitelTextStil}>{e.bezeichnung}</span>
        </Link>
      }
      style={klein ? { opacity: 0.65 } : { minHeight: KACHEL_MIN_HOEHE }}
      onClick={() => navigate(einsatzPfad(e.id))}
    >
      <Space orientation="vertical">
        <Space wrap>
          <StatusTag darstellung={EINSATZ_STATUS[e.status]} />
          <Tag>{EINSATZART_LABELS[e.einsatzart]}</Tag>
          {e.meine_rolle && <Tag>{e.meine_rolle}</Tag>}
        </Space>
        {/* Ort und Beginn beantworten „welcher ist meiner?" — vorher standen sie
            nur im Kopfdatenformular, drei Klicks entfernt (Befund M4). Die Ikone
            kommt aus `@ant-design/icons` und trägt eine `aria-hidden`-Hülle: der
            Knoten brächte sonst ein englisches `role="img"`-Label mit. */}
        {e.einsatzort && (
          <Typography.Text type="secondary" data-testid="einsatz-ort">
            <span aria-hidden="true">
              <EnvironmentOutlined />{' '}
            </span>
            {e.einsatzort}
          </Typography.Text>
        )}
        <Typography.Text type="secondary">seit {formatZeitKurz(e.begonnen_at)}</Typography.Text>
        {e.stichwort && <Typography.Text type="secondary">{e.stichwort}</Typography.Text>}
      </Space>
    </Card>
  );

  const leer = aktive.length === 0 && abgeschlossene.length === 0;

  if (isError) {
    return (
      <EinsatzSeite titel="Einsätze" breite={flaeche.seiteBreit}>
        <SeitenFehler
          text="Die Einsatzliste konnte nicht geladen werden."
          onWiederholen={() => void refetch()}
        />
      </EinsatzSeite>
    );
  }

  return (
    <EinsatzSeite
      titel="Einsätze"
      breite={flaeche.seiteBreit}
      dataUpdatedAt={einsaetzeAktualisiertAt}
    >
      {/* Leer und anlegeberechtigt schließen sich NICHT aus: vorher lief der
          Leer-Zweig nur für Nutzer ohne Anlegerecht, alle anderen sahen beim
          Laden, bei leerer Liste und im Fehlerfall dieselbe leere Fläche.

          KEINE Primäraktion am Leerknoten (LFH-331 · B3): der Weg heraus ist die
          Anlegen-Kachel unmittelbar darunter. Ein zweiter Knopf mit derselben
          Beschriftung machte jede Abfrage darauf mehrdeutig — und AK3 verlangt
          höchstens einen Primärknopf je Leerzustand. */}
      {!isPending && leer && (
        <div style={{ marginBottom: abstand.lg }}>
          <SeitenLeer titel="Keine Einsätze" />
        </div>
      )}

      {!isPending && sucheZeigen && (
        <div style={{ marginBottom: abstand.md, maxWidth: flaeche.kachelMin * 2 }}>
          <Input.Search
            aria-label="Einsätze durchsuchen"
            placeholder="Bezeichnung, Ort oder Stichwort"
            allowClear
            value={suche}
            onChange={(ev) => setSuche(ev.target.value)}
          />
        </div>
      )}

      {/* Dritter Zustand neben „lädt" und „gar keine Einsätze" — eine dritte Sorte
          stummer Fläche wäre genau das, wogegen dieses Ticket antritt (M4/M5). KEINE
          Primäraktion (LFH-331 · B3): der Weg heraus ist das `allowClear` am Suchfeld
          unmittelbar darüber, ein zweiter Knopf machte jede Abfrage darauf mehrdeutig. */}
      {!isPending && keineTreffer && (
        <div style={{ marginBottom: abstand.lg }}>
          <SeitenLeer titel={`Keine Treffer für „${suche.trim()}"`} />
        </div>
      )}

      {/* EIN Rasterknoten für Skelette wie Karten — dieselben Spalten, derselbe
          Abstand, dieselbe Kachelhöhe. Der Wechsel tauscht nur die Kinder. */}
      <div
        data-testid="einsaetze-raster"
        style={rasterStil(flaeche.kachelMin, abstand.lg)}
        aria-busy={isPending || undefined}
        aria-label={isPending ? 'Einsätze werden geladen' : undefined}
      >
        {isPending ? (
          <>
            <KachelSkelett />
            <KachelSkelett />
            <KachelSkelett />
          </>
        ) : (
          <>
            {darfAnlegen && (
              <Button
                type="dashed"
                icon={<PlusOutlined aria-hidden />}
                onClick={() => setDialogOffen(true)}
                style={{ height: '100%', width: '100%', minHeight: KACHEL_MIN_HOEHE }}
              >
                Neuer Einsatz
              </Button>
            )}
            {sichtbareAktive.map((e: EinsatzAnzeige) => renderKarte(e))}
          </>
        )}
      </div>

      {abgeschlossene.length > 0 && (
        <div style={{ marginTop: abstand.lg }}>
          <SektionHeader titel="Abgeschlossen" />
          <div style={rasterStil(flaeche.kachelMinKlein, abstand.md)}>
            {abgeschlossene.map((e: EinsatzAnzeige) => renderKarte(e, true))}
          </div>
        </div>
      )}

      {/* Vier Felder statt zwei (LFH-332 · B4, Befund H18). Einsatzart und Alarmzeit
          waren bisher nur über das 11-Feld-Kopfdatenformular erreichbar — die
          Nachpflege nach dem Anlegen entfällt damit im Regelfall. Vier Felder ist
          zugleich die Obergrenze für eine Schnellerfassung (LFH-19); ein fünftes
          gehört in die Kopfdaten, nicht hierher. */}
      <ErfassungsModal<AnlegeWerte>
        offen={dialogOffen}
        titel="Neuen Einsatz anlegen"
        form={form}
        erfassenText="Anlegen"
        laeuft={anlegen.isPending}
        initialValues={{ einsatzart: 'realeinsatz' as Einsatzart, begonnen_at: dayjs() }}
        onErfassen={async (w) => {
          await anlegen.mutateAsync(w);
        }}
        onFertig={() => setDialogOffen(false)}
        onAbbrechen={() => setDialogOffen(false)}
      >
        <Form.Item
          label="Bezeichnung"
          name="bezeichnung"
          rules={[{ required: true, message: 'Bitte Bezeichnung eingeben' }]}
        >
          <Input />
        </Form.Item>
        <Form.Item label="Stichwort" name="stichwort">
          <AutoComplete options={stichwortOptionen} allowClear placeholder="z. B. H1, MANV …" />
        </Form.Item>
        <Form.Item label="Einsatzart" name="einsatzart" rules={[{ required: true }]}>
          <Select options={EINSATZART_OPTIONEN} />
        </Form.Item>
        <Form.Item label="Alarmzeit" name="begonnen_at" rules={[{ required: true }]}>
          <DatePicker showTime format="DD.MM.YYYY HH:mm" style={{ width: '100%' }} />
        </Form.Item>
      </ErfassungsModal>
    </EinsatzSeite>
  );
}
