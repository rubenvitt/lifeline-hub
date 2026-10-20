import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { App, Button, Space, Typography } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { setzeMaterialStatus, updateDisposition } from '../api/einsatzMaterial';
import { einsatzKeys } from '../api/queryKeys';
import type { EinsatzMaterial, MaterialStatus } from '../api/types';
import { monoStil, useRollen } from '../components/instrument';
import { KennungsLink } from '../components/kennungsLink';
import { MODUL_MATERIAL_GESPERRT } from '../components/nurAnsicht';
import { Select } from '../components/Select';
import { SpeicherFehler, ZeilenFehler } from '../components/SpeicherHinweis';
import { sprungGesperrtText } from '../components/Sprung';
import StatusWahl from '../components/StatusWahl';
import { useZeilenFehler } from '../components/useZeilenFehler';
import { modulName } from '../einsatz/modulRegistry';
import { zeigeRueckgaengig } from '../kommunikation/rueckgaengig';
import { useSprungSperre } from '../einsatz/useSprungSperre';
import { materialPfad } from '../routing/deeplinks';
import MaterialAdhocDialog from './MaterialAdhocDialog';
import MaterialAusgabeModal from './MaterialAusgabeModal';
import MaterialHierherModal from './MaterialHierherModal';
import { useMaterialOrtKontext } from './MaterialOrtAngabe';
import { buildZuordnenOptions, type OrtPosten, type ZuordnenPosten } from './materialOrtWahl';
import {
  hoechsteTeilmenge,
  materialDarstellung,
  materialStatusWahl,
  mengeText,
  ORT_FELD,
  ortText,
  ortVon,
  ZUGEORDNET,
  type MaterialOrtRef,
} from './materialPosten';
import { materialKopfzahl } from './materialVerdichtungKern';
import { useMaterialOrt } from './useMaterialOrt';

/**
 * Material an EINEM Ort — Einheit, Fahrzeug, UHS oder Bereitstellungsraum — mit EINEM Baustein
 * (LLH-1225, design.md D8, Spec `material-am-ort`). Die Posten kommen aus der Quelle des
 * Aufrufers (Einheit-DTO, UHS-Detail, Materialliste), normiert auf {@link MaterialAmOrtPosten}.
 *
 * - Zeile: Bezeichnung, Kategorie gedämpft, Menge („30 von 50 übrig“, `mengeText`), Status über
 *   `materialDarstellung`. Die Statusanzeige ist der Auslöser der Statuswahl (LLH-1133,
 *   `StatusWahl`, derselbe Schreibweg `setzeMaterialStatus` und dieselben Einträge wie die
 *   Materialliste); eine Ablehnung steht an der Zeile. Bei Verbrauchsgut mit Rest „Ausgeben“
 *   (derselbe Dialog wie die Materialliste), rechts das Lösen in Rot mit Abstand und ohne
 *   Rückfrage (LFH-363: die gelöste Zuordnung ist umkehrbar, über die Auswahl darunter und über
 *   „Rückgängig“ im Hinweis). Die gelöste Zeile hält ihre Stelle als „Gelöst“, bis die Bedienung
 *   den Baustein verlassen hat ({@link useHoldGeloest}, LLH-1254).
 * - Kopfzahl „n Posten · k Ausfall“ aus der einen Material-Zählung.
 * - „Material zuordnen …“: wählen schreibt, Gruppen „Ohne Ort“ und „An anderem Ort“
 *   ({@link buildZuordnenOptions}). Ein aufteilbares Verbrauchsgut fragt zuerst die Menge
 *   ({@link MaterialHierherModal}, vorbelegt mit der ganzen Menge; t1hvaqzu, design.md D6): die
 *   ganze Menge holt den Posten, eine kleinere teilt ihn auf und setzt den Teil hierher. Zuordnen,
 *   Teilmenge und Lösen laufen über den EINEN Schreibweg ({@link useMaterialOrt}, Recht Material,
 *   nie die Route eines Zielmoduls).
 * - „Material erfassen“ (LLH-1133 D4): Ad-hoc-Material ohne Stamm mit diesem Ort in EINEM
 *   Request, im geteilten Dialog der Materialliste ({@link MaterialAdhocDialog}).
 * - Ein beendeter Ort sperrt nur das Zuordnen, Erfassen und Ausgeben, mit Kurzgrund daneben;
 *   Lösen und Status bleiben (LLH-1224 D13): sie ändern den Posten, nicht den Ort.
 * - Rechte (D9): bedienen nur mit Schreibrecht UND Freigabe Material. Ohne Freigabe zeigt der
 *   Baustein die Posten und die Auswahl gesperrt mit „Modul Material gesperrt“; ohne Schreibrecht
 *   (auch am Gerät) nur die Posten.
 */

