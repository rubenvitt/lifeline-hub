import { Alert, App, AutoComplete, Button, DatePicker, Form, Input, Tag, theme } from 'antd';
import { EnvironmentOutlined, PlusOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { useEffect, useState, type CSSProperties } from 'react';
import { Link, useLinkClickHandler, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Einsatzart, EinsatzAnzeige } from '../api/types';
import { ApiError } from '../api/client';
import { legeEinsatzAn, listeEinsaetze } from '../api/einsaetze';
import { listeStichwortVorschlaege } from '../api/stichwortVorschlaege';
import { formatZeitKurz } from '../anzeige/format';
import { EINSATZART_LABELS, EINSATZART_OPTIONEN } from '../einsatz/einsatzart';
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
import { einsatzStatus } from '../theme/statusFarben';
// Die Skelettform lebt als Klasse in der Gestaltungssprache. Der Import steht bewusst hier und
// nicht nur transitiv: ohne ihn wären die Balken 0 px hoch, und jsdom rechnet kein Layout — der
// Ausfall wäre in keinem Test sichtbar.
import '../theme/sprache.css';
import './EinsaetzePage.css';
import { monoStil, useRollen } from '../components/instrument';
import { einsaetzeMeta, kachelKennung } from './einsatzKachelKern';
import { adminDemoDatenPfad } from '../admin/adminNav';
import { useDemoDatenStatus } from '../admin/useDemoDaten';

/** Werte des Anlegedialogs (`begonnen_at` als Dayjs aus dem `DatePicker`). */
interface AnlegeWerte {
  bezeichnung: string;
  stichwort?: string;
  einsatzart: Einsatzart;
  begonnen_at: Dayjs;
}

/**
 * Mindesthöhe einer Kachel, damit Skelett, Karte und Anlegen-Kachel dieselbe Höhe tragen (kein
 * Sprung beim Wechsel Laden → Daten). `flaeche` kennt Kachelbreiten, aber keine Kachel-Höhenrolle.
 */
const KACHEL_MIN_HOEHE = 120;

/**
 * Ab wie vielen aktiven Einsätzen ein Suchfeld erscheint. Acht, weil das Raster auf dem Fükw-Schirm
 * dann zwei Reihen füllt — bis dahin ist Suchen langsamer als Hinsehen.
 */
const SUCHE_AB = 8;

/**
 * Der Titel-Link der Einsatzkarte als Bedienziel auf der Dichte-Staffel (Gate 3). Ein nacktes
 * Inline-`<a>` im Kartenkopf ist nur so hoch wie seine Zeile und unterschreitet schon in `kompakt`
 * den 24-px-Boden. Die Karte ist klickbar, der Link aber ist das Tastaturziel, und Gate 3 misst
 * jedes fokussierbare Element.
 *
 * Zwei Angaben: `minHeight` aus `controlHeight` trägt den Boden (30 / 48 / 72), die Polsterung
 * zieht mit — nur senkrecht, waagerecht polstert der Kartenkopf selbst. `display: flex` statt
 * `inline-flex`, damit der Text als eigenes Flex-Item per Ellipsis abschneidet (der Kopf ist
 * `white-space: nowrap`); ein atomarer Inline-Kasten würde hart geclippt, ohne „…".
 *
 * Rein und exportiert nach dem Muster von `bedienzielStil` (`pages/lagekarte/Sidebar.tsx`): so ist
 * die Zusicherung über zwei Dichtestufen ohne Rendern prüfbar — `test/utils.tsx` montiert ein
 * nacktes `ConfigProvider` ohne unser Theme.
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
 * Ladeplatzhalter in Kachelform. Bewusst nicht `SeitenSkeleton`: dessen `paddingTop:
 * flaeche.zustandOben` (80 px) ließe in einer Rasterzelle jede Kachel um 80 px wachsen, und der
 * Sprung Skelett → Karte wäre wieder da.
 */
function KachelSkelett() {
  return (
    <div className="lfh-einsatzkachel" style={{ minHeight: KACHEL_MIN_HOEHE, cursor: 'default' }}>
      <div className="lfh-skelett lfh-einsatzkachel__leib">
        <span className="lfh-skelett__balken lfh-skelett__balken--gross" />
        <span className="lfh-skelett__balken" />
        <span className="lfh-skelett__balken lfh-skelett__balken--kurz" />
      </div>
    </div>
  );
}

export default function EinsaetzePage() {
  const navigate = useNavigate();
  const { token } = theme.useToken();
  const { rollen } = useRollen();
  const { benutzer } = useAuth();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [dialogOffen, setDialogOffen] = useState(false);
  const [form] = Form.useForm<AnlegeWerte>();

  const darfAnlegen = darfVerwaltung(benutzer);

  /**
   * Hinweis auf die Demo-Daten (LFH-690, design.md D13): nur für den System-Admin, nur bei
   * Freischaltung (Status 200) und nur, solange für die Organisation nichts importiert ist. Ein 404
   * ist kein Fehlerbild.
   *
   * Nicht im Leerzustand: der ist aktionslos und rechnet je Benutzer, „nicht importiert" ist eine
   * Aussage über die Organisation. Der Hinweis springt in die Verwaltung — ein Direktimport hier
   * wäre eine zweite Stelle für einen unumkehrbaren Vorgang.
   *
   * Ort: unter allem, was die Einsatzliste zeichnet, nicht im `hinweis`-Slot darüber. Die
   * Status-Abfrage kommt regelmäßig nach der Liste an; über dem Raster schöbe der Hinweis es weg
   * (CLS über 0,1). Unter dem Raster liegt nichts, das springen könnte. Aus demselben Grund wartet
   * er auf die Liste (`!isPending`): unter den Skeletten schöbe ihn der Wechsel Skelett → Kacheln
   * selbst.
   */
  const demo = useDemoDatenStatus();
  const demoPfad = adminDemoDatenPfad();
  const zuDenDemoDaten = useLinkClickHandler<HTMLElement>(demoPfad);
  const demoHinweis =
    demo.freigeschaltet && demo.status?.importiert === false ? (
      <Alert
        type="info"
        showIcon
        title="Demo-Daten sind freigeschaltet und noch nicht importiert."
        description={
          <>
            <div>
              Ein Übungseinsatz samt Stammdaten für Vorführung und Schulung lässt sich in der
              Verwaltung anlegen.
            </div>
            {/* Der Verweis ist ein eigenes Bedienziel unter dem Satz: im Satz trennte ihn nur
                die Farbe vom Text (WCAG 1.4.1), und `minHeight` ohne Polsterung risse die
                Textzeile in `handschuh` auf 72 px. Als antd-`Button` erbt er Höhe und
                Polsterung vom `ConfigProvider` und trägt `colorText` auf eigener Fläche. Mit
                `href` bleibt er ein `<a>` (Strg/⌘-Klick öffnet einen Tab);
                `useLinkClickHandler` navigiert beim schlichten Klick in der App. Nicht der
                `action`-Slot: dort drückte der Knopf den Text bei 390 px auf die halbe Breite. */}
            <div style={{ marginTop: token.marginSM }}>
              <Button href={demoPfad} onClick={zuDenDemoDaten}>
                Zu den Demo-Daten
              </Button>
            </div>
          </>
        }
      />
    ) : undefined;

  // `isPending` (erster Abruf), nicht `isFetching`: nach dem Anlegen invalidiert die Mutation die
  // Liste, ein Ladezweig an `isFetching` nähme den Anlegen-Knopf beim Hintergrund-Nachladen weg.
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
        // `.utc()` vor dem Formatieren: `begonnen_at` ist ein UTC-Wirestring und wird auch so
        // gelesen (`anzeige/format.ts` parst mit `dayjs.utc`). Ohne die Umrechnung landete die
        // lokale Wanduhrzeit als UTC in der Spalte, um den Zonenversatz verschoben.
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

  // Der jüngste Einsatz zuerst: gesucht wird meist der, der gerade läuft. Der Wirestring
  // (`YYYY-MM-DD HH:mm:ss`) ist direkt sortierbar.
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

  // Fällt die Zahl aktiver Einsätze unter SUCHE_AB, während ein Suchbegriff steht (etwa nach einem
  // Refetch bei Fensterfokus), verschwindet das Suchfeld samt `allowClear`. `suche` wird dann
  // zurückgesetzt, sonst wirkte der Filter weiter — leeres Raster, kein Hinweis, kein Ausweg.
  useEffect(() => {
    if (!sucheZeigen && suche !== '') {
      setSuche('');
    }
  }, [sucheZeigen, suche]);

  // Filtert die Suche alle aktiven Einsätze weg, ist `leer` weiterhin false (es gibt Einsätze);
  // ohne diesen Zweig stünde eine stumme Fläche da.
  const keineTreffer = sucheZeigen && suchbegriff !== '' && sichtbareAktive.length === 0;

  /**
   * Die Einsatzkachel: Fläche + Haarlinie statt antd-Card. Kopf: Status-Punkt und der Titel-Link
   * als Tastaturziel. Leib: Status als Wort (zweiter Kanal zum Punkt, WCAG 1.4.1), Einsatzart,
   * Rolle, Ort und eine Mono-Zeile aus Einsatznummer, Beginn und Stichwort. Die Nummer steht nur,
   * wenn es eine gibt (`kachelKennung`) — die Datenbank-`id` ist keine.
   */
  const renderKarte = (e: EinsatzAnzeige, klein = false) => {
    const kennung = kachelKennung(e);
    const aktiv = e.status === 'aktiv';
    return (
      <div
        key={e.id}
        data-lfh="einsatzkachel"
        className={
          klein ? 'lfh-einsatzkachel lfh-einsatzkachel--abgeschlossen' : 'lfh-einsatzkachel'
        }
        style={klein ? undefined : { minHeight: KACHEL_MIN_HOEHE }}
        onClick={() => navigate(einsatzPfad(e.id))}
      >
        <div className="lfh-einsatzkachel__kopf">
          <span
            aria-hidden="true"
            data-lfh="status-punkt"
            style={{
              width: 8,
              height: 8,
              flex: '0 0 8px',
              background: aktiv ? rollen.normal : rollen.schwach,
            }}
          />
          <Link
            to={einsatzPfad(e.id)}
            onClick={(event) => event.stopPropagation()}
            className="lfh-einsatzkachel__link"
            style={{ ...kartenTitelStil(token), minWidth: 0, flex: '1 1 auto' }}
          >
            <span style={kartenTitelTextStil}>{e.bezeichnung}</span>
          </Link>
        </div>
        <div className="lfh-einsatzkachel__leib">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: token.marginXS }}>
            <StatusTag darstellung={einsatzStatus[e.status]} />
            <Tag>{EINSATZART_LABELS[e.einsatzart]}</Tag>
            {e.meine_rolle && <Tag>{e.meine_rolle}</Tag>}
          </div>
          {/* Ort und Beginn beantworten „welcher ist meiner?". Die Ikone trägt eine
              `aria-hidden`-Hülle, sonst brächte sie ein englisches `role="img"`-Label mit. */}
          {e.einsatzort && (
            <span data-testid="einsatz-ort" style={{ color: rollen.text2 }}>
              <span aria-hidden="true">
                <EnvironmentOutlined />{' '}
              </span>
              {e.einsatzort}
            </span>
          )}
          <span
            style={{
              ...monoStil(12),
              display: 'flex',
              flexWrap: 'wrap',
              columnGap: token.marginXS,
            }}
          >
            {kennung && <span data-lfh="einsatznummer">{kennung}</span>}
            <span>seit {formatZeitKurz(e.begonnen_at)}</span>
            {e.stichwort && <span>{e.stichwort}</span>}
          </span>
        </div>
      </div>
    );
  };

  const leer = aktive.length === 0 && abgeschlossene.length === 0;

  if (isError) {
    return (
      <EinsatzSeite titel="Einsätze">
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
      meta={isPending ? undefined : einsaetzeMeta(aktive.length, abgeschlossene.length)}
      dataUpdatedAt={einsaetzeAktualisiertAt}
    >
      {/* Leer und anlegeberechtigt schließen sich nicht aus. Keine Primäraktion am Leerknoten:
          der Weg heraus ist die Anlegen-Kachel direkt darunter; ein zweiter gleich
          beschrifteter Knopf machte jede Abfrage darauf mehrdeutig. */}
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

      {/* Dritter Zustand neben „lädt" und „gar keine Einsätze". Keine Primäraktion: der Weg
          heraus ist das `allowClear` am Suchfeld darüber. */}
      {!isPending && keineTreffer && (
        <div style={{ marginBottom: abstand.lg }}>
          <SeitenLeer titel={`Keine Treffer für „${suche.trim()}"`} />
        </div>
      )}

      {/* Ein Rasterknoten für Skelette wie Karten — dieselben Spalten, derselbe Abstand,
          dieselbe Kachelhöhe. Der Wechsel tauscht nur die Kinder. */}
      <div
        data-testid="einsaetze-raster"
        style={rasterStil(flaeche.kachelMin, abstand.md)}
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

      {!isPending && demoHinweis && (
        <div data-lfh="demo-hinweis" style={{ marginTop: abstand.lg }}>
          {demoHinweis}
        </div>
      )}

      {/* Vier Felder: Einsatzart und Alarmzeit gleich beim Anlegen, damit die Nachpflege in den
          Kopfdaten im Regelfall entfällt. Vier ist die Obergrenze einer Schnellerfassung; ein
          fünftes gehört in die Kopfdaten. */}
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
