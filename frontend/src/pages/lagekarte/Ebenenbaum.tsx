import { Button, Input, Modal, Radio, Space, Tooltip, Typography } from 'antd';
import { useId, useState } from 'react';
import { IconHaken, IconLupe, IconMinus, IconSchloss } from '../../icons';
import { monoStil, useRollen } from '../../components/instrument';
import { SeitenLeer } from '../../components/SeitenZustand';
import { SpeicherFehler } from '../../components/SpeicherHinweis';
import { fachebeneFarbe } from '../../theme/statusFarben';
import type { FachebeneQuelle } from '../../api/fachebenen';
import AnsichtSwitcher from './AnsichtSwitcher';
import BildHintergruende, { loeschDialogBild } from './BildHintergruende';
import FachebeneStand from './FachebeneStand';
import { FACHEBENEN, fachebeneKeys, istBboxAbhaengig } from './fachebenen';
import Klassenlegende from './Klassenlegende';
import { KlappPaneel, LeistenAbschnitt } from './KlappPaneel';
import {
  FACHEBENEN_GRUPPEN,
  ebenenFarbe,
  ebenenGruppen,
  ebenenZeilen,
  filtereGruppe,
  gruppenZiel,
  gruppenZustand,
  type BaumKnoten,
  type EbenenZeile,
  type GruppenZustand,
} from './leistenDaten';
import { FehlerSlot, ebenenZeileStil } from './leistenTeile';
import { useBaumKlapp } from './leistenWahl';
import Sichtungslegende from './Sichtungslegende';
import type { KartenThemeWahl } from './basemapStil';
import type { SidebarProps } from './Sidebar';

/** Kantenlänge des Farbfelds einer Ebenen-Zeile (Neuentwurf S5). */
const FARBFELD = 14;

/**
 * Eine Zeile einer eigenen Ebene: Farbfeld · Name · Anzahl; Klick schaltet die Ebene.
 * `role="switch"` + `aria-checked` tragen den Zustand; das Farbfeld (gefüllt an, leer aus) ist der
 * zweite Kanal. Der zugängliche Name ist der Ebenenname allein.
 */
function EbenenZeilenKnopf({
  zeile,
  onUmschalten,
}: {
  zeile: EbenenZeile;
  onUmschalten: (an: boolean) => void;
}) {
  const { token, rollen } = useRollen();
  const eingeblendetId = useId();
  const farbe = ebenenFarbe(zeile.key, rollen);
  if (zeile.sperrgrund) return <GesperrteEbenenZeile zeile={zeile} grund={zeile.sperrgrund} />;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={zeile.sichtbar}
      aria-label={zeile.name}
      aria-describedby={zeile.eingeblendet ? eingeblendetId : undefined}
      data-ebene={zeile.key}
      className="lfh-ebenenzeile"
      onClick={() => onUmschalten(!zeile.sichtbar)}
      style={{
        ...ebenenZeileStil(token),
        borderBlockEnd: `1px solid ${rollen.flaeche3}`,
        // Aus = `text2`, nicht `schwach`: den Zustand tragen Farbfeld und `aria-checked`, die
        // Schrift hält in jedem Zustand den Textboden, auch auf dem Hover-Grund `flaeche3`
        // (`schwach` am Tag 5,8 : 1 auf `paneel`; LFH-671, `e2e/lagekarte-ebenen-kontrast.spec.ts`).
        color: zeile.sichtbar ? rollen.text : rollen.text2,
      }}
    >
      <Farbfeld an={zeile.sichtbar} farbe={farbe} />
      <span style={{ flex: 1, minWidth: 0, fontSize: 12 }}>
        {zeile.name}
        {/* Aus, aber für den Verortungsauftrag gezeichnet (LLH-1125): der Zusatz sagt, warum Marker
            trotz ausgeschalteter Ebene stehen. Der zugängliche Name bleibt der Ebenenname. */}
        {zeile.eingeblendet && (
          <span id={eingeblendetId} style={{ color: rollen.text2 }}>
            {' · eingeblendet'}
          </span>
        )}
      </span>
      {/* `text2` aus demselben Grund; `gedaempft` hielte am Tag auf `flaeche3` nur 6,6 : 1. */}
      <span style={{ ...monoStil(11), color: rollen.text2 }}>{zeile.anzahl}</span>
    </button>
  );
}

