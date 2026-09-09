import { MoreOutlined } from '@ant-design/icons';
import { Button, Dropdown, Space, Tag, theme, Tooltip, Typography } from 'antd';
import type { ReactNode } from 'react';
import type { EtbEintragAnzeige } from '../api/types';
import Datensicht, {
  HERVORGEHOBEN,
  spaltenFuer,
  type Gruppierung,
  type Kartenplan,
} from '../components/Datensicht';
import Markdown from '../components/Markdown';
import StatusTag from '../components/StatusTag';
import EtbBacklinkBadges from './EtbBacklinkBadges';
import { istNachgetragen } from './typFarben';
import type { EtbZeile } from './etbZeile';
import { etbTyp } from '../theme/statusFarben';
import { abstand } from '../theme/tokens';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import { formatZeit } from '../kommunikation/zeit';
import type { AbgelehnterEintrag, AusstehenderEintrag } from '../offline/queue';

/** Die Spaltenschlüssel der Chronologie. Ausgeschrieben, weil die Aktionsspalte
 *  bedingt entsteht und eine bedingte Liste die Literale verlöre. */
type EtbSpalte = 'nr' | 'zeit' | 'typ' | 'vonan' | 'inhalt' | 'erfasser' | 'aktion';

interface Props {
  /** Gesendete und gepufferte Einträge als EINE Chronologie (`etb/etbZeile.ts`). */
  zeilen: readonly EtbZeile[];
  /** Einsatz-id für die Deeplink-Backlink-Badges (ETB → Befehl/Lagebericht/Auftrag). */
  einsatzId: number;
  /** Per ?eintrag=<id> adressierter Eintrag — wird hervorgehoben (LFH-25). */
  highlightId?: number | null;
  /** Wenn gesetzt, erscheint je Eintrag eine „Berichtigen"-Aktion. */
  onBerichtigen?: (eintrag: EtbEintragAnzeige) => void;
  /** Wenn gesetzt, erscheint je Eintrag eine „Wiedervorlage"-Aktion (ETB→Erinnerung, LFH-106). */
  onWiedervorlage?: (eintrag: EtbEintragAnzeige) => void;
  /** Wenn gesetzt, erscheint je Eintrag eine „Auftrag erteilen"-Aktion (ETB→Auftrag, LFH-112). */
  onAuftragErteilen?: (eintrag: EtbEintragAnzeige) => void;
  /** Abgelehnten Eintrag erneut in die Warteschlange geben (LFH-342 · C7). */
  onErneutSenden?: (puffer: AbgelehnterEintrag) => void;
  /** Abgelehnten Eintrag endgültig verwerfen. */
  onVerwerfen?: (puffer: AbgelehnterEintrag) => void;
  /**
   * Der Abruf läuft noch. Wird bis an das Primitiv durchgereicht (LFH-331 · B3).
   *
   * Optional wie die beiden folgenden Angaben — die Bestandsfälle in `EtbTabelle.test.tsx`
   * rendern die Chronologie ohne Zustandsangabe, ein Pflichtfeld bräche dort schon den
   * Typcheck.
   */
  ladend?: boolean;
  /** Der Abruf ist gescheitert. Trägt allein die Unterdrückung unten — die Meldung selbst
   *  gehört der Seite (Spec-Festlegung D3). */
  fehler?: boolean;
  /** Was anstelle der Zeilen steht, wenn keine da sind. Die Seite baut ihn, weil erst dort
   *  bekannt ist, ob ein Filter aktiv ist und ob der Benutzer erfassen darf. */
  leerText?: ReactNode;
}

/** Der Inhalt eines gepufferten Eintrags — beide Sorten tragen dieselbe Nutzlast. */
function pufferInhalt(p: AusstehenderEintrag): string {
  return p.eintrag.inhalt;
}

/**
 * Gruppenachse der Chronologie: ein Kopf je angefangener Stunde.
 *
 * Tag UND Stunde im Schlüssel, nicht nur die Stunde — sonst fielen „gestern 14 Uhr" und
 * „heute 14 Uhr" in eine Gruppe, und ein Tagebuch, das über Mitternacht läuft, ist der
 * Normalfall und nicht die Ausnahme.
 *
 * Ohne `reihenfolge`: die Gruppen erscheinen in Antreffreihenfolge, und die ist die
 * Serverordnung (neueste zuerst). Eine feste Folge müsste sie erfinden.
 */
