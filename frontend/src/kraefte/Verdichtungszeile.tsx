import { StaerkeSchreibweise } from '../anzeige/KuerzelErklaerung';
import { Space } from 'antd';
import { Fragment } from 'react';
import { useModulFreigaben, useSprungSperre } from '../einsatz/useSprungSperre';
import { freigabeVon, modulName } from '../einsatz/modulRegistry';
import { MODUL_FAHRZEUGE_GESPERRT, MODUL_PERSONAL_GESPERRT } from '../components/nurAnsicht';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { einsatzKeys } from '../api/queryKeys';
import { listeEinsatzPersonal } from '../api/einsatzPersonal';
import { listeEinsatzFahrzeuge } from '../api/einsatzFahrzeuge';
import { statusKategorie, type Statusrolle } from '../theme/statusFarben';
import { statusFlaeche, tonVonRolle } from '../components/instrument/statusFlaeche';
import { useRollen } from '../components/instrument';
import { STAERKE_AUSGESCHRIEBEN, staerkeText } from '../anzeige/staerke';
import { verdichte } from './kraeftebild';

/**
 * Der Meldebild-Link als Bedienziel auf der Dichte-Staffel: ein `<a>` erbt keine Steuerhöhe
 * (im Browser blieb er im Handschuh-Betrieb bei 16 px).
 * ZWEI Angaben: `minHeight` aus `controlHeight` plus mitziehende Polsterung auf BEIDEN Achsen
 * (hier polstert niemand sonst). `inline-flex`, weil der Link ein Glied einer waagerechten
 * `Space`-Zeile ist; `flex` risse ihn auf volle Breite. Rein und exportiert, damit über zwei
 * Dichtestufen ohne Rendern prüfbar.
 */
export function verdichtungsLinkStil(
  token: { controlHeight: number; paddingSM: number },
  form: VerdichtungForm = 'zeile',
) {
  if (form === 'meta') {
    // Im Seitenkopf (LLH-1786): Boden ist die Steuerhöhe selbst, der Rand liegt im Kasten. Mit
    // Polsterung oben und unten wäre der Link in `kompakt` 46 statt 30 px hoch, und der Kopf der
    // Kräfteseiten stünde höher als der von Material (`e2e/kraefte-seitenkopf.spec.ts`).
    return {
      display: 'inline-flex',
      alignItems: 'center',
      boxSizing: 'border-box',
      minHeight: token.controlHeight,
      padding: `0 ${token.paddingSM}px`,
    } as const;
  }
  return {
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: token.controlHeight,
    padding: `${token.paddingSM}px`,
  } as const;
}

/**
 * Textfarbe einer Statuszahl in der Zeile: die TEXTROLLE des Tons (`normalText`/`achtungText`/
 * `alarmText`, über `statusFlaeche`), nicht die Füllrolle aus `rollenFarbe`. Die Zahlen stehen
 * als Text auf Seitengrund (`grund`); dort tragen die Füllrollen am Tag den Boden 7 : 1 nicht
 * (gemessen 5,80 / 5,78 / 5,66), die Textrollen schon (gerechnet 7,68 / 7,72 / 7,51; nachts 11,58 /
 * 12,45 / 7,18). LFH-538, gemessen in `e2e/kraefte-kontrast.spec.ts`. Rein.
 */
export function verdichtungsTextfarbe(
  rollen: Parameters<typeof statusFlaeche>[0],
  rolle: Statusrolle,
): string {
  return statusFlaeche(rollen, tonVonRolle(rolle) ?? 'neutral').text;
}

