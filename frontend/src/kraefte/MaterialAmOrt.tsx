import { useId, useMemo, useState, type ReactNode } from 'react';
import { App, Button, Space, Typography } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { updateDisposition } from '../api/einsatzMaterial';
import { einsatzKeys } from '../api/queryKeys';
import type { EinsatzMaterial } from '../api/types';
import { monoStil, useRollen } from '../components/instrument';
import { KennungsLink } from '../components/kennungsLink';
import { MODUL_MATERIAL_GESPERRT } from '../components/nurAnsicht';
import { Select } from '../components/Select';
import { SpeicherFehler, ZeilenFehler } from '../components/SpeicherHinweis';
import { sprungGesperrtText } from '../components/Sprung';
import StatusTag from '../components/StatusTag';
import { useZeilenFehler } from '../components/useZeilenFehler';
import { useSprungSperre } from '../einsatz/useSprungSperre';
import { materialPfad } from '../routing/deeplinks';
import MaterialAusgabeModal from './MaterialAusgabeModal';
import { useMaterialOrtKontext } from './MaterialOrtAngabe';
import { buildZuordnenOptions, type OrtPosten, type ZuordnenPosten } from './materialOrtWahl';
import { materialDarstellung, mengeText, ORT_FELD, type MaterialOrtRef } from './materialPosten';
import { materialKopfzahl } from './materialVerdichtungKern';
import { useMaterialOrt } from './useMaterialOrt';

/**
 * Material an EINEM Ort — Einheit, Fahrzeug, UHS oder Bereitstellungsraum — mit EINEM Baustein
 * (LLH-1225, design.md D8, Spec `material-am-ort`). Die Posten kommen aus der Quelle des
 * Aufrufers (Einheit-DTO, UHS-Detail, Materialliste), normiert auf {@link MaterialAmOrtPosten}.
 *
 * - Zeile: Bezeichnung, Kategorie gedämpft, Menge („30 von 50 übrig“, `mengeText`), Status über
 *   `materialDarstellung`; bei Verbrauchsgut mit Rest „Ausgeben“ (derselbe Dialog wie die
 *   Materialliste), rechts das Lösen in Rot mit Abstand und ohne Rückfrage (LFH-363: die gelöste
 *   Zuordnung ist umkehrbar, über die Auswahl darunter).
 * - Kopfzahl „n Posten · k Ausfall“ aus der einen Material-Zählung.
 * - „Material zuordnen …“: wählen schreibt, Gruppen „Ohne Ort“ und „An anderem Ort“
 *   ({@link buildZuordnenOptions}). Zuordnen und Lösen laufen über den EINEN Schreibweg
 *   ({@link useMaterialOrt}, Recht Material, nie die Route eines Zielmoduls).
 * - Ein beendeter Ort sperrt nur das Zuordnen (und Ausgeben), mit Kurzgrund daneben; Lösen
 *   bleibt (LLH-1224 D13).
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
  const { setOrt } = useMaterialOrt(einsatzId);
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
    onSuccess: (_d, p) => void message.success(`${p.bezeichnung} gelöst`),
    onError: (e, p) => zeilen.melde(p.id, e, 'Lösen fehlgeschlagen'),
    onSettled: (_d, _e, p) => mark(p.id, false),
  });
  const zuordnen = useMutation({
    mutationFn: (p: ZuordnenPosten) => setOrt(p, ort),
    onMutate: () => zuordnenFehler.beginne('zuordnen'),
    onSuccess: (_d, p) => void message.success(`${p.bezeichnung} zugeordnet`),
    onError: (e) => zuordnenFehler.melde('zuordnen', e, 'Zuordnen fehlgeschlagen'),
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
      // Die Einheit trägt ihr Material im DTO, UHS und Bereitstellungsraum im Detail.
      void qc.invalidateQueries({ queryKey: einsatzKeys.einheiten(einsatzId) });
      if (ort.art === 'uhs') {
        void qc.invalidateQueries({ queryKey: einsatzKeys.uhsDetail(einsatzId, ort.id) });
      } else if (ort.art === 'bereitstellungsraum') {
        void qc.invalidateQueries({ queryKey: einsatzKeys.brDetail(einsatzId, ort.id) });
      }
      void qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
      return qc.invalidateQueries({ queryKey: einsatzKeys.material(einsatzId) });
    },
  });

  const zuordnenGrund = zuordnenFehler.grund('zuordnen');
  const sperre = !materialFrei ? MODUL_MATERIAL_GESPERRT : sperrgrund;

  return (
    <div data-lfh="material-am-ort">
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
      {posten.length === 0 && (
        <div>
          <Typography.Text type="secondary">{leerText}</Typography.Text>
        </div>
      )}
      {posten.map((p) => {
        const grund = zeilen.grund(p.id);
        const isAusgebbar =
          isBedienbar && !sperrgrund && p.art === 'verbrauchsgut' && p.ausgegeben < p.menge;
        return (
          <div
            key={p.id}
            data-lfh="material-am-ort-zeile"
            style={{
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
              <StatusTag darstellung={materialDarstellung(p)} />
            </span>
            {isBedienbar && (
              <Space size="middle" wrap>
                {isAusgebbar && (
                  <Button
                    aria-label={`${p.bezeichnung} ausgeben`}
                    onClick={() => {
                      ausgabe.reset();
                      setAusgabeFuer(p.id);
                    }}
                  >
                    Ausgeben
                  </Button>
                )}
                <Button
                  danger
                  aria-label={loesenName(p.bezeichnung, loesenText)}
                  loading={loesend.has(p.id)}
                  onClick={() => loesen.mutate(p)}
                >
                  {loesenText}
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
              laeuft={zuordnen.isPending}
              onWaehlen={(p) => zuordnen.mutate(p)}
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
  onWaehlen: (p: ZuordnenPosten) => void;
}

/**
 * Die bedienbare Auswahl. Eigene Komponente, damit die Namen der anderen Orte (Listen der Module,
 * nur mit Leserecht) erst geladen werden, wenn die Person zuordnen darf.
 */
function ZuordnenAuswahl({ einsatzId, ort, angebot, laeuft, onWaehlen }: ZuordnenAuswahlProps) {
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
          if (p) onWaehlen(p);
        }}
      />
      {fehler && (
        <Typography.Text type="danger" id={grundId}>
          Material konnte nicht geladen werden
        </Typography.Text>
      )}
      {leer && (
        // Ein Sprung ist keine Handlung (LFH-616): EIN Link mit „↗“, kein Knopf.
        <Typography.Text type="secondary" id={grundId}>
          Kein Material ohne Ort –{' '}
          {materialGesperrt ? (
            sprungGesperrtText('im Modul Material erfassen')
          ) : (
            <KennungsLink to={materialPfad(einsatzId)}>
              im Modul Material erfassen <span aria-hidden="true">↗</span>
            </KennungsLink>
          )}
        </Typography.Text>
      )}
    </div>
  );
}
