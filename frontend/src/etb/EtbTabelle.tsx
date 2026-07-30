import { MoreOutlined } from '@ant-design/icons';
import { Button, Dropdown, Space, Tag, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { ReactNode } from 'react';
import type { EtbEintragAnzeige } from '../api/types';
import KatalogTabelle from '../components/KatalogTabelle';
import Markdown from '../components/Markdown';
import StatusTag from '../components/StatusTag';
import EtbBacklinkBadges from './EtbBacklinkBadges';
import { istNachgetragen } from './typFarben';
import { etbTyp } from '../theme/statusFarben';
import { abstand } from '../theme/tokens';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import { formatZeit } from '../kommunikation/zeit';

interface Props {
  eintraege: EtbEintragAnzeige[];
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
  /**
   * Der Abruf läuft noch. Wird bis an antds `Table` durchgereicht (LFH-331 · B3).
   *
   * Optional wie die beiden folgenden Angaben — die acht Bestandsfälle in
   * `EtbTabelle.test.tsx` rendern die Chronologie ohne Zustandsangabe, ein Pflichtfeld
   * bräche dort schon den Typcheck.
   */
  ladend?: boolean;
  /** Der Abruf ist gescheitert. Trägt allein die Unterdrückung unten — die Meldung selbst
   *  gehört der Seite (Spec-Festlegung D3). */
  fehler?: boolean;
  /** Was anstelle der Zeilen steht, wenn keine da sind. Die Seite baut ihn, weil erst dort
   *  bekannt ist, ob ein Filter aktiv ist und ob der Benutzer erfassen darf. */
  leerText?: ReactNode;
}

export default function EtbTabelle({
  eintraege, einsatzId, highlightId, onBerichtigen, onWiedervorlage, onAuftragErteilen,
  ladend, fehler, leerText,
}: Props) {
  // Map id → lfd_nr, um Berichtigungs-Ziele auf ihre laufende Nummer aufzulösen.
  const lfdNrVonId = new Map(eintraege.map((e) => [e.id, e.lfd_nr]));

  // Map Original-id → lfd_nr der Berichtigung, für den Rückverweis am Originaleintrag.
  const berichtigtDurch = new Map<number, number>();
  for (const e of eintraege) {
    if (e.typ === 'berichtigung' && e.berichtigt_eintrag_id != null) {
      berichtigtDurch.set(e.berichtigt_eintrag_id, e.lfd_nr);
    }
  }

  const spalten: ColumnsType<EtbEintragAnzeige> = [
    { title: 'Nr.', dataIndex: 'lfd_nr', width: 64 },
    {
      title: 'Ereigniszeit',
      key: 'ereigniszeit',
      width: 180,
      render: (_, e) => (
        <Space size={abstand.xs}>
          <span><ZeitAnzeige wert={e.ereigniszeit} format="kurz" /></span>
          {/*
            Ein Wort, kein Zeichen (LFH-365 · B5e): das ⧖ hier war nur mit Tooltip oder
            Vorwissen deutbar, und die Aussage „nachgetragen" ist beweisrelevant. Der
            `Tag` gibt ihr denselben Träger, den die Berichtigungs-Merkmale in der
            Inhaltsspalte schon haben — Form als Kanal, ohne Farbwert, also ohne
            Berührung des Statusfarb-Vertrags.

            Kein `aria-label` mehr: es gewann in der Namensrechnung gegen den sichtbaren
            Inhalt (accname 2C vor 2F) und machte damit jede Rollen-Zusicherung auf eine
            SICHTBARE Beschriftung unwiderlegbar — sie war schon grün, als hier nur das
            Zeichen stand. Wer es wieder hinzufügt, dreht das Kriterium ab.

            Der Tooltip bleibt und trägt weiterhin den Server-Empfangszeitpunkt; er ist
            die Begründung, nicht die Beschriftung.
          */}
          {istNachgetragen(e.ereigniszeit, e.received_at) && (
            <Tooltip title={`Nachgetragen — Server-Empfang: ${formatZeit(e.received_at)}`}>
              <Tag style={{ margin: 0 }}>Nachtrag</Tag>
            </Tooltip>
          )}
        </Space>
      ),
    },
    {
      title: 'Typ',
      dataIndex: 'typ',
      width: 130,
      render: (_, e) => <StatusTag darstellung={etbTyp[e.typ]} />,
    },
    {
      title: 'Von → An',
      key: 'vonan',
      width: 160,
      render: (_, e) => (e.von || e.an ? `${e.von ?? '—'} → ${e.an ?? '—'}` : '—'),
    },
    {
      title: 'Inhalt',
      dataIndex: 'inhalt',
      render: (_, e) => {
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
      },
    },
    { title: 'Erfasser', dataIndex: 'erfasser_name', width: 120 },
  ];

  if (onBerichtigen || onWiedervorlage || onAuftragErteilen) {
    spalten.push({
      title: '',
      key: 'aktion',
      /*
       * Von 230 px auf die Breite eines Auslösers. Die Zahl ist bewusst großzügig: der
       * Knopf ist quadratisch und erbt seine Kante aus `controlHeight`, im
       * Handschuh-Betrieb also 72 px. Eine feste Spaltenbreite kann der Staffel nicht
       * folgen — sie ist hier nur ein Hinweis, weil `KatalogTabelle` mit
       * `scroll={{ x: 'max-content' }}` rechnet.
       */
      width: 96,
      render: (_, e) => {
        /*
         * Aus drei Knöpfen wird eine Datenliste (LFH-365 · B5e). Vorbild und
         * Konsistenzanker ist `chat/NachrichtenStrom.tsx:88` — dort wurde genau diese
         * Transformation schon vollzogen.
         *
         * Die Sichtbarkeitsregeln von vorher bleiben unverändert, sie wandern nur vom
         * JSX in den Listenaufbau: eine Berichtigung berichtigt man nicht, und eine
         * Aktion, die die Seite nicht mitgibt, gibt es nicht.
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
             * `autoFocus` nach dem Befund an `components/Datensicht.tsx:664-670`: ohne
             * ihn klebt der Fokus am Auslöser und die Pfeiltasten heben im Menü nichts
             * hervor. Die Wirkung ist in jsdom nicht prüfbar — Fokus- und
             * Tastaturverhalten eines Portal-Menüs belegt erst Playwright —, deshalb
             * steht sie hier als Konvention mit Quelle und nicht als Zusicherung.
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
              Der Name trägt die laufende Nummer, nicht bloß „Aktionen": die Tabelle
              zeigt viele Zeilen, und n gleichnamige Knöpfe sind per Rolle nicht
              auseinanderzuhalten (Festlegung aus LFH-364). Genommen wird die
              menschenlesbare Kennung der Tabelle, nie die DB-`id`.

              Kein `size`-Prop — die Trefffläche kommt aus `controlHeight`.
            */}
            <Button
              type="text"
              aria-label={`Aktionen zu Eintrag ${e.lfd_nr}`}
              icon={<MoreOutlined />}
            />
          </Dropdown>
        );
      },
    });
  }

  /**
   * Solange geladen wird oder der Abruf gescheitert ist, wird über die Menge nichts
   * behauptet — Hausvorbild `components/Liste.tsx`, das seit je so gebaut ist. Ohne die
   * Weiche blitzte „Noch keine Einträge." hinter dem Ladebalken bzw. unter der
   * Fehlermeldung auf und behauptete ein leeres Tagebuch, wo bloß die Verbindung riss.
   *
   * Die Fehlerhälfte ist der Teil, den die zentrale Regel im Tabellen-Primitiv NICHT
   * abdeckt (Spec-Festlegung D4, die das Tagebuch namentlich nennt): das ETB tauscht
   * seine Tabelle im Fehlerfall bewusst NICHT aus, sondern behält sie mit der Meldung
   * darüber montiert — bereits geladene Einträge bleiben lesbar. Genau deshalb ist die
   * Unterdrückung hier auch prüfbar: die Zusicherung „Leertext nicht im DOM" belegt eine
   * Entscheidung und nicht bloß eine abwesende Komponente (Spec §3/F2).
   *
   * `null` statt `undefined`: antd wertet `locale.emptyText` per `typeof` aus — `undefined`
   * fällt auf sein Standard-Leerbild zurück, `null` wird als „nichts" übernommen (gemessen
   * an `antd/es/table/InternalTable.js`).
   */
  const leer = ladend || fehler ? null : leerText;

  return (
    // Über das geteilte Primitiv statt roh (LFH-329 · B1, Gate-1-Abschluss):
    // die Chronologie ist mit sieben Spalten breiter als ein Handschirm und
    // drückte den Seitenrumpf auf 390 px um 10 px auseinander — leer gemessen,
    // mit Einträgen mehr. Sie scrollt jetzt in sich, behält ihre Kopfzeile beim
    // Rollen und lässt die laufende Nummer stehen.
    <KatalogTabelle<EtbEintragAnzeige>
      rowKey="id"
      columns={spalten}
      dataSource={eintraege}
      loading={ladend}
      locale={{ emptyText: leer }}
      pagination={false}
      rowClassName={(e) =>
        [
          e.typ === 'berichtigung' ? 'etb-berichtigung' : '',
          e.id === highlightId ? 'zeile-hervorgehoben' : '',
        ].filter(Boolean).join(' ')
      }
    />
  );
}
