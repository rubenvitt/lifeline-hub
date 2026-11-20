import { Button, Input, type InputRef } from 'antd';
import { useId, useMemo, useRef, useState, type ReactNode, type Ref } from 'react';
import type { Uhs } from '../api/types';
import type { PersonAnlegenEingabe } from '../api/einsatzPerson';
import { fehlerText } from '../api/client';
import { PERSON_NAME_MAX } from '../api/eingabegrenzen';
import { Zeichenzaehler } from '../components/zeichenGrenze';
import SichtungsTag from '../components/SichtungsTag';
import { useViewport } from '../components/useViewport';
import { Schnellerfassungszeile, Textstufe, monoStil, useRollen } from '../components/instrument';
import { schrift, schriftskala } from '../theme/tokens';
import { formatKoordinate } from './koordinate';
import {
  ANLASS_KUERZEL,
  ENTLASSEN_KUERZEL,
  MASSNAHME_KUERZEL,
  SICHTUNG_BUCHSTABEN,
  SICHTUNG_FARBEN,
  loeseBefehl,
  loeseUhsAuf,
  parsePersonBefehl,
  type BefehlTeil,
} from './personBefehl';
import {
  ANLASS_REIHE,
  ANLASS_WORT,
  LEICHTE_MASSNAHMEN,
  MASSNAHME_WORT,
  SK_META,
} from './personMeta';

/** Aus dem Bild, nicht aus dem Baum: der Vorleser liest die Kürzel weiter als Feldbeschreibung. */
const NUR_VORLESER = {
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
} as const;

/**
 * Die Betroffenen-Schnellerfassungszeile: EINE Eingabe, die per Kürzel parst
 * (`personen/personBefehl.ts`), etwa „Kowalski, Anna w 34 sk3 @Weserstadion #52.2691/9.1342".
 * Erkannte Teile stehen darunter als Marken, die Sichtung als `SichtungsTag`. Enter erfasst,
 * das Feld leert sich, der Fokus bleibt, rechts steht die Quittung „Zuletzt: …".
 *
 * Nicht `ErfassungsFormular`: die Hülle rendert eine eigene Aktionsreihe (unter einer
 * Kommandozeile eine zweite Knopfreihe), fokussiert beim MONTIEREN (die Zeile steht dauerhaft
 * über der Liste; am Handschirm ginge jedes Mal die Tastatur auf) und schließt ohne
 * Serienmodus. Die Bauform folgt `components/SchnellAnlegen.tsx` (kein `<form>`) mit dessen
 * vier Zusicherungen, jede getestet:
 *  · Enter und Knopf gehen durch DIESELBE Funktion, mit Riegel `sendetRef`.
 *  · `onErfassen` MUSS bei Ablehnung ablehnen; dann bleibt der Wortlaut und der Fehler steht an
 *    der Zeile, nicht in einem Toast.
 *  · Geleert wird nur, wenn noch der abgeschickte Text im Feld steht.
 *  · Der Fokus kehrt im nächsten Bild ins Feld zurück.
 *
 * Die Anlage läuft über die offlinefähige Mutation der Seite (`client_id`, Sichtung, `uhs_id`
 * und Koordinate im SELBEN POST).
 */

interface BetroffeneZeileProps {
  uhsListe: readonly Uhs[];
  /** Anlegen. **Muss bei Ablehnung ablehnen** (`mutateAsync`). */
  onErfassen: (eingabe: PersonAnlegenEingabe) => Promise<unknown>;
  laeuft?: boolean;
  /** Quittung der letzten Erfassung („Zuletzt: 1419 R-048 Kowalski, Anna · SK III"). */
  zuletzt?: ReactNode;
  /** Zugriff auf das Feld (Kommandopalette, `?neu=1`). */
  feldRef?: Ref<InputRef>;
}

/** Der Grund eines unerkannten Wortblocks aus `parsePersonBefehl` (LLH-1767). */
const NICHT_VERSTANDEN = 'Nicht verstanden';

/**
 * Die Zeilen der Kürzel-Legende (LLH-1767): Zeichen und ausgeschriebene Bedeutung, die Listen
 * aus denselben Quellen wie der Parser (LFH-948).
 */
