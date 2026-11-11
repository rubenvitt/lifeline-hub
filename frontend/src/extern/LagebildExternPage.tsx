import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type * as maplibregl from 'maplibre-gl';
import { Alert, Typography } from 'antd';
import { ApiError } from '../api/client';
import { ladeLagebildExtern } from '../api/lagebildExtern';
import { globalKeys } from '../api/queryKeys';
import type { LagebildEinsatz, LagebildExtern } from '../api/types';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { zeitKurz } from '../anzeige/zeitDarstellung';
import { Kennzahl, Kennzahlenband, Paneel, useRollen } from '../components/instrument';
import { EINSATZART_LABELS } from '../einsatz/einsatzart';
import { spiegelStand } from '../einsatz/spiegel/spiegelText';
import LagemonitorKarte from '../geraet/LagemonitorKarte';
import { Bildmarke } from '../marke/Bildmarke';
import { absolutiereProxyAnfrage } from '../pages/lagekarte/basemapStil';
import { neueClientId } from '../offline/clientId';
import { lagebildKartenDaten } from './lagebildKarte';

/** Takt der Seite (design.md D9). */
export const ABRUF_MS = 30_000;

/** Feld der Antwort → Wort, wenn es nicht übertragen ist (design.md D5). */
const FELD_WORT: Readonly<Record<string, string>> = {
  betroffene_gesamt: 'Betroffene',
  betroffene: 'Betroffene nach Sichtung',
  sanitaetsdienst: 'Sanitätsdienst',
  einsatzkraefte_gesamt: 'Einsatzkräfte',
  kraefte: 'Kräfte',
  uhs: 'Unfallhilfsstellen',
  lagemeldung: 'Lagemeldung',
  karte: 'Karte',
};

/** Schlüssel aus dem Fragment des Links (`/extern#llh_lb_…`); er bleibt in der Adresse, damit
 *  Neuladen und Lesezeichen gehen. */
