import {
  Alert,
  App,
  Breadcrumb,
  Button,
  Form,
  Input,
  Space,
  Tag,
  Tree,
  type TreeDataNode,
} from 'antd';
import EinsatzSeite from '../components/EinsatzSeite';
import { Paneel, monoStil, useRollen } from '../components/instrument';
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
import { einsatzKeys, globalKeys } from '../api/queryKeys';
import type { Einheit } from '../api/types';
import StaerkeAnzeige from '../anzeige/StaerkeAnzeige';
import { einheitDetailPfad, kraefteuebersichtPfad, parseRouteId } from '../routing/deeplinks';
import Verdichtungszeile from '../kraefte/Verdichtungszeile';
import { ErfassungsModal } from '../components/Erfassung';
import StatusTag from '../components/StatusTag';
import { einsatzStatus } from '../theme/statusFarben';
import { useFehlerMeldung } from '../components/useFehlerMeldung';

/**
 * Gliederung der Einheiten eines Einsatzes. Die Detailansicht liegt auf eigener Route
 * (`EinheitDetailPage.tsx`, `/einsaetze/:id/einheiten/:einheitId`); hier bleibt die Auswahl, und
 * die darf umbrechen.
 */

/**
 * Baut antd-Tree-Daten aus der flachen Einheitenliste (nach ueber_einheit_id).
 *
 * Jeder Knoten trägt einen echten `<Link>` auf die Detailroute: das ist das Tastaturziel der Zeile
 * und macht die Gliederung deeplink-fähig. Ein `onSelect` am Baum allein wäre für die Tastatur ein
 * Umweg und für „im neuen Tab öffnen" gar kein Weg.
 *
 * Der Führer ist eine Ikone, kein Emoji. Die Hülle ist `aria-hidden`, weil ein
 * `@ant-design/icons`-Knoten sonst sein englisches `aria-label` („user") als Vorleseziel in jede
 * Zeile stellte.
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
          {/* Stärke als Mono-Zahl, nicht als blaues Etikett: Blau ist `bedien`, eine Stärke ist
              eine Angabe. */}
          <span style={{ ...monoStil(12), color: sekundaerFarbe }}>
            <StaerkeAnzeige wert={e.ist} />
            {e.soll ? (
              <>
                {' '}
                / Soll <StaerkeAnzeige wert={e.soll} />
              </>
            ) : null}
          </span>
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
  const { rollen } = useRollen();

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

  const fehler = useFehlerMeldung();

  /**
   * „Einheit bilden" fragt zuerst: ein sofort geschriebener Platzhalter stünde nach einem Fehlklick
   * in jedem Baum, jeder Zuordnungsliste und jeder Stärkeaggregation.
   *
   * Zwei Felder: Name (Pflicht) und Typ; alles Weitere gehört auf die Detailseite (Feldbudget ~3).
   * Kein `serie`: eine Einheit zu bilden ist keine Minutentakt-Erfassung.
   */
  const bilden = useMutation({
    mutationFn: (werte: BildenWerte) =>
      bildeEinheit(einsatzId, { name: werte.name.trim(), typ_id: werte.typ_id ?? null }),
    onSuccess: (e) => {
      qc.invalidateQueries({ queryKey: einsatzKeys.einheiten(einsatzId) });
      qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
      message.success('Einheit gebildet');
      // Direkt in die frische Einheit: dort stehen die Kopfdaten, die gerade nicht abgefragt
      // wurden.
      void navigate(einheitDetailPfad(einsatzId, e.id));
    },
    onError: fehler,
  });

  const baumDaten = useMemo(
    () => baueBaum(einheiten, einsatzId, rollen.gedaempft),
    [einheiten, einsatzId, rollen.gedaempft],
  );

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
  const darfSchreiben = darfImEinsatzSchreiben(einsatz, benutzer);

  // Erst nach dem Laden weiterleiten: vorher ist „gibt es die Einheit?" nicht beantwortbar.
  if (deeplinkZiel != null && einheiten.some((e) => e.id === deeplinkZiel)) {
    return <Navigate to={einheitDetailPfad(einsatzId, deeplinkZiel)} replace />;
  }

  /**
   * Listenzustand der Gliederungs-Karte — der Fehler allein reicht als Bedingung nicht. Ohne
   * Einheiten im Zwischenspeicher tritt der Fehler an die Stelle des Baums; mit Einheiten bleibt
   * der Baum stehen und bekommt ein Banner, er ist echt, nur womöglich alt.
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
            { title: 'Einheiten' },
          ]}
        />
      }
      titel={
        <Space>
          Einheiten
          <StatusTag darstellung={einsatzStatus[einsatz.status]} />
        </Space>
      }
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
        !darfSchreiben &&
        einsatz.status !== 'aktiv' && (
          <Alert type="info" showIcon title="Einsatz ist abgeschlossen — nur Ansicht." />
        )
      }
    >
      <Verdichtungszeile einsatzId={einsatzId} pfad={kraefteuebersichtPfad(einsatzId)} />

      {/* Die Gliederung ist die ganze Seite. Sie wächst mit und deckelt bei 360 px auf breitem
          Schirm; `flexWrap`, damit sie auf 390 px ausweichen kann. */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <Paneel
          titel="Gliederung"
          meta={einheitenQuery.isSuccess ? einheiten.length : undefined}
          koerperPolster
          style={{ flex: '1 1 clamp(260px, 30%, 360px)' }}
        >
          {/* Drei Zustände, nicht zwei: `einheiten.length === 0` ist auch während des Ladens
              und im Fehlerfall wahr. Gefragt wird deshalb die Query; die Länge entscheidet
              erst, wenn sie etwas bedeutet. Reihenfolge: laden vor Fehler vor leer.

              Der Fehlerzweig trägt zusätzlich die Mengenbedingung (`listeGescheitert`): er
              verdrängt den Baum nur, wenn es keinen gibt. */}
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
              {/* `selectable={false}`: das Bedienziel ist der Link im Knoten, nicht die
                  Zeilenauswahl. */}
              <Tree treeData={baumDaten} defaultExpandAll selectable={false} />
            </>
          )}
        </Paneel>
      </div>

      {/* Zwei Felder; der Rest der Kopfdaten lebt auf der Detailansicht. Der Dialog setzt auf
          allen Auswegen selbst zurück. */}
      <ErfassungsModal<BildenWerte>
        offen={bildenOffen}
        titel="Einheit bilden"
        form={bildenForm}
        erfassenText="Bilden"
        laeuft={bilden.isPending}
        // `mutateAsync`, nicht `mutate`: die Hülle darf die Felder nur leeren, wenn der Datensatz
        // ankam. Ein 422 kostete sonst den eingegebenen Namen.
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
    </EinsatzSeite>
  );
}
