import HelferKern
import SwiftUI

/// Bereich „Aufträge“ auf „Angemeldet“ (auch pausiert und in der Ruhe, ADR-0111): Zahl der
/// offenen, die Liste in der Ordnung des Kerns, leer der feste Text; darunter der Hinweis, wenn
/// Mitteilungen abgelehnt sind. Tippen öffnet den Auftrag.
struct AuftraegeBereich: View {
    @Bindable var modell: HelferModell

    private var offen: Int { Auftraege.offene(modell.auftraege) }

    var body: some View {
        VStack(alignment: .leading, spacing: LifelineAbstand.abstandKomfortabelSm) {
            VStack(alignment: .leading, spacing: LifelineAbstand.abstandKomfortabelSm) {
                HStack(alignment: .firstTextBaseline) {
                    Augenbraue(AuftragAnzeige.bereich)
                    Spacer(minLength: LifelineAbstand.abstandKomfortabelSm)
                    if offen > 0 {
                        Text("\(offen) offen")
                            .schrift(Stil.wert, relativeTo: .subheadline)
                            .foregroundStyle(Farbe.alarmText)
                            .monospacedDigit()
                            .accessibilityIdentifier("auftraege-offen")
                    }
                }
                if modell.auftraege.isEmpty {
                    Text(AuftragAnzeige.leer)
                        .schrift(Stil.text, relativeTo: .body)
                        .foregroundStyle(Farbe.text2)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("auftraege-leer")
                } else {
                    ForEach(modell.auftraege) { auftrag in
                        if auftrag.id != modell.auftraege.first?.id {
                            Divider().overlay(Farbe.linie)
                        }
                        Button {
                            modell.geoeffneterAuftrag = auftrag.id
                        } label: {
                            AuftragZeile(auftrag: auftrag)
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("auftrag-\(auftrag.id)")
                    }
                }
            }
            .karte()
            if modell.mitteilungenAus {
                Hinweis(text: AuftragAnzeige.mitteilungenAus, symbol: "bell.slash.fill")
                    .accessibilityIdentifier("mitteilungen-aus")
            }
        }
    }
}

/// Eine Zeile der Liste: Nummer, Priorität, Text (aufgehoben durchgestrichen) und Stand.
private struct AuftragZeile: View {
    let auftrag: HelferAuftrag

