import { Button, Modal, type ModalProps } from 'antd';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { useBlocker } from 'react-router';
import { istSitzungGesperrt } from '../auth/sitzungsSperre';
import { SpeicherFehler } from './SpeicherHinweis';
import Knopfreihe from './instrument/Knopfreihe';
import { MASKE_HAELT_FOKUS } from './maskeHaeltFokus';
import Stapel from './instrument/Stapel';

interface Props {
  /** Merker der Seite: offene, nicht gespeicherte Änderungen. */
  ungespeichert: boolean;
  /**
   * Nur Entwürfe (`entwurf/EntwurfNavigationSchutz.tsx`): bietet „Speichern und weiter" an.
   * Formularseiten lassen es weg (LFH-979, design.md D3): Prüffehler und Rückfragen ihres
   * Speicherns stünden hinter der Maske dieses Dialogs.
   */
  speichern?: () => Promise<void>;
  speichert?: boolean;
  /** Grund eines gescheiterten „Speichern und weiter". */
  speicherFehler?: unknown;
}

/**
 * Rückfrage vor dem Verlassen einer Seite mit ungespeicherten Änderungen (LFH-979). Hält jeden
 * Wechsel auf einen ANDEREN Pfad an (Seitenmenü, Segmentleiste, Brotkrume); Suchparameter und
 * Hash bleiben frei. Braucht einen Data Router (`useBlocker`) — in Tests
 * `renderMitProviders(…, { datenRouter: true })`. Die Warnung beim Schließen des Tabs trägt der
 * Merker (`useFormularVerlassenSchutz`, `useEntwurfVerlustschutz`), nicht dieser Dialog. Ein
 * Wechsel IN der Seite (Segmentleiste ohne Pfad, Reiter) fragt über
 * `useWechselNachRueckfrage` (`components/offeneBearbeitung.tsx`, LLH-1415) mit demselben
 * `VerlassenDialog`.
 *
 * Der Grund eines gescheiterten Speicherns steht IM Dialog: der Modal trägt
 * `mask={{ closable: false }}`, ein Seiten-Alert dahinter wäre unsichtbar.
 */
export default function VerlassenRueckfrage({
  ungespeichert,
  speichern,
  speichert = false,
  speicherFehler,
}: Props) {
  // Steht der Dialog „Sitzung beendet“ (LLH-1770), fragt sie nicht: der Weg zur Anmeldeseite
  // (Frist, „Abmelden“) bliebe sonst unsichtbar unter der Abdeckung hängen. Die Sperre steht
  // genau so lange wie die Unterbrechung (`AuthContext`, `setzeUnterbrechung`); sie wird beim
  // Navigieren gelesen, nicht beim Rendern, und braucht deshalb keinen Auth-Kontext.
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      ungespeichert && !istSitzungGesperrt() && currentLocation.pathname !== nextLocation.pathname,
  );

  useEffect(() => {
    // Ein Speichern kann die Rückfrage erledigen, während sie offen steht. Nur den noch
    // angehaltenen Wechsel nachholen: nach „Bleiben" ist der Blocker bereits reset.
    if (blocker.state === 'blocked' && !ungespeichert) blocker.proceed();
  }, [blocker, ungespeichert]);

  return (
    <VerlassenDialog
      offen={blocker.state === 'blocked' && ungespeichert}
      onBleiben={() => {
        if (blocker.state === 'blocked') blocker.reset();
      }}
      onVerwerfen={() => {
        if (blocker.state === 'blocked') blocker.proceed();
      }}
      speichern={speichern}
      speichert={speichert}
      speicherFehler={speicherFehler}
    />
  );
}

/**
 * Der Dialog der Rückfrage ohne Router: „Bleiben“/„Verwerfen“, Wortlaut für jeden Wechsel gleich,
 * ob Pfad (`VerlassenRueckfrage`) oder Segment in der Seite (`useWechselNachRueckfrage`).
 */
