import { Button, Form, Typography, type FormInstance } from 'antd';
import { memo, useCallback, useId, useState, type ReactNode } from 'react';
import { IconHakenKreis, IconMinusKreis } from '../icons';
import MarkdownEditor from '../components/MarkdownEditor';
import { Paneel, Segmentleiste, useRollen } from '../components/instrument';
import AbschnittsText from './AbschnittsText';
import Einstiegsfokus from './Einstiegsfokus';
import {
  befuellungsKette,
  EDITOR_ZEILEN,
  fuellstandText,
  istLeer,
  type DokumentAbschnitt,
} from './dokumentEntwurfKern';
import './dokumentEntwurf.css';

type Ansicht = 'bearbeiten' | 'lesen';

/**
 * Was im Kopf eines Abschnitts neben Name und Hilfetext steht (Lagebericht: der Übernahme-Knopf,
 * `lageberichte/AbschnittUebernahme.tsx`). `null`/`undefined` → nichts. Die Seite übergibt die
 * Funktion per `useCallback`: eine neue Identität je Render höbe die `memo`-Sperre jedes Abschnitts
 * auf (Render-Zähler-Gate in `DokumentEntwurf.test.tsx`).
 */
export type AbschnittAktion = (abschnitt: DokumentAbschnitt) => ReactNode;

export interface DokumentEntwurfProps {
  /** Das Formular der Seite; der Baustein steht IN ihrem `<Form>`. */
  form: FormInstance;
  /** Gliederung aus der Vorlage der Art (identitätsstabil, aus `VORLAGEN`). */
  abschnitte: readonly DokumentAbschnitt[];
  /** Kopfblock: die Felder der Seite über den Abschnitten (Titel, Zeitstand, Verteiler). */
  kopf?: ReactNode;
  /** Erweiterungsstelle je Abschnitt im Abschnittskopf — siehe {@link AbschnittAktion}. */
  aktion?: AbschnittAktion;
  /**
   * Aktion der Seite für das ganze Dokument im Kopf der Gliederung (Lagebericht: „Leere Abschnitte
   * aus dem Lagebild füllen“, `lageberichte/LeereAbschnitteFuellen.tsx`). Steht über der
   * Sprungleiste, nicht in ihr: die Landmarke „Gliederung“ trägt nur Sprünge.
   */
  gliederungKopf?: ReactNode;
  /**
   * Feld des Einstiegsfokus (`entwurf/Einstiegsfokus.tsx`: der erste LEERE Abschnitt des
   * Serverstands). Beim Einhängen eingefroren; der Remount der Seite über `key={id}` ist der Reset.
   */
  einstieg: string | undefined;
}

/**
 * Die Schreibfläche jedes gegliederten Führungsdokuments — Lagebericht, Befehl, Pressemitteilung
 * (`entwurf/AGENTS.md`, „Gegliederte Dokumente“; Herleitung LLH-1074, vorher LFH-348). EIN
 * Baustein, damit dasselbe Dokument nicht zwei Bedienformen hat.
 *
 * - **Paneel „Entwurf“** mit dem Füllstand („5/8 Abschnitte“) und dem Umschalter „Bearbeiten |
 *   Lesefassung“ für das GANZE Dokument; darunter der Kopfblock der Seite.
 * - **Gliederung** als Sprungleiste: je Abschnitt Zeichen und Wort „leer“ (zweiter Kanal, WCAG
 *   1.4.1). Ab `xl` klebt sie links unter dem Rahmen, darunter steht sie oben als eine Zeile, die
 *   in sich rollt (`dokumentEntwurf.css`). Darüber optional eine Aktion der Seite
 *   (`gliederungKopf`).
 * - **Alle Abschnitte offen**, untereinander; der Editor wächst mit dem Inhalt (leer einzeilig,
 *   {@link EDITOR_ZEILEN}). Kopf mit Name (h3), Leer-Marke, Hilfetext und Aktion.
 * - **Lesefassung** aus den aktuellen Formularwerten, so wie gedruckt (`AbschnittsText`). Die
 *   Editoren bleiben dabei eingehängt (`hidden`): rc-field-form liefert beim Absenden nur
 *   eingehängte Felder, ein Speichern schickte sonst alle Abschnitte leer.
 * - **Druck** wie bisher: im Bearbeiten die Druckfassung je Editor (Titelblock LFH-1008), in der
 *   Lesefassung die Lesefassung; Bedienung weicht (`dokumentEntwurf.css`).
 *
 * TIPPLATENZ: der Baustein beobachtet das Formular nur über die Leer-Kette (`Form.useWatch` mit
 * Selektor) und rendert nur, wenn ein Abschnitt kippt; jeder Abschnitt ist `memo`. Tippen rendert
 * damit nur das eigene `Form.Item` (Messung `e2e/lagebericht-tippen.spec.ts`).
 */