/** Ein Posten am Ort, wie ihn jede Quelle liefern kann (das Einheit-DTO trägt keine Kategorie). */
export type MaterialAmOrtPosten = Pick<
  EinsatzMaterial,
  'id' | 'bezeichnung' | 'menge' | 'ausgegeben' | 'art' | 'status'
> & { kategorie?: string | null };

export interface MaterialAmOrtProps {
  einsatzId: number;
  ort: MaterialOrtRef;
  posten: readonly MaterialAmOrtPosten[];
  /** Die Materialliste als Angebot der Auswahl; nur mit Freigabe Material abgefragt. */
  angebot?: { data: readonly ZuordnenPosten[] | undefined; isError: boolean };
  /** Schreibrecht im Einsatz, an einem Gerät `false`. */
  darfSchreiben: boolean;
  /** Freigabe des Moduls Material. */
  materialFrei: boolean;
  /** Wortlaut des Lösens je Ort: „Aus Einheit lösen“, „Vom Fahrzeug lösen“, „Lösen“. */
  loesenText: string;
  /** Kurzgrund eines beendeten Orts („UHS aufgelöst“); sperrt Zuordnen und Ausgeben. */
  sperrgrund?: string | null;
  /** Überschrift über den Zeilen („Beladung“); ohne sie steht nur die Kopfzahl. */
  titel?: string;
  /** Die Kopfzahl im Baustein; aus, wenn der Rahmen sie trägt (Meta des Paneels). */
  kopfzahl?: boolean;
  leerText?: string;
}

/** Zugänglicher Name des Lösens mit der Bezeichnung: „Trage vom Fahrzeug lösen“. */
function loesenName(bezeichnung: string, loesenText: string): string {
  return `${bezeichnung} ${loesenText.charAt(0).toLowerCase()}${loesenText.slice(1)}`;
}

/**
 * Die Auswahl füllt ihre Zeile bis 420 px (schmal die ganze Breite), ein Grund daneben bricht
 * darunter. Ihre Einträge brechen um statt abzuschneiden: der Ort steht am Ende des Etiketts
 * („Wolldecke · 30 von 50 übrig · Staffel A“) und unterscheidet gleichnamige Posten
 * (Prüfliste Teil II).
 */
const AUSWAHL_STIL = { flex: '1 1 240px', maxWidth: 420, minWidth: 0 } as const;
const auswahlZeile = (gap: number) =>
  ({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap }) as const;
const wrapLabel = (o: { label?: ReactNode }) => (
  <span style={{ whiteSpace: 'normal' }}>{o.label}</span>
);

/**
 * Wie lange eine gelöste Zeile nach dem letzten Tipp im Baustein mindestens steht (LLH-1254,
 * `openspec/changes/archive/2026-10-19-k2gckqtq-material-loesen-ohne-sprung/design.md` D3).
 */
export const HOLD_MS = 4000;

/**
 * Ein selbst gelöster Posten. `pending`: die Quelle zeigt ihn noch (das Einheit-DTO gleicht ohne
 * Warten ab), trotzdem steht der Platzhalter, sonst wäre der Knopf noch einmal bedienbar. `gone`:
 * die Quelle zeigt ihn nicht mehr; taucht er wieder auf (Rückgängig, ein anderer ordnet zu),
 * gewinnt die echte Zeile (design.md D4).
 */
interface Geloest {
  p: MaterialAmOrtPosten;
  /** Stelle in der zuletzt gezeichneten Folge. */
  index: number;
  phase: 'pending' | 'gone';
}

const NO_GELOEST: ReadonlyMap<number, Geloest> = new Map();

/** Die Marke „Gelöst“: gedämpft, ohne Fläche und Rand, kein Bedienziel mehr. */
const geloestStyle = (farbe: string) =>
  ({
    color: farbe,
    background: 'transparent',
    borderColor: 'transparent',
    boxShadow: 'none',
    cursor: 'default',
  }) as const;