export function VerlassenDialog({
  offen,
  onBleiben,
  onVerwerfen,
  speichern,
  speichert = false,
  speicherFehler,
}: Omit<Props, 'ungespeichert'> & {
  offen: boolean;
  onBleiben: () => void;
  onVerwerfen: () => void;
}) {
  return (
    <Modal
      title="Ungespeicherte Änderungen"
      open={offen}
      onCancel={onBleiben}
      mask={{ closable: false }}
      footer={
        <Stapel richtung="zeile" umbruch abstand="md" verteilen="between">
          <Button danger onClick={onVerwerfen}>
            Verwerfen
          </Button>
          <Stapel richtung="zeile" umbruch abstand="sm">
            <Button type={speichern ? 'default' : 'primary'} onClick={onBleiben}>
              Bleiben
            </Button>
            {speichern && (
              <Button type="primary" loading={speichert} onClick={() => void speichern()}>
                Speichern und weiter
              </Button>
            )}
          </Stapel>
        </Stapel>
      }
    >
      <Stapel abstand="sm">
        <span>Noch nicht gespeicherte Änderungen gehen beim Verlassen verloren.</span>
        <SpeicherFehler fehler={speicherFehler} />
      </Stapel>
    </Modal>
  );
}

/**
 * Rückfrage vor dem Verwerfen geänderter Eingaben eines Erfassungsdialogs (LLH-1755,
 * `frontend/AGENTS.md`, „Erfassungs-Norm“). Dieselbe Form wie {@link VerlassenDialog}, eigener
 * Wortlaut: „beim Verlassen“ passt nicht, wenn nur ein Dialog schließt. Escape und Kreuz heißen
 * „Weiter bearbeiten“, die Maske schließt nicht; der Fokus steht auf „Weiter bearbeiten“.
 *
 * **Der Fokus beim Öffnen** (LLH-2013): `autoFocus` allein trägt im Browser nicht. antd ließe den
 * Inhalt nach dem Schließen eingehängt, und React fokussiert nur beim Einhängen; ab dem zweiten
 * Öffnen setzte rc-dialog den Fokus nach der Einblendung auf den Rahmen, Enter tat nichts. Deshalb
 * `destroyOnHidden`. Und rc-dialogs Fokusfalle (`useLockFocus`) zieht ihn gleich nach dem
 * `autoFocus` weg: erst die des Dialogs dahinter auf dessen Kreuz, dann die der Rückfrage auf ihr
 * erstes fokussierbares Element, ihr Kreuz. Bis die Einblendung endet oder die Person selbst eine
 * Taste oder den Zeiger benutzt, holt die Rückfrage jeden solchen Fokus deshalb auf „Weiter
 * bearbeiten“ zurück. jsdom kennt die Falle nicht; den Browser hält
 * `e2e/dialog-rueckfrage.spec.ts` fest.
 */
export function VerwerfenDialog({
  offen,
  titel,
  onWeiter,
  onVerwerfen,
}: {
  offen: boolean;
  /** Titel des Erfassungsdialogs; nur als Text wird er genannt. */
  titel?: ReactNode;
  onWeiter: () => void;
  onVerwerfen: () => void;
}) {
  const weiterRef = useRef<HTMLButtonElement>(null);
  // Die Einblendung, in der die Fokusfallen noch ziehen: vom Öffnen bis `afterOpenChange` oder
  // bis die Person selbst eine Taste oder den Zeiger benutzt.
  const oeffnet = useRef(false);
  const fokusZurueck = () => weiterRef.current?.focus({ preventScroll: true });
  useLayoutEffect(() => {
    oeffnet.current = offen;
  }, [offen]);

  return (
    <Modal
      title="Eingaben verwerfen?"
      open={offen}
      // Mittig, damit sie den Kopf des Erfassungsdialogs nicht verdeckt.
      centered
      onCancel={onWeiter}
      destroyOnHidden
      // rc-dialog setzt den Fokus am Ende der Einblendung noch auf den Rahmen, falls er außerhalb
      // steht; `onFocus` unten holt ihn zurück, danach endet die Einblendung.
      afterOpenChange={(geoeffnet) => {
        if (geoeffnet) oeffnet.current = false;
      }}
      mask={{ closable: false }}
      // antd hört Escape global: dasselbe Escape, das die Rückfrage öffnet, schlösse sie sofort
      // wieder. Escape gilt deshalb am Rahmen der Rückfrage, wo immer der Fokus darin steht. Keine
      // Taste läuft weiter: die Rückfrage hängt im React-Baum unter dem Erfassungsformular, dessen
      // Strg/⌘+Enter sonst hinter ihr speicherte (LLH-1755, Review).
      keyboard={false}
      wrapProps={{
        ...MASKE_HAELT_FOKUS,
        onFocus: (e: FocusEvent<HTMLDivElement>) => {
          if (oeffnet.current && !weiterRef.current?.contains(e.target)) fokusZurueck();
        },
        onPointerDown: () => {
          oeffnet.current = false;
        },
        onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => {
          oeffnet.current = false;
          e.stopPropagation();
          if (e.key !== 'Escape' || e.nativeEvent.isComposing) return;
          e.preventDefault();
          onWeiter();
        },
      }}
      footer={
        <Knopfreihe fuss>
          <Button danger onClick={onVerwerfen}>
            Verwerfen
          </Button>
          <Button ref={weiterRef} type="primary" autoFocus onClick={onWeiter}>
            Weiter bearbeiten
          </Button>
        </Knopfreihe>
      }
    >
      {typeof titel === 'string' && titel !== ''
        ? `Die Eingaben in „${titel}“ gehen verloren.`
        : 'Die Eingaben gehen verloren.'}
    </Modal>
  );
}

