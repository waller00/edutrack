# Enfoque de Aseguramiento de Calidad (QA)

El aseguramiento de calidad en el proyecto EduTrack tiene como objetivo garantizar que el sistema desarrollado cumpla con los requerimientos definidos, mantenga un comportamiento estable en producción y minimice la aparición de errores durante su uso en el entorno real del Liceo Los Olivos.

Dado que se trata de una solución que integra múltiples componentes tecnológicos (frontend, backend, base de datos, servicios externos y despliegue en la nube), se adoptó un enfoque de QA continuo, automatizado e integrado al ciclo de desarrollo. Este enfoque permite validar cada cambio realizado en el código antes de su integración definitiva, reduciendo riesgos técnicos y asegurando la calidad del producto final.

El equipo implementó prácticas alineadas con DevOps, integrando testing, validación, despliegue y observabilidad dentro de un mismo flujo automatizado mediante GitHub Actions. El enfoque no se limita a detectar errores antes de la integración (*shift-left*), sino que también monitorea el comportamiento del sistema una vez en producción (*shift-right*).

## Estrategia de aseguramiento de calidad

La estrategia de QA del proyecto se basa en la integración continua (CI), donde cada modificación en el repositorio activa automáticamente un conjunto de validaciones.

Se definió un flujo de trabajo basado en ramas:

- **develop**: utilizada para desarrollo e integración de nuevas funcionalidades (se despliega al entorno de *testing*).
- **main**: utilizada para versiones estables en producción.

Los cambios se gestionan mediante *pull requests*, lo que permite realizar revisiones de código y ejecutar validaciones automáticas antes de su aprobación. Este enfoque asegura que ningún cambio sea incorporado sin haber sido previamente validado.

La estrategia se apoya en cuatro pilares complementarios:

1. **Validación automática** en cada cambio (tests, tipos, lint, análisis estático).
2. **Revisión manual** entre pares mediante *pull requests*.
3. **Validación en entornos reales** (testing y producción) tras cada despliegue.
4. **Observabilidad continua** del sistema en producción para detectar regresiones que escapan a las pruebas.

## Integración continua y automatización

Para garantizar la calidad del código, se implementaron *pipelines* automatizados mediante GitHub Actions. Estos *pipelines* se ejecutan ante eventos como *push* o *pull request*, y permiten validar de forma continua el estado del sistema.

Los *workflows* configurados incluyen:

- **`ci.yml`** — Validación principal: ante cada *push* o *pull request* ejecuta, en frontend y backend, validación de tipos (`typecheck`), pruebas automatizadas con cobertura (Vitest), *lint* del frontend (ESLint), *build* y publicación de artefactos de cobertura.
- **`sonar.yml`** — Análisis estático de calidad con SonarCloud en ramas `main` y `develop` y en *pull requests* hacia ellas.
- **`e2e.yml`** — Pruebas *end-to-end* de humo con Playwright sobre flujos críticos.
- **`docker-publish.yml`** — Construcción y publicación de imágenes Docker (backend y frontend) en el registro de contenedores.
- **`ci-security.yml`** — Análisis de seguridad con Trivy (ejecución manual bajo demanda — *workflow dispatch*).
- **`deploy.yml`** — Despliegue automático a la infraestructura en DigitalOcean.
- **`deploy-recover.yml`** — Recuperación de emergencia de los entornos (sin *rebuild*).
- **`performance-*-baseline.yml`** — Líneas base de rendimiento con k6 contra producción (ejecución controlada y manual).

Este conjunto de procesos permite detectar errores de forma temprana y mantener un control constante sobre la calidad del sistema. El despliegue automático (`deploy.yml`) exige, además, *typecheck* exitoso del frontend antes de publicar en *testing* o producción.

## Tipos de pruebas implementadas

El proyecto incorpora distintos niveles de testing con el objetivo de cubrir tanto la lógica interna del sistema como su funcionamiento integral y no funcional.

**1. Pruebas unitarias y de integración (Vitest).** En backend y frontend. En el backend se validan servicios y rutas HTTP (pruebas de API con dependencias simuladas mediante `vi.hoisted()`); en el frontend se validan la capa de lógica pura (`src/lib`), utilidades y funciones de dominio. El backend cuenta además con una suite de integración dedicada (`test:integration`).

