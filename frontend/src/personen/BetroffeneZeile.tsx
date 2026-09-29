import { Button, Input, type InputRef } from 'antd';
import { useId, useMemo, useRef, useState, type ReactNode, type Ref } from 'react';
import type { Uhs } from '../api/types';
import type { PersonAnlegenEingabe } from '../api/einsatzPerson';
import { fehlerText } from '../api/client';
import SichtungsTag from '../components/SichtungsTag';
import Tastenkuerzel from '../components/Tastenkuerzel';
import { useViewport } from '../components/useViewport';
import { Schnellerfassungszeile, monoStil, useRollen } from '../components/instrument';
import { formatKoordinate } from './koordinate';
import { loeseBefehl, loeseUhsAuf, parsePersonBefehl, type BefehlTeil } from './personBefehl';

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
  /** Quittung der letzten Erfassung („Zuletzt: 14:19 R-048 Kowalski, Anna · SK III"). */
  zuletzt?: ReactNode;
  /** Zugriff auf das Feld (Kommandopalette, `?neu=1`). */
  feldRef?: Ref<InputRef>;
}

function Marke({ teil, uhsListe }: { teil: BefehlTeil; uhsListe: readonly Uhs[] }) {
  const { rollen } = useRollen();
  switch (teil.art) {
    case 'name':
      return (
        <span style={{ fontSize: 13, color: rollen.text }}>
          {teil.name == null && teil.vorname == null ? 'unbekannt' : teil.text}
        </span>
      );
    case 'geschlecht':
    case 'alter':
      return <span style={{ ...monoStil(12), color: rollen.gedaempft }}>{teil.text}</span>;
    case 'sichtung':
      return <SichtungsTag kategorie={teil.wert} style={{ marginInlineEnd: 0 }} />;
    case 'uhs': {
      const a = loeseUhsAuf(teil.suche, uhsListe);
      return 'uhs' in a ? (
        <span style={{ ...monoStil(12), color: rollen.bedien }}>→ UHS {a.uhs.bezeichnung}</span>
      ) : (
        <span style={{ ...monoStil(12), color: rollen.alarmText }} title={a.problem}>
          {teil.text} ?
        </span>
      );
    }
    case 'koordinate':
      return (
        <span style={{ ...monoStil(12), color: rollen.gedaempft }} title="Fundort-Koordinate">
          #{formatKoordinate(teil.lat, teil.lon)}
        </span>
      );
    case 'unerkannt':
      return (
        <span
          style={{ ...monoStil(12), color: rollen.alarmText, textDecoration: 'line-through' }}
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
  const hinweisId = useId();
  const eigenesFeld = useRef<InputRef>(null);
  const sendetRef = useRef(false);
  const [text, setText] = useState('');
  /** Fehler des letzten Absende-Versuchs (Prüfung ODER Server) — steht bis zur nächsten Eingabe. */
  const [versuchFehler, setVersuchFehler] = useState<string[] | null>(null);

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
      // Leere Eingabe: nichts tun, kein Fehlerton. Mit Problemen: sagen, warum nicht.
      if (ergebnis.probleme.length > 0) setVersuchFehler(ergebnis.probleme);
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
  // Kürzel-Hinweis und „erkannt: …" liegen GESTAPELT in derselben Rasterzelle: der Hinweis bleibt
  // im Baum und wird nur unsichtbar, die Zeile behält also ihre Höhe (sonst sprang bei 390 px
  // der Inhalt darunter beim ersten Zeichen). `visibility: hidden` nimmt ihn zugleich aus
  // `aria-describedby`.
  const stapel = { gridArea: '1 / 1' } as const;
  const hinweiszeile = (
    <>
      <span id={hinweisId} style={{ display: 'inline-grid', minWidth: 0 }}>
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
          <span>
            Kürzel: <span style={{ color: rollen.gedaempft }}>Name, Vorname</span>
          </span>
          <span style={{ color: rollen.gedaempft }}>m/w/d + Alter</span>
          <span style={{ color: rollen.gedaempft }}>sk1–sk4 · skt · sku</span>
          {/* Das Format zeigt der Platzhalter nicht, also hier. */}
          <span style={{ color: rollen.gedaempft }}>#Koordinate (52.2691/9.1342)</span>
          <span style={{ color: rollen.gedaempft }}>@UHS</span>
        </span>
        {!leer && (
          <span
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
    <Schnellerfassungszeile
      praefix="/person"
      hinweis={
        istSchmal ? undefined : (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: token.marginXXS }}>
            <Tastenkuerzel aria-hidden>↵</Tastenkuerzel> erfassen &amp; nächste
          </span>
        )
      }
      hinweiszeile={hinweiszeile}
    >
      <Input
        ref={setzeFeld}
        value={text}
        aria-label="Kurzeingabe Person"
        aria-describedby={hinweisId}
        placeholder="Kowalski, Anna w 34 sk3"
        enterKeyHint="send"
        // Ohne `minWidth: 0` schrumpfte das Flex-Kind nicht unter seine Inhaltsbreite und drückte am
        // Handschirm den Knopf hinaus.
        style={{ flex: '1 1 auto', minWidth: 0 }}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => {
          setText(e.target.value);
          setVersuchFehler(null);
        }}
        onPressEnter={() => void senden()}
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