const EINGABE =
  'input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled])';

/**
 * Wohin der Fokus nach „Weiter bearbeiten“ zurückkehrt: das Feld, in dem er stand, sonst (Kreuz,
 * Abbrechen-Knopf) das erste Feld des Dialogs.
 */
function eingabeFokus(aktiv: Element | null): HTMLElement | null {
  if (!(aktiv instanceof HTMLElement)) return null;
  if (aktiv.matches(EINGABE)) return aktiv;
  return aktiv.closest('.ant-modal')?.querySelector<HTMLElement>(EINGABE) ?? aktiv;
}

/**
 * Schutz eines handgebauten Dialogs mit gesteuerten Feldern (LLH-2010, `frontend/AGENTS.md`,
 * „Erfassungs-Norm“): dieselbe Pforte wie in `ErfassungsFormular`, für Dialoge, die kein
 * Formular sind (Bestätigung mit Grund, Einfelddialog, Postenliste). Die Maske schließt nie;
 * Kreuz, Escape und ein eigener Abbrechen-Knopf (`abbrechen`) schließen ohne Änderung sofort und
 * fragen mit Änderung über {@link VerwerfenDialog} nach.
 *
 * `rueckfrage` steht neben dem `<Modal>` (ein eigener Dialog darüber), nicht in seinem Inhalt.
 */
export function useVerwerfenSchutz({
  geaendert,
  gesperrt = false,
  titel,
  onSchliessen,
}: {
  /** Hat die Person etwas eingegeben, das beim Schließen verloren ginge? */
  geaendert: boolean;
  /** Läuft gerade gespeichert? Dann ist jeder Weg hinaus gesperrt. */
  gesperrt?: boolean;
  /** Titel des Dialogs; die Rückfrage nennt ihn. */
  titel?: ReactNode;
  /** Der Abbruch des Dialogs: Zustand räumen, Dialog schließen. */
  onSchliessen: () => void;
}): {
  modalProps: Pick<ModalProps, 'mask' | 'wrapProps' | 'onCancel' | 'keyboard'>;
  abbrechen: () => void;
  rueckfrage: ReactNode;
} {
  const [rueckfrageOffen, setRueckfrageOffen] = useState(false);
  // Fokus vor der Rückfrage; „Weiter bearbeiten“ bringt ihn zurück, sonst stünde er auf <body>
  // und der Dialog hörte kein Escape mehr.
  const fokusVorher = useRef<HTMLElement | null>(null);

  const abbrechen = useCallback(() => {
    if (gesperrt) return;
    if (!geaendert) {
      onSchliessen();
      return;
    }
    fokusVorher.current = eingabeFokus(document.activeElement);
    setRueckfrageOffen(true);
  }, [gesperrt, geaendert, onSchliessen]);

  const weiter = useCallback(() => {
    setRueckfrageOffen(false);
    const ziel = fokusVorher.current;
    fokusVorher.current = null;
    if (ziel) setTimeout(() => ziel.focus(), 0);
  }, []);

  const verwerfen = useCallback(() => {
    setRueckfrageOffen(false);
    fokusVorher.current = null;
    onSchliessen();
  }, [onSchliessen]);

  return {
    modalProps: {
      mask: { closable: false },
      wrapProps: MASKE_HAELT_FOKUS,
      onCancel: abbrechen,
      // Escape erreicht nur den obersten offenen Dialog (rc-dialog): steht die Rückfrage, gilt es ihr.
      keyboard: !gesperrt,
    },
    abbrechen,
    rueckfrage: (
      <VerwerfenDialog
        offen={rueckfrageOffen}
        titel={titel}
        onWeiter={weiter}
        onVerwerfen={verwerfen}
      />
    ),
  };
}