export default function DokumentEntwurf({
  form,
  abschnitte,
  kopf,
  aktion,
  gliederungKopf,
  einstieg,
}: DokumentEntwurfProps) {
  const { token } = useRollen();
  const [ansicht, setAnsicht] = useState<Ansicht>('bearbeiten');
  const basis = useId();
  const bearbeitenId = `${basis}-bearbeiten`;
  const lesenId = `${basis}-lesen`;
  const anker = useCallback((schluessel: string) => `${basis}-b-${schluessel}`, [basis]);
  const leseAnker = useCallback((schluessel: string) => `${basis}-l-${schluessel}`, [basis]);

  const selektor = useCallback(
    (werte: Record<string, unknown> | undefined) => befuellungsKette(werte, abschnitte),
    [abschnitte],
  );
  const kette = (Form.useWatch(selektor, form) as string | undefined) ?? selektor(undefined);

  /**
   * Ein Tipp in der Gliederung: der Abschnitt rollt an den Anfang (den Rahmen hält
   * `scroll-padding-block-start` frei), im Bearbeiten bekommt das Feld den Fokus — ohne zweiten
   * Sprung, der den Kopf des Abschnitts wieder aus dem Bild schöbe.
   */
  const springen = useCallback(
    (schluessel: string) => {
      const lesen = ansicht === 'lesen';
      const ziel = document.getElementById(lesen ? leseAnker(schluessel) : anker(schluessel));
      ziel?.scrollIntoView?.({ block: 'start' });
      if (lesen) return;
      const feld = form.getFieldInstance(schluessel) as
        { focus?: (o?: FocusOptions & { cursor?: 'end' }) => void } | null | undefined;
      feld?.focus?.({ preventScroll: true, cursor: 'end' });
    },
    [ansicht, anker, leseAnker, form],
  );

  return (
    <div data-lfh="dokument-entwurf" className="dokument-entwurf">
      <Paneel
        titel="Entwurf"
        meta={fuellstandText(kette)}
        aktion={
          <Segmentleiste
            rolle="tablist"
            beschriftung="Ansicht des Entwurfs"
            optionen={[
              { wert: 'bearbeiten', label: 'Bearbeiten', steuert: bearbeitenId },
              { wert: 'lesen', label: 'Lesefassung', steuert: lesenId },
            ]}
            wert={ansicht}
            onWechsel={setAnsicht}
          />
        }
        koerperPolster
      >
        {kopf != null && (
          <div
            data-lfh="entwurf-kopf"
            className="dokument-entwurf__kopf"
            style={{ columnGap: token.margin }}
          >
            {kopf}
          </div>
        )}
        <div className="dokument-entwurf__koerper" style={{ gap: token.margin }}>
          <div className="dokument-entwurf__gliederung">
            {gliederungKopf != null && (
              <div data-lfh="gliederung-kopf" style={{ marginBottom: token.marginXS }}>
                {gliederungKopf}
              </div>
            )}
            <DokumentGliederung abschnitte={abschnitte} kette={kette} onSprung={springen} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div
              id={bearbeitenId}
              role="tabpanel"
              aria-label="Bearbeiten"
              data-lfh="entwurf-abschnitte"
              hidden={ansicht !== 'bearbeiten'}
            >
              {abschnitte.map((a, i) => (
                <AbschnittBlock
                  key={a.schluessel}
                  abschnitt={a}
                  leer={istLeer(kette, i)}
                  aktion={aktion}
                  anker={anker(a.schluessel)}
                />
              ))}
            </div>
            <div
              id={lesenId}
              role="tabpanel"
              aria-label="Lesefassung"
              data-lfh="entwurf-lesefassung"
              hidden={ansicht !== 'lesen'}
            >
              {ansicht === 'lesen' && (
                <Lesefassung form={form} abschnitte={abschnitte} anker={leseAnker} />
              )}
            </div>
          </div>
        </div>
      </Paneel>
      {/* Als letztes Kind: beim Mount-Effekt stehen alle Felder im DOM. */}
      <Einstiegsfokus form={form} feld={einstieg} />
    </div>
  );
}

/** Zeichen der Leer-Marke (Minus- oder Hakenkreis), dekorativ: das Wort „leer“ trägt die Aussage. */
function LeerZeichen({ leer }: { leer: boolean }) {
  const { token } = useRollen();
  return (
    <span aria-hidden style={{ color: leer ? token.colorTextSecondary : token.colorSuccess }}>
      {leer ? <IconMinusKreis /> : <IconHakenKreis />}
    </span>
  );
}

/** Leer-Marke im Abschnittskopf: Zeichen und Wort — Farbe ist nie der einzige Kanal. */
function LeerMarke() {
  const { token } = useRollen();
  return (
    <span
      data-lfh="leer-marke"
      style={{ display: 'inline-flex', alignItems: 'center', gap: token.marginXXS }}
    >
      <LeerZeichen leer />
      <Typography.Text type="secondary">leer</Typography.Text>
    </span>
  );
}

interface GliederungProps {
  abschnitte: readonly DokumentAbschnitt[];
  kette: string;
  onSprung: (schluessel: string) => void;
}