function schluesselAusFragment(): string {
  const roh = window.location.hash.replace(/^#/, '');
  try {
    return decodeURIComponent(roh);
  } catch {
    return roh;
  }
}

/** Ist der Link nicht (mehr) gültig? Der Server sagt nicht, warum. */
export function linkUngueltig(fehler: unknown): boolean {
  return fehler instanceof ApiError && fehler.status === 401;
}

/**
 * Hält die Karte der letzten vollständigen Antwort: der Server lässt sie weg, solange die Fassung
 * gleich ist (`?karte=<etag>`, wie beim Lagemonitor).
 */
export function mitKarte(neu: LagebildExtern, alt: LagebildExtern | undefined): LagebildExtern {
  if (neu.karte || !neu.karte_etag || alt?.karte_etag !== neu.karte_etag) return neu;
  return { ...neu, karte: alt.karte };
}

/**
 * Lagebild für Externe (LLH-1496, Spec `lagebild-extern`, design.md D9): eine Seite ohne Sitzung
 * und ohne App-Rahmen für Behörden, Nachbarorganisationen und Presse. Der Schlüssel steht im
 * Fragment des Links; die Seite fragt alle {@link ABRUF_MS} nach und hält bei 401 an.
 *
 * Gezeigt wird nur, was der Server liefert: keine Namen, keine Freitexte außer der Lagemeldung.
 * Fehlt ein Feld, weil die führende Stelle seine Kategorie nicht überträgt, steht es als „nicht
 * übertragen“ da.
 */
export default function LagebildExternPage() {
  const [schluessel] = useState(schluesselAusFragment);
  // Kennung dieser Öffnung (Protokoll, design.md D6): je Laden der Seite eine neue.
  const [oeffnung] = useState(neueClientId);
  // Empfänger außerhalb der Führung lesen keine DTG: hier immer Datum und Uhrzeit.
  const { konventionen } = useAnzeigeKonventionen();
  const konv = useMemo(
    () => ({ ...konventionen, zeitdarstellung: 'datum_uhrzeit' as const }),
    [konventionen],
  );
  const { token, rollen } = useRollen();
  const letzte = useRef<LagebildExtern | undefined>(undefined);
  const [beendet, setBeendet] = useState(false);
  const [jetzt, setJetzt] = useState(() => Date.now());

  const abfrage = useQuery({
    queryKey: globalKeys.lagebildExtern(),
    queryFn: async () => {
      const antwort = await ladeLagebildExtern(
        schluessel,
        oeffnung,
        letzte.current?.karte_etag ?? undefined,
      );
      const voll = mitKarte(antwort, letzte.current);
      letzte.current = voll;
      return voll;
    },
    enabled: schluessel !== '' && !beendet,
    refetchInterval: ABRUF_MS,
    refetchIntervalInBackground: true,
    retry: (n, e) => !linkUngueltig(e) && n < 2,
  });

  useEffect(() => {
    if (linkUngueltig(abfrage.error)) setBeendet(true);
  }, [abfrage.error]);

  // Uhr für „keine Verbindung seit …“ am Spiegel.
  useEffect(() => {
    const t = window.setInterval(() => setJetzt(Date.now()), 15_000);
    return () => window.clearInterval(t);
  }, []);

  // Der Karten-Proxy nimmt den Schlüssel wie eine Sitzung; nur an die eigenen Proxy-Adressen,
  // nie an eine fremde Kachelquelle.
  const anfrage = useMemo(
    () =>
      (url: string): maplibregl.RequestParameters => {
        const r = absolutiereProxyAnfrage(url);
        return r.url.startsWith(`${window.location.origin}/api/karte/proxy/`)
          ? { ...r, headers: { Authorization: `Bearer ${schluessel}` } }
          : r;
      },
    [schluessel],
  );

  const daten = abfrage.data;
  const karte = useMemo(() => lagebildKartenDaten(daten?.karte), [daten?.karte]);

  const rahmen = (inhalt: ReactNode) => (
    <div
      style={{
        minHeight: '100vh',
        background: rollen.grund,
        color: rollen.text,
        padding: token.padding,
        boxSizing: 'border-box',
      }}
    >
      <div style={{ maxWidth: 1200, margin: '0 auto', display: 'grid', gap: token.margin }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: token.marginXS }}>
          <Bildmarke hoehe={18} linienFarbe="var(--lfh-text)" quadratFarbe="var(--lfh-marke)" />
          <span style={{ fontWeight: 600 }}>Lagebild</span>
          {daten && (
            <span style={{ color: rollen.gedaempft }} data-lfh="extern-empfaenger">
              · für {daten.empfaenger}
            </span>
          )}
        </div>
        {inhalt}
      </div>
    </div>
  );

  if (schluessel === '' || beendet) {
    return rahmen(
      <Alert
        type="info"
        showIcon
        data-lfh="extern-ungueltig"
        title="Dieser Link gilt nicht mehr."
      />,
    );
  }
  if (!daten) {
    return rahmen(
      abfrage.isError ? (
        <Alert type="error" showIcon title="Lagebild nicht ladbar" />
      ) : (
        <Typography.Text style={{ color: rollen.gedaempft }}>Lädt …</Typography.Text>
      ),
    );
  }

  const zeit = (wert: string) => zeitKurz(wert, konv);
  const e = daten.einsatz;
  const fehlt = new Set(daten.nicht_uebertragen);
  const abgleich = daten.quelle.spiegel
    ? spiegelStand(
        {
          beendet: daten.quelle.abgleich_beendet,
          letzter_abgleich_at: daten.quelle.letzter_abgleich_at ?? null,
        },
        true,
        jetzt,
        zeit,
      )
    : null;

  return rahmen(
    <>
      <header style={{ display: 'grid', gap: token.marginXXS }}>
        <Typography.Title level={1} style={{ margin: 0, fontSize: 24 }} data-lfh="extern-titel">
          {e.bezeichnung}
        </Typography.Title>
        <span style={{ color: rollen.gedaempft }}>
          {[e.stichwort, EINSATZART_LABELS[e.einsatzart], `seit ${zeit(e.begonnen_at)}`]
            .filter(Boolean)
            .join(' · ')}
        </span>
        <span data-lfh="extern-stand" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <span>Stand {zeit(daten.stand_at)}</span>
          {abfrage.isError && <span style={{ color: rollen.achtungText }}>· keine Verbindung</span>}
          {abgleich && (
            <span
              data-lfh="extern-abgleich"
              data-gestoert={abgleich.gestoert ? 'ja' : 'nein'}
              style={{
                color: abgleich.gestoert ? rollen.alarmText : rollen.gedaempft,
                fontWeight: abgleich.gestoert ? 600 : 400,
              }}
            >
              · {abgleich.text}
            </span>
          )}
          {daten.gueltig_bis && (
            <span style={{ color: rollen.gedaempft }}>· gültig bis {zeit(daten.gueltig_bis)}</span>
          )}
        </span>
      </header>

      <Zahlen e={e} fehlt={fehlt} />

      {daten.karte ? (
        <div
          style={{
            height: 'min(60vh, 520px)',
            border: `1px solid ${rollen.linie}`,
            background: rollen.flaeche,
          }}
        >
          <LagemonitorKarte
            einsatzort={karte.einsatzort}
            uhs={karte.uhs}
            zonen={karte.zonen}
            abschnitte={karte.abschnitte}
            schrift={14}
            bedienbar
            anfrage={anfrage}
          />
        </div>
      ) : (
        fehlt.has('karte') && <NichtUebertragen feld="karte" />
      )}

      {e.lagemeldung && (
        <Paneel titel="Lagemeldung" meta={zeit(e.lagemeldung.freigegeben_at)} koerperPolster>
          <Typography.Paragraph style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
            {e.lagemeldung.text}
          </Typography.Paragraph>
        </Paneel>
      )}
      {fehlt.has('lagemeldung') && <NichtUebertragen feld="lagemeldung" />}
    </>,
  );
}

