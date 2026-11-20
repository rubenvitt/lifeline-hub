import { Button, Typography } from 'antd';
import { QueryClientContext } from '@tanstack/react-query';
import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { zeitpunkt } from '../anzeige/zeitDarstellung';
import { einsatzKeys } from '../api/queryKeys';
import { useRollen } from '../components/instrument';
import {
  OFFLINE_QUEUE_EVENT,
  beobachteQueueAenderungen,
  queueAlleLaden,
  schreibaktionenLaden,
  type OfflineSchreibaktion,
} from './queue';

/** Was eine nicht gesendete Schreibaktion ist, ohne „Abgelehnt“; exhaustiv über die Art. */
export function aktionWort(aktion: OfflineSchreibaktion): string {
  switch (aktion.art) {
    case 'person':
      return 'Personenerfassung';
    case 'meldung':
      return `Meldung von ${aktion.daten.absender}`;
    case 'stand':
      return `Standmeldung: ${aktion.bezeichnung}`;
    case 'belegung':
      return `Belegungsmeldung: ${aktion.bezeichnung}`;
    case 'registrierung':
      return `Registrierung: ${aktion.bezeichnung}`;
    case 'abmeldung':
      return `Abmeldung: ${aktion.bezeichnung}`;
    case 'ausgabe':
      return `Verpflegungsausgabe: ${aktion.bezeichnung}`;
    case 'eintreffen':
      return `Eintreffen: ${aktion.name} · ${aktion.bezeichnung}`;
    case 'eingaenge_gelesen':
      return 'Eingänge „Alle gelesen“';
    case 'benachrichtigung_quittiert':
      return 'Eingang gelesen';
    case 'sichtung':
      return `Sichtung: ${aktion.bezeichnung}`;
    case 'verbleib':
      return `Verbleib: ${aktion.bezeichnung}`;
    case 'notiz':
      return `Verlaufsnotiz: ${aktion.bezeichnung}`;
    case 'transport':
      return `Transport: ${aktion.bezeichnung}`;
    case 'anlass':
      return `Anlass: ${aktion.bezeichnung}`;
    case 'massnahme':
      return `Maßnahme: ${aktion.bezeichnung}`;
    case 'verletzung':
      return `Verletzung: ${aktion.bezeichnung}`;
    default: {
      const nie: never = aktion;
      return `Offline-Aktion ${JSON.stringify(nie)}`;
    }
  }
}

interface Zeile {
  schluessel: string;
  wort: string;
  einsatzId: number;
  erstelltAt: string;
}

/**
 * Was auf diesem Gerät noch nicht beim Server ist (LLH-1758, `offline/AGENTS.md`, „Vorgemerkt
 * heißt nicht offline“): ETB-Einträge und Schreibaktionen aller Einsätze der Person, je Zeile Art,
 * Einsatz und Erfassungszeit. „Jetzt erneut senden“ stößt den Abgleich an, statt auf den
 * Backoff zu warten. Kein Verwerfen: Ausstehendes ist Beweissicherung. Leer steht nichts da.
 */
export default function NichtGesendetListe({
  benutzerId,
  einsatzId,
}: {
  benutzerId?: number;
  einsatzId?: number;
}) {
  const { token, rollen } = useRollen();
  const { konventionen } = useAnzeigeKonventionen();
  const queryClient = useContext(QueryClientContext);
  const [zeilen, setZeilen] = useState<Zeile[]>([]);
  const generation = useRef(0);

  const laden = useCallback(async () => {
    const g = ++generation.current;
    if (benutzerId == null) {
      setZeilen([]);
      return;
    }
    const [etb, aktionen] = await Promise.all([
      queueAlleLaden(benutzerId),
      schreibaktionenLaden(benutzerId),
    ]);
    if (generation.current !== g) return;
    const alle: Zeile[] = [
      ...etb.map((e) => ({
        schluessel: `etb:${e.id}`,
        wort: 'ETB-Eintrag',
        einsatzId: e.einsatz_id,
        erstelltAt: e.erstellt_at,
      })),
      ...aktionen.map((a) => ({
        schluessel: `schreiben:${a.id}`,
        wort: aktionWort(a.aktion),
        einsatzId: a.einsatz_id,
        erstelltAt: a.erstellt_at,
      })),
    ]
      .filter((z) => einsatzId == null || z.einsatzId === einsatzId)
      .sort((a, b) => a.erstelltAt.localeCompare(b.erstelltAt));
    setZeilen(alle);
  }, [benutzerId, einsatzId]);

  useEffect(() => {
    void laden();
    return beobachteQueueAenderungen(() => void laden());
  }, [laden]);

  if (zeilen.length === 0) return null;
  const einsatzName = (id: number) =>
    queryClient?.getQueryData<{ bezeichnung?: string }>(einsatzKeys.einsatz(id))?.bezeichnung ??
    `Einsatz ${id}`;
  return (
    <section
      aria-label="Nicht gesendet"
      data-lfh="nicht-gesendet"
      style={{
        borderInlineStart: `3px solid ${token.colorWarning}`,
        paddingInlineStart: token.paddingSM,
        color: rollen.text2,
      }}
    >
      <Typography.Text strong>Nicht gesendet</Typography.Text>
      <ul style={{ listStyle: 'none', margin: `${token.marginXS}px 0`, padding: 0 }}>
        {zeilen.map((z) => (
          <li key={z.schluessel}>
            {z.wort} · {einsatzName(z.einsatzId)} · {zeitpunkt(z.erstelltAt, konventionen)}
          </li>
        ))}
      </ul>
      <Button onClick={() => window.dispatchEvent(new Event(OFFLINE_QUEUE_EVENT))}>
        Jetzt erneut senden
      </Button>
    </section>
  );
}