/** Das Farbfeld einer Zeile: gefüllt an, leer aus — der zweite Kanal neben `aria-checked`. */
function Farbfeld({ an, farbe }: { an: boolean; farbe: string }) {
  const { rollen } = useRollen();
  return (
    <span
      aria-hidden="true"
      data-lfh="ebenen-farbfeld"
      style={{
        width: FARBFELD,
        height: FARBFELD,
        flex: `0 0 ${FARBFELD}px`,
        borderWidth: 1,
        borderStyle: 'solid',
        borderColor: an ? farbe : rollen.steuerRahmen,
        background: an ? `color-mix(in srgb, ${farbe} 55%, transparent)` : 'transparent',
      }}
    />
  );
}

/**
 * Eine gesperrte Ebenen-Zeile (Betroffene, Betreuungsstellen, Bereitstellungsräume, Tiere ohne
 * Zugriff), gebaut wie ein gesperrtes Modul in `einsatz/ModulPanel.tsx`: `disabled`, Schloss in
 * `aria-hidden`-Hülle, der Grund als Text statt einer Zahl. Kein `role="switch"` — ohne Zugriff
 * gibt es keinen Zustand. Die Zahl entfällt, weil sie die Menge wäre, die der Benutzer nicht sehen
 * darf.
 */
function GesperrteEbenenZeile({ zeile, grund }: { zeile: EbenenZeile; grund: string }) {
  const { token, rollen } = useRollen();
  return (
    <button
      type="button"
      disabled
      aria-label={`${zeile.name} – ${grund}`}
      title={grund}
      data-ebene={zeile.key}
      data-gesperrt="true"
      className="lfh-ebenenzeile"
      style={{
        ...ebenenZeileStil(token),
        cursor: 'not-allowed',
        background: 'transparent',
        borderBlockEnd: `1px solid ${rollen.flaeche3}`,
        // `text2`, nicht `schwach`: der Grund ist die Aussage der Zeile, keine Beischrift.
        color: rollen.text2,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: FARBFELD,
          height: FARBFELD,
          flex: `0 0 ${FARBFELD}px`,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 11,
          color: rollen.schwach,
        }}
      >
        <IconSchloss />
      </span>
      <span style={{ flex: 1, minWidth: 0, fontSize: 12 }}>{zeile.name}</span>
      <span style={{ fontSize: 11 }}>{grund}</span>
    </button>
  );
}

/**
 * Zeile einer Fachebene — dieselbe Form wie eine eigene Ebene (Spec `lagekarte-kartenleiste`,
 * „Eine Zeilenform“): die Zeile ist der Schalter, kein zweiter `Switch`. Geltung und Stand stehen
 * unter dem Namen und sind als Beschreibung vorlesbar; rechts steht der Zustand als Wort („lädt“
 * statt eines Kreisels, der in einem Knopf kein Inhalt sein darf).
 *
 * Eine Ebene mit Klassenfarben zeichnet nie in einer Ebenenfarbe: ihr Farbfeld bleibt neutral, und
 * eingeschaltet steht ihre Legende unter der Zeile (LFH-592) — außerhalb des Knopfs, denn eine
 * Liste ist kein Inhalt eines Knopfs.
 */