    var body: some View {
        HStack(alignment: .top, spacing: LifelineAbstand.abstandKomfortabelSm) {
            VStack(alignment: .leading, spacing: LifelineAbstand.abstandKomfortabelXs) {
                HStack(spacing: LifelineAbstand.abstandKomfortabelXs) {
                    if let nummer = auftrag.number {
                        Text("#\(nummer)")
                            .schrift(Stil.wert, relativeTo: .caption)
                            .foregroundStyle(Farbe.gedaempft)
                    }
                    if let prioritaet = auftrag.prioritaet, prioritaet != .normal, auftrag.isOffen {
                        Prioritaetsmarke(prioritaet: prioritaet)
                    }
                    Spacer(minLength: 0)
                    Text(AuftragAnzeige.kurz(auftrag))
                        .schrift(Stil.klein, relativeTo: .caption)
                        .foregroundStyle(auftrag.isOffen ? Farbe.alarmText : Farbe.gedaempft)
                }
                Text(auftrag.text)
                    .schrift(Stil.text, relativeTo: .body)
                    .foregroundStyle(auftrag.isAufgehoben ? Farbe.gedaempft : Farbe.text)
                    .strikethrough(auftrag.isAufgehoben)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Image(systemName: "chevron.right")
                .foregroundStyle(Farbe.gedaempft)
                .accessibilityHidden(true)
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

/// „Sofort“ oder „Dringend“ als kleine Marke.
private struct Prioritaetsmarke: View {
    let prioritaet: Prioritaet

    var body: some View {
        Text(prioritaet.text.uppercased())
            .schrift(Stil.augenbraue, relativeTo: .caption)
            .foregroundStyle(prioritaet == .sofort ? Farbe.aufBedien : Farbe.achtungText)
            .padding(.horizontal, LifelineAbstand.abstandKomfortabelXs)
            .background(prioritaet == .sofort ? Farbe.alarm : Farbe.achtungFlaeche, in: eckig)
    }
}

/// Bildschirm „Auftrag“ (Entwurf „Oberfläche der App“): Auftragstext groß, Ort, Priorität, Frist,
/// erteilt um, an wen; je eigener Empfängerzeile der große Knopf „Übernommen“ bzw. der Stand.
/// Aufgehoben: durchgestrichen mit „aufgehoben“, kein Knopf. Scheitert die Quittung, steht am
/// Knopf „Bitte über Funk bestätigen“.
struct AuftragSeite: View {
    @Bindable var modell: HelferModell
    let auftragId: Int64

    var body: some View {
        Group {
            if let auftrag = modell.auftrag(auftragId) {
                inhalt(auftrag)
            } else {
                Seite {
                    Text("Dieser Auftrag ist nicht mehr da.")
                        .schrift(Stil.text, relativeTo: .body)
                        .foregroundStyle(Farbe.text2)
                }
            }
        }
        .toolbar(.visible, for: .navigationBar)
        .navigationTitle(titel)
        .navigationBarTitleDisplayMode(.inline)
    }

    private var titel: String {
        guard let nummer = modell.auftrag(auftragId)?.number else { return "Auftrag" }
        return "Auftrag #\(nummer)"
    }

    private func inhalt(_ auftrag: HelferAuftrag) -> some View {
        Seite {
            VStack(alignment: .leading, spacing: LifelineAbstand.abstandKomfortabelSm) {
                HStack(spacing: LifelineAbstand.abstandKomfortabelXs) {
                    Augenbraue(modell.einsatzname)
                    if let prioritaet = auftrag.prioritaet, prioritaet != .normal {
                        Prioritaetsmarke(prioritaet: prioritaet)
                    }
                }
                Text(auftrag.text)
                    .schrift(Stil.titel, relativeTo: .largeTitle)
                    .foregroundStyle(auftrag.isAufgehoben ? Farbe.gedaempft : Farbe.text)
                    .strikethrough(auftrag.isAufgehoben)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("auftrag-text")
                if auftrag.isAufgehoben {
                    Text(AuftragAnzeige.aufgehoben)
                        .schrift(Stil.kartentitel, relativeTo: .headline)
                        .foregroundStyle(Farbe.alarmText)
                        .accessibilityIdentifier("aufgehoben")
                }
            }
            VStack(alignment: .leading, spacing: LifelineAbstand.abstandKomfortabelSm) {
                if let ort = auftrag.location {
                    Wertzeile(bezeichnung: "Ort", wert: ort, symbol: "mappin.and.ellipse")
                }
                if let prioritaet = auftrag.prioritaet {
                    Wertzeile(
                        bezeichnung: "Priorität", wert: prioritaet.text,
                        symbol: "exclamationmark.circle")
                }
                if let frist = auftrag.frist {
                    Wertzeile(
                        bezeichnung: "Frist", wert: AuftragAnzeige.uhrzeit(frist), symbol: "timer")
                }
                if let erteilt = auftrag.erteilt {
                    Wertzeile(
                        bezeichnung: "Erteilt um", wert: AuftragAnzeige.uhrzeit(erteilt),
                        symbol: "clock")
                }
            }
            .karte()
            ForEach(auftrag.recipients) { zeile in
                Quittungszeile(modell: modell, auftrag: auftrag, zeile: zeile)
            }
        }
    }
}

/// Eine eigene Empfängerzeile: an wen, dann Knopf oder Stand.
private struct Quittungszeile: View {
    @Bindable var modell: HelferModell
    let auftrag: HelferAuftrag
    let zeile: HelferAuftrag.Empfaenger

    var body: some View {
        let stand = modell.stand(auftrag, empfaenger: zeile)
        VStack(alignment: .leading, spacing: LifelineAbstand.abstandKomfortabelSm) {
            Wertzeile(bezeichnung: "An", wert: AuftragAnzeige.empfaenger(zeile), symbol: "person.2")
            switch stand {
            case .offen, .sendet:
                knopf(stand)
            case .fehler(let text):
                knopf(stand)
                Hinweis(
                    text: text, symbol: "antenna.radiowaves.left.and.right.slash",
                    farbe: Farbe.alarmText, flaeche: Farbe.alarmFlaeche
                )
                .accessibilityIdentifier("quittung-fehler")
            case .quittiert(let um, let von):
                Label(
                    modell.quittungstext(zeile, um: um, von: von), systemImage: "checkmark.circle.fill"
                )
                .schrift(Stil.kartentitel, relativeTo: .headline)
                .foregroundStyle(Farbe.normalText)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("uebernommen-\(zeile.id)")
            case .aufgehoben:
                EmptyView()
            }
        }
        .karte()
        .sensoryFeedback(.success, trigger: modell.eigeneQuittungen.contains(zeile.id))
    }

    /// Großer Knopf „Übernommen“; während der Quittung gesperrt.
    private func knopf(_ stand: Quittungsstand) -> some View {
        Button {
            Task { await modell.quittiere(auftrag, empfaenger: zeile) }
        } label: {
            Label(
                stand == .sendet ? AuftragAnzeige.sendet : AuftragAnzeige.knopf,
                systemImage: "checkmark")
        }
        .buttonStyle(Hauptknopfstil(rolle: .normal))
        .disabled(!stand.kannQuittieren)
        .accessibilityIdentifier("uebernehmen-\(zeile.id)")
    }
}
