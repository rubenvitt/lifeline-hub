import { Button, Flex, Form, Modal, type FormInstance, type FormRule } from 'antd';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react';
import { istKonflikt } from '../../api/client';
import {
  OffeneBearbeitungProvider,
  useHatOffeneBearbeitung,
  useOffeneBearbeitungBelegung,
} from '../offeneBearbeitung';
import { SpeicherFehler } from '../SpeicherHinweis';
import { useSpeicherLeiste } from '../speicherLeiste';
import { useEditSitzung, type CasBasis, type MitGeaendertAt } from '../useEditSitzung';
import Datenraster, { Datenfeld } from './Datenraster';
import DatenfeldEingabe from './DatenfeldEingabe';
import Paneel, { paneelZeileStil, type PaneelUeberschrift } from './Paneel';
import { useRollen } from './rollenwerte';

/**
 * BearbeitbaresPaneel — „Bearbeiten in der Ansicht“ (LLH-1139, `frontend/AGENTS.md`, „Bearbeiten
 * in der Ansicht“; Spec `formularseiten`, „Eine offene Bearbeitung je Ansicht“). Der EINE Baustein
 * für paneel- und ansichtsweises Speichern; Fach-Seiten bauen keinen eigenen.
 *
 * - **Modus `paneel`** (Stufe Paneel): ein `Paneel` mit `Datenraster`; „Bearbeiten“ im Kopf schaltet
 *   NUR dieses Paneel um — dieselben Zellen werden zu Eingaben (`DatenfeldEingabe`, das Etikett
 *   bleibt der Begriff), Speichern/Abbrechen im Fuß.
 * - **Modus `ansicht`** (Stufe ganze Ansicht, oder eine Karte, die selbst die Ansicht ist): kein
 *   eigener Rahmen und keine Lesefassung; die Ansicht des Aufrufers ist die Anzeige, er öffnet über
 *   `offen`/`onOffenAenderung`. Der Fuß ist die klebende Speichern-Leiste (`useSpeicherLeiste`).
 * - **Eine offene Bearbeitung je Seite:** das Öffnen belegt den Merker
 *   `components/offeneBearbeitung.tsx` (`melde('offen')`), jedes andere „Bearbeiten“ und jedes
 *   Einzelfeld der Seite ist gesperrt mit „Erst „Titel“ speichern oder abbrechen“. Die Rückfrage vor
 *   dem Verlassen kommt erst mit einer Änderung (`melde('geaendert')`). Ohne Merker der Seite legt
 *   der Baustein seinen eigenen an: der Verlassen-Schutz gilt immer (Data Router nötig, in Tests
 *   `renderMitProviders(…, { datenRouter: true })`).
 * - **CAS:** `useEditSitzung` friert `geaendert_at` und die Werte beim Öffnen ein; ein
 *   Hintergrund-Refetch ändert weder die Eingaben noch die Basis. `onSpeichern(patch, basis)`;
 *   `basis` `undefined` heißt „Meine Änderung übernehmen“ nach einem 409.
 * - **Nur Geändertes:** der Patch enthält nur Felder, deren Wert sich nach Inhalt geändert hat
 *   (`bearbeitetePatch`, oder `patch` des Aufrufers); ein leerer Patch sendet nichts und schließt.
 * - **Tastatur:** Enter speichert (Knopf `submit` im `<form>`, Erfassungs-Norm), Escape bricht ab
 *   (eine offene Auswahl schluckt Escape selbst: rc-select stoppt die Ausbreitung). Fokus beim
 *   Öffnen ins erste Feld, beim Schließen zurück auf „Bearbeiten“ bzw. `ausloeserRef`.
 * - **Fehler am Ort** (LFH-1077): Prüffehler unter der Zelle, eine Ablehnung als `SpeicherFehler`
 *   am Paneel, der 409 als Rückfrage „Zwischenzeitlich geändert“. Kein Toast.
 */

