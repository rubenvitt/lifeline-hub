import { useQuery, type QueryKey } from '@tanstack/react-query';
import { Button, Input, Space, type InputProps, type InputRef } from 'antd';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { OrtSucheAntwort, OrtTreffer } from '../api/karteOrtSuche';
import { useRollen } from '../components/instrument';
import { useOnline } from '../offline/useOnline';
import type { LatLon } from './koordinaten';
import { adressAussage, adressBegriff } from './ortssuche';

/**
 * Wert des Ortsfelds: der Text und, solange er der eines gewählten Treffers ist, dessen
 * Koordinate. Jede Textänderung setzt `koordinate` auf `null` (Spec `ortsfeld`, „Treffer setzt
 * Adresse und Koordinate“).
 */
export interface OrtsfeldWert {
  text: string;
  koordinate: LatLon | null;
}

export interface OrtsfeldProps {
  id?: string;
  'aria-label'?: string;
  autoFocus?: boolean;
  value?: OrtsfeldWert;
  onChange?: (wert: OrtsfeldWert) => void;
  /** Die Suche des Einstiegs (im Einsatz oder in der Organisation). */
  suchen: (begriff: string) => Promise<OrtSucheAntwort>;
  /** Query-Key der Suche zu einem Begriff, aus `api/queryKeys.ts`. */
  suchSchluessel: (begriff: string) => QueryKey;
  /**
   * Meldet, ob die Trefferliste offen ist — wie das Popup einer Auswahl. `InlineAngabe` reicht es
   * über `popup` herein: dann schließt Escape zuerst die Liste und verwirft erst danach die Zeile.
   */
  onOpenChange?: (offen: boolean) => void;
  /**
   * Zeichengrenze des Textes (`zeichenGrenze(max)` aus `components/zeichenGrenze.tsx`); die
   * passende `zeichenRegel` prüft der Aufrufer am Text des Werts.
   */
  count?: InputProps['count'];
}

/** Eine Suche: der Begriff und ihre laufende Nummer (je Enter oder Knopf eine neue). */
interface Anfrage {
  begriff: string;
  nr: number;
}

/**
 * Frische der Treffer im Client wie auf der Lagekarte: eine zweite Suche nach demselben Begriff
 * fragt nicht. Nur für `ok`; „ausgelastet“ und „nicht erreichbar“ verlangen einen neuen Versuch.
 */
const TREFFER_FRISCH_MS = 10 * 60_000;

/**
 * Ortsangabe mit Adresssuche (LFH-1175, Spec `ortsfeld`; Kern von LFH-1248). Gesucht wird nur auf
 * Enter oder „Ort suchen“, nie beim Tippen: der öffentliche Nominatim verbietet
 * Autovervollständigung, und der Takt des Servers gilt für alle (`pages/lagekarte/AGENTS.md`,
 * Ortssuche). Enter im Feld sucht und sendet das umgebende Formular NICHT ab; gespeichert wird
 * über dessen Knopf.
 *
 * Freitext bleibt erlaubt; eine Koordinate von Hand gehört in die Koordinateneingabe daneben.
 */
export function Ortsfeld({
  id,
  'aria-label': ariaLabel,
  autoFocus,
  value = { text: '', koordinate: null },
  onChange,
  suchen,
  suchSchluessel,
  onOpenChange,
  count,
}: OrtsfeldProps) {
  const { token, rollen } = useRollen();
  const online = useOnline();
  const [anfrage, setAnfrage] = useState<Anfrage | null>(null);
  const nrRef = useRef(0);
  const feldRef = useRef<InputRef>(null);
  const begriff = adressBegriff(value.text);
  const listeOffen = online && anfrage !== null;

  // Offen/zu nur beim Wechsel melden; der Anfangszustand „zu“ ist keine Meldung.
  const gemeldetRef = useRef(false);
  useEffect(() => {
    if (gemeldetRef.current === listeOffen) return;
    gemeldetRef.current = listeOffen;
    onOpenChange?.(listeOffen);
  }, [listeOffen, onOpenChange]);

  function sucheStarten() {
    if (!online || begriff === null) return;
    nrRef.current += 1;
    setAnfrage({ begriff, nr: nrRef.current });
  }

  function tasten(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
    // Kein implizites Absenden des umgebenden Formulars: Enter sucht.
    e.preventDefault();
    sucheStarten();
  }

  /**
   * Escape am ganzen Feld (Eingabe, „Ort suchen“, Treffer): eine offene Liste schließt zuerst
   * allein; erst das nächste Escape gehört dem Formular (Zeile verwerfen, Dialog schließen).
   */
  function escape(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'Escape' || !listeOffen) return;
    e.preventDefault();
    setAnfrage(null);
    fokusInsFeld();
  }

  /** Der Fokus fällt nicht auf `<body>`, wenn die Liste mit dem fokussierten Knopf aushängt. */
  function fokusInsFeld() {
    feldRef.current?.focus();
  }

  function waehlen(t: OrtTreffer) {
    onChange?.({ text: t.kurz ?? t.name, koordinate: { lat: t.lat, lon: t.lon } });
    setAnfrage(null);
    fokusInsFeld();
  }

  return (
    <div
      onKeyDown={escape}
      style={{ display: 'flex', flexDirection: 'column', gap: token.marginXS, minWidth: 0 }}
    >
      {/* `minWidth: 0` am Feld: antds Eingabe bringt eine Mindestbreite mit und weitete am Handy
          das Raster der Zeile über 390 px (e2e `einsatzort-ortssuche.spec.ts`). */}
      <Space.Compact style={{ width: '100%', display: 'flex' }}>
        <Input
          ref={feldRef}
          style={{ flex: '1 1 auto', minWidth: 0 }}
          id={id}
          aria-label={ariaLabel}
          autoFocus={autoFocus}
          value={value.text}
          count={count}
          onChange={(e) => {
            onChange?.({ text: e.target.value, koordinate: null });
            setAnfrage(null);
          }}
          onKeyDown={tasten}
        />
        <Button disabled={!online || begriff === null} onClick={sucheStarten}>
          Ort suchen
        </Button>
      </Space.Compact>
      {!online ? (
        <div role="status" style={{ color: rollen.text2 }}>
          Adresssuche ohne Netz nicht verfügbar
        </div>
      ) : (
        anfrage && (
          <OrtsfeldTreffer
            anfrage={anfrage}
            suchen={suchen}
            suchSchluessel={suchSchluessel}
            onWaehlen={waehlen}
            onNeuerVersuch={fokusInsFeld}
          />
        )
      )}
    </div>
  );
}

