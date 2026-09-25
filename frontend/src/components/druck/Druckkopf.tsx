import { useEffect, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { theme } from 'antd';
import { ladeOrganisation, orgLogoPfad } from '../../api/organisation';
import { globalKeys } from '../../api/queryKeys';
import { useAuth } from '../../auth/AuthContext';
import { useAnzeigeKonventionen } from '../../anzeige/AnzeigeKonventionenContext';
import { taktischeDtgVoll } from '../../anzeige/format';

/** Eine Angabe unter dem Titel: „Stand", „Auswahl" o. Ä. — vom Aufrufer geliefert. */
export interface DruckkopfZeile {
  etikett: string;
  wert: ReactNode;
}

export interface DruckkopfProps {
  /** Art des Dokuments: „Befehl", „Lagebericht", „Meldebild", „Einsatztagebuch". */
  dokumentart: string;
  /** Titel des Dokuments, falls es einen eigenen hat (Befehl, Lagebericht). */
  titel?: string;
  einsatz: { bezeichnung: string; einsatznummer_intern?: string | null };
  /** Stand bzw. gedruckte Auswahl — die Seite weiß, was ihren Stand ausmacht. */
  zeilen?: DruckkopfZeile[];
  /**
   * `druck`: nur auf Papier (Befehl, Lagebericht, Meldebild — dort stehen dieselben Angaben
   * am Bildschirm schon in Seitenkopf und Leisten). `immer`: auch am Bildschirm
   * (ETB-Druckansicht, die ihr Papier vorab zeigt).
   */
  sichtbarkeit: 'druck' | 'immer';
  /**
   * Ebene der Dokumentüberschrift; Vorgabe `h1`. Die ETB-Druckansicht zeigt den Kopf auch
   * am Bildschirm unter dem Seitenkopf, der schon das `h1` trägt — dort `2`, damit die
   * Seite nicht zwei `h1` hat. Auf Papier ist der Seitenkopf ausgeblendet.
   */
  ebene?: 1 | 2;
}

/**
 * Der gemeinsame Druckkopf (LFH-22, design.md D2 des Changes `lfh-22-druck-export`).
 *
 * Ein Blatt muss ohne Bildschirm zuordenbar sein: WELCHE Organisation, WELCHES Dokument,
 * WELCHER Einsatz, WELCHER Stand, WER hat gedruckt und WANN. Lagebericht, Befehl, Meldebild
 * und ETB-Druck tragen denselben Kopf — vorher hatte nur das Meldebild einen eigenen.
 *
 * Er gehört INNERHALB der Druckwurzel (`data-lfh="druckwurzel"`): `druck/druck.css` blendet
 * im Druck alles außerhalb aus. Seine Bildschirmregel (`.druckkopf--nur-druck`) steht dort.
 *
 * DRUCKZEITPUNKT: in der Anzeigezone (`useAnzeigeKonventionen`), als taktische DTG. Er wird
 * beim Rendern gesetzt UND bei `beforeprint` erneuert — zwischen Öffnen der Seite und
 * Strg+P können Stunden liegen. `flushSync`, weil ein Update aus einem Browser-Ereignis
 * außerhalb von React sonst erst nach dem Druckbild gerendert würde.
 *
 * Gedruckt wird erst, wenn die Organisation geladen ist — das stellt `useDrucken` sicher,
 * nicht dieser Baustein. Er zeigt bis dahin keinen Namen statt eines Platzhalters.
 */
export default function Druckkopf({
  dokumentart,
  titel,
  einsatz,
  zeilen = [],
  sichtbarkeit,
  ebene = 1,
}: DruckkopfProps) {
  const Ueberschrift = ebene === 1 ? 'h1' : 'h2';
  const { token } = theme.useToken();
  const { benutzer } = useAuth();
  const { konventionen } = useAnzeigeKonventionen();
  const organisation = useQuery({
    queryKey: globalKeys.organisation(),
    queryFn: ladeOrganisation,
  });
  const [jetzt, setJetzt] = useState(() => new Date());
  // Ein Logo, das nicht lädt, fällt weg (kein leerer Bildrahmen auf dem Blatt). Gemerkt je
  // sha256: ein ersetztes Logo bekommt einen neuen Versuch.
  const [kaputtesLogo, setKaputtesLogo] = useState<string | null>(null);
  const logo = organisation.data?.logo;

  useEffect(() => {
    const vorDruck = () => flushSync(() => setJetzt(new Date()));
    window.addEventListener('beforeprint', vorDruck);
    return () => window.removeEventListener('beforeprint', vorDruck);
  }, []);

  const nummer = einsatz.einsatznummer_intern?.trim();
  const angaben: DruckkopfZeile[] = [
    {
      etikett: 'Einsatz',
      wert: nummer ? `${einsatz.bezeichnung} (${nummer})` : einsatz.bezeichnung,
    },
    ...zeilen,
    // Die DRUCKENDE Person (Spec „Gemeinsamer Druckkopf"), nicht die Urheberin: „Erstellt
    // von" las sich auf Befehl und Lagebericht als Urheberschaft des Dokuments. Zwei Zeilen
    // statt „Gedruckt: DTG · Name": die DTG bleibt ein eigener, maschinenlesbarer Wert.
    { etikett: 'Gedruckt von', wert: benutzer?.anzeigename ?? '—' },
    { etikett: 'Gedruckt am', wert: taktischeDtgVoll(jetzt.toISOString(), konventionen) },
  ];

  return (
    <header
      data-lfh="druckkopf"
      className={sichtbarkeit === 'druck' ? 'druckkopf druckkopf--nur-druck' : 'druckkopf'}
      // Am Schirm ist der Kopf bei `druck` per CSS weg; `aria-hidden` sagt dasselbe dem
      // Zugänglichkeitsbaum, auch wo kein CSS geladen ist (jsdom). Auf Papier gibt es keinen
      // Vorlesebaum, die Angabe kostet dort nichts.
      aria-hidden={sichtbarkeit === 'druck' ? true : undefined}
      style={{ marginBlockEnd: token.marginLG }}
    >
      <div
        className="druckkopf__org"
        style={{ display: 'flex', alignItems: 'center', gap: token.marginSM, fontWeight: 600 }}
      >
        {/* Nur mit hinterlegtem Logo — sonst weder Bild noch Platzhalter. `?v=<sha256>`, damit
            ein ersetztes Logo nicht aus dem Bildspeicher kommt. `alt=""`: der Name steht
            daneben, das Bild wiederholt ihn nur. `useDrucken` wartet vor dem Druck auf
            `decode()` dieses Knotens. */}
        {logo && kaputtesLogo !== logo.sha256 && (
          <img
            className="druckkopf__logo"
            src={orgLogoPfad(logo.sha256)}
            alt=""
            style={{ maxHeight: 48, maxWidth: 200, objectFit: 'contain' }}
            onError={() => flushSync(() => setKaputtesLogo(logo.sha256))}
          />
        )}
        <span>{organisation.data?.name}</span>
      </div>
      <Ueberschrift
        className="druckkopf__titel"
        style={{ fontSize: token.fontSizeHeading4, margin: 0 }}
      >
        {titel ? `${dokumentart} – ${titel}` : dokumentart}
      </Ueberschrift>
      <dl
        className="druckkopf__angaben"
        style={{
          display: 'grid',
          gridTemplateColumns: 'max-content 1fr',
          columnGap: token.marginSM,
          rowGap: 2,
          margin: `${token.marginXS}px 0 0`,
        }}
      >
        {angaben.map((a) => (
          <div key={a.etikett} style={{ display: 'contents' }}>
            <dt style={{ color: token.colorTextSecondary }}>{a.etikett}</dt>
            <dd style={{ margin: 0 }}>{a.wert}</dd>
          </div>
        ))}
      </dl>
    </header>
  );
}