function FachebenenZeile({ quelle, props }: { quelle: FachebeneQuelle; props: SidebarProps }) {
  const { token, rollen } = useRollen();
  const geltungId = useId();
  const standId = useId();
  const zustandId = useId();
  const def = FACHEBENEN[quelle];
  const status = props.fachebenenStatus[quelle];
  const sichtbar = props.fachebenenSichtbar[quelle];
  const laedt = sichtbar && props.fachebenenLaedt?.[quelle];
  const zoomHinweis = sichtbar && istBboxAbhaengig(quelle) && props.zoomZuKlein?.[quelle];
  const zustand = laedt
    ? 'lädt'
    : zoomHinweis
      ? 'näher heranzoomen'
      : sichtbar && status === 'offline'
        ? 'offline'
        : sichtbar && status === 'leer'
          ? 'keine Daten'
          : null;
  const beschreibung = [def.geltung ? geltungId : null, sichtbar ? standId : null, zustandId]
    .filter((x) => x != null)
    .join(' ');
  return (
    <div data-fachebene={quelle}>
      <button
        type="button"
        role="switch"
        aria-checked={sichtbar}
        aria-label={def.label}
        aria-describedby={beschreibung}
        className="lfh-ebenenzeile"
        onClick={() => props.onFachebeneToggle(quelle, !sichtbar)}
        style={{
          ...ebenenZeileStil(token),
          alignItems: 'flex-start',
          lineHeight: token.lineHeight,
          borderBlockEnd: `1px solid ${rollen.flaeche3}`,
          color: sichtbar ? rollen.text : rollen.text2,
        }}
      >
        <Farbfeld
          an={sichtbar}
          // Neutral statt Rückfallton: die Klassen erklärt die Legende darunter.
          farbe={def.klassenfarben ? rollen.text2 : fachebeneFarbe(quelle, token)}
        />
        <span style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 12 }}>{def.label}</span>
          {/* Der Geltungsbereich steht als Zeile, nicht als Tooltip: auf dem Tablet gibt es kein
              Hovern. */}
          {def.geltung && (
            <span
              id={geltungId}
              data-lfh="fachebene-geltung"
              style={{ fontSize: 11, color: rollen.text2 }}
            >
              {def.geltung}
            </span>
          )}
          {/* Alter des Stands als eigene Zeile: „offline“ und Stand gelten zusammen. */}
          {sichtbar && (
            <span id={standId}>
              <FachebeneStand quelle={quelle} abgerufen={props.fachebenenAbgerufen?.[quelle]} />
            </span>
          )}
        </span>
        {/* `nowrap`: sonst bricht das Wort mitten durch. */}
        <span
          id={zustandId}
          data-lfh="fachebene-zustand"
          style={{
            fontSize: 11,
            whiteSpace: zoomHinweis ? undefined : 'nowrap',
            color: zoomHinweis ? rollen.achtungText : rollen.text2,
          }}
        >
          {zustand}
        </span>
      </button>
      {/* Nur eingeschaltet: ausgeschaltet zeichnet die Ebene nichts. */}
      {sichtbar && def.klassenfarben && (
        <div style={{ padding: token.paddingSM, paddingInlineStart: token.padding }}>
          <Klassenlegende bezeichnung={def.label} eintraege={def.klassenfarben.legende} />
        </div>
      )}
    </div>
  );
}

/**
 * Gruppenschalter (Spec „Gruppenschalter“): ein eigenes Ziel neben dem Klappkopf,
 * `role="checkbox"` mit `aria-checked` an/aus/`mixed` — „teilweise“ ist der dritte Zustand, den
 * ein Schalter nicht kennt. Zweiter Kanal ist das Zeichen im Kästchen (Haken, Strich, leer).
 */
function GruppenSchalter({
  name,
  zustand,
  onSchalten,
}: {
  name: string;
  zustand: GruppenZustand;
  onSchalten: () => void;
}) {
  const { token, rollen } = useRollen();
  const gefuellt = zustand !== 'aus';
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={zustand === 'teilweise' ? 'mixed' : zustand === 'an'}
      aria-label={`${name}: alle Ebenen`}
      data-lfh="gruppenschalter"
      className="lfh-klappkopf"
      onClick={onSchalten}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flex: `0 0 ${token.controlHeight}px`,
        minWidth: token.controlHeight,
        minHeight: token.controlHeight,
        margin: 0,
        padding: 0,
        border: 0,
        cursor: 'pointer',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: FARBFELD,
          height: FARBFELD,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: `1px solid ${gefuellt ? rollen.bedien : rollen.steuerRahmen}`,
          background: gefuellt ? rollen.bedien : 'transparent',
          color: rollen.paneel,
        }}
      >
        {zustand === 'an' ? (
          <IconHaken size={12} />
        ) : zustand === 'teilweise' ? (
          <IconMinus size={12} />
        ) : null}
      </span>
    </button>
  );
}

/**
 * Ansicht „Ebenen“ der Kartenleiste (LLH-1028, Zielgliederung D4): ein Ebenenbaum in festen
 * Gruppen — Kräfte, Lage, Betroffene & Versorgung, Fachebenen (Warnungen, Wasser, Umwelt,
 * Verkehr & Infrastruktur), Hintergrund (Kartengrundlage, Bild-Hintergründe). Zuordnung als
 * Daten in `leistenDaten.ts` (`EBENEN_GRUPPEN`, `FACHEBENEN_GRUPPEN`).
 *
 * Kopf: Kartenansicht (Wahl, „In dieser Ansicht speichern“, Ablehnungsgründe) und „Ebene
 * suchen“. Der Kopf rollt mit: mit Ablehnungsgründen und Speichern-Knopf wäre er klebend unter
 * `lg` größer als die halbe Leiste.
 *
 * Klappzustand je Gerät (`useBaumKlapp`). Die Suche öffnet Gruppen mit Treffern nur für ihre
 * Dauer: geklappt wird dann ein Zustand der Suche, der gemerkte bleibt stehen.
 */
