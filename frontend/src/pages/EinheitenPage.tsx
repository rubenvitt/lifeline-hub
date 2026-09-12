import {
  Alert,
  App,
  Breadcrumb,
  Button,
  Card,
  Form,
  Input,
  Space,
  Tag,
  theme,
  Tree,
  Typography,
  type TreeDataNode,
} from 'antd';
import { UserOutlined } from '@ant-design/icons';
import { Select } from '../components/Select';
import {
  SeitenFehler,
  SeitenLeer,
  SeitenSkeleton,
  SeitenStandVeraltet,
  nichtGefundenInhalt,
} from '../components/SeitenZustand';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ladeEinsatz } from '../api/einsaetze';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { useAuth } from '../auth/AuthContext';
import { listeEinheitTypen } from '../api/einheitTypen';
import { bildeEinheit, listeEinheiten } from '../api/einheiten';
import { ApiError } from '../api/client';
import { einsatzKeys, globalKeys } from '../api/queryKeys';
import type { Einheit } from '../api/types';
import StaerkeAnzeige from '../anzeige/StaerkeAnzeige';
import Datenstand from '../components/Datenstand';
import { einheitDetailPfad, kraefteuebersichtPfad, parseRouteId } from '../routing/deeplinks';
import Verdichtungszeile from '../kraefte/Verdichtungszeile';
import { ErfassungsModal } from '../components/Erfassung';

/**
 * Gliederung der Einheiten eines Einsatzes (LFH-339 · C4).
 *
 * ── DIE SEITE TRÄGT SEIT C4 NUR NOCH DIE GLIEDERUNG ────────────────────────────────────
 *
 * Vorher lag rechts daneben die Detailansicht: NEUN Formularfelder plus DREI sofort
 * wirkende Zuordnungslisten in einer Karte, mit dem Speichern-Knopf mitten im Inhalt
 * (Befund M26). Nach LFH-19 gehört das auf eine eigene Route — sie liegt jetzt in
 * `EinheitDetailPage.tsx` unter `/einsaetze/:id/einheiten/:einheitId`.
 *
 * Was hier bleibt, ist die Auswahl. Und die darf umbrechen: die Gliederungskarte hatte
 * `flex: '0 0 360px'` ohne `flexWrap` — eine Breite, die auf 390 px nicht passt und nicht
 * ausweichen darf (Befund M25).
 */

/**
 * Baut antd-Tree-Daten aus der flachen Einheitenliste (nach ueber_einheit_id).
 *
 * Jeder Knoten trägt einen echten `<Link>` auf die Detailroute: das ist das TASTATURZIEL
 * der Zeile und macht die Gliederung deep-link-fähig. Ein `onSelect` am Baum allein wäre
 * für die Tastatur ein Umweg und für „im neuen Tab öffnen" gar kein Weg.
 *
 * Das Führer-Emoji (👤) ist einer Ikone gewichen: Zeichnung, Farbe und Breite eines Emojis
 * kommen aus der Systemschrift statt aus dem Entwurf, und im Ausdruck verhält es sich
 * anders als der übrige Satz. Die Hülle ist `aria-hidden`, weil ein
 * `@ant-design/icons`-Knoten sonst sein eigenes ENGLISCHES `aria-label` („user") als
 * eigenes Vorleseziel in jede Zeile stellte.
 */
function baueBaum(einheiten: Einheit[], einsatzId: number, sekundaerFarbe: string): TreeDataNode[] {
  const kinder = new Map<number | null, Einheit[]>();
  for (const e of einheiten) {
    const key = e.ueber_einheit_id ?? null;
    if (!kinder.has(key)) kinder.set(key, []);
    kinder.get(key)!.push(e);
  }
  const baue = (parent: number | null): TreeDataNode[] =>
    (kinder.get(parent) ?? []).map((e) => ({
      key: e.id,
      title: (
        <Space size={4}>
          <Link to={einheitDetailPfad(einsatzId, e.id)}>{e.name}</Link>
          {e.typ_label && <Tag>{e.typ_label}</Tag>}
          <Tag color="blue">
            <StaerkeAnzeige wert={e.ist} />
            {e.soll ? (
              <>
                {' '}
                / Soll <StaerkeAnzeige wert={e.soll} />
              </>
            ) : null}
          </Tag>
          {e.fuehrer_name && (
            <span style={{ color: sekundaerFarbe }}>
              <span aria-hidden="true">
                <UserOutlined />
              </span>{' '}
              {e.fuehrer_name}
            </span>
          )}
        </Space>
      ),
      children: baue(e.id),
    }));
  return baue(null);
}

/** Feldsatz des „Einheit bilden"-Dialogs — bewusst zwei Felder (siehe `bilden`). */
interface BildenWerte {
  name: string;
  typ_id?: number | null;
}

