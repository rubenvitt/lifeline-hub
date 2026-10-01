import { IkoneStift } from '../ikonen';
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Button, Space } from 'antd';
import { useRollen } from './instrument/rollenwerte';
import { wertKnopfStil } from './BemerkungZelle';
import { SpeicherFehler } from './SpeicherHinweis';
import { useFokusRueckgabe } from './useFokusRueckgabe';

/**
 * Inline bearbeitbare Angabe mit BELIEBIGER Eingabe (LFH-472) — Text, Textfeld, Zahl, Auswahl,
 * Datum/Uhrzeit —, optional als Pflichtangabe.
 *
 * ── ABGRENZUNG ZU `BemerkungZelle` ─────────────────────────────────────────────────────
 *
 * `BemerkungZelle` (LFH-369) trägt optionale Freitexte in Listen und steht auf antds
 * `Typography.Text editable`, das nur Text kann. Hier braucht es DatePicker, Select und
 * InputNumber und eine Pflichtangabe, die leer abgelehnt wird. Gemeinsam sind die Anzeige (Wert
 * als Knopf, `wertKnopfStil`, Platzhalter in `bedienText`) und die Fokusrückgabe
 * (`useFokusRueckgabe`) — beide aus EINER Quelle, nicht kopiert.
 *
 * ── DIE REGELN AUS LFH-369, HIER WEITER GÜLTIG ─────────────────────────────────────────
 *
 * - **Der Auslöser nennt die Angabe** („Leitstellen-Nr. bearbeiten"); der Wert ist die
 *   Beschreibung (`aria-describedby`), kein `aria-label`, das den Inhalt verdeckte.
 * - **Ohne Schreibrecht keine Aufforderung**: nur der Wert, leer als „—".
 * - **Fokus fällt nicht auf `<body>`**, auch wenn der neue Wert erst eine Runde später kommt.
 * - Die `keyCode`-Falle von antds `Editable` gilt NICHT: hier sendet das native `<form>` (Enter),
 *   Escape läuft über `key`.
 *
 * ── WAS BEWUSST FEHLT ──────────────────────────────────────────────────────────────────
 *
 * **Kein Speichern beim Verlassen (Blur).** DatePicker und Select öffnen Portale; ein Klick
 * darin verlässt die Eingabe, und ein Blur-Speichern schriebe einen halben Zeitpunkt. Gespeichert
 * wird nur ausdrücklich: Enter, Strg/⌘+Enter im Textfeld, oder „Speichern".
 */

/** Was die Eingabe zum Einhängen bekommt. `feld` ist unverändert auf das antd-Element spreizbar. */
export interface InlineEingabe<T> {
  feld: { id: string; 'aria-label': string; autoFocus: true };
  value: T;
  onChange: (wert: T) => void;
  /**
   * Nur für Eingaben mit Popup (DatePicker, Select, AutoComplete) auf das Element spreizen. Damit
   * schließt Escape zuerst das Popup und verwirft erst beim nächsten Mal die Zeile.
   */
  popup: { onOpenChange: (offen: boolean) => void };
}

export interface InlineAngabeProps<T> {
  /** Name der Angabe — Etikett der Eingabe und Kern jedes zugänglichen Namens. */
  etikett: string;
  /** Gespeicherter Wert (Serverstand), Ausgangspunkt jeder Bearbeitung. */
  wert: T;
  /** Darstellung des gefüllten Werts. Ein leerer Wert zeigt stattdessen die Aufforderung bzw. „—". */
  anzeige: ReactNode;
  leer: (wert: T) => boolean;
  /** Wertgleichheit für den Riegel „unverändert → kein Senden". Vorgabe `Object.is`. */
  gleich?: (a: T, b: T) => boolean;
  darfSchreiben: boolean;
  /** Leer wird abgelehnt: kein Senden, alter Wert, Hinweis an der Zeile. */
  pflicht?: boolean;
  /** Enter bleibt Zeilenumbruch; gesendet wird mit Strg/⌘+Enter. */
  mehrzeilig?: boolean;
  eingabe: (p: InlineEingabe<T>) => ReactNode;
  /**
   * Übernahme. Lehnt bei Ablehnung ab (`mutateAsync`) — dann bleibt die Eingabe mit dem Entwurf
   * offen und der Fehler steht an der Zeile. Erfüllt erst, wenn der neue Wert im Cache steht.
   */
  onSpeichern: (wert: T) => Promise<unknown>;
}

