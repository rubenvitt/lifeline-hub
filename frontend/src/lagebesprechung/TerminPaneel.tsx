import { useId } from 'react';
import { Button, Flex, Typography, theme } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Dayjs } from 'dayjs';
import { useUhr } from '../abloesung/useUhr';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import { ZeitpunktEingabe } from '../anzeige/ZeitpunktEingabe';
import { alsBackendZeit } from '../anzeige/zeitEingabe';
import { fetchLagebesprechungIcs, setLagebesprechungTermin } from '../api/lagebesprechung';
import { einsatzKeys } from '../api/queryKeys';
import type { LagebesprechungStand } from '../api/types';
import { exportDateiname, speichereDatei } from '../components/dateiSpeichern';
import { SpeicherFehler } from '../components/SpeicherHinweis';
import {
  Kennzahl,
  Kennzahlenband,
  Paneel,
  Stapel,
  type KennzahlZustand,
} from '../components/instrument';
import { schnellwahlAuswahl, schnellwahlZeit } from '../anzeige/zeitSchnellwahl';
import { serverJetzt } from '../offline/serveruhr';
import { lagebesprechungZustand, terminZeitpunkt } from './lagebesprechungZustand';

/** Teilmenge der geteilten Schnellwahl (+30/+60/+120), wie im Abschluss. */
const SCHNELLWAHL = schnellwahlAuswahl([30, 60, 120]);

interface TerminPaneelProps {
  einsatzId: number;
  stand: LagebesprechungStand | undefined;
  zustand: KennzahlZustand;
  /** Schreibrecht im Einsatz; ohne steht die Schnellwahl gesperrt da (Grund am Seitenkopf). */
  darfSchreiben: boolean;
}

/**
 * Paneel „Termin“ der Seite Lagebesprechung (LLH-1111, design.md D7): der nächste Termin groß als
 * taktische Zeit mit seinem Zustand („in 25 min“, „jetzt fällig“, „seit 5 min überfällig“ im Ton
 * `achtung`, Regel „Überfälliger Besprechungstermin“ in `lagebesprechung/AGENTS.md`), daneben die
 * Zahl der abgeschlossenen Besprechungen.
 *
 * Darunter die Schnellwahl ab jetzt (Serveruhr) und die freie Wahl. Gesetzt wird ohne Abschluss
 * und ohne ETB-Eintrag (D3); „kein Termin“ fragt nicht nach, ein Griff nimmt es zurück. Der Zustand
 * läuft im 30-s-Takt ohne Blinken weiter.
 */
export default function TerminPaneel({
  einsatzId,
  stand,
  zustand,
  darfSchreiben,
}: TerminPaneelProps) {
  const { token } = theme.useToken();
  const kalenderGrundId = useId();
  const qc = useQueryClient();
  const jetzt = useUhr(30_000);
  const termin = stand?.naechste_lagebesprechung_at;
  const darstellung = lagebesprechungZustand(termin, jetzt);

  const mutation = useMutation({
    mutationFn: (naechste_at: string | null) =>
      setLagebesprechungTermin(einsatzId, { naechste_at }),
    onSuccess: (antwort) => {
      qc.setQueryData(einsatzKeys.lagebesprechung(einsatzId), antwort);
      // Hygiene für den eigenen Schirm: `einsatz` kommt live nur bei echter Änderung.
      void qc.invalidateQueries({ queryKey: einsatzKeys.einsatz(einsatzId) });
    },
  });
  // Nur Lesen: der Export schreibt nichts, deshalb weder `darfSchreiben` noch `isGesperrt`.
  // `networkMode: 'always'` wie `useCsvExport`: ohne Netz scheitert er sofort sichtbar, statt zu
  // pausieren und später ungefragt nachzulaufen.
  const kalender = useMutation({
    networkMode: 'always',
    mutationFn: async () => {
      const datei = await fetchLagebesprechungIcs(einsatzId);
      speichereDatei(datei, exportDateiname('lagebesprechung', einsatzId, 'ics'));
    },
  });
  const isGesperrt = !darfSchreiben || stand == null || mutation.isPending;
  const setTermin = (zeitpunkt: Dayjs | null) =>
    mutation.mutate(zeitpunkt ? alsBackendZeit(zeitpunkt) : null);

  return (
    <Paneel titel="Termin" koerperPolster style={{ marginBottom: token.margin }}>
      <Stapel abstand="md">
        <Kennzahlenband beschriftung="Termin der nächsten Lagebesprechung" spalten={2}>
          <Kennzahl
            titel="Nächste Lagebesprechung"
            groesse="gross"
            zustand={zustand}
            ton={darstellung.rolle === 'achtung' ? 'achtung' : 'neutral'}
            wert={termin ? <ZeitAnzeige wert={termin} rolle="kurz" /> : '—'}
            notiz={darstellung.label}
          />
          <Kennzahl
            titel="Abgeschlossen"
            groesse="gross"
            zustand={zustand}
            wert={stand?.anzahl_lagebesprechungen ?? 0}
            notiz={
              stand?.letzte_lagebesprechung
                ? `zuletzt Nr. ${stand.letzte_lagebesprechung.lfd_nr}`
                : 'noch keine'
            }
          />
        </Kennzahlenband>
        <Flex wrap gap={token.marginXS} role="group" aria-label="Termin setzen">
          {SCHNELLWAHL.map((s) => (
            <Button
              key={s.label}
              disabled={isGesperrt}
              onClick={() => setTermin(schnellwahlZeit(serverJetzt(), s.minuten))}
            >
              {s.label}
            </Button>
          ))}
          <Button disabled={isGesperrt || !termin} onClick={() => setTermin(null)}>
            kein Termin
          </Button>
          <ZeitpunktEingabe
            art="frist"
            aria-label="Termin wählen"
            placeholder="Termin wählen"
            disabled={isGesperrt}
            value={terminZeitpunkt(termin)}
            // Ein geleertes Feld (Enter) leert den Termin wie „kein Termin“.
            onChange={(zeitpunkt) => {
              if (zeitpunkt || termin) setTermin(zeitpunkt);
            }}
          />
        </Flex>
        <Flex align="center" gap={token.marginXS} wrap>
          <Button
            disabled={!termin || kalender.isPending}
            loading={kalender.isPending}
            aria-describedby={termin ? undefined : kalenderGrundId}
            onClick={() => kalender.mutate()}
          >
            In Kalender übernehmen
          </Button>
          {!termin && (
            <Typography.Text id={kalenderGrundId} type="secondary">
              Kein Termin
            </Typography.Text>
          )}
        </Flex>
        <SpeicherFehler fehler={mutation.error} titel="Termin nicht gesetzt" />
        <SpeicherFehler
          fehler={kalender.error}
          titel="Nicht übernommen"
          fallback="Keine Verbindung zum Server"
        />
      </Stapel>
    </Paneel>
  );
}