/**
 * Die Führungsantwort im Kopf einer Kräfte-Modulseite: Σ-Stärke und Fahrzeugverfügbarkeit über
 * der Tabelle, verlinkt auf das volle Meldebild.
 *
 * SIE LÄDT SELBST (wie die Lage-Dashboard-Kacheln), statt dass jede Seite Listen hereinreicht,
 * die sie selbst nicht anzeigt. Die Schlüssel sind DIESELBEN `einsatzKeys` wie auf den Seiten,
 * TanStack dedupliziert.
 *
 * KEIN MATERIAL: die Zeile beantwortet „welche Kräfte habe ich"; `verdichte` bekommt eine leere
 * Materialliste, der Abruf bleibt bei zwei Listen.
 *
 * STUMM BEI FEHLER UND BEIM LADEN: „0/0/0//0" läse sich wie „keine Kräfte im Einsatz", und ein
 * ein- und ausblendender Platzhalter verschöbe die Tabelle darunter. Die Fehleranzeige gehört
 * der Tabelle, die dieselben Daten trägt.
 *
 * GESPERRTES NACHBARMODUL (LLH-1462): ohne Freigabe von Personal oder Fahrzeuge fragt die Zeile
 * die Liste gar nicht ab (kein 403). Die freie Hälfte bleibt stehen, die gesperrte steht als
 * „—“ (Stärke) bzw. fehlt (Fahrzeugzahlen), daneben der Grund in Worten. Sind beide gesperrt,
 * ist die Zeile still: dann gibt es nichts zu verdichten.
 *
 * Den Pfad baut der Aufrufer; die Komponente kennt keine Einsatz-Routen.
 */

const KATEGORIEN = ['verfuegbar', 'gebunden', 'nicht_verfuegbar'] as const;

/**
 * Wo die Zeile steht: `zeile` als eigene Zeile über einer Liste, `meta` im Seitenkopf neben dem
 * Titel (LLH-1786, Change `z137bgm5-seitenkopf-einzeilig` D2; Fahrzeuge, Personal, Einheiten).
 */
export type VerdichtungForm = 'zeile' | 'meta';

