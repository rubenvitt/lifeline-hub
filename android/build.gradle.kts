// Wurzel des Android-Builds: keine eigenen Aufgaben. Die Plugins der Apps (`:app`, `:helfer`)
// stehen hier nur, damit sie einmal in einem Klassenlader liegen; die Kerne tragen ihre eigenen
// (`android/kern`, `android/helferkern`).
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.roborazzi) apply false
}
