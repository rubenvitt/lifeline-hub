import { Button, Flex, Space, Typography } from 'antd';
import type { Dayjs } from 'dayjs';
import type { Abloesung, BeendetGrund, RhythmusQuelle } from '../api/types';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import { MenueAusloeser, type MenueEintrag } from '../components/MenueAusloeser';
import { ZeilenFehler } from '../components/SpeicherHinweis';
import type { ZeilenGrund } from '../components/useZeilenFehler';
import StatusTag from '../components/StatusTag';
import { monoStil, useRollen } from '../components/instrument';
import { dauerText } from '../lagebesprechung/lagebesprechungZustand';
import { abloesungEinstufung, rollenFarbe } from '../theme/statusFarben';
import { schrift } from '../theme/tokens';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { abloeserText } from './abloeser';
import { besatzungPlanText, besatzungText, nachBesatzungswechselText } from './besatzung';
import { verbleibText } from './verbleib';
import { beginnWort } from './beginnText';
import { abloeserStandText, type AbloeserStand } from './abloeserStand';
import { formatDauer } from './dauer';
import { abloesungZeit, einstufungOf } from './einstufung';
import { planungEntfallenText, planungWarnungText } from './planungWarnung';

const { Text } = Typography;

interface AbloesungKarteProps {
  schicht: Abloesung;
  jetzt: Dayjs;
  darfSchreiben: boolean;
  onVollziehen?: (schicht: Abloesung) => void;
  onAbloeserPlanen?: (schicht: Abloesung) => void;
  onRhythmusAendern?: (schicht: Abloesung) => void;
  onZuruecknehmen?: (schicht: Abloesung) => void;
  /** Grund der zuletzt abgelehnten Rücknahme an dieser Karte, aus `components/useZeilenFehler.ts`. */
  fehlerGrund?: ZeilenGrund | null;
  /**
   * Stand der geplanten Ablöser aus der Kräfte-Zeitachse (LLH-1131 Teil II,
   * `abloesung/abloeserStand.ts`); `null`, solange keiner ein Ereignis trägt.
   */
  abloeserStand?: readonly AbloeserStand[] | null;
  /** Per Deeplink `?schicht=` angesprungen (Spec `deeplink-hervorhebung`). */
  hervorgehoben?: boolean;
}

/** Einzeilig mit „…“, der ganze Text im `title` (LFH-708: fremde Änderungen ändern die Höhe nicht). */
const EINZEILIG = {
  display: 'block',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
} as const;

/** Zeiten in Mono mit festen Ziffern, in der Größe der Zeile (LFH-771). */
const ZAHL = { fontFamily: schrift.zahl, fontVariantNumeric: 'tabular-nums' } as const;

/** „in 23 min" · „seit 12 min überfällig" — das Wort neben der Uhrzeit. */
function abstandText(faelligAt: string, jetzt: Dayjs): string {
  const f = abloesungZeit(faelligAt);
  if (!f) return '';
  const minuten = Math.floor((f.valueOf() - jetzt.valueOf()) / 60_000);
  if (minuten < 0) return `seit ${dauerText(-minuten)}`;
  if (minuten === 0) return 'in < 1 min';
  return `in ${dauerText(minuten)}`;
}

/** Herkunft des Rhythmus in der Karte (LLH-1122: Rangfolge eigen → Abschnitt → Einsatz). */
const QUELLE_WORT: Record<RhythmusQuelle, string> = {
  einheit: 'eigen',
  abschnitt: 'Vorgabe',
  einsatz: 'Vorgabe Einsatz',
};

/** Grund des Endes ohne Ablösung (LLH-1128) im Wortlaut der Karte. */
const GRUND_WORT: Record<BeendetGrund, string> = {
  entlassung: 'entlassen',
  aufloesung: 'aufgelöst',
};

/** Die Zeitspalte je Status: welcher Zeitpunkt führt und welches Wort darunter steht. */
function zeitspalte(s: Abloesung): { zeit: string | null | undefined; wort: string } {
  if (s.status === 'laufend') return { zeit: s.faellig_at, wort: 'fällig' };
  if (s.status === 'beendet') return { zeit: s.beendet_at, wort: 'beendet' };
  return { zeit: s.vollzogen_at, wort: 'abgelöst' };
}