**2. Pruebas end-to-end de humo (Playwright).** Simulan el comportamiento del usuario sobre flujos críticos del sistema, con backend y base de datos PostgreSQL levantados dentro del *pipeline* de GitHub Actions, validando el sistema integrado de extremo a extremo.

**3. Validación estática (TypeScript).** Se ejecuta `typecheck` (`tsc --noEmit`) en frontend y backend, lo que permite detectar errores de tipos antes de la ejecución del código. En el frontend también se ejecuta *lint* (ESLint) en el *pipeline* de integración continua.

**4. Análisis estático de calidad (SonarCloud).** Detecta *bugs*, *code smells*, código duplicado y vulnerabilidades, y aplica el control de complejidad cognitiva del código (ver sección siguiente).

**5. Pruebas de seguridad (Trivy).** Analizan el *filesystem* del repositorio y las imágenes Docker del backend y del frontend en busca de vulnerabilidades de severidad **alta** y **crítica**, ignorando las no corregibles (*unfixed*). Los resultados se publican en formato SARIF en la pestaña de seguridad de GitHub.

**6. Pruebas de rendimiento (k6).** Se ejecutan *baselines* de rendimiento controladas contra el entorno de producción —una autenticada y otra conservadora—, cuyas métricas pueden enviarse a Prometheus y visualizarse en Grafana. Permiten detectar regresiones de latencia o degradación de rendimiento entre versiones.

## Métricas y umbrales de calidad

Para que la calidad sea verificable y no quede librada al criterio individual, el proyecto define **umbrales numéricos** que se aplican automáticamente:

| Métrica | Backend | Frontend |
|---|---|---|
| Cobertura de líneas | ≥ 85 % | ≥ 90 % |
| Cobertura de sentencias | ≥ 85 % | ≥ 90 % |
| Cobertura de funciones | ≥ 85 % | ≥ 90 % |
| Cobertura de ramas | ≥ 70 % | ≥ 85 % |