/**
 * Die gelöste Zeile hält ihre Stelle (LLH-1254, Spec `material-am-ort`, „Gelöste Zeile hält ihre Stelle“):
 * sonst rückt der Lösen-Knopf der nächsten Zeile unter Finger oder Zeiger, und ein schneller zweiter
 * Tipp löst den falschen Posten. Alle Platzhalter fallen ZUSAMMEN, sobald kein Maus- oder
 * Stiftzeiger über dem Baustein steht, kein Fokus darin liegt und {@link HOLD_MS} seit dem letzten
 * Tipp vergangen ist; einzeln fallende sprängen wieder. Die Bedingungen Zeiger und Fokus folgen der
 * Zuflussschleuse (`components/useZuflussSchleuse.ts`): Touch zählt nicht, weil ein Tipp betritt und
 * verlässt; ein Portal-Menü ist kein Verlassen. Die Schleuse selbst hält nur Zuwachs, Entfallenes
 * fällt dort sofort (design.md D1).
 */
function useHoldGeloest(posten: readonly MaterialAmOrtPosten[], ortKey: string) {
  const [state, setState] = useState<{ ort: string; entries: ReadonlyMap<number, Geloest> }>(
    () => ({ ort: ortKey, entries: NO_GELOEST }),
  );
  // Ein anderer Ort (oder Einsatz) leert: die Platzhalter gehören zum Ort, an dem gelöst wurde.
  const geloest = state.ort === ortKey ? state.entries : NO_GELOEST;
  const update = useCallback(
    (f: (prev: ReadonlyMap<number, Geloest>) => ReadonlyMap<number, Geloest>) =>
      setState((s) => {
        const prev = s.ort === ortKey ? s.entries : NO_GELOEST;
        const next = f(prev);
        return next === prev && s.ort === ortKey ? s : { ort: ortKey, entries: next };
      }),
    [ortKey],
  );

  // Die Folge, wie sie gezeichnet ist: der Platzhalter steht an der Stelle des gelösten Postens,
  // die übrigen in der Folge der Quelle. Mehrere behalten ihre Plätze, weil aufsteigend eingefügt wird.
  const rows = useMemo(() => {
    const present = new Set(posten.map((p) => p.id));
    const list = posten.map((p) => ({ p, isGeloest: geloest.get(p.id)?.phase === 'pending' }));
    [...geloest.values()]
      .filter((g) => !present.has(g.p.id))
      .sort((a, b) => a.index - b.index)
      .forEach((g) => list.splice(Math.min(g.index, list.length), 0, { p: g.p, isGeloest: true }));
    return list;
  }, [posten, geloest]);

  const shownIds = useRef<number[]>([]);
  useLayoutEffect(() => {
    shownIds.current = rows.map((r) => r.p.id);
  });

  // Phasen nachführen; zeichnen tut die Folge oben schon richtig, das hier ist nur Buchhaltung.
  useEffect(() => {
    const present = new Set(posten.map((p) => p.id));
    update((prev) => {
      let next: Map<number, Geloest> | null = null;
      for (const [id, g] of prev) {
        if (present.has(id) && g.phase === 'gone') {
          next ??= new Map(prev);
          next.delete(id);
        } else if (!present.has(id) && g.phase === 'pending') {
          next ??= new Map(prev);
          next.set(id, { ...g, phase: 'gone' });
        }
      }
      return next ?? prev;
    });
  }, [posten, update]);

  const conditions = useRef({ pointer: false, focus: false, lastTap: 0 });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const check = useCallback(
    function check() {
      clearTimeout(timer.current);
      const c = conditions.current;
      if (c.pointer || c.focus) return;
      const rest = HOLD_MS - (Date.now() - c.lastTap);
      if (rest > 0) {
        timer.current = setTimeout(check, rest);
        return;
      }
      update((prev) => (prev.size === 0 ? prev : NO_GELOEST));
    },
    [update],
  );
  const isHolding = geloest.size > 0;
  useEffect(() => {
    if (!isHolding) return;
    timer.current = setTimeout(check, HOLD_MS);
    return () => clearTimeout(timer.current);
  }, [isHolding, check]);
  useEffect(() => () => clearTimeout(timer.current), []);

  /** Nach dem Erfolg des Lösens: die Zeile wird Platzhalter, das Lösen zählt als Tipp. */
  const add = useCallback(
    (p: MaterialAmOrtPosten) => {
      conditions.current.lastTap = Date.now();
      const index = shownIds.current.indexOf(p.id);
      update((prev) =>
        new Map(prev).set(p.id, {
          p,
          index: index < 0 ? shownIds.current.length : index,
          phase: 'pending',
        }),
      );
    },
    [update],
  );
  /** Nach „Rückgängig“: kehrt der Posten in die Quelle zurück, gewinnt die echte Zeile. */
  const release = useCallback(
    (id: number) =>
      update((prev) => {
        const g = prev.get(id);
        return g == null || g.phase === 'gone'
          ? prev
          : new Map(prev).set(id, { ...g, phase: 'gone' });
      }),
    [update],
  );

  const rootProps = {
    onPointerMove: (e: ReactPointerEvent) => {
      if (e.pointerType !== 'touch') conditions.current.pointer = true;
    },
    onPointerLeave: (e: ReactPointerEvent) => {
      if (e.pointerType === 'touch') return;
      conditions.current.pointer = false;
      check();
    },
    onPointerDown: () => {
      conditions.current.lastTap = Date.now();
    },
    onFocus: () => {
      conditions.current.focus = true;
    },
    onBlur: (e: ReactFocusEvent<HTMLDivElement>) => {
      const ziel = e.relatedTarget;
      if (ziel != null && e.currentTarget.contains(ziel)) return;
      if (ziel?.closest?.('.ant-dropdown, .ant-select-dropdown, .ant-picker-dropdown')) return;
      conditions.current.focus = false;
      check();
    },
  };

  return { rows, add, release, rootProps };
}

