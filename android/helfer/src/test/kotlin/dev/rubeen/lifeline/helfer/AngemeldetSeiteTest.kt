package dev.rubeen.lifeline.helfer

import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import dev.rubeen.lifeline.helfer.seiten.AngemeldetSeite
import dev.rubeen.lifeline.helfer.ui.HelferThema
import dev.rubeen.lifeline.helferkern.Ruhegrund
import dev.rubeen.lifeline.helferkern.Testzustand
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Bildschirm 4 „Angemeldet“: an, pausiert und in der Ruhe (Spec „Bildschirme“, `Phase.Ruht`). */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class AngemeldetSeiteTest {
    @get:Rule
    val compose = createComposeRule()

    private fun zeige(testzustand: Testzustand) {
        val modell = HelferModell.start(testzustand) { error("keine Dienste im Test") }
        compose.setContent {
            HelferThema {
                AngemeldetSeite(modell, onFortsetzen = {}, onOrtungStarten = {}, onEinstellungen = {})
            }
        }
    }

    @Test
    fun `in der Ruhe stehen Titel und Grund und nur Abmelden`() {
        zeige(Testzustand.RUHT)
        compose.onNodeWithText(Ruhegrund.TITEL, useUnmergedTree = true).assertExists()
        compose.onNodeWithText(Ruhegrund.KEINE_ROLLE.text, useUnmergedTree = true).assertExists()
        compose.onNodeWithTag("abmelden").assertExists()
        compose.onNodeWithTag("pausieren").assertDoesNotExist()
        compose.onNodeWithTag("fortsetzen").assertDoesNotExist()
    }

    @Test
    fun `angemeldet zeigt Ortung an mit Pausieren`() {
        zeige(Testzustand.ANGEMELDET)
        compose.onNodeWithText("Ortung an", useUnmergedTree = true).assertExists()
        compose.onNodeWithTag("pausieren").assertExists()
    }
}