const LEGENDE: readonly { zeichen: string; bedeutung: string }[] = [
  { zeichen: 'Name, Vorname', bedeutung: 'Nachname zuerst · „unbekannt“ für ohne Namen' },
  { zeichen: 'm / w / d', bedeutung: 'Geschlecht, dahinter das Alter: w 34 · m ca 50' },
  {
    zeichen: SICHTUNG_FARBEN.map((f) => f.farbe).join(' · '),
    bedeutung: `Sichtung SK I–IV · auch sk1–sk4 · ${SICHTUNG_BUCHSTABEN.map(
      (k) => `${k.kuerzel} = ${SK_META[k.kategorie].label}`,
    ).join(' · ')}`,
  },
  {
    zeichen: '!',
    bedeutung: `Anlass: ${ANLASS_REIHE.map((a) => ANLASS_KUERZEL[a][0]).join(' · ')}`,
  },
  {
    zeichen: '+',
    bedeutung: `Maßnahme: ${LEICHTE_MASSNAHMEN.map((m) => MASSNAHME_KUERZEL[m][0]).join(' · ')}`,
  },
  { zeichen: `>${ENTLASSEN_KUERZEL[0]}`, bedeutung: 'versorgt und entlassen (braucht „!Anlass“)' },
  { zeichen: '#', bedeutung: 'Fundort: #52.2691/9.1342' },
  { zeichen: '@', bedeutung: 'Unfallhilfsstelle: @Weserstadion' },
];

function Marke({ teil, uhsListe }: { teil: BefehlTeil; uhsListe: readonly Uhs[] }) {
  const { rollen } = useRollen();
  switch (teil.art) {
    case 'name':
      // Zähler je Teil ab 80 % der Grenze (LLH-1329); darüber nennt die Zeile den Grund beim Senden.
      return (
        <Textstufe>
          {teil.name == null && teil.vorname == null ? 'unbekannt' : teil.text}
          {teil.name != null && <Zeichenzaehler wert={teil.name} max={PERSON_NAME_MAX} />}
          {teil.vorname != null && <Zeichenzaehler wert={teil.vorname} max={PERSON_NAME_MAX} />}
        </Textstufe>
      );
    case 'geschlecht':
    case 'alter':
      return <span style={{ ...monoStil('monoKlein'), color: rollen.gedaempft }}>{teil.text}</span>;
    case 'sichtung':
      return <SichtungsTag kategorie={teil.wert} style={{ marginInlineEnd: 0 }} />;
    case 'anlass':
      return <Textstufe title="Anlass">{ANLASS_WORT[teil.wert]}</Textstufe>;
    case 'massnahme':
      return <Textstufe title="Maßnahme">+ {MASSNAHME_WORT[teil.wert]}</Textstufe>;
    case 'entlassen':
      return (
        <span style={{ ...monoStil('monoKlein'), color: rollen.bedien }} title="Verbleib">
          → entlassen
        </span>
      );
    case 'uhs': {
      const a = loeseUhsAuf(teil.suche, uhsListe);
      return 'uhs' in a ? (
        <span style={{ ...monoStil('monoKlein'), color: rollen.bedien }}>
          → UHS {a.uhs.bezeichnung}
        </span>
      ) : (
        <span style={{ ...monoStil('monoKlein'), color: rollen.alarmText }} title={a.problem}>
          {teil.text} ?
        </span>
      );
    }
    case 'koordinate':
      return (
        <span
          style={{ ...monoStil('monoKlein'), color: rollen.gedaempft }}
          title="Fundort-Koordinate"
        >
          #{formatKoordinate(teil.lat, teil.lon)}
        </span>
      );
    case 'unerkannt':
      // Ein nicht verstandener Wortblock (LLH-1767) ist keine verworfene Angabe, sondern eine
      // Frage an den Schreiber: Wellenlinie und „?“ statt Durchstreichen.
      if (teil.grund === NICHT_VERSTANDEN) {
        return (
          <span
            style={{
              ...monoStil('monoKlein'),
              color: rollen.alarmText,
              textDecoration: 'underline wavy',
            }}
            title={teil.grund}
          >
            {teil.text} ?
          </span>
        );
      }
      return (
        <span
          style={{
            ...monoStil('monoKlein'),
            color: rollen.alarmText,
            textDecoration: 'line-through',
          }}
          title={teil.grund}
        >
          {teil.text}
        </span>
      );
  }
}