const GRUPPEN: Gruppierung<EtbZeile> = {
  schluessel: (z) => {
    const roh = z.art === 'eintrag' ? z.eintrag.ereigniszeit : z.puffer.erstellt_at;
    return roh.slice(0, 13); // YYYY-MM-DD HH
  },
  etikett: (wert) => `${wert.slice(8, 10)}.${wert.slice(5, 7)}. · ${wert.slice(11, 13)} Uhr`,
};

/**
 * Chronologie des Einsatztagebuchs (LFH-342 · C7).
 *
 * ── WARUM `Datensicht` UND WARUM MIT EIGENBAU-KARTE ──────────────────────────────
 *
 * Die Chronologie lief bis hierher direkt auf `KatalogTabelle` und war damit auf jedem
 * Schirm eine Tabelle mit sieben Spalten. Im Fükw (1366 px, geöffnetes ModulPanel, 1033 px
 * Contentbreite) belegten die sechs Nebenspalten 884 px — dem Meldungstext, also
 * ausgerechnet der beweissichernden Aussage, blieben 149 px (14 %). Sie ist die
 * neunzehnte Konsumentin des Tabellen-Primitivs gewesen und der benannte Restposten
 * LFH-330 · AP8; der ist damit eingelöst.
 *
 * Der Kartenzweig ist ein **Eigenbau** (`art: 'eigen'`, erster Eintrag in
 * `KARTEN_EIGENBAU`). Der Plan-Modus trägt Titel + Status + höchstens DREI Sekundärfelder
 * + genau EINE Primäraktion. Die Ereigniszeile braucht fünf Kopffelder (Nr. · Zeit · Typ ·
 * Von→An · Erfasser), einen Markdown-Block über die volle Breite und DREI Zeilenaktionen —
 * im Plan-Modus fielen Berichtigen, Wiedervorlage und Auftrag unter `md` ersatzlos weg.
 * An einem beweissichernden Tagebuch ist das kein hinnehmbarer Funktionsverlust, und die
 * Sekundärfelder rendern als nebeneinanderliegende Etikett/Wert-Paare, also gerade nicht
 * als Volltextblock.
 *
 * ── DREI DINGE, DIE DER EIGENBAU SELBST TRAGEN MUSS ──────────────────────────────
 *
 * `Datensicht` gibt beim Eigenbau `karte.render(...)` ROH zurück; der umgebende `<div>`
 * mit Klasse, Marke und Tiefen-Polsterung entsteht nur im Plan-Modus. Deshalb setzt der
 * Renderer hier selbst:
 *   1. `data-lfh="datensicht-karte"` — sonst findet `scrolleZurZeile` die Karte nicht,
 *      und der Deeplink `?eintrag=` liefe unter `md` still ins Leere.
 *   2. die Zeilenklasse (`etb-berichtigung`, {@link HERVORGEHOBEN}, Offline-Marke) — sonst
 *      gälte sie nur im Tabellenzweig.
 *   3. das Tastaturziel: die Aktionen sind echte Knöpfe, die Karte selbst bleibt ein
 *      nacktes `<div>` (dieselbe Trennung wie in `components/Liste.tsx`).
 *
 * ── WAS BEWUSST NICHT GESETZT IST ────────────────────────────────────────────────
 *
 * · `suche` — die Volltextsuche des ETB ist SERVERSEITIG und arbeitet über den ganzen
 *   Bestand. Die clientseitige Suche des Primitivs sähe nur das geladene
 *   100-Zeilen-Fenster und behauptete eine Vollständigkeit, die sie nicht hat.
 * · `standardSortierung` — `null`, also Serverordnung. Eine Beweiskette sortiert man
 *   nicht um.
 * · `onZeileKlick` — es gibt keine Detailroute je Eintrag; der Klick hätte kein Ziel.
 */