Estos umbrales se configuran en Vitest y **hacen fallar el *pipeline*** si la cobertura desciende por debajo del mínimo, evitando regresiones. La cobertura se mide sobre la capa de lógica/dominio unit-testeable; los adaptadores de integración, el *bootstrap*/*wiring* y la capa de UI quedan fuera del cálculo de cobertura (se validan mediante pruebas de integración, *e2e* y manuales), pero siguen analizándose para *bugs* y *smells*.

Adicionalmente, SonarCloud aplica un **Quality Gate** sobre el código nuevo que exige:

- Cobertura de código nuevo **≥ 80 %**.
- **Cero** *issues* de severidad *Blocker* o *Critical* en código nuevo.
- Complejidad cognitiva máxima por función de **15** (regla `typescript:S3776`).

## Análisis estático de calidad con SonarCloud

Más allá de las pruebas, el proyecto integra **SonarCloud** como herramienta de análisis estático continuo. En cada *push* o *pull request* hacia `main` y `develop`, Sonar analiza el código de `backend/src` y `frontend/web/src` y evalúa cuatro dimensiones: **fiabilidad** (*bugs*), **seguridad** (vulnerabilidades), **mantenibilidad** (*code smells*) y **cobertura**.

El análisis se apoya en los artefactos de cobertura (`lcov.info`) generados por el *pipeline* de CI, por lo que mide la calidad real del código probado. El resultado se condensa en el **Quality Gate**: si el código nuevo no cumple los criterios definidos en la sección anterior, el *pull request* queda marcado como no apto para fusión.

Este mecanismo aporta una capa objetiva de control de calidad, independiente del criterio del revisor humano, y permite mantener la deuda técnica acotada a lo largo del tiempo.

## Control de calidad del código

El control de calidad se gestiona a través de tres mecanismos complementarios: validaciones automáticas, análisis estático y revisión manual.

En cada *pull request* y en cada *push* al repositorio se ejecutan los *checks* definidos en GitHub Actions (integración continua, *e2e*, análisis de calidad con SonarCloud y, bajo demanda, análisis de seguridad con Trivy). La política del equipo es **no fusionar cambios mientras los *workflows* relevantes estén en fallo o el Quality Gate no esté en verde**; el cumplimiento estricto del *merge* puede reforzarse con reglas de protección de rama en GitHub.

Además, se realiza revisión de código entre los integrantes del equipo, lo que permite mejorar la calidad general, detectar malas prácticas y mantener consistencia en el desarrollo. El estado de cada rama puede visualizarse mediante indicadores de *checks*, lo que permite evaluar rápidamente la estabilidad del proyecto.

## Gestión de defectos y trazabilidad

Cuando un defecto es detectado —ya sea por un *check* automático, por la revisión de un par o por el monitoreo en producción— se registra y se gestiona siguiendo un flujo definido:

1. **Detección y registro** del defecto (con pasos para reproducirlo y entorno afectado).
2. **Reproducción** en un entorno controlado y, cuando es posible, **incorporación de una prueba automatizada** que capture el fallo, garantizando que no vuelva a ocurrir (prevención de regresiones).
3. **Corrección** en una rama de trabajo, validada por el *pipeline* completo.
4. **Verificación** mediante *pull request* y *checks* en verde antes de su fusión.

La trazabilidad de cada cambio se mantiene a través del historial de *commits* y *pull requests*, lo que permite vincular cada corrección con su causa y su validación.

## Despliegue y validación en entornos

El proceso de despliegue también forma parte del enfoque de QA, ya que permite validar el sistema en condiciones reales.

Se implementó un flujo automatizado donde:

- Los cambios en la rama **develop** se despliegan en un entorno de *testing*.
- Los cambios en la rama **main** se despliegan en producción.

El despliegue se realiza mediante GitHub Actions utilizando conexión SSH hacia el servidor en DigitalOcean, asegurando consistencia entre entornos. El uso de contenedores Docker permite garantizar que el sistema se ejecute bajo las mismas condiciones en desarrollo, *testing* y producción.

Tras cada despliegue en *testing* o producción se aplican comprobaciones operativas documentadas en el manual de instalación (estado de contenedores, *endpoint* `/health`, carga de la interfaz, flujo de sesión y, si corresponde, validación del terminal biométrico). Los entornos de prueba se pueblan con datos representativos mediante *scripts* de *seed*, lo que permite validar flujos completos sin depender de datos productivos.

## Recuperación ante fallos

Como complemento del despliegue, el proyecto contempla un mecanismo de **recuperación ante fallos** (`deploy-recover.yml`). Ante una caída o un despliegue defectuoso, este *workflow* permite restablecer los contenedores de un entorno (*testing* o producción) sin necesidad de reconstruir las imágenes, reduciendo el tiempo de indisponibilidad. La existencia de un procedimiento de contingencia documentado y automatizado forma parte de las garantías de calidad operativa del sistema.

## Observabilidad y monitoreo en producción

El aseguramiento de calidad no concluye con el despliegue. El sistema incorpora **observabilidad continua** en tres capas complementarias, que permiten detectar en producción problemas que las pruebas no anticiparon (*shift-right testing*):

- **Sentry** (backend y frontend): captura y reporta excepciones en tiempo real, con contexto suficiente para diagnosticar la causa raíz. Responde *qué* error ocurrió y *dónde*.
- **LogRocket** (frontend, *session replay*): reconstruye la sesión del usuario previa a un incidente, permitiendo entender *cómo* se llegó al fallo desde la perspectiva real de uso. Se activa únicamente en producción y solo cuando hay un App ID configurado.
- **Grafana + Loki + Prometheus**: centralización de *logs* y *dashboards* de métricas —incluyendo las líneas base de rendimiento generadas con k6—, que muestran el comportamiento agregado del sistema y permiten distinguir un fallo puntual de uno sistémico.

La combinación de las tres herramientas cubre el ciclo completo de diagnóstico: Sentry identifica el error, LogRocket reproduce el camino que lo provocó y Grafana evalúa su impacto global. Esta información retroalimenta el desarrollo, priorizando correcciones y nuevas pruebas automatizadas, y cerrando así el ciclo de calidad.

## Roles y responsabilidades

Si bien todo el equipo participa transversalmente del aseguramiento de calidad, se distribuyeron responsabilidades para garantizar cobertura y revisión cruzada:

| Integrante | Foco principal de QA |
|---|---|
| Jorge Marrero | Pruebas de backend (servicios, rutas, integración) y análisis de cobertura |
| Robert Taffura | Pruebas de frontend, *e2e* (Playwright) y validación funcional en *testing* |
| Joaquin Waller | *Pipelines* de CI/CD, despliegue, seguridad (Trivy) y observabilidad |

La **revisión de código entre pares** es obligatoria: ningún integrante fusiona sus propios cambios sin la aprobación de otro, lo que asegura una mirada independiente sobre cada modificación.

## Definición de "Terminado" (*Definition of Done*)

Un cambio se considera terminado únicamente cuando cumple **todos** los siguientes criterios:

- El *typecheck* pasa en frontend y backend.
- Las pruebas automatizadas (unitarias, integración y *e2e*) están en verde.
- La cobertura se mantiene por encima de los umbrales definidos.
- El Quality Gate de SonarCloud está en verde (sin *issues Blocker*/*Critical* nuevos).
- El cambio fue revisado y aprobado por otro integrante del equipo.
- El despliegue en *testing* fue validado operativamente.

