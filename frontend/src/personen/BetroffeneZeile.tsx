import { Button, Input, type InputRef } from 'antd';
import { useId, useMemo, useRef, useState, type ReactNode, type Ref } from 'react';
import type { Uhs } from '../api/types';
import type { PersonAnlegenEingabe } from '../api/einsatzPerson';
import { fehlerText } from '../api/client';
import SichtungsTag from '../components/SichtungsTag';
import Tastenkuerzel from '../components/Tastenkuerzel';
import { useViewport } from '../components/useViewport';
import { Schnellerfassungszeile, monoStil, useRollen } from '../components/instrument';
import { loeseBefehl, loeseUhsAuf, parsePersonBefehl, type BefehlTeil } from './personBefehl';

/**
 * Die Betroffenen-Schnellerfassungszeile (Neuentwurf S7 „Das Formular wird zur Zeile").
 *
 * EINE Eingabe, die per Kürzel parst (`personen/personBefehl.ts`): „Kowalski, Anna w 34
 * sk3 @Weserstadion". Erkannte Teile stehen darunter als Marken — die Sichtung als
 * `SichtungsTag` (BBK-Kennzeichnung, LFH-455), nie als Designfarbe. Enter erfasst, das Feld
 * leert sich, der Fokus bleibt, die Quittung „Zuletzt: …" steht rechts daneben.
 *
 * ── WARUM NICHT `ErfassungsFormular` ────────────────────────────────────────────────────
 *
 * Die Erfassungs-Norm verlangt für MASKEN die Hülle aus `components/Erfassung.tsx`. Geprüft
 * und verworfen, an drei Stellen gemessen:
 *  1. Die Hülle rendert ihre Aktionsreihe SELBST — Trennlinie, „Erfassen"-Knopf, im
 *     Serienmodus Zähler und „Speichern und nächste". Unter einer Kommandozeile stünde
 *     damit eine zweite Knopfreihe; abschaltbar ist sie nicht.
 *  2. Sie fokussiert ihr erstes Feld beim MONTIEREN. Hier steht die Zeile dauerhaft über
 *     einer Liste: jeder Besuch der Seite zöge den Fokus aus der Liste — und am Handschirm
 *     die Bildschirmtastatur auf.
 *  3. Enter ohne Serienmodus leert UND ruft `onFertig` (schließen); die Zeile ist immer
 *     Serie. Das Serien-Kürzel Strg+Enter wäre hier ein zweiter Weg zum selben Ziel.
 *
 * Die Bauform folgt deshalb `components/SchnellAnlegen.tsx` — das Primitiv, das CLAUDE.md
 * für Ein-Feld-Erfassung nennt, und das aus demselben Grund KEIN `<form>` trägt (ein
 * verschachteltes Formular lädt beim Absenden die Seite neu). Dessen Hülle (Label über
 * dem Feld, `Space.Compact`) passt nicht in die Instrumenten-Zeile; übernommen sind seine
 * VIER Zusicherungen, jede mit Test:
 *  · Enter im Feld und der Knopf gehen durch DIESELBE Funktion, mit Riegel gegen doppeltes
 *    Absenden (`sendetRef` — ein gehaltenes Enter erreicht einen `loading`-Knopf nie).
 *  · `onErfassen` MUSS bei Ablehnung ablehnen; dann bleibt der Wortlaut stehen und der
 *    Fehler (400/422 mit Wortlaut des Servers) steht an der Zeile, nicht in einem Toast.
 *  · Geleert wird nur, wenn im Feld noch der abgeschickte Text steht — wer weitertippt,
 *    während der vorige Datensatz unterwegs ist, verliert nichts.
 *  · Der Fokus kehrt im nächsten Bild ins Feld zurück.
 *
 * Die Anlage selbst läuft über die OFFLINEFÄHIGE Mutation der Seite
 * (`erfassePersonOfflineFaehig`: `client_id`, Sichtung und `uhs_id` im SELBEN POST). Die
 * Zeile kennt keinen Transport.
 */

export interface BetroffeneZeileProps {
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
  const hinweiszeile = (
    <>
      <span
        id={hinweisId}
        style={{
          display: 'inline-flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          columnGap: token.padding,
          rowGap: token.marginXXS,
        }}
      >
        {leer ? (
          <>
            <span>
              Kürzel: <span style={{ color: rollen.gedaempft }}>Name, Vorname</span>
            </span>
            <span style={{ color: rollen.gedaempft }}>m/w/d + Alter</span>
            <span style={{ color: rollen.gedaempft }}>sk1–sk4 · skt · sku</span>
            <span style={{ color: rollen.gedaempft }}>@UHS</span>
          </>
        ) : (
          <span
            data-lfh="erkannt"
            style={{
              display: 'inline-flex',
              flexWrap: 'wrap',
              alignItems: 'center',
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
        // Füllt die Zeile neben dem Knopf; ohne `minWidth: 0` schrumpfte ein Flex-Kind
        // nicht unter seine Inhaltsbreite und drückte am Handschirm den Knopf hinaus.
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