export function InlineAngabe<T>({
  etikett,
  wert,
  anzeige,
  leer,
  gleich = Object.is,
  darfSchreiben,
  pflicht = false,
  mehrzeilig = false,
  eingabe,
  onSpeichern,
}: InlineAngabeProps<T>) {
  const [bearbeitet, setBearbeitet] = useState(false);
  const [entwurf, setEntwurf] = useState<T>(wert);
  const [sendet, setSendet] = useState(false);
  const [fehler, setFehler] = useState<unknown>(null);
  const [pflichtHinweis, setPflichtHinweis] = useState(false);
  // Riegel in der Absende-Funktion, nicht am Knopf: Enter und ein zweiter Klick liefen sonst an
  // `loading` vorbei, bevor React neu gerendert hat.
  const sendetRef = useRef(false);
  // Offen-Zustand des Eingabe-Popups. Gelesen in der CAPTURE-Phase: rc-picker schließt sein Popup
  // beim Escape im eigenen keydown (vor dem Bubbling ans `<form>`) und meldet `onOpenChange(false)`
  // dabei schon — in der Bubble-Phase stünde hier bereits „zu".
  const popupOffenRef = useRef(false);
  const escSchliesstPopup = useRef(false);
  const knopfRef = useFokusRueckgabe(bearbeitet);
  const { token, rollen } = useRollen();
  const wertId = useId();
  const feldId = useId();

  if (!darfSchreiben) return <>{leer(wert) ? '—' : anzeige}</>;

  function oeffnen() {
    setEntwurf(wert);
    setFehler(null);
    setPflichtHinweis(false);
    setBearbeitet(true);
  }

  function schliessen() {
    popupOffenRef.current = false;
    setFehler(null);
    setBearbeitet(false);
  }

  async function abschicken() {
    if (sendetRef.current) return;
    if (pflicht && leer(entwurf)) {
      setPflichtHinweis(true);
      schliessen();
      return;
    }
    if (gleich(entwurf, wert)) {
      schliessen();
      return;
    }
    sendetRef.current = true;
    setSendet(true);
    setFehler(null);
    try {
      await onSpeichern(entwurf);
      schliessen();
    } catch (e) {
      setFehler(e);
    } finally {
      sendetRef.current = false;
      setSendet(false);
    }
  }

  function tastenVorab(e: KeyboardEvent<HTMLFormElement>) {
    // Auswahl/Autovervollständigung melden ihr Popup zusätzlich am Feld; das deckt Eingaben ab,
    // deren Aufrufer `popup` nicht verdrahtet.
    const amFeld = e.target instanceof Element && e.target.getAttribute('aria-expanded') === 'true';
    escSchliesstPopup.current = e.key === 'Escape' && (popupOffenRef.current || amFeld);
  }

  function tasten(e: KeyboardEvent<HTMLFormElement>) {
    if (e.key === 'Escape') {
      // Ein offenes Popup der Eingabe schließt zuerst allein; erst das nächste Escape verwirft die
      // Zeile. Keine der antd-Eingaben ruft dabei `preventDefault` (pages/lagekarte/AGENTS.md, LFH-712).
      if (escSchliesstPopup.current) return;
      e.preventDefault();
      schliessen();
    } else if (mehrzeilig && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void abschicken();
    }
  }

  if (bearbeitet) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void abschicken();
        }}
        onKeyDownCapture={tastenVorab}
        onKeyDown={tasten}
        style={{ display: 'flex', flexDirection: 'column', gap: token.marginXS, minWidth: 0 }}
      >
        {eingabe({
          feld: { id: feldId, 'aria-label': etikett, autoFocus: true },
          value: entwurf,
          onChange: setEntwurf,
          popup: {
            onOpenChange: (offen) => {
              popupOffenRef.current = offen;
            },
          },
        })}
        <SpeicherFehler fehler={fehler} />
        <Space wrap>
          <Button
            type="primary"
            htmlType="submit"
            loading={sendet}
            aria-label={`${etikett} speichern`}
          >
            Speichern
          </Button>
          <Button
            disabled={sendet}
            aria-label={`Bearbeitung von ${etikett} abbrechen`}
            onClick={schliessen}
          >
            Abbrechen
          </Button>
        </Space>
      </form>
    );
  }

  const hinweis = pflichtHinweis ? (
    <div data-fehler role="status" style={{ color: rollen.alarmText }}>
      {`${etikett} ist eine Pflichtangabe — der bisherige Wert bleibt.`}
    </div>
  ) : null;

  if (leer(wert)) {
    return (
      <>
        <Button
          ref={knopfRef}
          type="link"
          // `bedienText`, die Rolle für blauen TEXT; seit LFH-652 wertgleich mit antds `colorLink`.
          style={{ color: rollen.bedienText, paddingInline: 0 }}
          onClick={oeffnen}
        >
          {`${etikett} eintragen`}
        </Button>
        {hinweis}
      </>
    );
  }

  return (
    <>
      <Button
        ref={knopfRef}
        type="text"
        aria-label={`${etikett} bearbeiten`}
        aria-describedby={wertId}
        style={{
          ...wertKnopfStil(token),
          color: 'inherit',
          font: 'inherit',
          marginInline: -token.paddingSM,
        }}
        onClick={oeffnen}
      >
        <span id={wertId}>{anzeige}</span>
        {/* Ikone ohne eigenes Vorleseziel (frontend/AGENTS.md, „Ein Emoji ist keine Ikone"). */}
        <span aria-hidden="true" style={{ color: token.colorTextSecondary }}>
          <IkoneStift />
        </span>
      </Button>
      {hinweis}
    </>
  );
}
