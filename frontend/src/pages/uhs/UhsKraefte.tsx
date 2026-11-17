import { useId, useState, type ReactNode } from 'react';
import { App, Button, Form, Input, Space, Tag, Typography } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  erfasseAdhocKraft,
  listeKraefteOhneUhs,
  ordneEinheitZu,
  ordneKraftZu,
  zieheKraftAb,
  type AdhocKraftEingabe,
} from '../../api/einsatzUhs';
import { PERSONAL_ADHOC_TEXT_MAX } from '../../api/eingabegrenzen';
import { POSITION_LABELS, POSITION_OPTIONEN } from '../../api/personal';
import { einsatzKeys } from '../../api/queryKeys';
import type { StaerkePosition, UhsDetail, UhsKraft } from '../../api/types';
import { staerkeText } from '../../anzeige/staerke';
import { ErfassungsModal } from '../../components/Erfassung';
import KatalogTabelle, { type KatalogSpalte } from '../../components/KatalogTabelle';
import { Select } from '../../components/Select';
import { teilwortSuche } from '../../components/teilwortSuche';
import { Datenfeld, Datenraster, useRollen } from '../../components/instrument';
import { SpeicherFehler, ZeilenFehler } from '../../components/SpeicherHinweis';
import { schliesseRueckgaengig, zeigeRueckgaengig } from '../../kommunikation/rueckgaengig';
import { useHoldGeloest } from '../../components/useHoldGeloest';
import { useZeilenFehler } from '../../components/useZeilenFehler';
import { funktionText } from '../../kraefte/einsatzfunktionKern';
import { freieEinheiten, kraftAuswahlText, zaehleQualifikationen } from './uhsKraefteKern';

interface Props {
  einsatzId: number;
  uhs: UhsDetail;
  schreibgeschuetzt: boolean;
  /** „Einheit zuordnen“: nur die Einsatzleitung, kein Gerät (Server 403). */
  einheitZuordnen: boolean;
}

/** Positionen in der Reihenfolge der Stärke (F/UF/M), nicht nach Alphabet. */
const POSITION_FOLGE = POSITION_OPTIONEN.map((o) => o.value);
const POSITION_FILTER = POSITION_OPTIONEN.map((o) => ({ text: o.label, value: o.value }));

function positionRang(k: UhsKraft): number {
  return k.staerke_position ? POSITION_FOLGE.indexOf(k.staerke_position) : POSITION_FOLGE.length;
}

interface KraftWerte {
  kraft_id: number;
}
interface EinheitWerte {
  einheit_id: number;
}
interface AdhocWerte {
  name: string;
  funktion?: string;
  staerke_position?: StaerkePosition;
}

/**
 * Kräfte einer UHS (LFH-1045, Spec `uhs-staerke`): die Stärke aus den zugeordneten Einsatzkräften,
 * ihre Qualifikationen als Zahl je Bezeichnung und die Zuordnung selbst. Geteilt von der
 * UHS-Detailseite (Einsatzleitung) und dem Bereich „UHS“ des UHS-Laptops; der Server begrenzt das
 * Gerät auf die eigene UHS (`src/geraet/stelle.rs`).
 */