export default function Ebenenbaum(props: SidebarProps) {
  const { token, rollen } = useRollen();
  const { darfSchreiben } = props;
  const sektionFehler = props.sektionFehler ?? {};
  const klapp = useBaumKlapp();
  const [begriff, setBegriff] = useState('');
  const suche = begriff.trim();
  const [suchKlapp, setSuchKlapp] = useState<Partial<Record<BaumKnoten, boolean>>>({});
  // Leeren beendet den Suchzustand — während des Renderns, ohne sichtbaren Zwischenstand.
  if (!suche && Object.keys(suchKlapp).length > 0) setSuchKlapp({});
  const istOffen = (k: BaumKnoten) => (suche ? (suchKlapp[k] ?? true) : klapp.offen[k]);
  const umschalten = (k: BaumKnoten) => () => {
    if (suche) setSuchKlapp((alt) => ({ ...alt, [k]: !istOffen(k) }));
    else klapp.setze(k, !klapp.offen[k]);
  };
  /**
   * Bild, dessen Entfernen bestätigt werden soll — ein Dialog für die ganze Liste, außerhalb der
   * Gruppen: eine zugeklappte Gruppe darf eine offene Rückfrage nicht abhängen.
   */
  const [loeschBildId, setLoeschBildId] = useState<number | null>(null);

  const zeilen = ebenenZeilen(
    props.verortet,
    props.zonenAnzahl,
    props.layer,
    sektionFehler.nichtVerortet != null,
    props.personen,
    props.betreuung,
    props.br,
    props.eingeblendet ?? null,
    props.tier,
  );
  const eigene = ebenenGruppen(zeilen).map((g) => ({
    ...g,
    treffer: filtereGruppe(suche, [g.name], g.zeilen),
  }));
  const zeigeSichtungslegende =
    (props.layer.person || props.eingeblendet === 'person') && props.personen?.zugriff === 'frei';

  const fachAn = fachebeneKeys().filter((k) => props.fachebenenSichtbar[k]).length;
  const fach = FACHEBENEN_GRUPPEN.map((g) => {
    const z = g.ebenen.map((key) => ({
      key,
      name: FACHEBENEN[key].label,
      sichtbar: props.fachebenenSichtbar[key],
    }));
    return {
      ...g,
      zeilen: z,
      an: z.filter((x) => x.sichtbar).length,
      treffer: filtereGruppe(suche, ['Fachebenen', g.name], z),
    };
  });
  const fachTreffer = fach.some((g) => g.treffer.length > 0);

  const grundlageInhalt =
    props.grundlageWahl != null ||
    !props.onlineVerfuegbar ||
    !props.offlineVerfuegbar ||
    props.basemap === 'offline';
  const grundlageTreffer =
    grundlageInhalt &&
    filtereGruppe(suche, ['Hintergrund'], [{ name: 'Kartengrundlage' }]).length > 0;
  const bilderNameTrifft =
    filtereGruppe(suche, ['Hintergrund'], [{ name: 'Bild-Hintergründe' }]).length > 0;
  const bilderListe = bilderNameTrifft ? props.bilder : filtereGruppe(suche, [], props.bilder);
  const bilderTreffer = bilderNameTrifft || bilderListe.length > 0;
  const bilderFehler = sektionFehler.bilder != null;
  const hintergrundTreffer = grundlageTreffer || bilderTreffer;

  const keinTreffer =
    suche !== '' &&
    !eigene.some((g) => g.treffer.length > 0) &&
    !fachTreffer &&
    !hintergrundTreffer;

  const schalteGruppe = (
    z: readonly { sichtbar: boolean; sperrgrund?: string }[],
    zustand: GruppenZustand,
    schalte: (i: number, an: boolean) => void,
  ) => {
    const ziel = gruppenZiel(zustand);
    z.forEach((x, i) => {
      if (!x.sperrgrund && x.sichtbar !== ziel) schalte(i, ziel);
    });
  };

  return (
    <div data-lfh="ebenenbaum">
      <LeistenAbschnitt titel="Kartenansicht" kennung="ansicht">
        <div style={{ padding: token.padding }}>
          {sektionFehler.ansichten ? (
            <FehlerSlot fehler={sektionFehler.ansichten} />
          ) : (
            <AnsichtSwitcher
              // Ein Einsatzwechsel schließt offene Dialoge samt Grund; eine späte Antwort trifft
              // dann keinen Dialog des neuen Einsatzes.
              key={props.einsatzId}
              ansichten={props.ansichten}
              aktiveAnsichtId={props.aktiveAnsichtId}
              darfSchreiben={darfSchreiben}
              busy={props.ansichtBusy}
              onWaehlen={props.onAnsichtWaehlen}
              onNeu={props.onAnsichtNeu}
              onUmbenennen={props.onAnsichtUmbenennen}
              onStandard={props.onAnsichtStandard}
              onLoeschen={props.onAnsichtLoeschen}
            />
          )}
          {darfSchreiben && props.ansichtDirty && (
            <Space orientation="vertical" style={{ width: '100%', marginTop: token.marginSM }}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                Ungespeicherte Änderungen
              </Typography.Text>
              {/* Schreibt in die aktive Ansicht, nicht in eine einsatzweite Einstellung. */}
              <Button
                type="primary"
                block
                loading={props.ansichtSpeichert}
                onClick={props.onAnsichtSpeichern}
              >
                In dieser Ansicht speichern
              </Button>
            </Space>
          )}
          {(props.ansichtFehler?.length ?? 0) > 0 && (
            <div
              data-lfh="ansicht-fehler"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: token.marginSM,
                marginTop: token.marginSM,
              }}
            >
              {props.ansichtFehler?.map((g) => (
                <SpeicherFehler
                  key={g.schluessel}
                  fehler={g.fehler}
                  titel={g.titel}
                  fallback={g.fallback}
                />
              ))}
            </div>
          )}
          {/* Schlichtes Eingabefeld statt Suchvariante: gefiltert wird live, deren Suchknopf wäre
              ein Tab-Ziel ohne Wirkung. Das Icon in `aria-hidden`-Hülle. */}
          <Input
            aria-label="Ebene suchen"
            placeholder="Ebene suchen"
            allowClear
            prefix={
              <span aria-hidden="true" style={{ color: rollen.schwach }}>
                <IconLupe />
              </span>
            }
            value={begriff}
            onChange={(ev) => setBegriff(ev.target.value)}
            style={{ marginTop: token.marginSM }}
          />
        </div>
      </LeistenAbschnitt>

      {keinTreffer && <SeitenLeer titel={`Keine Ebene zu „${suche}“`} />}

      {eigene.map((g) =>
        g.treffer.length === 0 ? null : (
          <KlappPaneel
            key={g.kennung}
            titel={g.name}
            kennung={g.kennung}
            meta={`${g.an}/${g.gesamt}`}
            offen={istOffen(g.kennung)}
            onUmschalten={umschalten(g.kennung)}
            polster={false}
            zusatz={(() => {
              const zustand = gruppenZustand(g.zeilen);
              return zustand == null ? null : (
                <GruppenSchalter
                  name={g.name}
                  zustand={zustand}
                  onSchalten={() =>
                    schalteGruppe(g.zeilen, zustand, (i, an) =>
                      props.onLayerToggle(g.zeilen[i].key, an),
                    )
                  }
                />
              );
            })()}
          >
            <div role="group" aria-label={g.name}>
              {g.treffer.map((z) => (
                <EbenenZeilenKnopf
                  key={z.key}
                  zeile={z}
                  onUmschalten={(an) => props.onLayerToggle(z.key, an)}
                />
              ))}
            </div>
            {g.kennung === 'betroffene' && zeigeSichtungslegende && <Sichtungslegende />}
          </KlappPaneel>
        ),
      )}

      {fachTreffer && (
        <KlappPaneel
          titel="Fachebenen"
          kennung="fachebenen"
          meta={fachAn > 0 ? `${fachAn} an` : undefined}
          offen={istOffen('fachebenen')}
          onUmschalten={umschalten('fachebenen')}
          polster={false}
        >
          {fach.map((g) =>
            g.treffer.length === 0 ? null : (
              <KlappPaneel
                key={g.kennung}
                titel={g.name}
                kennung={g.kennung}
                ebene={3}
                einzug
                meta={`${g.an}/${g.zeilen.length}`}
                offen={istOffen(g.kennung)}
                onUmschalten={umschalten(g.kennung)}
                polster={false}
                zusatz={
                  <GruppenSchalter
                    name={g.name}
                    zustand={gruppenZustand(g.zeilen) ?? 'aus'}
                    onSchalten={() =>
                      schalteGruppe(g.zeilen, gruppenZustand(g.zeilen) ?? 'aus', (i, an) =>
                        props.onFachebeneToggle(g.zeilen[i].key, an),
                      )
                    }
                  />
                }
              >
                <div role="group" aria-label={g.name}>
                  {g.treffer.map((z) => (
                    <FachebenenZeile key={z.key} quelle={z.key} props={props} />
                  ))}
                </div>
              </KlappPaneel>
            ),
          )}
        </KlappPaneel>
      )}

      {hintergrundTreffer && (
        <KlappPaneel
          titel="Hintergrund"
          kennung="hintergrund"
          // Ein Fehler-Slot steht offen: zugeklappt wäre er von „nichts da" nicht zu unterscheiden.
          offen={istOffen('hintergrund') || bilderFehler}
          onUmschalten={umschalten('hintergrund')}
          polster={false}
        >
          {/* Ab `md` steht die Wahl über der Karte, ein Weg je Breite (LFH-1083). Hat die
              Untergruppe dann nichts zu sagen, steht sie nicht da. */}
          {grundlageTreffer && (
            <KlappPaneel
              titel="Kartengrundlage"
              kennung="grundlage"
              ebene={3}
              einzug
              offen={istOffen('grundlage')}
              onUmschalten={umschalten('grundlage')}
            >
              <Space orientation="vertical" style={{ width: '100%' }}>
                {props.grundlageWahl}
                {/* Mit der Wahl im Baum (Handschirm) nennt deren Sperrgrund das schon. */}
                {!props.grundlageWahl && !props.onlineVerfuegbar && (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    Online-Karte: nicht konfiguriert
                  </Typography.Text>
                )}
                {!props.grundlageWahl && !props.offlineVerfuegbar && (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    Offline-Karte: nicht konfiguriert
                  </Typography.Text>
                )}
                {props.basemap === 'offline' && (
                  <div>
                    <Typography.Text
                      type="secondary"
                      style={{ fontSize: 12, display: 'block', marginBottom: token.marginXS }}
                    >
                      Karten-Design
                    </Typography.Text>
                    <Radio.Group
                      value={props.kartenTheme}
                      onChange={(e) =>
                        props.onKartenThemeWechsel(e.target.value as KartenThemeWahl)
                      }
                      optionType="button"
                      aria-label="Karten-Design"
                      name="lagekarte-karten-design"
                    >
                      <Tooltip title="folgt dem App-Design">
                        <Radio.Button value="auto">Auto</Radio.Button>
                      </Tooltip>
                      <Radio.Button value="light">Hell</Radio.Button>
                      <Radio.Button value="dark">Dunkel</Radio.Button>
                    </Radio.Group>
                  </div>
                )}
              </Space>
            </KlappPaneel>
          )}
          {bilderTreffer && (
            <KlappPaneel
              titel="Bild-Hintergründe"
              kennung="bilder"
              ebene={3}
              einzug
              offen={istOffen('bilder') || bilderFehler}
              onUmschalten={umschalten('bilder')}
              meta={props.bilder.length || undefined}
            >
              <BildHintergruende
                {...props}
                angezeigt={bilderListe}
                onLoeschenFragen={setLoeschBildId}
              />
            </KlappPaneel>
          )}
        </KlappPaneel>
      )}

      {/* Löschbestätigung als ein Dialog für die ganze Bildliste, rot bestätigt. Kein
          `Popconfirm`: der bräuchte im Menü-Label ein `stopPropagation`. */}
      <Modal
        // Eine Quelle für Sichtbarkeit UND Titel (siehe `loeschDialogBild`).
        open={loeschDialogBild(props.bilder, loeschBildId) != null}
        title={`Bild „${loeschDialogBild(props.bilder, loeschBildId)?.name ?? ''}" entfernen?`}
        okText="Entfernen"
        okButtonProps={{ danger: true }}
        cancelText="Abbrechen"
        onOk={() => {
          if (loeschBildId != null) props.onBildLoeschen(loeschBildId);
          setLoeschBildId(null);
        }}
        onCancel={() => setLoeschBildId(null)}
        destroyOnHidden
      >
        <Typography.Paragraph>Gesetzte Eckpunkte gehen verloren.</Typography.Paragraph>
      </Modal>
    </div>
  );
}
