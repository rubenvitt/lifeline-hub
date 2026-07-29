import { App, AutoComplete, Button, Card, DatePicker, Form, Input, Space, Tag, Typography } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Einsatzart, EinsatzAnzeige, EinsatzStatus } from '../api/types';
import { ApiError } from '../api/client';
import { legeEinsatzAn, listeEinsaetze } from '../api/einsaetze';
import { listeStichwortVorschlaege } from '../api/stichwortVorschlaege';
import { EINSATZART_OPTIONEN } from '../einsatz/einsatzart';
import { ErfassungsModal } from '../components/Erfassung';
import { Select } from '../components/Select';
import { useAuth } from '../auth/AuthContext';
import { darfVerwaltung } from '../einsatz/schreibrecht';
import { globalKeys } from '../api/queryKeys';
import EinsatzSeite from '../components/EinsatzSeite';
import SektionHeader from '../components/SektionHeader';
import StatusTag from '../components/StatusTag';
import { SeitenFehler, SeitenLeer } from '../components/SeitenZustand';
import type { StatusDarstellung } from '../theme/statusFarben';
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
 * Status eines Einsatzes als Statusrolle (LFH-328 · A2).
 *
 * Trägt bewusst den Vertragstyp {@link StatusDarstellung} aus `theme/statusFarben.ts`:
 * damit ist `label` Pflichtfeld (zweiter Kanal, WCAG 1.4.1 — vorher rendete der Tag
 * den ROHEN Enum-String, was nur zufällig auch ein Text war), und der `Record` bricht
 * bei einer neuen `EinsatzStatus`-Variante aus dem Codegen.
 *
 * BEFUND, warum die Zeile hier und nicht in `statusFarben.ts` steht: die
 * Vertragstabelle der Spec (§1.3) listet acht Enums, `EinsatzStatus` ist keins davon —
 * es gibt dort also (noch) keinen Platz dafür. Der Zielzustand ist ein
 * `einsatzStatus`-Export in `statusFarben.ts`. Die Zuordnung selbst ist nicht hier
 * entschieden, sondern zitiert (Spec §6, Prüflistenzeile 7: `aktiv` → `normal`,
 * `abgeschlossen` → `neutral`).
 */
const EINSATZ_STATUS: Record<EinsatzStatus, StatusDarstellung> = {
  aktiv: { rolle: 'normal', label: 'aktiv' },
  abgeschlossen: { rolle: 'neutral', label: 'abgeschlossen' },
};

/**
 * Mindesthöhe einer Kachel. KEIN neuer Wert — die 120 px standen schon am
 * Anlegen-Knopf; sie sind hier nur an EINE Stelle gehoben, damit Skelett, Karte und
 * Anlegen-Kachel dieselbe Höhe tragen (Prüfliste Kriterium 12, kein Sprung beim
 * Wechsel Laden → Daten). BEFUND: `flaeche` kennt `kachelMin`/`kachelMinKlein`
 * (Breiten), aber keine Kachel-Höhenrolle — erfunden wird hier keine.
 */
const KACHEL_MIN_HOEHE = 120;

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
        // Dasselbe Format wie im Kopfdaten-PATCH (`EinsatzdatenPage`), damit beide
        // Wege denselben Wert schreiben.
        begonnen_at: werte.begonnen_at?.format('YYYY-MM-DD HH:mm:ss'),
      }),
    onSuccess: (neuerEinsatz) => {
      qc.invalidateQueries({ queryKey: globalKeys.einsaetze() });
      navigate(`/einsaetze/${neuerEinsatz.id}`);
    },
    onError: (e) =>
      message.error(e instanceof ApiError ? e.message : 'Einsatz konnte nicht angelegt werden'),
  });

  const aktive = einsaetze.filter((e: EinsatzAnzeige) => e.status === 'aktiv');
  const abgeschlossene = einsaetze.filter((e: EinsatzAnzeige) => e.status === 'abgeschlossen');

  const renderKarte = (e: EinsatzAnzeige, klein = false) => (
    <Card
      key={e.id}
      hoverable
      title={e.bezeichnung}
      style={klein ? { opacity: 0.65 } : { minHeight: KACHEL_MIN_HOEHE }}
      onClick={() => navigate(`/einsaetze/${e.id}`)}
    >
      <Space orientation="vertical">
        <Space>
          <StatusTag darstellung={EINSATZ_STATUS[e.status]} />
          {e.meine_rolle && <Tag>{e.meine_rolle}</Tag>}
        </Space>
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
    <EinsatzSeite titel="Einsätze" breite={flaeche.seiteBreit}>
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
            {aktive.map((e: EinsatzAnzeige) => renderKarte(e))}
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
        onErfassen={async (w) => { await anlegen.mutateAsync(w); }}
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