export default function UhsKraefte({ einsatzId, uhs, schreibgeschuetzt, einheitZuordnen }: Props) {
  const qc = useQueryClient();
  const { message } = App.useApp();
  // Ablehnungen am Ort, kein Toast (LFH-1077, `frontend/AGENTS.md`, „Rückwege und Fehler“): die
  // Dialoge tragen ihre Mutation als `speicherung`, Abziehen meldet an der Zeile der Kraft.
  const abziehenZeilen = useZeilenFehler<number>();
  const { rollen } = useRollen();
  // Die abgezogene Kraft hält ihre Zeile (LLH-1924, Spec `bedien-muster`, „Gelöste Zeile hält
  // ihre Stelle“): sonst rückt „Abziehen“ der nächsten Kraft unter den Finger.
  const halten = useHoldGeloest(uhs.kraefte, `${einsatzId}:${uhs.id}`);
  const gehalten = new Set(halten.rows.filter((r) => r.isGeloest).map((r) => r.p.id));
  // Laufend je Zeile, nicht `isPending`: zwei Zeilen dürfen gleichzeitig laufen, und ein zweiter
  // Tipp auf dieselbe schickt nichts.
  const [laufend, setLaufend] = useState<ReadonlySet<number>>(new Set());
  const markiere = (id: number, an: boolean) =>
    setLaufend((alt) => {
      const neu = new Set(alt);
      if (an) neu.add(id);
      else neu.delete(id);
      return neu;
    });
  const bedienbar = !schreibgeschuetzt && uhs.status !== 'aufgeloest' && !uhs.storniert_at;
  const [offen, setOffen] = useState<'kraft' | 'einheit' | 'adhoc' | null>(null);
  const [kraftForm] = Form.useForm<KraftWerte>();
  const [einheitForm] = Form.useForm<EinheitWerte>();
  const [adhocForm] = Form.useForm<AdhocWerte>();
  const sperrgrundId = useId();

  const ohneUhsQuery = useQuery({
    queryKey: einsatzKeys.personalOhneUhs(einsatzId),
    queryFn: () => listeKraefteOhneUhs(einsatzId, uhs.id),
    enabled: bedienbar,
  });
  const ohneUhs = ohneUhsQuery.data ?? [];
  const einheiten = freieEinheiten(ohneUhs);
  const qualifikationen = zaehleQualifikationen(uhs.kraefte);

  function invalidate() {
    qc.invalidateQueries({ queryKey: einsatzKeys.uhsDetail(einsatzId, uhs.id) });
    qc.invalidateQueries({ queryKey: einsatzKeys.uhs(einsatzId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.personal(einsatzId) });
  }

  const zuordnenMut = useMutation({
    mutationFn: (kraftId: number) => ordneKraftZu(einsatzId, uhs.id, kraftId),
    onSuccess: () => {
      message.success('Kraft zugeordnet');
      invalidate();
    },
  });
  const einheitMut = useMutation({
    mutationFn: (einheitId: number) => ordneEinheitZu(einsatzId, uhs.id, einheitId),
    onSuccess: () => {
      message.success('Einheit zugeordnet');
      invalidate();
    },
  });
  const adhocMut = useMutation({
    mutationFn: (daten: AdhocKraftEingabe) => erfasseAdhocKraft(einsatzId, uhs.id, daten),
    onSuccess: () => {
      message.success('Kraft erfasst');
      invalidate();
    },
  });
  // „Rückgängig“ nach dem Abziehen (LLH-1722, `frontend/AGENTS.md`, „Beenden: Verb, Ort und
  // Sicherung je Art“): ordnet die Kraft über denselben Weg wieder dieser UHS zu, aber nur, wenn sie
  // nicht inzwischen an einer anderen steht (LLH-1924). Die Ablehnung steht an der gehaltenen
  // Zeile; ist die gefallen, über der Liste.
  const rueckgaengigMut = useMutation({
    mutationFn: (k: UhsKraft) => ordneKraftZu(einsatzId, uhs.id, k.id, { nurWennFrei: true }),
    onMutate: (k) => {
      abziehenZeilen.beginne(k.id);
      markiere(k.id, true);
    },
    onSuccess: (_d, k) => {
      halten.release(k.id);
      invalidate();
    },
    onError: (e, k) => abziehenZeilen.melde(k.id, e, 'Nicht zurückgenommen'),
    onSettled: (_d, _e, k) => markiere(k.id, false),
  });
  const abziehenMut = useMutation({
    mutationFn: (k: UhsKraft) => zieheKraftAb(einsatzId, uhs.id, k.id),
    onMutate: (k) => {
      abziehenZeilen.beginne(k.id);
      markiere(k.id, true);
      rueckgaengigMut.reset();
    },
    onSuccess: (_d, k) => {
      halten.add(k);
      zeigeRueckgaengig(message, `${k.name} abgezogen`, () => rueckgaengigMut.mutate(k));
      invalidate();
    },
    onError: (e, k) => abziehenZeilen.melde(k.id, e, 'Abziehen fehlgeschlagen'),
    onSettled: (_d, _e, k) => markiere(k.id, false),
  });
  /** Teile einer gehaltenen Zeile bleiben unsichtbar an ihrem Platz (Höhe hält). */
  const nurPlatz = (k: UhsKraft) =>
    gehalten.has(k.id) ? ({ visibility: 'hidden' } as const) : undefined;
  /** Ein Feld mit einem zweiten, das in einer gehaltenen Zeile darüber liegt. */
  const mitUeberlage = (k: UhsKraft, inhalt: ReactNode, ueberlage: ReactNode) => (
    <span style={{ display: 'inline-grid' }}>
      <span style={{ gridArea: '1 / 1', ...nurPlatz(k) }}>{inhalt}</span>
      {gehalten.has(k.id) && <span style={{ gridArea: '1 / 1' }}>{ueberlage}</span>}
    </span>
  );

  const keineFreie = ohneUhsQuery.isSuccess && ohneUhs.length === 0;

  // Filterwerte Einheit aus den Kräften dieser UHS: eine feste Liste gibt es hier nicht.
  const einheitFilter = [...new Set(uhs.kraefte.flatMap((k) => (k.einheit ? [k.einheit] : [])))]
    .sort((a, b) => a.localeCompare(b, 'de'))
    .map((name) => ({ text: name, value: name }));

  // Sortieren und Filtern (LLH-1096, Spec `tabellen-sortieren-filtern`): jede Spalte außer der
  // Aktion sortiert, Position und Einheit sind Wertelisten und filtern. Ohne Listengedächtnis: die
  // Liste ist ein Reiter der UHS-Detailseite (und der Bereich „UHS“ am Gerät), deren Adresse die
  // UHS meint; Sortierung und Filter gelten, solange der Reiter offen ist.
  const columns: KatalogSpalte<UhsKraft>[] = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      sorter: (a, b) => a.name.localeCompare(b.name, 'de'),
      render: (name: string, k: UhsKraft) =>
        gehalten.has(k.id) ? <span style={{ color: rollen.gedaempft }}>{name}</span> : name,
    },
    // Die eine Funktionsangabe (Einsatzfunktion vor Qualifikation), die Qualifikation darunter wie
    // in der Personalliste (LLH-1067, `kraefte/einsatzfunktionKern.ts`).
    {
      title: 'Funktion',
      key: 'funktion',
      sorter: (a, b) => (funktionText(a) ?? '').localeCompare(funktionText(b) ?? '', 'de'),
      // In der gehaltenen Zeile steht hier „Rückgängig“: weit weg vom Knopf, den ein zweiter Tipp
      // trifft (LLH-1924, `frontend/AGENTS.md`, „Beenden: Verb, Ort und Sicherung je Art“).
      render: (_: unknown, k: UhsKraft) => {
        const text = funktionText(k);
        const qualifikation = k.funktion?.trim();
        return mitUeberlage(
          k,
          <>
            {text ?? '—'}
            {qualifikation && qualifikation !== text && (
              <Typography.Text
                type="secondary"
                style={{ display: 'block', overflowWrap: 'anywhere' }}
              >
                {qualifikation}
              </Typography.Text>
            )}
          </>,
          bedienbar && (
            <Button
              aria-label={`Rückgängig: ${k.name} zurück an die UHS`}
              loading={laufend.has(k.id)}
              onClick={() => {
                if (laufend.has(k.id)) return;
                // Derselbe Rückweg wie im Hinweis: der schließt sich (Review LLH-1924).
                schliesseRueckgaengig(message);
                rueckgaengigMut.mutate(k);
              }}
            >
              Rückgängig
            </Button>
          ),
        );
      },
    },
    {
      title: 'Position',
      dataIndex: 'staerke_position',
      key: 'position',
      sorter: (a, b) => positionRang(a) - positionRang(b),
      filters: POSITION_FILTER,
      onFilter: (wert, k) => k.staerke_position === wert,
      render: (p: StaerkePosition | undefined, k: UhsKraft) => (
        <span style={nurPlatz(k)}>{p ? POSITION_LABELS[p] : '—'}</span>
      ),
    },
    {
      title: 'Einheit',
      dataIndex: 'einheit',
      key: 'einheit',
      sorter: (a, b) => (a.einheit ?? '').localeCompare(b.einheit ?? '', 'de'),
      filters: einheitFilter.length > 0 ? einheitFilter : undefined,
      onFilter: (wert, k) => k.einheit === wert,
      render: (v: string | undefined, k: UhsKraft) => <span style={nurPlatz(k)}>{v ?? '—'}</span>,
    },
    ...(bedienbar
      ? [
          {
            title: 'Aktion',
            key: 'aktion',
            // Keine Rückfrage: die Kraft bleibt im Einsatz und lässt sich wieder zuordnen, der
            // Hinweis bietet „Rückgängig“ (`frontend/AGENTS.md`, „Destruktiv ist nicht gleich
            // destruktiv“). Einzige Handlung der Zeile, deshalb ein Knopf (LLH-1722).
            // Gehalten steht „Gelöst“ träge an der Stelle des Knopfs (LLH-1924).
            render: (_: unknown, k: UhsKraft) => {
              const grund = abziehenZeilen.grund(k.id);
              const geloest = gehalten.has(k.id);
              return (
                <Space orientation="vertical" size={4}>
                  {mitUeberlage(
                    k,
                    <Button
                      danger
                      aria-label={`${k.name} abziehen`}
                      aria-hidden={geloest || undefined}
                      tabIndex={geloest ? -1 : undefined}
                      loading={!geloest && laufend.has(k.id)}
                      onClick={() => {
                        if (!geloest && !laufend.has(k.id)) abziehenMut.mutate(k);
                      }}
                    >
                      Abziehen
                    </Button>,
                    <Button
                      type="text"
                      aria-label={`${k.name} gelöst`}
                      aria-disabled
                      style={{ color: rollen.gedaempft, cursor: 'default' }}
                    >
                      Gelöst
                    </Button>,
                  )}
                  {grund && <ZeilenFehler fehler={grund.fehler} fallback={grund.fallback} />}
                </Space>
              );
            },
          },
        ]
      : []),
  ];

  return (
    <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
      {rueckgaengigMut.isError &&
        !halten.rows.some((r) => r.p.id === rueckgaengigMut.variables?.id) && (
          <SpeicherFehler
            fehler={rueckgaengigMut.error}
            titel={`${rueckgaengigMut.variables?.name ?? 'Kraft'} nicht zurückgenommen`}
            fallback="Rückgängig fehlgeschlagen"
          />
        )}
      <Datenraster beschriftung="Stärke der UHS" spalten={2}>
        <Datenfeld label="Stärke" mono>
          <span data-testid="uhs-staerke">{staerkeText(uhs.staerke)}</span>
        </Datenfeld>
        <Datenfeld label="Qualifikationen">
          {qualifikationen.length === 0 ? (
            '—'
          ) : (
            <Space wrap size={[4, 4]}>
              {qualifikationen.map((q) => (
                <Tag key={q.bezeichnung}>
                  {q.bezeichnung} {q.anzahl}
                </Tag>
              ))}
            </Space>
          )}
        </Datenfeld>
      </Datenraster>
      {bedienbar && (
        <Space wrap size="small" align="center">
          <Button
            onClick={() => setOffen('kraft')}
            disabled={keineFreie}
            aria-describedby={keineFreie ? sperrgrundId : undefined}
          >
            Kraft zuordnen
          </Button>
          {einheitZuordnen && (
            <Button
              onClick={() => setOffen('einheit')}
              disabled={keineFreie || einheiten.length === 0}
            >
              Einheit zuordnen
            </Button>
          )}
          <Button onClick={() => setOffen('adhoc')}>Kraft erfassen</Button>
          {keineFreie && (
            <Typography.Text type="secondary" id={sperrgrundId}>
              Keine Kraft ohne UHS
            </Typography.Text>
          )}
        </Space>
      )}
      <div {...halten.rootProps}>
        <KatalogTabelle<UhsKraft>
          rowKey="id"
          dataSource={halten.rows.map((r) => r.p)}
          columns={columns}
          mehrzahl="Kräften"
          pagination={false}
          locale={{ emptyText: 'Keine Kraft an dieser UHS' }}
        />
      </div>
      <ErfassungsModal<KraftWerte>
        offen={offen === 'kraft'}
        titel="Kraft zuordnen"
        form={kraftForm}
        erfassenText="Zuordnen"
        laeuft={zuordnenMut.isPending}
        speicherung={zuordnenMut}
        speicherFehlerTitel="Nicht zugeordnet"
        speicherFehlerFallback="Zuordnen fehlgeschlagen"
        onErfassen={(w) => zuordnenMut.mutateAsync(w.kraft_id)}
        onFertig={() => setOffen(null)}
        onAbbrechen={() => setOffen(null)}
      >
        <Form.Item<KraftWerte>
          name="kraft_id"
          label="Kraft"
          rules={[{ required: true, message: 'Bitte eine Kraft auswählen' }]}
        >
          <Select
            showSearch={teilwortSuche}
            style={{ width: '100%' }}
            placeholder="Kraft auswählen…"
            options={ohneUhs.map((k) => ({ value: k.id, label: kraftAuswahlText(k) }))}
          />
        </Form.Item>
      </ErfassungsModal>
      {einheitZuordnen && (
        <ErfassungsModal<EinheitWerte>
          offen={offen === 'einheit'}
          titel="Einheit zuordnen"
          form={einheitForm}
          erfassenText="Zuordnen"
          laeuft={einheitMut.isPending}
          speicherung={einheitMut}
          speicherFehlerTitel="Nicht zugeordnet"
          speicherFehlerFallback="Zuordnen fehlgeschlagen"
          onErfassen={(w) => einheitMut.mutateAsync(w.einheit_id)}
          onFertig={() => setOffen(null)}
          onAbbrechen={() => setOffen(null)}
        >
          <Form.Item<EinheitWerte>
            name="einheit_id"
            label="Einheit"
            rules={[{ required: true, message: 'Bitte eine Einheit auswählen' }]}
          >
            <Select
              style={{ width: '100%' }}
              placeholder="Einheit auswählen…"
              options={einheiten.map((e) => ({
                value: e.id,
                label: `${e.name} (${e.anzahl} ${e.anzahl === 1 ? 'Kraft' : 'Kräfte'})`,
              }))}
            />
          </Form.Item>
        </ErfassungsModal>
      )}
      <ErfassungsModal<AdhocWerte>
        offen={offen === 'adhoc'}
        titel="Kraft erfassen"
        form={adhocForm}
        erfassenText="Erfassen"
        laeuft={adhocMut.isPending}
        speicherung={adhocMut}
        speicherFehlerTitel="Nicht erfasst"
        speicherFehlerFallback="Erfassen fehlgeschlagen"
        onErfassen={(w) =>
          adhocMut.mutateAsync({
            name: w.name,
            funktion: w.funktion?.trim() || undefined,
            staerke_position: w.staerke_position,
          })
        }
        onFertig={() => setOffen(null)}
        onAbbrechen={() => setOffen(null)}
      >
        <Form.Item<AdhocWerte>
          name="name"
          label="Name"
          rules={[{ required: true, whitespace: true, message: 'Bitte einen Namen angeben' }]}
        >
          <Input maxLength={PERSONAL_ADHOC_TEXT_MAX} />
        </Form.Item>
        {/* Freitext ist die Qualifikation (`funktion`); die Einsatzfunktion setzt die Personalliste. */}
        <Form.Item<AdhocWerte> name="funktion" label="Qualifikation">
          <Input maxLength={PERSONAL_ADHOC_TEXT_MAX} />
        </Form.Item>
        <Form.Item<AdhocWerte> name="staerke_position" label="Position">
          <Select allowClear placeholder="ohne" options={POSITION_OPTIONEN} />
        </Form.Item>
      </ErfassungsModal>
    </Space>
  );
}
