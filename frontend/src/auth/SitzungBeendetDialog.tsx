import { Button, Flex, Modal } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Stapel } from '../components/instrument';
import AnmeldeFormular from './AnmeldeFormular';
import { UNTERBRECHUNG_FRIST_MS, useAuth } from './AuthContext';

/** Über jedem Overlay der Seite: Dialoge (1000), Popover und Tooltips (bis 1070), die
 *  Sprungpalette (2000). */
const Z_EBENE = 2100;

/** Restliche ganze Minuten, aufgerundet, mindestens 1 — „in 0 min“ stünde nie da. */
function restMinuten(restMs: number): number {
  return Math.max(1, Math.ceil(restMs / 60_000));
}

/**
 * Sitzung beendet (LLH-1770): Die Sitzung endete im laufenden Betrieb. Die Seite bleibt montiert,
 * ihre Eingaben auch in offenen Dialogen, und liegt undurchsichtig verdeckt unter dieser Anmeldung.
 * Was nach der Anmeldung geschieht, entscheidet der `AuthProvider`: dieselbe Person arbeitet weiter,
 * eine andere lädt die Seite neu.
 *
 * Nicht schließbar (kein Kreuz, kein Escape, keine Maske). Läuft die Frist ab oder wählt die
 * Person „Abmelden“, folgt der volle Ausgang zur Anmeldeseite mit Grund. Die Restzeit wird aus
 * dem Eintritt berechnet, nicht hochgezählt: ein verdeckter Tab drosselt Timer.
 *
 * Gehört ins Sitzungs-Layout neben den `BenutzerKonfliktDialog` (`App.tsx`).
 */
export default function SitzungBeendetDialog() {
  const { unterbrechung, unterbrechungBeenden } = useAuth();
  const navigate = useNavigate();
  const { pathname, search, hash } = useLocation();
  const von = `${pathname}${search}${hash}`;
  const [jetzt, setJetzt] = useState(() => Date.now());
  const beendet = useRef(false);

  const seit = unterbrechung?.seit ?? null;
  const restMs = seit === null ? UNTERBRECHUNG_FRIST_MS : seit + UNTERBRECHUNG_FRIST_MS - jetzt;

  useEffect(() => {
    if (seit === null) {
      beendet.current = false;
      return;
    }
    setJetzt(Date.now());
    const takt = window.setInterval(() => setJetzt(Date.now()), 1_000);
    return () => window.clearInterval(takt);
  }, [seit]);

  const beenden = useRef<() => void>(() => {});
  beenden.current = () => {
    if (beendet.current) return;
    beendet.current = true;
    // Erst die Anmeldeseite, dann abmelden: sonst leitete `RequireAuth` beim Wegfall des
    // Benutzers selbst um, ohne den Grund. Im Data Router ist die Navigation erst mit ihrem
    // Versprechen vollzogen (die Anmeldeseite kann nachgeladen werden).
    void Promise.resolve(
      navigate('/login', { replace: true, state: { von, grund: 'sitzung-beendet' } }),
    ).finally(() => void unterbrechungBeenden());
  };

  useEffect(() => {
    if (seit !== null && restMs <= 0) beenden.current();
  }, [seit, restMs]);

  if (!unterbrechung) return null;

  return (
    <Modal
      open
      title="Sitzung beendet"
      closable={false}
      keyboard={false}
      mask={{ closable: false }}
      zIndex={Z_EBENE}
      classNames={{ mask: 'lfh-sitzung-beendet-maske' }}
      // Undurchsichtig: ohne gültige Sitzung bleibt nichts von der Seite sichtbar.
      styles={{ mask: { background: 'var(--lfh-grund)', opacity: 1, backdropFilter: 'none' } }}
      footer={
        <Flex justify="end">
          <Button onClick={() => beenden.current()}>Abmelden</Button>
        </Flex>
      }
    >
      <Stapel abstand="sm">
        <span>Erneut anmelden. Eingaben auf dieser Seite bleiben erhalten.</span>
        <span>{`Ohne Anmeldung wird diese Seite in ${restMinuten(restMs)} min geschlossen`}</span>
        <AnmeldeFormular
          zielPfad={von}
          onAngemeldet={() => {}}
          benutzernameVorgabe={unterbrechung.bisher.benutzername}
          ssoHinweis="Verlässt die Seite, Eingaben auf dieser Seite gehen verloren"
        />
      </Stapel>
    </Modal>
  );
}