export default function EinheitenPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { benutzer } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const [bildenOffen, setBildenOffen] = useState(false);
  const [bildenForm] = Form.useForm<BildenWerte>();
  const { token } = theme.useToken();

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const einheitenQuery = useQuery({
    queryKey: einsatzKeys.einheiten(einsatzId),
    queryFn: () => listeEinheiten(einsatzId),
  });
  const typenQuery = useQuery({ queryKey: globalKeys.einheitTypen(), queryFn: listeEinheitTypen });

  const einheiten = useMemo(() => einheitenQuery.data ?? [], [einheitenQuery.data]);

  /**
   * Bestands-Deeplink `?einheit=<id>` LEITET WEITER auf die Item-Route (LFH-25/LFH-339).
   *
   * Der Query-Param war das Muster für Module OHNE Detailansicht — seit C4 hat die Einheit
   * eine. Andere Module verlinken weiterhin mit `?einheit=`, deshalb wird der Param nicht
   * fallengelassen, sondern übersetzt.
   *
   * BEWUSST NICHT über `useQueryParamSelektion`, und das ist gemessen: der Hook ist
   * apply-then-clean — er ruft `anwenden(id)` und räumt den Param DANACH mit einem eigenen
   * `setSearchParams(..., { replace: true })` aus der URL. Diese zweite Navigation
   * überschreibt eine Weiterleitung aus der Closure sofort wieder; der Aufrufer landet
   * zurück auf der Gliederung. Der Hook ist für eine SELEKTION auf derselben Seite gebaut,
   * nicht für einen Routenwechsel.
   *
   * `<Navigate replace>` ist hier zudem die ehrlichere Form: es passiert beim Rendern, nicht
   * als Nebenwirkung, und der Zurück-Knopf bleibt nicht in der Weiterleitung hängen. Die ID
   * wird gegen die GELADENE Liste geprüft — eine erfundene Kennung soll auf der Gliederung
   * landen, nicht auf einer Detailseite ohne Datensatz.
   */
  const [searchParams] = useSearchParams();
  const deeplinkZiel = parseRouteId(searchParams.get('einheit') ?? undefined);

  const fehler = (e: unknown) =>
    message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');

  /**
   * „Einheit bilden" fragt seit LFH-339 · C4 zuerst (Befund M27).
   *
   * Vorher schrieb der Knopf SOFORT `{ name: 'Neue Einheit' }` in die Datenbank — vor jeder
   * Eingabe. Ein Fehlklick oder ein Sinneswandel hinterliess damit eine Platzhalter-Einheit,
   * die danach in jedem Baum, jeder Zuordnungsliste und jeder Stärkeaggregation stand;
   * entfernen liess sie sich nur über „Auflösen".
   *
   * ZWEI Felder, nicht neun: Name (Pflicht, `autoFocus` durch die Hülle) und Typ. Alles
   * Weitere gehört auf die Detailseite — das Feldbudget einer Erfassungsmaske liegt bei ~3.
   *
   * KEIN `serie`: eine Einheit zu bilden ist keine Minutentakt-Erfassung wie die
   * Ad-hoc-Disposition eines Fahrzeugs.
   */
  const bilden = useMutation({
    mutationFn: (werte: BildenWerte) =>
      bildeEinheit(einsatzId, { name: werte.name.trim(), typ_id: werte.typ_id ?? null }),
    onSuccess: (e) => {
      qc.invalidateQueries({ queryKey: einsatzKeys.einheiten(einsatzId) });
      qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
      message.success('Einheit gebildet');
      // Direkt in die frische Einheit: dort stehen die Kopfdaten, die gerade NICHT
      // abgefragt wurden, und genau dorthin will, wer eine Einheit bildet.
      void navigate(einheitDetailPfad(einsatzId, e.id));
    },
    onError: fehler,
  });

  const baumDaten = useMemo(
    () => baueBaum(einheiten, einsatzId, token.colorTextSecondary),
    [einheiten, einsatzId, token.colorTextSecondary],
  );

  // Seitenzustand: NUR `einsatzQuery` — ohne sie tragen weder Breadcrumb noch
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
  const darfSchreiben = darfImEinsatzSchreiben(einsatz, benutzer);

  // Erst NACH dem Laden weiterleiten: vorher ist die Prüfung „gibt es die Einheit?" nicht
  // beantwortbar, und ein Sprung ins Blaue landete auf einem Leerzustand.
  if (deeplinkZiel != null && einheiten.some((e) => e.id === deeplinkZiel)) {
    return <Navigate to={einheitDetailPfad(einsatzId, deeplinkZiel)} replace />;
  }

  /**
   * LISTENZUSTAND der Gliederungs-Karte — zwei Lagen, zwei Antworten (D3). Der Fehler
   * allein reicht als Bedingung NICHT.
   *
   * Ohne Einheiten im Zwischenspeicher tritt der Fehler an die Stelle des Baums. MIT
   * Einheiten bleibt der Baum stehen und bekommt ein Banner: er ist echt, nur womöglich
   * alt. Ein Fehler, der ihn wegräumt, nähme der Einsatzkraft die Gliederung, die sie eben
   * noch vor sich hatte.
   */
  const listeGescheitert = einheitenQuery.isError && einheiten.length === 0;
  const standVeraltet = einheitenQuery.isError && einheiten.length > 0;

  return (
    <div>
      <Breadcrumb
        style={{ marginBottom: 12 }}
        items={[
          { title: <Link to="/einsaetze">Einsätze</Link> },
          { title: einsatz.bezeichnung },
          { title: 'Einheiten' },
        ]}
      />
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
        <Space orientation="vertical" size={0}>
          <Space>
            <Typography.Title level={3} style={{ margin: 0 }}>
              Einheiten
            </Typography.Title>
            <Tag color={einsatz.status === 'aktiv' ? 'green' : 'default'}>{einsatz.status}</Tag>
          </Space>
          <Datenstand dataUpdatedAt={einheitenQuery.dataUpdatedAt} />
        </Space>
        {darfSchreiben && (
          <Button type="primary" onClick={() => setBildenOffen(true)}>
            Einheit bilden
          </Button>
        )}
      </Space>
      {!darfSchreiben && einsatz.status !== 'aktiv' && (
        <Alert
          style={{ marginBottom: 12 }}
          type="info"
          showIcon
          title="Einsatz ist abgeschlossen — nur Ansicht."
        />
      )}

      <Verdichtungszeile einsatzId={einsatzId} pfad={kraefteuebersichtPfad(einsatzId)} />

      {/**
       * Die Gliederung ist seit C4 die GANZE Seite — die Detailhälfte ist auf eine eigene
       * Route gezogen. Was von M25 bleibt, ist der Umbruch: die Karte hatte
       * `flex: '0 0 360px'` ohne `flexWrap`, also eine Breite, die auf 390 px nicht passt
       * und nicht ausweichen darf. Jetzt wächst sie mit und deckelt bei 360 px auf breitem
       * Schirm, wo ein Baum nicht über die ganze Fläche laufen soll.
       */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <Card style={{ flex: '1 1 clamp(260px, 30%, 360px)' }} size="small" title="Gliederung">
          {/* DREI Zustände, nicht zwei (LFH-331 · B3). Die frühere Weiche hing an
              `einheiten.length === 0` — und das ist während des Ladens und im Fehlerfall
              genauso wahr wie bei einer tatsächlich leeren Gliederung. Gefragt wird
              deshalb die QUERY; die Länge entscheidet erst, wenn sie etwas bedeutet.
              Reihenfolge ist Teil der Aussage: laden vor Fehler vor leer.

              Der Fehlerzweig trägt zusätzlich die MENGENBEDINGUNG (`listeGescheitert`):
              er verdrängt den Baum nur, wenn es keinen gibt. */}
          {einheitenQuery.isLoading ? (
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
              hinweis="Die Gliederung entsteht mit der ersten gebildeten Einheit."
              aktion={
                darfSchreiben
                  ? // Wortlaut BYTE-GLEICH zum Kopfknopf: es ist dieselbe Handlung, und eine
                    // zweite Schreibweise für dieselbe Geste ist genau der Befund, den B3
                    // behebt.
                    { label: 'Einheit bilden', onClick: () => setBildenOffen(true) }
                  : undefined
              }
            />
          ) : (
            <>
              {standVeraltet && (
                <SeitenStandVeraltet onWiederholen={() => void einheitenQuery.refetch()} />
              )}
              {/* `selectable={false}`: das Bedienziel ist der Link im Knoten, nicht die
                  Zeilenauswahl. Zwei Wege zur selben Handlung, von denen einer nur
                  hervorhebt, wären ein Unterschied ohne Bedeutung. */}
              <Tree treeData={baumDaten} defaultExpandAll selectable={false} />
            </>
          )}
        </Card>
      </div>

      {/* Zwei Felder statt neun: der Rest der Kopfdaten lebt auf der Detailansicht. Der
          Dialog übernimmt das Zurücksetzen auf ALLEN Auswegen selbst (Knopf, Kreuz,
          Escape, Maskenklick) — deshalb ruft hier niemand `resetFields`. */}
      <ErfassungsModal<BildenWerte>
        offen={bildenOffen}
        titel="Einheit bilden"
        form={bildenForm}
        erfassenText="Bilden"
        laeuft={bilden.isPending}
        // `mutateAsync`, nicht `mutate`: die Hülle darf die Felder nur leeren, wenn der
        // Datensatz wirklich ankam. Ein 422 kostete sonst den eingegebenen Namen.
        onErfassen={(w) => bilden.mutateAsync(w)}
        onFertig={() => setBildenOffen(false)}
        onAbbrechen={() => setBildenOffen(false)}
      >
        <Form.Item label="Name" name="name" rules={[{ required: true, whitespace: true }]}>
          <Input placeholder="z. B. 2. Zug" />
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
      </ErfassungsModal>
    </div>
  );
}