export default function Verdichtungszeile({
  einsatzId,
  pfad,
  form = 'zeile',
  fahrzeugzahl = true,
  aufteilung = true,
}: {
  einsatzId: number;
  pfad: string;
  form?: VerdichtungForm;
  /** `false` auf der Fahrzeugseite: ihr Kopf nennt die Zahl schon („3 Fahrzeuge“, LLH-1786). */
  fahrzeugzahl?: boolean;
  /**
   * `false`, wo die Liste die Aufteilung verfügbar / gebunden / nicht verfügbar schon in ihren
   * Gruppenköpfen nennt (Fahrzeuge als Karten am Handschirm, LLH-1786): sie steht dann nur einmal.
   */
  aufteilung?: boolean;
}) {
  const { token, rollen } = useRollen();
  // Kein Link in ein gesperrtes Meldebild (LFH-888, design.md D4); die Zahlen bleiben.
  const meldebildGesperrt = useSprungSperre(einsatzId)('kraefteuebersicht');
  const freigaben = useModulFreigaben(einsatzId);
  const personalFrei = freigabeVon('personal', freigaben);
  const fahrzeugeFrei = freigabeVon('fahrzeuge', freigaben);
  const personalQuery = useQuery({
    queryKey: einsatzKeys.personal(einsatzId),
    queryFn: () => listeEinsatzPersonal(einsatzId),
    enabled: personalFrei === true,
  });
  const fahrzeugeQuery = useQuery({
    queryKey: einsatzKeys.fahrzeuge(einsatzId),
    queryFn: () => listeEinsatzFahrzeuge(einsatzId),
    enabled: fahrzeugeFrei === true,
  });

  // Der Datenriegel steht VORN: liegen keine Zahlen vor, ist die Zeile still — ob der Abruf noch
  // läuft oder scheiterte. Liegen Zahlen vor und scheitert erst ein Folgeabruf, bleiben sie
  // stehen (echt, nur womöglich alt), sonst spränge die Tabelle darunter unter dem Cursor.
  // Eine gesperrte Liste wartet auf nichts: sie fehlt bewusst (LLH-1462).
  const personalDa = personalFrei === false || personalQuery.data !== undefined;
  const fahrzeugeDa = fahrzeugeFrei === false || fahrzeugeQuery.data !== undefined;
  const laedt = !personalDa || !fahrzeugeDa;
  // Als eigene Zeile still beim Laden; im Kopf hält ein stummer Platzhalter in derselben Form
  // (dieselben Glieder, Zahlen als `0`) Breite und Umbruch der Meta-Gruppe (LLH-1463).
  if (laedt && form === 'zeile') return null;
  if (personalFrei === false && fahrzeugeFrei === false) return null;

  const v = verdichte(
    laedt ? [] : (personalQuery.data ?? []),
    laedt ? [] : (fahrzeugeQuery.data ?? []),
    [],
  );
  const sperre =
    personalFrei === false
      ? MODUL_PERSONAL_GESPERRT
      : fahrzeugeFrei === false
        ? MODUL_FAHRZEUGE_GESPERRT
        : null;
  const glieder = (
    <>
      {/* Die Schreibweise steht dabei (LLH-1750, Spec `lage-verdichtung`). */}
      <span style={{ color: token.colorTextSecondary }}>
        Stärke <StaerkeSchreibweise />
      </span>
      {/* Ohne Personal ist die Stärke unbekannt: „—“, nie „0/0/0//0“ (keine erfundenen Daten). */}
      <strong title={personalFrei === false || laedt ? undefined : STAERKE_AUSGESCHRIEBEN}>
        {personalFrei === false ? '—' : staerkeText(v.staerke)}
      </strong>
      {fahrzeugeFrei !== false && (fahrzeugzahl || aufteilung) && (
        <>
          <span aria-hidden>·</span>
          {fahrzeugzahl && (
            <span style={{ color: token.colorTextSecondary }}>Fahrzeuge {v.anzahlFahrzeuge}</span>
          )}
          {/* Zahl vor Wort, dieselben Wörter wie der Zählerstreifen der Tabelle darunter
              (LFH-973, `statusKategorie`): „verfügbar“ statt „frei“, „nicht verfügbar“
              ausgeschrieben. */}
          {aufteilung &&
            KATEGORIEN.map((k, i) => (
              <Fragment key={k}>
                {i > 0 && <span aria-hidden>·</span>}
                <span style={{ color: verdichtungsTextfarbe(rollen, statusKategorie[k].rolle) }}>
                  {v.fahrzeugStatus[k]} {statusKategorie[k].label}
                </span>
              </Fragment>
            ))}
        </>
      )}
      {sperre && (
        <>
          <span aria-hidden>·</span>
          <span data-lfh="verdichtung-sperre" style={{ color: token.colorTextSecondary }}>
            {sperre}
          </span>
        </>
      )}
      {/* Der Linktext ist der Name des Moduls (`modulName`); die Route bleibt `kraefteuebersicht`. */}
      {!meldebildGesperrt &&
        (laedt ? (
          // Im Platzhalter kein Link: er wäre unsichtbar, aber fokussierbar.
          <span style={verdichtungsLinkStil(token, form)}>{modulName('kraefteuebersicht')}</span>
        ) : (
          <Link to={pfad} style={verdichtungsLinkStil(token, form)}>
            {modulName('kraefteuebersicht')}
          </Link>
        ))}
    </>
  );
  if (form === 'meta') {
    // Im Kopf: die Glieder sind Glieder der Meta-Gruppe der `EinsatzSeite` (`display: contents`),
    // damit sie sich die Zeilen mit Zahl und Datenstand teilen, statt als ein Block eine eigene
    // Zeile zu nehmen. Die Gruppe bricht um, die Glieder nicht im Wort. Kein Abstand nach unten.
    return laedt ? (
      <span
        data-lfh="verdichtung-platzhalter"
        aria-hidden="true"
        style={{ display: 'contents', visibility: 'hidden' }}
      >
        {glieder}
      </span>
    ) : (
      <span data-lfh="verdichtung-meta" style={{ display: 'contents' }}>
        {glieder}
      </span>
    );
  }
  return (
    <Space
      wrap
      align="center"
      data-lfh="verdichtungszeile"
      style={{ marginBlockEnd: token.margin }}
    >
      {glieder}
    </Space>
  );
}