export default function BetroffeneZeile({
  uhsListe,
  onErfassen,
  laeuft = false,
  zuletzt,
  feldRef,
}: BetroffeneZeileProps) {
  const { token, rollen } = useRollen();
  const { istSchmal } = useViewport();
  const erkanntId = useId();
  const kuerzelId = useId();
  const eigenesFeld = useRef<InputRef>(null);
  const sendetRef = useRef(false);
  const [text, setText] = useState('');
  /** Kürzel-Hinweis unter `md` aufgeklappt? Ab `md` steht er, solange das Feld den Fokus hat. */
  const [kuerzelOffen, setKuerzelOffen] = useState(false);
  /** Fokus im Feld: ab `md` zeigt nur er die Kürzel (LFH-1078, zeigen statt erklären). */
  const [fokus, setFokus] = useState(false);
  /** Fehler des letzten Absende-Versuchs (Prüfung ODER Server) — steht bis zur nächsten Eingabe. */
  const [versuchFehler, setVersuchFehler] = useState<string[] | null>(null);
  /** Enter auf dem leeren Feld (LLH-1767): leise sagen, dass nichts da ist, statt still zu bleiben. */
  const [leerVersuch, setLeerVersuch] = useState(false);

  const befehl = useMemo(() => parsePersonBefehl(text), [text]);
  const ergebnis = useMemo(() => loeseBefehl(befehl, uhsListe), [befehl, uhsListe]);

  const setzeFeld = (el: InputRef | null) => {
    eigenesFeld.current = el;
    if (typeof feldRef === 'function') feldRef(el);
    else if (feldRef) (feldRef as { current: InputRef | null }).current = el;
  };

  async function senden() {
    if (sendetRef.current || laeuft) return;
    if (!ergebnis.ok) {
      // Leere Eingabe: leiser Hinweis, kein Fehlerton (LLH-1767). Mit Problemen: sagen, warum nicht.
      if (befehl.leer) setLeerVersuch(true);
      else if (ergebnis.probleme.length > 0) setVersuchFehler(ergebnis.probleme);
      return;
    }
    sendetRef.current = true;
    const abgeschickt = text;
    try {
      await onErfassen(ergebnis.eingabe);
    } catch (e) {
      setVersuchFehler([fehlerText(e, 'Erfassen fehlgeschlagen')]);
      return;
    } finally {
      sendetRef.current = false;
    }
    setVersuchFehler(null);
    setText((aktuell) => (aktuell === abgeschickt ? '' : aktuell));
    requestAnimationFrame(() => eigenesFeld.current?.focus());
  }

  const leer = befehl.leer;
  // Die Legende (LLH-1767) ist ein Raster in Lauftextgröße. Unter `md` steht sie nur aufgeklappt
  // da, im Fluss (LFH-963, design.md D6). Ab `md` liegt sie bei Fokus auf dem LEEREN Feld als
  // Schicht unter der Zeile (LFH-1078: sonst reichen Platzhalter und „erkannt:“-Marken): drei, vier
  // Zeilen im Fluss schöben die Liste dauerhaft nach unten. Sonst bleibt sie für Vorlesende im
  // Baum, als Beschreibung des Felds.
  const legendeLage: 'vorleser' | 'fluss' | 'schicht' = istSchmal
    ? kuerzelOffen
      ? 'fluss'
      : 'vorleser'
    : fokus && leer
      ? 'schicht'
      : 'vorleser';
  const raster = {
    display: 'grid',
    // Am Handschirm Zeichen über Bedeutung: neben „rot · gelb · grün · blau“ bliebe der Bedeutung
    // kaum ein Drittel der Breite.
    gridTemplateColumns: istSchmal ? 'minmax(0, 1fr)' : 'max-content minmax(0, 1fr)',
    columnGap: token.padding,
    rowGap: token.marginXXS,
    margin: 0,
    fontFamily: schrift.text,
    fontSize: schriftskala.text.groesse,
    color: rollen.text,
  } as const;
  const legendeStil =
    legendeLage === 'vorleser'
      ? NUR_VORLESER
      : legendeLage === 'fluss'
        ? { ...raster, flexBasis: '100%' }
        : {
            ...raster,
            position: 'absolute',
            top: '100%',
            insetInlineStart: 0,
            // Über Tabellenkopf und Zeilen der Liste, unter dem Eingangsband (`zIndexPopupBase - 1`)
            // und allen Klappflächen.
            zIndex: token.zIndexPopupBase - 2,
            width: 'max-content',
            maxWidth: 'min(720px, calc(100vw - 32px))',
            marginBlockStart: token.marginXXS,
            padding: `${token.paddingXS}px ${token.paddingSM}px`,
            background: rollen.flaeche2,
            border: `1px solid ${rollen.linie}`,
          };
  // Legende (bzw. unter `md` ihr Knopf) und „erkannt: …" liegen GESTAPELT in derselben
  // Rasterzelle: die Ebene bleibt im Baum und wird nur unsichtbar, die Zeile behält also ihre Höhe
  // (sonst sprang bei 390 px der Inhalt darunter beim ersten Zeichen). Ab `md` hält `minBlockSize`
  // die eine Zeile, die „erkannt:“ braucht. Das Feld beschreibt sich je nach Lage mit der Legende
  // oder mit „erkannt: …“, nie mit beidem und nie mit dem Knopf.
  const stapel = { gridArea: '1 / 1' } as const;
  const hinweiszeile = (
    <>
      <span
        style={{ display: 'inline-grid', minWidth: 0, position: 'relative', minBlockSize: '1lh' }}
      >
        <span
          aria-hidden={leer ? undefined : true}
          style={{
            ...stapel,
            display: 'inline-flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            columnGap: token.padding,
            rowGap: token.marginXXS,
            visibility: leer ? 'visible' : 'hidden',
          }}
        >
          {/* In der Ebene des leeren Felds, ÜBER der Legenden-Schicht (die sonst den Hinweis
              verdeckte). Immer im Baum, damit Vorlesende die Meldung beim Erscheinen hören. */}
          <span role="status" style={leerVersuch ? undefined : NUR_VORLESER}>
            {leerVersuch ? 'Noch nichts eingegeben' : ''}
          </span>
          <dl id={kuerzelId} data-lfh="kuerzel" aria-label="Kürzel" style={legendeStil}>
            {LEGENDE.map((z) => (
              <div key={z.zeichen} style={{ display: 'contents' }}>
                <dt style={{ ...monoStil('mono'), color: rollen.bedien }}>{z.zeichen}</dt>{' '}
                <dd style={{ margin: 0, marginBlockEnd: istSchmal ? token.marginXS : 0 }}>
                  {z.bedeutung}
                </dd>
              </div>
            ))}
          </dl>
          {/* EIN Knopf für beide Richtungen: er bleibt beim Umschalten derselbe Knoten, der Fokus
              bleibt auf ihm. Beim Tippen unsichtbar wie die Ebene, seine Höhe bleibt stehen. */}
          {istSchmal && (
            <Button
              type="link"
              aria-expanded={kuerzelOffen}
              aria-controls={kuerzelId}
              onClick={() => setKuerzelOffen((offen) => !offen)}
              style={{ paddingInline: 0 }}
            >
              {kuerzelOffen ? 'Kürzel ausblenden' : 'Kürzel anzeigen'}
            </Button>
          )}
        </span>
        {!leer && (
          <span
            id={erkanntId}
            data-lfh="erkannt"
            style={{
              ...stapel,
              display: 'inline-flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              alignSelf: 'start',
              gap: token.marginXS,
            }}
          >
            <span>erkannt:</span>
            {befehl.teile.map((t, i) => (
              <Marke key={`${t.art}-${i}`} teil={t} uhsListe={uhsListe} />
            ))}
          </span>
        )}
      </span>
      {zuletzt != null && (
        <span data-lfh="zuletzt" style={{ marginInlineStart: 'auto', color: rollen.gedaempft }}>
          {zuletzt}
        </span>
      )}
      {versuchFehler && versuchFehler.length > 0 && (
        <span role="alert" style={{ flexBasis: '100%', color: rollen.alarmText }}>
          Nicht erfasst: {versuchFehler.join(' · ')}
        </span>
      )}
    </>
  );

  return (
    // `feldFuellt` lässt das Feld wachsen und unter seine Inhaltsbreite schrumpfen (sonst drückte es
    // am Handschirm den Knopf hinaus); der Knopf hält sich mit `flex: 0 0 auto` heraus.
    <Schnellerfassungszeile praefix="/person" hinweiszeile={hinweiszeile} feldFuellt>
      <Input
        ref={setzeFeld}
        value={text}
        aria-label="Kurzeingabe Person"
        aria-describedby={leer ? kuerzelId : erkanntId}
        placeholder="Kowalski, Anna w 34 sk3"
        enterKeyHint="send"
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => {
          setText(e.target.value);
          setVersuchFehler(null);
          setLeerVersuch(false);
        }}
        onPressEnter={() => void senden()}
        onFocus={() => setFokus(true)}
        onBlur={() => setFokus(false)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && text !== '') {
            e.stopPropagation();
            setText('');
            setVersuchFehler(null);
          }
        }}
      />
      <Button
        type="primary"
        loading={laeuft}
        onClick={() => void senden()}
        style={{ marginInline: token.marginXS, flex: '0 0 auto' }}
      >
        Person erfassen
      </Button>
    </Schnellerfassungszeile>
  );
}