/** Sprungleiste der Abschnitte mit Leer-Marke; rendert nur, wenn ein Abschnitt kippt. */
const DokumentGliederung = memo(function DokumentGliederung({
  abschnitte,
  kette,
  onSprung,
}: GliederungProps) {
  const { token } = useRollen();
  return (
    <nav aria-label="Gliederung" data-lfh="gliederung">
      <ol className="dokument-entwurf__gliederungsliste" style={{ gap: token.marginXXS }}>
        {abschnitte.map((a, i) => {
          const leer = istLeer(kette, i);
          return (
            <li key={a.schluessel}>
              <Button
                type="text"
                className="dokument-entwurf__sprung"
                data-leer={leer || undefined}
                // Boden der Staffel auch dort, wo die Spalte ab `xl` die Höhe freigibt
                // (`height: auto` für umbrechende Namen, `dokumentEntwurf.css`).
                style={{ minHeight: token.controlHeight }}
                onClick={() => onSprung(a.schluessel)}
              >
                <LeerZeichen leer={leer} />
                {/* Das Leerzeichen steht im Inline-Fluss der Beschriftung, nicht zwischen den
                    Flex-Kindern des Knopfs: dort fiele es weg, und der Name hieße „Auftragleer“. */}
                <span>
                  {a.label}
                  {leer && (
                    <>
                      {' '}
                      <Typography.Text type="secondary">leer</Typography.Text>
                    </>
                  )}
                </span>
              </Button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
});

interface AbschnittBlockProps {
  abschnitt: DokumentAbschnitt;
  leer: boolean;
  aktion: AbschnittAktion | undefined;
  anker: string;
}

/**
 * Ein Abschnitt: Kopf (Name als h3, Leer-Marke, Hilfetext, Aktion) und der mitwachsende Editor.
 *
 * `memo` mit identitätsstabilen Props — die Seite rendert beim Tippen in Titel oder Zeitstand und
 * bei jedem Wechsel des Speicherstands neu; ohne Sperre liefen alle Editoren samt
 * `autoSize`-Nachmessung mit. Ein Verstoß fällt nicht auf, es wird nur langsam: Gate ist der
 * Render-Zähler in `DokumentEntwurf.test.tsx`.
 *
 * Das Feldetikett bleibt für die Label-Verknüpfung und steht nicht ein zweites Mal sichtbar da.
 * Auf Papier trägt der Titel der Druckfassung den Abschnitt (`druckTitel`, LFH-1008), der Kopf
 * weicht (`dokumentEntwurf.css`).
 */
const AbschnittBlock = memo(function AbschnittBlock({
  abschnitt: a,
  leer,
  aktion,
  anker,
}: AbschnittBlockProps) {
  const { token } = useRollen();
  const hilfeId = useId();
  const zusatz = aktion?.(a);
  return (
    // Ohne Namen: acht benannte `section` wären acht Landmarken „region“; die Gliederung trägt
    // das h3, das Feld seinen Namen über das Etikett.
    <section id={anker} data-lfh="entwurf-abschnitt" style={{ marginBottom: token.margin }}>
      <div data-lfh="abschnitt-kopf" style={{ marginBottom: token.marginXXS }}>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'baseline',
            columnGap: token.marginXS,
          }}
        >
          <Typography.Title level={3} style={{ fontSize: token.fontSizeHeading5, margin: 0 }}>
            {a.label}
          </Typography.Title>
          {leer && <LeerMarke />}
        </div>
        {a.hilfetext && (
          <Typography.Text type="secondary" id={hilfeId} style={{ display: 'block' }}>
            {a.hilfetext}
          </Typography.Text>
        )}
        {zusatz != null && zusatz !== false && (
          <div data-lfh="abschnitt-aktion" style={{ marginTop: token.marginXXS }}>
            {zusatz}
          </div>
        )}
      </div>
      <Form.Item
        name={a.schluessel}
        label={a.label}
        labelCol={{ style: { display: 'none' } }}
        style={{ marginBottom: 0 }}
      >
        <MarkdownEditor
          layout="toggle"
          umschalterAussen
          vorschauOffen={false}
          druckfassung
          druckTitel={a.label}
          // Unter dem Abschnittskopf (h3): `#` im Text wird h4.
          unterEbene={3}
          variante="dokument"
          autoSize={EDITOR_ZEILEN}
          aria-describedby={a.hilfetext ? hilfeId : undefined}
        />
      </Form.Item>
    </section>
  );
});

/** Die Lesefassung aus den aktuellen Formularwerten — nur eingehängt, solange sie gezeigt wird. */
function Lesefassung({
  form,
  abschnitte,
  anker,
}: {
  form: FormInstance;
  abschnitte: readonly DokumentAbschnitt[];
  anker: (schluessel: string) => string;
}) {
  const beobachtet = Form.useWatch([], form) as Record<string, unknown> | undefined;
  const werte = beobachtet ?? (form.getFieldsValue() as Record<string, unknown>);
  const texte = abschnitte.map((a) => {
    const t = werte?.[a.schluessel];
    return { schluessel: a.schluessel, text: typeof t === 'string' ? t : '' };
  });
  // Unter dem Paneel (h2): Abschnittstitel h3, `#` im Text h4 — wie im Bearbeiten.
  return <AbschnittsText gliederung={abschnitte} abschnitte={texte} unterEbene={2} anker={anker} />;
}
