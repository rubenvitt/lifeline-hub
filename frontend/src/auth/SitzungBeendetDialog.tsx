import { Button, Flex, Modal } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { dauer } from '../anzeige/dauer';
import { Stapel } from '../components/instrument';
import AnmeldeFormular from './AnmeldeFormular';
import { VERDECKT } from './BenutzerKonfliktDialog';
import { geraetTabRaeumen } from '../offline/geraetRaeumung';
import { UNTERBRECHUNG_FRIST_MS, useAuth } from './AuthContext';

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
      // Undurchsichtig und über jedem Overlay der Seite (Dialoge 1000, Popover bis 1070,
      // Sprungpalette 2000): ohne gültige Sitzung bleibt nichts von der Seite sichtbar.
      {...VERDECKT}
      footer={
        <Flex justify="end">
          <Button onClick={() => beenden.current()}>Abmelden</Button>
        </Flex>
      }
    >
      <Stapel abstand="sm">
        <span>Erneut anmelden. Eingaben auf dieser Seite bleiben erhalten.</span>
        <span>{`Ohne Anmeldung wird diese Seite in ${dauer(restMinuten(restMs))} geschlossen`}</span>
        <AnmeldeFormular
          zielPfad={von}
          onAngemeldet={() => {}}
          benutzernameVorgabe={unterbrechung.bisher.benutzername}
          ssoHinweis="Verlässt die Seite, Eingaben auf dieser Seite gehen verloren"
          // Wer über SSO zurückkommt, kann eine andere Person sein: der Speicher des Tabs geht
          // vorher, die Platte ist schon leer.
          vorUmleitung={geraetTabRaeumen}
        />
      </Stapel>
    </Modal>
  );
}