export default function MaterialAmOrt({
  einsatzId,
  ort,
  posten,
  angebot,
  darfSchreiben,
  materialFrei,
  loesenText,
  sperrgrund = null,
  titel,
  kopfzahl = true,
  leerText = 'Kein Material',
}: MaterialAmOrtProps) {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const { token, rollen } = useRollen();
  const { setOrt, teileAufNach } = useMaterialOrt(einsatzId);
  const grundId = useId();
  const isBedienbar = darfSchreiben && materialFrei;

  /** Der Posten mit dem Ort-Feld dieses Orts: daraus baut `setOrt` das Lösen. */
  const amOrt = (id: number): OrtPosten => ({
    id,
    einheit_id: null,
    einsatz_fahrzeug_id: null,
    uhs_id: null,
    br_id: null,
    [ORT_FELD[ort.art]]: ort.id,
  });

  const zeilen = useZeilenFehler<number>();
  const halten = useHoldGeloest(posten, `${einsatzId}:${ort.art}:${ort.id}`);
  const zuordnenFehler = useZeilenFehler<'zuordnen'>();
  // Was gerade gelöst wird, je Posten: die Rückmeldung steht am Knopf vor der Antwort.
  const [loesend, setLoesend] = useState<ReadonlySet<number>>(() => new Set());
  const mark = (id: number, an: boolean) =>
    setLoesend((alt) => {
      const neu = new Set(alt);
      if (an) neu.add(id);
      else neu.delete(id);
      return neu;
    });

  const loesen = useMutation({
    mutationFn: (p: MaterialAmOrtPosten) => setOrt(amOrt(p.id), null),
    onMutate: (p) => {
      zeilen.beginne(p.id);
      mark(p.id, true);
    },
    onSuccess: (_d, p) => {
      halten.add(p);
      // An einem beendeten Ort lehnt der Server das Wieder-Zuordnen sicher ab: dort kein Rückweg
      // (`kommunikation/rueckgaengig.tsx`, „Nur dort zeigen, wo der Server einen Rückweg hat“).
      if (sperrgrund) void message.success(`${p.bezeichnung} gelöst`);
      else zeigeRueckgaengig(message, `${p.bezeichnung} gelöst`, () => rueckgaengig.mutate(p));
    },
    onError: (e, p) => zeilen.melde(p.id, e, 'Lösen fehlgeschlagen'),
    onSettled: (_d, _e, p) => mark(p.id, false),
  });
  // „Rückgängig“ ordnet über den einen Schreibweg wieder diesem Ort zu (design.md D5). Der Grund
  // einer Ablehnung steht über dem Block, nicht an der Zeile: der Platzhalter fiele mit ihm weg.
  const rueckgaengig = useMutation({
    mutationFn: (p: MaterialAmOrtPosten) =>
      setOrt(
        { id: p.id, einheit_id: null, einsatz_fahrzeug_id: null, uhs_id: null, br_id: null },
        ort,
      ),
    onSuccess: (_d, p) => halten.release(p.id),
  });
  const zuordnen = useMutation({
    mutationFn: (p: ZuordnenPosten) => setOrt(p, ort),
    onMutate: () => zuordnenFehler.beginne('zuordnen'),
    onSuccess: (_d, p) => void message.success(`${p.bezeichnung} zugeordnet`),
    onError: (e) => zuordnenFehler.melde('zuordnen', e, 'Zuordnen fehlgeschlagen'),
  });
  // Die Mengenfrage beim Zuordnen (t1hvaqzu, design.md D6): ein Dialog für alle Posten, mit dem
  // Stand beim Öffnen; die Ablehnung steht in ihm.
  // Entfällt der Posten live aus dem Angebot, bleibt der Dialog mit dem Stand beim Öffnen offen
  // und trägt die Ablehnung (Muster der Materialliste).
  const [hierherFuer, setHierherFuer] = useState<{
    p: ZuordnenPosten;
    bisherText: string;
  } | null>(null);
  const hierherPosten =
    hierherFuer == null
      ? null
      : (angebot?.data?.find((p) => p.id === hierherFuer.p.id) ?? hierherFuer.p);
  const hierher = useMutation({
    mutationFn: (v: { p: ZuordnenPosten; menge: number }) =>
      v.menge === v.p.menge ? setOrt(v.p, ort) : teileAufNach(v.p, v.menge, ort),
    onSuccess: (_d, v) =>
      void message.success(
        v.menge === v.p.menge
          ? `${v.p.bezeichnung} zugeordnet`
          : `${v.menge} ${v.p.bezeichnung} zugeordnet`,
      ),
  });
  const waehle = (p: ZuordnenPosten, bisherText: string) => {
    if (hoechsteTeilmenge(p) < 1) {
      zuordnen.mutate(p);
      return;
    }
    hierher.reset();
    setHierherFuer({ p, bisherText });
  };

  /**
   * Gleicht nach einer Änderung am Posten ab: die Einheit trägt ihr Material im DTO, UHS und
   * Bereitstellungsraum im Detail, das Fahrzeug liest die Materialliste. Erfüllt, wenn alle neu im
   * Cache stehen — bis dahin zeigt die Zeile den gewählten Stand.
   */
  const syncOrt = () => {
    void qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
    return Promise.all([
      qc.invalidateQueries({ queryKey: einsatzKeys.einheiten(einsatzId) }),
      ort.art === 'uhs'
        ? qc.invalidateQueries({ queryKey: einsatzKeys.uhsDetail(einsatzId, ort.id) })
        : ort.art === 'bereitstellungsraum'
          ? qc.invalidateQueries({ queryKey: einsatzKeys.brDetail(einsatzId, ort.id) })
          : undefined,
      qc.invalidateQueries({ queryKey: einsatzKeys.material(einsatzId) }),
    ]);
  };

  // Status am Ort (LLH-1133): derselbe Weg wie die Materialliste, die Ablehnung an der Zeile.
  const statusWechsel = useMutation({
    mutationFn: async (v: { p: MaterialAmOrtPosten; status: MaterialStatus }) => {
      await setzeMaterialStatus(einsatzId, v.p.id, v.status);
      await syncOrt();
    },
    onMutate: (v) => zeilen.beginne(v.p.id),
    onError: (e, v) => zeilen.melde(v.p.id, e, 'Status nicht geändert'),
  });

  // „Ausgeben“ (D5): derselbe Dialog wie die Materialliste, mit dem Stand beim Öffnen.
  const [ausgabeFuer, setAusgabeFuer] = useState<number | null>(null);
  const ausgabePosten =
    ausgabeFuer == null ? null : (posten.find((p) => p.id === ausgabeFuer) ?? null);
  const ausgabe = useMutation({
    mutationFn: (v: { p: MaterialAmOrtPosten; ausgegeben: number; menge: number }) =>
      updateDisposition(einsatzId, v.p.id, { ausgegeben: v.ausgegeben }),
    onSuccess: (_d, v) => {
      message.success(`${v.p.bezeichnung}: ${v.menge} ausgegeben`);
      return syncOrt();
    },
  });

  const zuordnenGrund = zuordnenFehler.grund('zuordnen');
  const sperre = !materialFrei ? MODUL_MATERIAL_GESPERRT : sperrgrund;
  const [erfassenOffen, setErfassenOffen] = useState(false);
  // Neben der Auswahl; gesperrt nennt die Auswahl daneben den Grund, der Knopf verweist darauf.
  const erfassenKnopf = (
    <Button
      disabled={sperre != null}
      aria-describedby={sperre != null ? grundId : undefined}
      onClick={() => setErfassenOffen(true)}
    >
      Material erfassen
    </Button>
  );

  return (
    <div data-lfh="material-am-ort" {...halten.rootProps}>
      {(titel || kopfzahl) && (
        <Space size={token.marginXS} style={{ marginBottom: token.marginXS }}>
          {titel && <Typography.Text type="secondary">{titel}</Typography.Text>}
          {kopfzahl && (
            <span
              data-testid="material-am-ort-kopf"
              style={{ ...monoStil(12), color: rollen.gedaempft }}
            >
              {materialKopfzahl(posten)}
            </span>
          )}
        </Space>
      )}
      {rueckgaengig.isError && (
        <div style={{ marginBottom: token.marginSM, maxWidth: 420 }}>
          <SpeicherFehler
            fehler={rueckgaengig.error}
            titel={`${rueckgaengig.variables?.bezeichnung ?? 'Posten'} nicht zurückgenommen`}
            fallback="Rückgängig fehlgeschlagen"
          />
        </div>
      )}
      {halten.rows.length === 0 && (
        <div>
          <Typography.Text type="secondary">{leerText}</Typography.Text>
        </div>
      )}
      {halten.rows.map(({ p, isGeloest }) => {
        const grund = zeilen.grund(p.id);
        // Bis der Abgleich steht, zeigt die Zeile den gewählten Status.
        const isStatusPending = statusWechsel.isPending && statusWechsel.variables?.p.id === p.id;
        const statusStand = isStatusPending ? { ...p, status: statusWechsel.variables.status } : p;
        const isAusgebbar =
          isBedienbar && !sperrgrund && p.art === 'verbrauchsgut' && p.ausgegeben < p.menge;
        // Am Platzhalter stehen Status und „Ausgeben“ unsichtbar und träge weiter: fielen sie weg,
        // passte eine umgebrochene Zeile wieder in eine, und alles darunter rückte hoch.
        const nurPlatz = isGeloest ? ({ visibility: 'hidden' } as const) : undefined;
        return (
          <div
            key={p.id}
            // Eigene Zeilenwurzel für den Palettenweg „Status setzen“ (`components/StatusWahl.tsx`):
            // sonst wäre in der Fahrzeugkarte die Karte die Zeile, und der letzte Posten gewänne
            // gegen die Statuswahl des Fahrzeugs.
            data-row-key={`material-${p.id}`}
            data-lfh="material-am-ort-zeile"
            data-geloest={isGeloest || undefined}
            style={{
              color: isGeloest ? rollen.gedaempft : undefined,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              columnGap: token.margin,
              rowGap: token.marginSM,
              flexWrap: 'wrap',
              // Bedienziel-Boden einer handgebauten Zeile (LFH-365); zwei Zeilen stehen `marginSM`
              // auseinander, Lösen über Lösen hält so den Aktionsabstand (≥ 8 / ≥ 16).
              minHeight: token.controlHeight,
              paddingBlock: token.marginSM / 2,
            }}
          >
            <span
              style={{
                display: 'inline-flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: token.marginXS,
              }}
            >
              <span>{p.bezeichnung}</span>
              {p.kategorie && <Typography.Text type="secondary">{p.kategorie}</Typography.Text>}
              {/* Eine Zahl bricht nicht um. */}
              <span style={{ ...monoStil(13), whiteSpace: 'nowrap' }}>{mengeText(p)}</span>
              <span style={nurPlatz}>
                {/* Gesperrt meldet die Statuswahl ihre Palettenebene ab. */}
                <StatusWahl
                  darstellung={materialDarstellung(statusStand)}
                  aktuell={statusStand.status}
                  optionen={materialStatusWahl(p.art)}
                  kennung={p.bezeichnung}
                  darfSchreiben={isBedienbar}
                  laeuft={isStatusPending}
                  gesperrt={statusWechsel.isPending || isGeloest}
                  onWaehlen={(status) => {
                    if (!statusWechsel.isPending && status !== p.status) {
                      statusWechsel.mutate({ p, status });
                    }
                  }}
                />
              </span>
            </span>
            {isBedienbar && (
              <Space size="middle" wrap>
                {isAusgebbar && (
                  <Button
                    aria-label={`${p.bezeichnung} ausgeben`}
                    style={nurPlatz}
                    onClick={() => {
                      if (isGeloest) return;
                      ausgabe.reset();
                      setAusgabeFuer(p.id);
                    }}
                  >
                    Ausgeben
                  </Button>
                )}
                {/* Gelöst bleibt es DERSELBE Knopf, träge (`aria-disabled`, nicht `disabled`): der Fokus
                    bleibt, und ein zweiter Tipp trifft nichts. Kein Wechsel von `type`: antd hängt den
                    Knopf dann neu ein, und der Fokus fiele auf `body`. Beide Wörter liegen im selben
                    Gitterfeld, so ist die Marke nie schmaler als der Knopf (design.md D2). */}
                <Button
                  danger={!isGeloest}
                  aria-label={
                    isGeloest ? `${p.bezeichnung} gelöst` : loesenName(p.bezeichnung, loesenText)
                  }
                  aria-disabled={isGeloest || undefined}
                  loading={!isGeloest && loesend.has(p.id)}
                  style={isGeloest ? geloestStyle(rollen.gedaempft) : undefined}
                  onClick={() => {
                    if (!isGeloest) loesen.mutate(p);
                  }}
                >
                  <span style={{ display: 'inline-grid' }}>
                    <span
                      style={{ gridArea: '1 / 1', visibility: isGeloest ? 'hidden' : undefined }}
                    >
                      {loesenText}
                    </span>
                    <span
                      style={{ gridArea: '1 / 1', visibility: isGeloest ? undefined : 'hidden' }}
                    >
                      Gelöst
                    </span>
                  </span>
                </Button>
              </Space>
            )}
            {grund && (
              <div style={{ flexBasis: '100%' }}>
                <ZeilenFehler fehler={grund.fehler} fallback={grund.fallback} />
              </div>
            )}
          </div>
        );
      })}
      {darfSchreiben && (
        <div style={{ marginTop: token.marginSM }}>
          {sperre != null || !angebot ? (
            <div style={auswahlZeile(token.marginXS)}>
              <Select
                style={AUSWAHL_STIL}
                placeholder="Material zuordnen …"
                aria-label="Material zuordnen"
                value={null}
                disabled
                aria-describedby={sperre ? grundId : undefined}
              />
              {erfassenKnopf}
              {sperre && (
                <Typography.Text type="secondary" id={grundId}>
                  {sperre}
                </Typography.Text>
              )}
            </div>
          ) : (
            <ZuordnenAuswahl
              einsatzId={einsatzId}
              ort={ort}
              angebot={angebot}
              laeuft={zuordnen.isPending || hierher.isPending}
              onWaehlen={waehle}
              erfassen={erfassenKnopf}
            />
          )}
        </div>
      )}
      {zuordnenGrund && (
        <div style={{ marginTop: token.marginSM, maxWidth: 420 }}>
          <SpeicherFehler
            fehler={zuordnenGrund.fehler}
            titel="Nicht zugeordnet"
            fallback={zuordnenGrund.fallback}
          />
        </div>
      )}
      {isBedienbar && !sperrgrund && (
        <MaterialAdhocDialog
          einsatzId={einsatzId}
          ort={ort}
          offen={erfassenOffen}
          onSchliessen={() => setErfassenOffen(false)}
        />
      )}
      {isBedienbar && !sperrgrund && (
        <MaterialHierherModal
          posten={hierherPosten}
          bisherText={hierherFuer?.bisherText ?? ''}
          laeuft={hierher.isPending}
          speicherung={hierher}
          onHolen={(menge) =>
            hierherPosten ? hierher.mutateAsync({ p: hierherPosten, menge }) : Promise.resolve()
          }
          onSchliessen={() => setHierherFuer(null)}
        />
      )}
      {/* Außerhalb der Zeilen-`map`: ein Dialog für alle Posten (`frontend/AGENTS.md`, „Aktionen“). */}
      {isBedienbar && (
        <MaterialAusgabeModal
          posten={ausgabePosten}
          modus="ausgeben"
          laeuft={ausgabe.isPending}
          speicherung={ausgabe}
          onSpeichern={(ausgegeben, menge) =>
            ausgabePosten
              ? ausgabe.mutateAsync({ p: ausgabePosten, ausgegeben, menge })
              : Promise.resolve()
          }
          onSchliessen={() => setAusgabeFuer(null)}
        />
      )}
    </div>
  );
}