function NichtUebertragen({ feld }: { feld: string }) {
  const { rollen } = useRollen();
  return (
    <div data-lfh="extern-nicht-uebertragen" style={{ color: rollen.gedaempft }}>
      {FELD_WORT[feld] ?? feld}: nicht übertragen
    </div>
  );
}

function Zahlen({ e, fehlt }: { e: LagebildEinsatz; fehlt: ReadonlySet<string> }) {
  const zahl = (feld: string, wert: number | null | undefined) =>
    fehlt.has(feld) ? 'nicht übertragen' : (wert ?? '—');
  const b = e.betroffene;
  const k = e.kraefte;
  const san = e.sanitaetsdienst;
  return (
    <>
      <Kennzahlenband beschriftung="Kennzahlen">
        <Kennzahl titel="Betroffene" wert={zahl('betroffene_gesamt', e.betroffene_gesamt)} />
        <Kennzahl
          titel="Einsatzkräfte"
          wert={zahl('einsatzkraefte_gesamt', e.einsatzkraefte_gesamt)}
        />
        {b && (
          <Kennzahl
            titel="Vermisst"
            wert={b.vermisst}
            ton={b.vermisst > 0 ? 'achtung' : 'neutral'}
          />
        )}
        {k && <Kennzahl titel="Einheiten" wert={k.einheiten} />}
        {san && (
          <Kennzahl
            titel="Kontakte"
            wert={san.kontakte}
            notiz={`${san.kontakte_letzte_stunde} in der letzten Stunde`}
          />
        )}
        {san && <Kennzahl titel="In Versorgung" wert={san.in_versorgung} />}
        {san && <Kennzahl titel="Transporte" wert={san.transporte} />}
      </Kennzahlenband>
      {b && (
        <Kennzahlenband beschriftung="Betroffene nach Sichtung">
          <Kennzahl titel="SK I" wert={b.sk1} ton={b.sk1 > 0 ? 'alarm' : 'neutral'} />
          <Kennzahl titel="SK II" wert={b.sk2} />
          <Kennzahl titel="SK III" wert={b.sk3} />
          <Kennzahl titel="SK IV" wert={b.sk4} />
          <Kennzahl titel="Ungesichtet" wert={b.ohne} />
        </Kennzahlenband>
      )}
      {e.uhs && e.uhs.length > 0 && (
        <Kennzahlenband beschriftung="Unfallhilfsstellen">
          {e.uhs.map((u) => (
            <Kennzahl
              key={u.id}
              titel={u.bezeichnung}
              wert={u.plaetze > 0 ? `${u.belegt}/${u.plaetze}` : u.belegt}
              notiz={`${u.kraefte} Kräfte`}
            />
          ))}
        </Kennzahlenband>
      )}
      {[...fehlt]
        .filter((f) => f !== 'karte' && f !== 'lagemeldung' && !f.endsWith('_gesamt'))
        .map((f) => (
          <NichtUebertragen key={f} feld={f} />
        ))}
    </>
  );
}