export interface BearbeitbaresFeld<W> {
  /** Feldname im Formular und Schlüssel im Patch. */
  name: Extract<keyof W, string>;
  /** Begriff — Augenbraue der Anzeige und Etikett der Eingabe. */
  label: string;
  /** Lesewert im Modus `paneel`. */
  anzeige: ReactNode;
  /** Genau eine Eingabe, die `id` annimmt (`DatenfeldEingabe`). */
  eingabe: ReactElement<{ id?: string }>;
  regeln?: FormRule[];
  /** Hilfe unter der Eingabe (Vorschlag mit Herkunft). */
  hilfe?: ReactNode;
  breit?: boolean;
  mono?: boolean;
}

export interface BearbeitbaresPaneelProps<W extends object, P = Partial<W>> {
  /** Titel des Paneels; zugleich das Etikett im Sperrgrund der übrigen Bearbeitungen. */
  titel: string;
  ueberschrift?: PaneelUeberschrift;
  meta?: ReactNode;
  /** Der Datensatz; nur `geaendert_at` wird gelesen (Kollisionsbasis). */
  datensatz: MitGeaendertAt;
  /** Formularwerte des Datensatzes, aus demselben Stand wie `datensatz`. */
  werte: W;
  felder: readonly BearbeitbaresFeld<W>[];
  /** Abbildung auf den Patch; Vorgabe: nur geänderte Felder (`bearbeitetePatch`). */
  patch?: (vorher: W, nachher: W) => P;
  /** Lehnt bei Ablehnung ab (`mutateAsync`); ein 409 öffnet die Rückfrage. */
  onSpeichern: (patch: P, basis: CasBasis | undefined) => Promise<unknown>;
  /** „Verwerfen und neu laden“ nach einem 409, etwa `query.refetch`. */
  onNeuLaden?: () => void;
  darfSchreiben: boolean;
  /** Kurzgrund ohne Schreibrecht; ohne Grund entfällt „Bearbeiten“. */
  grund?: string;
  modus?: 'paneel' | 'ansicht';
  /** Gesteuert öffnen (Pflicht im Modus `ansicht`). */
  offen?: boolean;
  onOffenAenderung?: (offen: boolean) => void;
  /** Eigene Formularinstanz, wenn der Aufrufer Werte beobachten muss (`Form.useWatch`). */
  form?: FormInstance<W>;
  /** Ziel der Fokusrückgabe im Modus `ansicht`. */
  ausloeserRef?: RefObject<HTMLElement | null>;
  /** Spalten des Rasters; Vorgabe 3. */
  spalten?: number;
}