export default function EtbTabelle({
  zeilen, einsatzId, highlightId, onBerichtigen, onWiedervorlage, onAuftragErteilen,
  onErneutSenden, onVerwerfen, ladend, fehler, leerText,
}: Props) {
  const { token } = theme.useToken();

  const eintraege = zeilen.flatMap((z) => (z.art === 'eintrag' ? [z.eintrag] : []));

  // Map id → lfd_nr, um Berichtigungs-Ziele auf ihre laufende Nummer aufzulösen.
  const lfdNrVonId = new Map(eintraege.map((e) => [e.id, e.lfd_nr]));

  // Map Original-id → lfd_nr der Berichtigung, für den Rückverweis am Originaleintrag.
  const berichtigtDurch = new Map<number, number>();
  for (const e of eintraege) {
    if (e.typ === 'berichtigung' && e.berichtigt_eintrag_id != null) {
      berichtigtDurch.set(e.berichtigt_eintrag_id, e.lfd_nr);
    }
  }

  /**
   * Die Zeilenaktionen, EINMAL für beide Zweige.
   *
   * Zwei Aufbauten wären zwei Sichtbarkeitsregeln und zwei Orte, an denen eine Aktion
   * fehlen kann — und der Kartenzweig wäre der, den niemand ansieht.
   */
  function zeilenAktionen(z: EtbZeile): ReactNode {
    if (z.art === 'abgelehnt') {
      // Ein abgelehnter Eintrag verlangt eine Entscheidung, kein Menü: beide Auswege
      // stehen offen da, weil das Verwerfen unumkehrbar ist und das erneute Senden
      // der wahrscheinlichere Griff.
      return (
        <Space size="middle">
          <Button onClick={() => onErneutSenden?.(z.puffer)}>Erneut senden</Button>
          <Button danger onClick={() => onVerwerfen?.(z.puffer)}>Verwerfen</Button>
        </Space>
      );
    }
    // Ein ausstehender Eintrag ist noch nicht im Tagebuch — es gibt nichts zu
    // berichtigen und nichts, worauf ein Auftrag verweisen könnte.
    if (z.art === 'ausstehend') return null;

    const e = z.eintrag;
    /*
     * Aus drei Knöpfen wird eine Datenliste (LFH-365 · B5e). Vorbild und
     * Konsistenzanker ist `chat/NachrichtenStrom.tsx:88`.
     *
     * Die Sichtbarkeitsregeln bleiben unverändert: eine Berichtigung berichtigt man
     * nicht, und eine Aktion, die die Seite nicht mitgibt, gibt es nicht.
     */
    const items = [
      ...(onBerichtigen && e.typ !== 'berichtigung'
        ? [{ key: 'berichtigen', label: 'Berichtigen' }] : []),
      ...(onWiedervorlage ? [{ key: 'wiedervorlage', label: 'Wiedervorlage' }] : []),
      ...(onAuftragErteilen ? [{ key: 'auftrag', label: 'Auftrag erteilen' }] : []),
    ];
    // Kein Auslöser statt eines leeren oder deaktivierten Menüs. Erreichbar an einer
    // Berichtigungszeile auf einer Seite, die nur „Berichtigen" anbietet.
    if (items.length === 0) return null;
    return (
      <Dropdown
        trigger={['click']}
        /*
         * `autoFocus` nach dem Befund an `components/Datensicht.tsx:664-670`: ohne ihn
         * klebt der Fokus am Auslöser und die Pfeiltasten heben im Menü nichts hervor.
         * Die Wirkung ist in jsdom nicht prüfbar — Fokus- und Tastaturverhalten eines
         * Portal-Menüs belegt erst Playwright —, deshalb steht sie hier als Konvention
         * mit Quelle und nicht als Zusicherung.
         */
        autoFocus
        menu={{
          items,
          // Zuordnung am Menü statt an jedem Eintrag (Muster
          // `pages/lagekarte/AnsichtSwitcher.tsx:138`).
          onClick: ({ key }) => {
            if (key === 'berichtigen') onBerichtigen?.(e);
            if (key === 'wiedervorlage') onWiedervorlage?.(e);
            if (key === 'auftrag') onAuftragErteilen?.(e);
          },
        }}
      >
        {/*
          Der Name trägt die laufende Nummer, nicht bloß „Aktionen": die Chronologie zeigt
          viele Zeilen, und n gleichnamige Knöpfe sind per Rolle nicht auseinanderzuhalten
          (Festlegung aus LFH-364). Genommen wird die menschenlesbare Kennung, nie die
          DB-`id`. Kein `size`-Prop — die Trefffläche kommt aus `controlHeight`.
        */}
        <Button
          type="text"
          aria-label={`Aktionen zu Eintrag ${e.lfd_nr}`}
          icon={<MoreOutlined />}
        />
      </Dropdown>
    );
  }

  /** Kennung der Zeile: laufende Nummer — oder der Sendezustand, wenn es keine gibt. */
  function kennung(z: EtbZeile): ReactNode {
    if (z.art === 'eintrag') return `#${z.eintrag.lfd_nr}`;
    /*
     * Ein Etikett statt einer Nummer, und das ist die Aussage: der Eintrag hat noch
     * keine laufende Nummer, weil der Server sie vergibt. Eine erfundene Nummer oder
     * ein „—" verschwiege, dass hier etwas aussteht.
     *
     * `label` ist am `StatusTag` Pflichtfeld und damit der zweite Kanal (WCAG 1.4.1) —
     * die Farbe allein trüge die Aussage nicht.
     */
    return z.art === 'ausstehend'
      ? <StatusTag darstellung={{ rolle: 'achtung', label: 'wird gesendet …' }} />
      : <StatusTag darstellung={{ rolle: 'alarm', label: 'abgelehnt' }} />;
  }

  function zeitpunkt(z: EtbZeile): ReactNode {
    if (z.art !== 'eintrag') {
      // Aus der lokalen Erfassungszeit, nicht aus einer Serverzeit, die es nicht gibt.
      return <ZeitAnzeige wert={z.puffer.erstellt_at} format="kurz" />;
    }
    const e = z.eintrag;
    return (
      <Space size={abstand.xs}>
        <span><ZeitAnzeige wert={e.ereigniszeit} format="kurz" /></span>
        {/*
          Ein Wort, kein Zeichen (LFH-365 · B5e): das ⧖ hier war nur mit Tooltip oder
          Vorwissen deutbar, und die Aussage „nachgetragen" ist beweisrelevant.

          Kein `aria-label`: es gewann in der Namensrechnung gegen den sichtbaren Inhalt
          (accname 2C vor 2F) und machte damit jede Rollen-Zusicherung auf eine SICHTBARE
          Beschriftung unwiderlegbar. Der Tooltip bleibt und trägt den
          Server-Empfangszeitpunkt; er ist die Begründung, nicht die Beschriftung.
        */}
        {istNachgetragen(e.ereigniszeit, e.received_at) && (
          <Tooltip title={`Nachgetragen — Server-Empfang: ${formatZeit(e.received_at)}`}>
            <Tag style={{ margin: 0 }}>Nachtrag</Tag>
          </Tooltip>
        )}
      </Space>
    );
  }

  function inhaltsBlock(z: EtbZeile): ReactNode {
    if (z.art !== 'eintrag') {
      return <Markdown variante="kompakt">{pufferInhalt(z.puffer)}</Markdown>;
    }
    const e = z.eintrag;
    const istBerichtigung = e.typ === 'berichtigung' && e.berichtigt_eintrag_id != null;
    const wurdeBerichtigt = berichtigtDurch.has(e.id);
    return (
      <div>
        {(istBerichtigung || wurdeBerichtigt) && (
          <div style={{ marginBottom: abstand.xs }}>
            {istBerichtigung && (
              <Tag color="red">berichtigt #{lfdNrVonId.get(e.berichtigt_eintrag_id!) ?? '?'}</Tag>
            )}
            {wurdeBerichtigt && (
              <Tag color="gold">berichtigt durch #{berichtigtDurch.get(e.id)}</Tag>
            )}
          </div>
        )}
        {(e.befehl_id != null || e.lagebericht_id != null || e.auftrag_id != null) && (
          <div style={{ marginBottom: abstand.xs }}>
            <EtbBacklinkBadges eintrag={e} einsatzId={einsatzId} />
          </div>
        )}
        <Markdown variante="kompakt">{e.inhalt}</Markdown>
      </div>
    );
  }

  function vonAn(z: EtbZeile): string {
    const q = z.art === 'eintrag' ? z.eintrag : z.puffer.eintrag;
    return q.von || q.an ? `${q.von ?? '—'} → ${q.an ?? '—'}` : '—';
  }

  /**
   * EINE Klassenwahrheit für beide Zweige. Der Tabellenzweig bekommt sie über
   * `zeilenKlasse`, der Eigenbau setzt sie selbst — `Datensicht` legt beim Eigenbau
   * keinen Wrapper darum.
   */
  function zeilenKlasse(z: EtbZeile): string | undefined {
    const klassen = [
      z.art === 'eintrag' && z.eintrag.typ === 'berichtigung' ? 'etb-berichtigung' : '',
      z.art === 'ausstehend' ? 'etb-ausstehend' : '',
      z.art === 'abgelehnt' ? 'etb-abgelehnt' : '',
      z.art === 'eintrag' && z.eintrag.id === highlightId ? HERVORGEHOBEN : '',
    ].filter(Boolean);
    return klassen.length > 0 ? klassen.join(' ') : undefined;
  }

  /**
   * Die Aktionsspalte entsteht nur, wenn die Seite überhaupt eine Aktion mitgibt.
   *
   * Ohne die Weiche sähe ein Leser ohne Schreibrecht eine dauerhaft leere Spalte —
   * `EtbPage` übergibt dort alle Rückrufe als `undefined`. Deshalb ist `K` hier
   * ausgeschrieben statt inferiert: eine bedingte Liste verlöre die Schlüsselliterale.
   */
  const zeigtAktionen = onBerichtigen != null || onWiedervorlage != null
    || onAuftragErteilen != null || onErneutSenden != null || onVerwerfen != null;

  const spalten = spaltenFuer<EtbZeile>()<EtbSpalte>([
    // Index 0 ist die fixierte, menschenlesbare Kennung — nie die DB-`id`.
    { key: 'nr', title: 'Nr.', etikett: 'Nr.', width: 88, render: (_, z) => kennung(z) },
    {
      key: 'zeit', title: 'Ereigniszeit', etikett: 'Zeit', width: 180,
      render: (_, z) => zeitpunkt(z),
    },
    {
      key: 'typ', title: 'Typ', etikett: 'Typ', width: 130,
      render: (_, z) => (
        z.art === 'eintrag'
          ? <StatusTag darstellung={etbTyp[z.eintrag.typ]} />
          : <StatusTag darstellung={etbTyp[z.puffer.eintrag.typ]} />
      ),
    },
    /*
     * `abBreite: 'xxl'` an Von→An und Erfasser ist die ≥50-%-Zusicherung des Tickets in
     * Spaltenform: bei 1366 px (antd `xl`, nicht `xxl`) sind beide aus, und dem
     * Meldungstext bleibt statt 149 px der Rest der Contentbreite. Weg sind sie nicht —
     * der Spaltenschalter zählt sie als ausgeblendet und blendet sie auf Wunsch ein,
     * weil `abBreite` und Handauswahl durch DIESELBE Funktion laufen.
     */
    {
      key: 'vonan', title: 'Von → An', etikett: 'Von → An', width: 160, abBreite: 'xxl',
      render: (_, z) => vonAn(z),
    },
    { key: 'inhalt', title: 'Inhalt', etikett: 'Inhalt', render: (_, z) => inhaltsBlock(z) },
    {
      key: 'erfasser', title: 'Erfasser', etikett: 'Erfasser', width: 120, abBreite: 'xxl',
      render: (_, z) => (z.art === 'eintrag' ? z.eintrag.erfasser_name : '—'),
    },
    ...(zeigtAktionen ? [{
      key: 'aktion' as const, title: '', etikett: 'Aktionen',
      /*
       * Von 230 px auf die Breite eines Auslösers. Die Zahl ist bewusst großzügig: der
       * Knopf ist quadratisch und erbt seine Kante aus `controlHeight`, im
       * Handschuh-Betrieb also 72 px. Eine feste Spaltenbreite kann der Staffel nicht
       * folgen — sie ist hier nur ein Hinweis, weil die Tabelle mit `max-content` rechnet.
       */
      width: 96,
      render: (_: unknown, z: EtbZeile) => zeilenAktionen(z),
    }] : []),
  ]);

  /**
   * Die Ereigniszeile: Kopfzeile in einer Reihe, Meldungstext über die volle Breite.
   *
   * Das ist die Form, die das Ticket beschreibt, und der Grund für den Eigenbau. Die
   * Kopffelder brechen per `flexWrap` um, statt den Text zusammenzuquetschen.
   */
  const karte: Kartenplan<EtbZeile, EtbSpalte> = {
    art: 'eigen',
    render: ({ zeile }) => (
      <div
        // Die Marke, an der `scrolleZurZeile` die Karte findet — ohne sie liefe der
        // Deeplink `?eintrag=` unter `md` still ins Leere.
        data-lfh="datensicht-karte"
        data-testid="etb-ereigniszeile"
        data-zeile={zeile.schluessel}
        className={zeilenKlasse(zeile)}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: token.marginXXS,
          padding: `${token.paddingSM}px ${token.padding}px`,
          borderBlockEnd: `1px solid ${token.colorSplit}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: token.marginXS }}>
          <Typography.Text strong>{kennung(zeile)}</Typography.Text>
          <Typography.Text type="secondary">{zeitpunkt(zeile)}</Typography.Text>
          <StatusTag
            darstellung={etbTyp[zeile.art === 'eintrag' ? zeile.eintrag.typ : zeile.puffer.eintrag.typ]}
          />
          <Typography.Text type="secondary">{vonAn(zeile)}</Typography.Text>
          {zeile.art === 'eintrag' && (
            <Typography.Text type="secondary">{zeile.eintrag.erfasser_name}</Typography.Text>
          )}
        </div>
        {inhaltsBlock(zeile)}
        {/* Die Aktionen unter dem Text, nicht daneben: neben ihm nähmen sie genau die
            Breite weg, für die dieser Umbau gebaut ist. */}
        <div>{zeilenAktionen(zeile)}</div>
      </div>
    ),
  };

  /**
   * Solange geladen wird oder der Abruf gescheitert ist, wird über die Menge nichts
   * behauptet — Hausvorbild `components/Liste.tsx`. Ohne die Weiche blitzte „Noch keine
   * Einträge." hinter dem Ladebalken bzw. unter der Fehlermeldung auf und behauptete ein
   * leeres Tagebuch, wo bloß die Verbindung riss.
   *
   * Die Fehlerhälfte ist der Teil, den die zentrale Regel im Primitiv NICHT abdeckt
   * (Spec-Festlegung D4, die das Tagebuch namentlich nennt): das ETB tauscht seine Liste
   * im Fehlerfall bewusst NICHT aus, sondern behält sie mit der Meldung darüber montiert —
   * bereits geladene Einträge bleiben lesbar.
   *
   * `null` statt `undefined`: antd wertet `locale.emptyText` per `typeof` aus —
   * `undefined` fällt auf sein Standard-Leerbild zurück, `null` wird als „nichts"
   * übernommen (gemessen an `antd/es/table/InternalTable.js`).
   */
  const leer = ladend || fehler ? null : leerText;

  return (
    <Datensicht<EtbZeile, EtbSpalte>
      bezeichnung="Einsatztagebuch"
      // LFH-464: Karten unter 1200 px; lg ließe den gemessenen 1024-px-Engpass bestehen.
      tabelleAb="xl"
      spalten={spalten}
      daten={zeilen}
      zeilenSchluessel={(z) => z.schluessel}
      karte={karte}
      ladend={ladend}
      leerText={leer}
      // Serverordnung unangetastet: eine Beweiskette sortiert man nicht um.
      standardSortierung={null}
      gruppen={GRUPPEN}
      zeilenKlasse={zeilenKlasse}
    />
  );
}