/**
 * Treffer einer Suche. Eigene Komponente, weil nur sie den Server fragt: der Query-Key hängt am
 * Begriff, ohne Anfrage gibt es keinen.
 */
function OrtsfeldTreffer({
  anfrage,
  suchen,
  suchSchluessel,
  onWaehlen,
  onNeuerVersuch,
}: {
  anfrage: Anfrage;
  suchen: (begriff: string) => Promise<OrtSucheAntwort>;
  suchSchluessel: (begriff: string) => QueryKey;
  onWaehlen: (t: OrtTreffer) => void;
  /** Vor „Erneut suchen“: der Knopf hängt mit der Antwort aus, der Fokus geht ins Feld. */
  onNeuerVersuch: () => void;
}) {
  const { token, rollen } = useRollen();
  const abfrage = useQuery({
    queryKey: suchSchluessel(anfrage.begriff),
    queryFn: () => suchen(anfrage.begriff),
    staleTime: (q) => (q.state.data?.zustand === 'ok' ? TREFFER_FRISCH_MS : 0),
    retry: false,
  });
  const { refetch, isError, data } = abfrage;

  // Eine neue Suche nach demselben Begriff fragt nach einem Fehlzustand neu, wie „Erneut suchen“.
  const gefragtFuerRef = useRef(anfrage.nr);
  useEffect(() => {
    if (gefragtFuerRef.current === anfrage.nr) return;
    gefragtFuerRef.current = anfrage.nr;
    if (isError || (data != null && data.zustand !== 'ok')) void refetch();
  }, [anfrage.nr, isError, data, refetch]);

  if (abfrage.isPending) {
    return (
      <div role="status" style={{ color: rollen.text2 }}>
        Sucht …
      </div>
    );
  }

  const aussage = adressAussage(anfrage.begriff, data, isError);
  if (aussage) {
    const nochmal = isError || data?.zustand !== 'ok';
    return (
      <div
        role="status"
        style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: token.marginXS }}
      >
        {aussage}
        {nochmal && (
          <Button
            loading={abfrage.isFetching}
            onClick={() => {
              onNeuerVersuch();
              void refetch();
            }}
          >
            Erneut suchen
          </Button>
        )}
      </div>
    );
  }

  return (
    <ul
      aria-label="Treffer"
      style={{
        listStyle: 'none',
        margin: 0,
        padding: 0,
        display: 'flex',
        flexDirection: 'column',
        border: `1px solid ${rollen.linie}`,
      }}
    >
      {(data?.treffer ?? []).map((t, i) => (
        <li key={`${i}:${t.lat},${t.lon}`} style={{ minWidth: 0 }}>
          <Button
            type="text"
            block
            onClick={() => onWaehlen(t)}
            style={{
              height: 'auto',
              minWidth: 0,
              maxWidth: '100%',
              minHeight: token.controlHeight,
              paddingBlock: token.paddingXXS,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              justifyContent: 'center',
              textAlign: 'start',
              whiteSpace: 'normal',
            }}
          >
            <span style={{ overflowWrap: 'anywhere' }}>{t.kurz ?? t.name}</span>
            {t.kurz && (
              <span
                // Umbrechen statt abschneiden: eine Zeile ohne Umbruch ginge mit voller Breite in die
                // Mindestbreite des Rasters ein und weitete die Seite am Handy.
                style={{
                  color: rollen.text2,
                  fontSize: token.fontSizeSM,
                  overflowWrap: 'anywhere',
                }}
              >
                {t.name}
              </span>
            )}
          </Button>
        </li>
      ))}
    </ul>
  );
}