/** Wertgleichheit nach Inhalt (Zahlen, Texte, Listen, Objekte, Zeitpunkte über `toJSON`). */
function gleich(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** Vorgabe-Patch: nur die Felder, deren Wert sich nach Inhalt geändert hat. */
export function bearbeitetePatch<W extends object>(
  vorher: W,
  nachher: W,
  namen: readonly Extract<keyof W, string>[],
): Partial<W> {
  const patch: Partial<W> = {};
  for (const n of namen) {
    if (!gleich(vorher[n], nachher[n])) patch[n] = nachher[n];
  }
  return patch;
}

function isLeer(patch: unknown): boolean {
  return patch == null || (typeof patch === 'object' && Object.keys(patch).length === 0);
}

const ERSTES_FELD = 'input:not([type="hidden"]):not([disabled]), textarea:not([disabled])';

export default function BearbeitbaresPaneel<W extends object, P = Partial<W>>(
  props: BearbeitbaresPaneelProps<W, P>,
) {
  const hatMerker = useHatOffeneBearbeitung();
  if (hatMerker) return <Innen {...props} />;
  return (
    <OffeneBearbeitungProvider aktiv={props.darfSchreiben}>
      <Innen {...props} />
    </OffeneBearbeitungProvider>
  );
}

function Innen<W extends object, P = Partial<W>>({
  titel,
  ueberschrift = 'h2',
  meta,
  datensatz,
  werte,
  felder,
  patch: zuPatch,
  onSpeichern,
  onNeuLaden,
  darfSchreiben,
  grund,
  modus = 'paneel',
  offen: offenGesteuert,
  onOffenAenderung,
  form: formVonAussen,
  ausloeserRef,
  spalten = 3,
}: BearbeitbaresPaneelProps<W, P>) {
  const { token, rollen } = useRollen();
  const [eigeneForm] = Form.useForm<W>();
  const form = formVonAussen ?? eigeneForm;
  const { sitzung, starte, beende } = useEditSitzung<W>(form);
  const belegung = useOffeneBearbeitungBelegung(titel);
  const { melde } = belegung;
  const leiste = useSpeicherLeiste({ hasAbbrechen: true });

  const [offenIntern, setOffenIntern] = useState(false);
  const offen = offenGesteuert ?? offenIntern;
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<unknown>(null);
  const [konflikt, setKonflikt] = useState<{ patch: P } | null>(null);
  const knopfRef = useRef<HTMLButtonElement>(null);
  const rasterRef = useRef<HTMLDivElement>(null);
  const grundId = useId();

  const setOffen = useCallback(
    (wert: boolean) => {
      if (offenGesteuert === undefined) setOffenIntern(wert);
      onOffenAenderung?.(wert);
    },
    [offenGesteuert, onOffenAenderung],
  );

  // Öffnen: Sitzung aus EINEM Stand, Merker belegen, Fokus ins erste Feld. Schließen: Sitzung
  // beenden, Merker frei, Fokus zurück. Die Sitzung startet nur beim Übergang, ein neuer
  // `datensatz` während der Bearbeitung ändert sie nicht.
  useEffect(() => {
    if (offen && sitzung == null) {
      form.resetFields();
      starte(datensatz, werte);
      setFehler(null);
      melde('offen');
      requestAnimationFrame(() => {
        rasterRef.current?.querySelector<HTMLElement>(ERSTES_FELD)?.focus();
      });
    }
  }, [offen, sitzung, form, starte, datensatz, werte, melde]);

  useEffect(() => {
    if (!offen && sitzung != null) {
      beende();
      melde('zu');
    }
  }, [offen, sitzung, beende, melde]);

  // Ausgehängt mitten in der Bearbeitung (Karte entfällt): der Merker gibt selbst frei
  // (`useOffeneBearbeitungBelegung` meldet beim Aushängen ab).

  const schliesse = useCallback(() => {
    setKonflikt(null);
    setFehler(null);
    setOffen(false);
    const ziel = modus === 'ansicht' ? ausloeserRef : knopfRef;
    requestAnimationFrame(() => ziel?.current?.focus());
  }, [setOffen, modus, ausloeserRef]);

  const sende = async (patch: P, basis: CasBasis | undefined) => {
    setLaeuft(true);
    setFehler(null);
    try {
      await onSpeichern(patch, basis);
      setLaeuft(false);
      melde('zu');
      schliesse();
    } catch (e) {
      setLaeuft(false);
      // Nur der 409 MIT Basis ist der Sperrkonflikt; beim Übernehmen zeigt ein weiterer 409 die
      // Servermeldung, sonst wäre „Meine Änderung übernehmen“ ein toter Knopf.
      if (istKonflikt(e) && basis !== undefined) setKonflikt({ patch });
      else setFehler(e);
    }
  };

  const absenden = (eingabe: W) => {
    if (sitzung == null || laeuft) return;
    const nachher = { ...sitzung.werte, ...eingabe } as W;
    const patch = zuPatch
      ? zuPatch(sitzung.werte, nachher)
      : (bearbeitetePatch(
          sitzung.werte,
          nachher,
          felder.map((f) => f.name),
        ) as P);
    if (isLeer(patch)) {
      melde('zu');
      schliesse();
      return;
    }
    void sende(patch, sitzung.basis);
  };

  const onTaste = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Escape' || e.defaultPrevented || laeuft) return;
    e.preventDefault();
    melde('zu');
    schliesse();
  };

  const knoepfe = (
    <>
      <Button type="primary" htmlType="submit" loading={laeuft}>
        Speichern
      </Button>
      <Button
        htmlType="button"
        disabled={laeuft}
        onClick={() => {
          melde('zu');
          schliesse();
        }}
      >
        Abbrechen
      </Button>
    </>
  );

  const eingaben = (
    <div ref={rasterRef}>
      <Datenraster spalten={spalten} beschriftung={modus === 'ansicht' ? titel : undefined}>
        {felder.map((f) => (
          <DatenfeldEingabe
            key={f.name}
            label={f.label}
            name={f.name}
            rules={f.regeln}
            breit={f.breit}
            hilfe={f.hilfe}
          >
            {f.eingabe}
          </DatenfeldEingabe>
        ))}
      </Datenraster>
    </div>
  );

  const rueckfrage = (
    <Modal
      title="Zwischenzeitlich geändert"
      open={konflikt != null}
      onCancel={() => setKonflikt(null)}
      mask={{ closable: false }}
      footer={
        <Flex gap={token.margin} wrap justify="space-between">
          <Button
            onClick={() => {
              onNeuLaden?.();
              melde('zu');
              schliesse();
            }}
          >
            Verwerfen und neu laden
          </Button>
          <Button
            type="primary"
            loading={laeuft}
            onClick={() => {
              if (konflikt) void sende(konflikt.patch, undefined);
            }}
          >
            Meine Änderung übernehmen
          </Button>
        </Flex>
      }
    >
      Seit dem Öffnen von jemand anderem gespeichert.
    </Modal>
  );

  const formular = (inhalt: ReactNode) => (
    // Escape am Formular, nicht am Dokument: eine offene Auswahl stoppt die Ausbreitung selbst.
    <div onKeyDown={onTaste}>
      <Form<W>
        form={form}
        component="form"
        aria-label={`${titel} bearbeiten`}
        onFinish={absenden}
        onValuesChange={() => melde('geaendert')}
        scrollToFirstError={{ focus: true }}
      >
        {inhalt}
      </Form>
    </div>
  );

  if (modus === 'ansicht') {
    if (!offen) return null;
    return (
      <>
        {formular(
          <>
            {eingaben}
            <SpeicherFehler fehler={fehler} />
            <div {...leiste}>{knoepfe}</div>
          </>,
        )}
        {rueckfrage}
      </>
    );
  }

  if (offen) {
    return (
      <>
        {formular(
          <Paneel
            titel={titel}
            ueberschrift={ueberschrift}
            meta={meta}
            fuss={
              <Flex vertical gap={token.paddingSM}>
                <SpeicherFehler fehler={fehler} />
                <Flex wrap gap={token.padding}>
                  {knoepfe}
                </Flex>
              </Flex>
            }
          >
            {eingaben}
          </Paneel>,
        )}
        {rueckfrage}
      </>
    );
  }

  const sperrGrund = !darfSchreiben ? grund : belegung.gesperrt;
  const zeigeKnopf = darfSchreiben || grund != null;
  return (
    <Paneel
      titel={titel}
      ueberschrift={ueberschrift}
      meta={meta}
      aktion={
        zeigeKnopf ? (
          <Button
            ref={knopfRef}
            aria-label={`${titel} bearbeiten`}
            aria-describedby={sperrGrund ? grundId : undefined}
            disabled={sperrGrund != null}
            onClick={() => setOffen(true)}
          >
            Bearbeiten
          </Button>
        ) : undefined
      }
    >
      {zeigeKnopf && sperrGrund && (
        <div
          id={grundId}
          data-lfh="paneel-sperrgrund"
          style={{ ...paneelZeileStil(rollen, token), color: rollen.gedaempft, fontSize: 13 }}
        >
          {sperrGrund}
        </div>
      )}
      <Datenraster spalten={spalten}>
        {felder.map((f) => (
          <Datenfeld key={f.name} label={f.label} mono={f.mono} breit={f.breit}>
            {f.anzeige}
          </Datenfeld>
        ))}
      </Datenraster>
    </Paneel>
  );
}
