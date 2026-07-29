import { Button, Space, Tag, Tooltip } from 'antd';
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
          {istNachgetragen(e.ereigniszeit, e.received_at) && (
            <Tooltip title={`Nachgetragen — Server-Empfang: ${formatZeit(e.received_at)}`}>
              <span aria-label="nachgetragen">⧖</span>
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
      width: 230,
      render: (_, e) => (
        <Space size={abstand.xs} wrap>
          {onBerichtigen && e.typ !== 'berichtigung' && (
            <Button type="link" onClick={() => onBerichtigen(e)}>
              Berichtigen
            </Button>
          )}
          {onWiedervorlage && (
            <Button type="link" onClick={() => onWiedervorlage(e)}>
              Wiedervorlage
            </Button>
          )}
          {onAuftragErteilen && (
            <Button type="link" onClick={() => onAuftragErteilen(e)}>
              Auftrag erteilen
            </Button>
          )}
        </Space>
      ),
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
