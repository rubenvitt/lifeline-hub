package dev.rubeen.lifeline.helfer

import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import dev.rubeen.lifeline.helfer.seiten.AuftragSeite
import dev.rubeen.lifeline.helfer.ui.HelferThema
import dev.rubeen.lifeline.helferkern.Auftraege
import dev.rubeen.lifeline.helferkern.Testzustand
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Detail eines Auftrags (ADR-0106, Entwurf „Oberfläche der App“): Übernommen, Quittung, aufgehoben. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class AuftragSeiteTest {
    @get:Rule
    val compose = createComposeRule()

    private fun zeige(testzustand: Testzustand): HelferModell {
        val modell = HelferModell.start(testzustand) { error("keine Dienste im Test") }
        val auftrag = modell.auftraege.first { it.id == modell.offenerAuftrag }
        compose.setContent {
            HelferThema { AuftragSeite(modell, modell.auftraege.firstOrNull { it.id == auftrag.id } ?: auftrag) }
        }
        return modell
    }

    @Test
    fun `je eigene offene Zeile ein Knopf Uebernommen, danach die Uhrzeit`() {
        val modell = zeige(Testzustand.AUFTRAG_OFFEN)
        compose.onNodeWithTag("uebernehmen-${Beispiel.OFFEN_PERSON}").assertExists()
        compose.onNodeWithTag("uebernehmen-${Beispiel.OFFEN_EINHEIT}").performScrollTo().performClick()
        compose.waitForIdle()
        compose.onNodeWithTag("uebernehmen-${Beispiel.OFFEN_EINHEIT}").assertDoesNotExist()
        // Die Zeile an die Person bleibt offen, bis sie selbst übernommen ist.
        compose.onNodeWithTag("uebernehmen-${Beispiel.OFFEN_PERSON}").assertExists()
        val a = modell.auftraege.first { it.id == Beispiel.OFFEN }
        val einheit = a.recipients.first { it.id == Beispiel.OFFEN_EINHEIT }
        assertTrue(Auftraege.isEigeneQuittung(einheit, modell.anzeigename))
        val text = Auftraege.quittungstext(Auftraege.stand(a, einheit), modell.anzeigename, java.time.ZoneId.systemDefault())
        assertEquals(true, text?.startsWith("Übernommen um "))
    }

    @Test
    fun `war ein anderer schneller, steht sein Name`() {
        zeige(Testzustand.AUFTRAG_UEBERNOMMEN)
        compose.onNodeWithTag("uebernehmen-110").assertDoesNotExist()
        compose.onNodeWithText("Übernommen von Lisa K.", substring = true, useUnmergedTree = true).assertExists()
    }

    @Test
    fun `ein aufgehobener Auftrag hat keinen Knopf`() {
        zeige(Testzustand.AUFTRAG_AUFGEHOBEN)
        compose.onNodeWithTag("aufgehoben").assertExists()
        compose.onNodeWithTag("uebernehmen-90").assertDoesNotExist()
    }

    @Test
    fun `eine gescheiterte Quittung bittet um Funk`() {
        zeige(Testzustand.QUITTUNG_FEHLER)
        compose.onNodeWithTag("quittung-fehler", useUnmergedTree = true).assertExists()
        compose.onNodeWithText(Auftraege.QUITTUNG_FEHLGESCHLAGEN, useUnmergedTree = true).assertExists()
        compose.onNodeWithTag("uebernehmen-${Beispiel.OFFEN_EINHEIT}").assertExists()
    }

    @Test
    fun `Zurueck schliesst das Detail`() {
        val modell = zeige(Testzustand.AUFTRAG_OFFEN)
        compose.onNodeWithTag("zurueck").performScrollTo().performClick()
        assertNull(modell.offenerAuftrag)
    }
}