/**
 * Eine Schicht. Der linke Rand trägt die Einstufung — EINE Farbe, Gefahr gewinnt: überfällig
 * rot, Vorwarnung gelb, sonst Linienfarbe. Zweiter Kanal ist das Wort im Etikett (WCAG 1.4.1).
 * Nichts blinkt.
 *
 * „Ablösung vollziehen" ist die sichtbare Kartenaktion, „Ablösung planen" (Ablöser oder
 * Besatzungswechsel, LLH-1319) und „Rhythmus ändern" liegen im Dreipunkt-Menü (ab drei Aktionen
 * wird gebündelt). Ohne Schreibrecht fällt die Aktionszeile ganz weg; den Grund nennt der
 * Seitenkopf. Ein geplanter Besatzungswechsel steht an der Stelle der Ablöser („Besatzungswechsel
 * geplant · neu: …“), die Folgeschicht eines Wechsels nennt ihre Besatzung („nach
 * Besatzungswechsel · Besatzung: …“).
 *
 * Nicht laufend ist eine Schicht abgelöst (Zeitspalte: Vollzug) oder beendet (LLH-1128,
 * Zeitspalte: Ende, dazu „beendet · entlassen …“ bzw. „beendet · aufgelöst“). Eine laufende nennt
 * die Untereinheiten, die sie erben („gilt auch für: …“, Knoten-Modell).
 *
 * Hinweise an die Führung (LLH-1131 Teil II): Trägt ein geplanter Ablöser ein Ereignis der
 * Zeitachse, wird aus „Ablösung geplant durch …“ in derselben Zeile „Ablösung: 2. Rettungsstaffel ·
 * alarmiert 1340 · eingetroffen 1412 (BR Sportplatz)“, abgerufen aus dem Raum mit „· abgerufen …“
 * (LLH-1309). Ist die Planung entfallen und kein Ablöser geblieben, steht dezent „Planung entfallen
 * · 2. Rettungsstaffel aufgelöst“ (`planung_entfallen`, LLH-1309). Die Warnungen zur Planung
 * (`planung_warnungen`) stehen dezent in einer Zeile in der Rolle Achtung, im Wortlaut der Meldung
 * beim Planen; sie sind keine Einstufung und färben weder Kante noch Fläche. Angesprungen
 * (`?schicht=`) trägt die Karte die Deeplink-Hervorhebung: Bedienfläche, Linie oben und unten,
 * Gefahr gewinnt (eine überfällige Karte behält ihre Alarmfläche).
 */