interface ZuordnenAuswahlProps {
  einsatzId: number;
  ort: MaterialOrtRef;
  angebot: NonNullable<MaterialAmOrtProps['angebot']>;
  laeuft: boolean;
  /** Der gewählte Posten und sein bisheriger Ort im Wortlaut der Auswahl. */
  onWaehlen: (p: ZuordnenPosten, bisherText: string) => void;
  /** „Material erfassen“ neben der Auswahl. */
  erfassen: ReactNode;
}

/**
 * Die bedienbare Auswahl. Eigene Komponente, damit die Namen der anderen Orte (Listen der Module,
 * nur mit Leserecht) erst geladen werden, wenn die Person zuordnen darf.
 */
function ZuordnenAuswahl({
  einsatzId,
  ort,
  angebot,
  laeuft,
  onWaehlen,
  erfassen,
}: ZuordnenAuswahlProps) {
  const grundId = useId();
  const { token } = useRollen();
  const { kontext } = useMaterialOrtKontext(einsatzId, false, angebot.data);
  const materialGesperrt = useSprungSperre(einsatzId)('material');
  const optionen = useMemo(
    () => (angebot.data ? buildZuordnenOptions(angebot.data, ort, kontext.namen) : []),
    [angebot.data, ort, kontext.namen],
  );
  // Ein gescheiterter Abruf ohne Daten meldet sich; scheitert nur ein Abgleich im Hintergrund,
  // bleiben die alten Daten maßgeblich. Solange die Liste lädt, steht nichts daneben.
  const fehler = angebot.data === undefined && angebot.isError;
  const leer = angebot.data !== undefined && optionen.length === 0;
  return (
    <div style={auswahlZeile(token.marginXS)}>
      <Select<string>
        style={AUSWAHL_STIL}
        placeholder="Material zuordnen …"
        aria-label="Material zuordnen"
        value={null}
        loading={laeuft || angebot.data === undefined}
        disabled={fehler || leer}
        aria-describedby={fehler || leer ? grundId : undefined}
        options={optionen}
        optionRender={wrapLabel}
        onSelect={(wert) => {
          const p = angebot.data?.find((x) => String(x.id) === wert);
          if (!p) return;
          // Ohne Leserecht am bisherigen Ort hieße die Ergebniszeile sonst „…, zugeordnet 30“.
          const bisher = ortText(ortVon(p), kontext.namen);
          onWaehlen(p, bisher === ZUGEORDNET ? 'am bisherigen Ort' : bisher);
        }}
      />
      {erfassen}
      {fehler && (
        <Typography.Text type="danger" id={grundId}>
          Material konnte nicht geladen werden
        </Typography.Text>
      )}
      {leer && (
        // Ein Sprung ist keine Handlung (LFH-616): EIN Link mit „↗“, kein Knopf. Erfasst wird
        // daneben am Ort (LLH-1133); der Sprung führt nur noch in die Materialliste.
        <Typography.Text type="secondary" id={grundId}>
          Kein Material ohne Ort –{' '}
          {materialGesperrt ? (
            sprungGesperrtText(modulName('material'))
          ) : (
            <KennungsLink to={materialPfad(einsatzId)}>
              {modulName('material')} <span aria-hidden="true">↗</span>
            </KennungsLink>
          )}
        </Typography.Text>
      )}
    </div>
  );
}
