allprojects {
    repositories {
        google()
        mavenCentral()
    }
}

val newBuildDir: Directory =
    rootProject.layout.buildDirectory
        .dir("../../build")
        .get()
rootProject.layout.buildDirectory.value(newBuildDir)

subprojects {
    val newSubprojectBuildDir: Directory = newBuildDir.dir(project.name)
    project.layout.buildDirectory.value(newSubprojectBuildDir)
}
subprojects {
    project.evaluationDependsOn(":app")
}

// A plugin that compiles its Java and its Kotlin for different JVMs (tflite_flutter:
// Java 11, Kotlin left to the JDK, 21) is refused by Gradle. Each module's Kotlin
// is held at the level its own Java compiles for, read lazily once Android has
// settled it.
subprojects {
    tasks.withType<org.jetbrains.kotlin.gradle.tasks.KotlinCompile>().configureEach {
        val javaTaskName = name.replace("Kotlin", "JavaWithJavac")
        if (tasks.names.contains(javaTaskName)) {
            // A plain provider, read at execution: mapping the Java task itself
            // would make the two depend on each other in a circle.
            compilerOptions.jvmTarget.set(
                providers.provider {
                    org.jetbrains.kotlin.gradle.dsl.JvmTarget.fromTarget(
                        tasks.getByName<JavaCompile>(javaTaskName).targetCompatibility,
                    )
                },
            )
        }
    }
}

tasks.register<Delete>("clean") {
    delete(rootProject.layout.buildDirectory)
}