## Riesgos y limitaciones del enfoque

Por transparencia, se reconocen las limitaciones del enfoque actual:

- Las pruebas *e2e* son **de humo** (cubren flujos críticos, no la totalidad de los casos de uso).
- El análisis de seguridad con Trivy se ejecuta **bajo demanda** y no en cada *commit*, por lo que depende de la disciplina del equipo para correrlo periódicamente.
- Las pruebas de rendimiento se ejecutan de forma controlada y manual contra producción, no de manera continua.
- La cobertura mide la capa de lógica; los adaptadores de integración dependen de las pruebas *e2e* y de la validación manual.

Estas limitaciones son aceptables para el alcance del proyecto y constituyen líneas claras de mejora futura (por ejemplo, ampliar la suite *e2e* y automatizar el escaneo de seguridad en cada *pull request*).

## Beneficios del enfoque adoptado

El enfoque de QA implementado aporta múltiples beneficios al proyecto:

- Permite detectar errores en etapas tempranas del desarrollo.
- Reduce la probabilidad de fallos en producción.
- Automatiza procesos de validación, despliegue y recuperación.
- Mejora la calidad y mantenibilidad del código mediante umbrales objetivos y análisis estático.
- Garantiza visibilidad del comportamiento del sistema en producción.
- Aumenta la confianza en cada nueva versión del sistema.

## Conclusión

El enfoque de aseguramiento de calidad adoptado en EduTrack no se concibió como una etapa aislada al final del desarrollo, sino como una práctica transversal y continua que acompaña todo el ciclo de vida del software. La calidad se entiende aquí como una responsabilidad compartida por el equipo y como una propiedad construida de forma incremental en cada cambio, y no como una verificación puntual realizada antes de la entrega.

La estrategia combina deliberadamente dos perspectivas complementarias. El enfoque *shift-left* desplaza la detección de errores hacia las etapas más tempranas del desarrollo —validación estática de tipos, *lint*, pruebas unitarias y de integración, análisis estático con SonarCloud y escaneo de seguridad—, permitiendo corregir defectos cuando su costo de resolución es mínimo. El enfoque *shift-right*, en cambio, extiende el aseguramiento hasta el comportamiento real del sistema en producción mediante la observabilidad continua con Sentry, LogRocket y Grafana, reconociendo que ninguna prueba previa puede anticipar la totalidad de las condiciones de uso reales. Sobre una base de automatización que reduce el margen de error humano, la integración de pruebas en múltiples niveles, umbrales de cobertura verificables, un *Quality Gate* objetivo, análisis de seguridad, pruebas de rendimiento y un mecanismo de recuperación ante fallos conforma una estrategia integral que cubre las distintas dimensiones de la calidad: funcional, estructural, de seguridad, de rendimiento y operativa.

El resultado es un proceso que aporta beneficios concretos —detección temprana de errores, menor probabilidad de fallos en producción, mayor mantenibilidad, trazabilidad completa de cada cambio y una confianza sostenida en cada nueva versión—, especialmente relevantes dado el carácter productivo del sistema y su uso real en el Liceo Los Olivos, donde la estabilidad es un requisito crítico. El equipo reconoce, además, oportunidades claras de evolución —ampliar la cobertura *end-to-end*, automatizar el escaneo de seguridad en cada *pull request* o incorporar pruebas de rendimiento continuas— que, lejos de constituir una limitación, reflejan la madurez del proceso y consolidan una cultura de calidad orientada a la mejora continua, capaz de sostener el mantenimiento y crecimiento futuro del producto.