export default function AbloesungKarte({
  schicht: s,
  jetzt,
  darfSchreiben,
  onVollziehen,
  onAbloeserPlanen,
  onRhythmusAendern,
  onZuruecknehmen,
  fehlerGrund,
  abloeserStand,
  hervorgehoben = false,
}: AbloesungKarteProps) {
  const { token, rollen } = useRollen();
  const { konventionen } = useAnzeigeKonventionen();
  const laufend = s.status === 'laufend';
  const spalte = zeitspalte(s);
  const erben =
    s.erbende_einheiten.length > 0
      ? `gilt auch für: ${s.erbende_einheiten.map((e) => e.einheit_name).join(', ')}`
      : null;
  const durch = abloeserText(s);
  const plan = laufend ? besatzungPlanText(s) : null;
  const nachWechsel = laufend ? nachBesatzungswechselText(s) : null;
  const stufe = laufend ? einstufungOf(s, jetzt) : null;
  const darstellung = stufe ? abloesungEinstufung[stufe] : null;
  const kante =
    darstellung && darstellung.rolle !== 'neutral'
      ? rollenFarbe(darstellung.rolle, token)
      : rollen.linie;
  const stand = laufend && abloeserStand && abloeserStand.length > 0 ? abloeserStand : null;
  const warnungen = laufend
    ? s.planung_warnungen.map((w) => planungWarnungText(w, konventionen)).join(' · ')
    : '';
  const entfallen = s.planung_entfallen ? planungEntfallenText(s.planung_entfallen) : null;
  const grund =
    stufe === 'ueberfaellig'
      ? rollen.alarmFlaeche
      : hervorgehoben
        ? rollen.bedienFlaeche
        : rollen.paneel;

  const menue: MenueEintrag<'abloeser' | 'rhythmus'>[] = [
    ...(onAbloeserPlanen ? [{ key: 'abloeser' as const, label: 'Ablösung planen' }] : []),
    ...(onRhythmusAendern ? [{ key: 'rhythmus' as const, label: 'Rhythmus ändern' }] : []),
  ];

  return (
    <article
      data-lfh="abloesung-karte"
      data-einstufung={stufe ?? undefined}
      data-alarm={stufe === 'ueberfaellig' ? 'true' : undefined}
      data-hervorgehoben={hervorgehoben ? 'true' : undefined}
      data-schicht-id={s.id}
      aria-label={`Schicht ${s.einheit_name}`}
      style={{
        display: 'flex',
        alignItems: 'stretch',
        minWidth: 0,
        marginBottom: token.marginXS,
        background: grund,
        border: `1px solid ${rollen.linie}`,
        borderInlineStart: `3px solid ${kante}`,
        // Wie `kommunikation/KommKarte.tsx` (LFH-896): Linien innen, kein Ring, die Kante bleibt.
        boxShadow: hervorgehoben
          ? `inset 0 2px 0 ${rollen.bedien}, inset 0 -2px 0 ${rollen.bedien}`
          : undefined,
        color: rollen.text,
      }}
    >
      {/* Zeitspalte: die Fälligkeit bzw. der Vollzug führt, in Mono. Die Zeit ist immer so breit
          wie das breiteste `kurz`-Format (`DDHHmm`, sechs Ziffern): `HHmm` gilt nur für heute,
          und wüchse die Spalte mit dem Text, bräche die Karte kurz vor Mitternacht anders um als
          am Tag — eine fremde Rhythmusänderung ließ sie dann mobil um eine Zeile wachsen
          (LFH-708, Kriterium 12). `ch` misst die Ziffer der Mono-Schrift, also jede Dichte.
          Herleitung:
          `openspec/changes/archive/2026-10-01-lfh-708-abloesungskarte-hoehe-stabil/design.md` */}
      <div
        style={{
          flex: '0 0 auto',
          minWidth: 64,
          paddingBlock: token.paddingSM,
          paddingInline: token.padding,
          borderInlineEnd: `1px solid ${rollen.flaeche3}`,
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
        }}
      >
        <span style={{ ...monoStil(13, 500), minWidth: '6ch' }} data-lfh="abloesung-zeit">
          <ZeitAnzeige wert={spalte.zeit} rolle="kurz" />
        </span>
        <span style={{ ...monoStil(10), color: rollen.schwach }}>{spalte.wort}</span>
      </div>
      <div style={{ flex: 1, minWidth: 0, padding: token.paddingSM }}>
        <Flex justify="space-between" align="center" gap={token.marginXS} wrap>
          <Text strong style={{ fontSize: 15 }}>
            {s.einheit_name}
          </Text>
          {darstellung && <StatusTag darstellung={darstellung} />}
        </Flex>
        <Space orientation="vertical" size={2} style={{ width: '100%', marginTop: 4 }}>
          {laufend && <Text data-lfh="abloesung-abstand">{abstandText(s.faellig_at, jetzt)}</Text>}
          <Text type="secondary">
            {s.abschnitt_name ? `${s.abschnitt_name} · ` : ''}
            {/* Die Herkunft im Wort vor der Zeit (LLH-1312), keine eigene Zeile. */}
            {beginnWort(s.beginn_quelle)}{' '}
            {/* Zeiten in Mono mit festen Ziffern, in der Größe der Zeile (LFH-771): in der
                Textschrift hinge die Breite und damit der Umbruch an den Ziffern. */}
            <span
              data-lfh="abloesung-beginn"
              style={{ fontFamily: schrift.zahl, fontVariantNumeric: 'tabular-nums' }}
            >
              <ZeitAnzeige wert={s.beginn_at} rolle="kurz" />
            </span>
          </Text>
          {/* Eigene Zeile: Wert und Quelle ändert eine fremde Rhythmusänderung, und nur diese
              Zeile darf sie berühren; sie bleibt deshalb immer einzeilig (LFH-708). Den Abschnitt
              nennt die Zeile darüber, seine Vorgabe heißt nur „Vorgabe“. „Vorgabe Einsatz“
              (LLH-1122) passt auf 390 px in `komfortabel` für jeden Wert (167:59 h: 252 von
              256 px); nur im Handschuh-Betrieb auf 390 px kürzt die Zeile bei Werten mit Minuten
              oder ab 100 h das Quellenwort mit „…“, nie den Wert, und der ganze Text steht im
              `title` (gemessen in `e2e/abloesung-zufluss.spec.ts`). */}
          <Text
            type="secondary"
            data-lfh="abloesung-rhythmus"
            title={`Rhythmus ${formatDauer(s.rhythmus_minuten)} (${QUELLE_WORT[s.rhythmus_quelle]})`}
            style={{
              display: 'block',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            <span data-lfh="abloesung-rhythmus-wert">
              Rhythmus {formatDauer(s.rhythmus_minuten)}
            </span>{' '}
            ({QUELLE_WORT[s.rhythmus_quelle]})
          </Text>
          {/* Knoten-Modell (LLH-1118 Punkt 1): die Erben nennt der Server, der Client rechnet
              nichts nach. Einzeilig wie der Rhythmus: kommt ein Erbe hinzu oder fällt einer weg,
              ändert das die Höhe nur, wenn die Zeile erscheint oder verschwindet. */}
          {laufend && erben && (
            <Text
              type="secondary"
              data-lfh="abloesung-erben"
              title={erben}
              style={{
                display: 'block',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {erben}
            </Text>
          )}
          {/* Folgeschicht eines Besatzungswechsels (LLH-1319): die Besatzung beim Wechsel, nicht
              die heutige Zuordnung; einzeilig, der ganze Text im Titel, ohne Einstufung. */}
          {nachWechsel && (
            <Text
              type="secondary"
              data-lfh="abloesung-nach-besatzungswechsel"
              title={`nach Besatzungswechsel · Besatzung: ${nachWechsel}`}
              style={EINZEILIG}
            >
              nach Besatzungswechsel · Besatzung: {nachWechsel}
            </Text>
          )}
          {/* Geplanter Besatzungswechsel (LLH-1319) an der Stelle der Ablöser: eine Schicht plant
              das eine oder das andere. Einzeilig, samt Verteilung im Titel. */}
          {plan && (
            <Text
              type="secondary"
              data-lfh="abloesung-besatzung-plan"
              title={`Besatzungswechsel geplant · neu: ${plan.voll}`}
              style={EINZEILIG}
            >
              Besatzungswechsel geplant · neu: {plan.kurz}
            </Text>
          )}
          {/* Die Ablöser als Liste (LLH-1132), eine übernommene Schicht mit Vermerk. Einzeilig
              wie die Erben: eine fremde Planung ändert die Höhe nur, wenn die Zeile erscheint
              oder verschwindet; der ganze Text steht im Titel. */}
          {stand ? (
            <Text
              type="secondary"
              data-lfh="abloesung-abloeser"
              title={abloeserStandText(stand, konventionen)}
              style={EINZEILIG}
            >
              Ablösung:{' '}
              {stand.map((a, i) => (
                <span key={a.einheit_id}>
                  {i > 0 && '; '}
                  {a.einheit_name}
                  {a.alarmiert_at && (
                    <>
                      {' · alarmiert '}
                      <span data-lfh="abloesung-abloeser-zeit" style={ZAHL}>
                        <ZeitAnzeige wert={a.alarmiert_at} rolle="kurz" />
                      </span>
                    </>
                  )}
                  {a.eingetroffen_at && (
                    <>
                      {' · eingetroffen '}
                      <span data-lfh="abloesung-abloeser-zeit" style={ZAHL}>
                        <ZeitAnzeige wert={a.eingetroffen_at} rolle="kurz" />
                      </span>
                    </>
                  )}
                  {a.abgerufen_at && (
                    <>
                      {' · abgerufen '}
                      <span data-lfh="abloesung-abloeser-zeit" style={ZAHL}>
                        <ZeitAnzeige wert={a.abgerufen_at} rolle="kurz" />
                      </span>
                    </>
                  )}
                  {a.br_name && ` (${a.br_name})`}
                </span>
              ))}
            </Text>
          ) : (
            durch &&
            s.status !== 'beendet' && (
              <Text
                type="secondary"
                data-lfh="abloesung-abloeser"
                title={`${laufend ? 'Ablösung geplant durch' : 'Abgelöst durch'} ${durch}`}
                style={{
                  display: 'block',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {laufend ? 'Ablösung geplant durch ' : 'Abgelöst durch '}
                {durch}
              </Text>
            )
          )}
          {/* Entfallene Planung (LLH-1309): nur an einer laufenden Schicht ohne Ablöser, das
              entscheidet der Server. Dezent in der Rolle Achtung wie die Warnungen, einzeilig. */}
          {laufend && entfallen && (
            <Text
              data-lfh="abloesung-planung-entfallen"
              title={entfallen}
              style={{ ...EINZEILIG, color: rollen.achtungText }}
            >
              {entfallen}
            </Text>
          )}
          {/* Plausibilität beim Planen (LLH-1131): dezent, Rolle Achtung, nie Rot; die Planung
              gilt trotzdem. Einzeilig wie die Ablöser, der ganze Text im Titel. */}
          {warnungen && (
            <Text
              data-lfh="abloesung-planung-warnung"
              title={warnungen}
              style={{ ...EINZEILIG, color: rollen.achtungText }}
            >
              {/* Wortlaut aus `planungWarnungText`; die Uhrzeit in Mono wie jede Zeit der Karte. */}
              {s.planung_warnungen.map((w, i) => (
                <span key={`${w.art}-${w.einheit_id}-${w.abloesung_id ?? ''}`}>
                  {i > 0 && ' · '}
                  {w.art === 'im_einsatz' && w.seit_at ? (
                    <>
                      {w.einheit_name} steht selbst im Einsatz seit{' '}
                      <span data-lfh="abloesung-warnung-zeit" style={ZAHL}>
                        <ZeitAnzeige wert={w.seit_at} rolle="kurz" />
                      </span>
                    </>
                  ) : (
                    planungWarnungText(w, konventionen)
                  )}
                </span>
              ))}
            </Text>
          )}
          {s.status === 'abgeloest' && s.abschnitt_uebergeben && (
            <Text type="secondary" data-lfh="abloesung-abschnitt-uebergeben">
              Abschnitt {s.uebergebener_abschnitt_name ?? ''} übergeben
            </Text>
          )}
          {s.status === 'abgeloest' && verbleibText(s) != null && (
            <Text type="secondary" data-lfh="abloesung-verbleib">
              {verbleibText(s)}
            </Text>
          )}
          {/* Besatzungswechsel (LLH-1150): Einheit und Fahrzeug blieben, die neue Besatzung steht
              hier; einzeilig, beide Besatzungen im Titel. */}
          {s.status === 'abgeloest' && s.art === 'besatzung' && (
            <Text
              type="secondary"
              data-lfh="abloesung-besatzung"
              title={`Besatzungswechsel. Neue Besatzung: ${besatzungText(s, 'neu') ?? 'keine'}. Bisherige: ${besatzungText(s, 'alt') ?? 'keine'}`}
              style={{
                display: 'block',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              Besatzungswechsel · neu: {besatzungText(s, 'neu') ?? 'keine'}
            </Text>
          )}
          {/* Ende ohne Ablösung (LLH-1128): kein „abgelöst“, der Grund als Wort. Die Uhrzeit
              nur bei der Entlassung, wie die Einsatzkräfte sie melden; die Zeitspalte trägt das
              Ende in jedem Fall. */}
          {s.status === 'beendet' && (
            <Text type="secondary" data-lfh="abloesung-ende">
              beendet
              {s.beendet_grund ? ` · ${GRUND_WORT[s.beendet_grund]}` : ''}
              {s.beendet_grund === 'entlassung' && s.beendet_at && (
                <>
                  {' '}
                  <span style={{ fontFamily: schrift.zahl, fontVariantNumeric: 'tabular-nums' }}>
                    <ZeitAnzeige wert={s.beendet_at} rolle="kurz" />
                  </span>
                </>
              )}
            </Text>
          )}
        </Space>
        {darfSchreiben && laufend && (
          // `marginSM` = 7 / 11 / 16 px: im Handschuh-Betrieb ≥ 16 px zwischen zwei Zielen
          // (MIL-STD-1472F Fig. 24).
          <Flex justify="flex-end" gap={token.marginSM} style={{ marginTop: token.marginXS }}>
            {onVollziehen && (
              // Kein `type="primary"`: die eine Primäraktion der Seite steht im Kopf; n blaue Kartenknöpfe
              // nähmen der Einstufung am Rand die Aufmerksamkeit.
              <Button onClick={() => onVollziehen(s)}>Ablösung vollziehen</Button>
            )}
            <MenueAusloeser
              eintraege={menue}
              zugaenglicherName={`Aktionen zu ${s.einheit_name}`}
              onWahl={(key) => {
                if (key === 'abloeser') onAbloeserPlanen?.(s);
                if (key === 'rhythmus') onRhythmusAendern?.(s);
              }}
            />
          </Flex>
        )}
        {/* Grund einer abgelehnten Rücknahme über dem Knopf, bis zur nächsten (LFH-1077). */}
        {fehlerGrund && (
          <div style={{ marginTop: token.marginXS }}>
            <ZeilenFehler fehler={fehlerGrund.fehler} fallback={fehlerGrund.fallback} />
          </div>
        )}
        {darfSchreiben && !laufend && s.ruecknehmbar && onZuruecknehmen && (
          <Flex justify="flex-end" style={{ marginTop: token.marginXS }}>
            <Button onClick={() => onZuruecknehmen(s)}>Vollzug zurücknehmen</Button>
          </Flex>
        )}
      </div>
    </article>
  );
}
