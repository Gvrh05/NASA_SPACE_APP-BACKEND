# Validación y entrega por fases

Trabajo local en la rama backend-frontend de los dos repositorios, el 14 de noviembre de 2026.

## Fase 1 · Auditoría

Se inspeccionaron todos los archivos de código del backend y los flujos de estado, persistencia, API, IA, integridad, permisos y escenarios del frontend. El diagnóstico está en docs/audit.md. Se identificó que Vite ya dirigía /api a 3000, la IA ya tenía contratos compatibles y el dominio operativo todavía estaba en React. Las prioridades fueron monitoreo, persistencia y preservación de escenarios. Esta fase consistió en lectura y documentación. Las pruebas comenzaron después de definir los contratos.

## Fase 2 · Arquitectura

Se añadieron src/simulation/contracts.ts, src/simulation/domain/* y src/simulation/shared/*. Los contratos conservan las entidades existentes. Se eligió persistencia JSON atómica por sesión para una instancia. Se definieron revisiones y requestId para las mutaciones. React conserva el motor necesario para simulación sin API. La siguiente fase implementó los módulos sobre ese almacén común.

## Fase 3 · Implementación

Se añadieron src/simulation/simulation.service.ts, simulation.controller.ts y simulation.module.ts, además de src/astronauts, src/monitoring, src/alerts, src/medical y src/history. Se modificaron src/app.module.ts, src/main.ts, src/config/env.ts, src/ai/ai.service.ts y .gitignore.

Quedaron implementados perfiles y líneas base, recepción validada, frescura, calidad cero, congelación, firmas v2, duplicados, alertas, episodios, síntomas, análisis determinista, solicitudes de revisión humana, comunicaciones con estados separados e historial filtrable. Se corrigió el error de JSON inválido de IA. La siguiente fase conectó el cliente React.

## Fase 4 · Integración

En el frontend se añadieron src/api/simulation.ts y shared/stateSchema.ts. Se modificaron src/state/store.tsx, src/persistence/db.ts, src/domain/guard.ts, src/domain/selectors.ts, shared/mac.ts, src/ai/client.ts, src/pages/AnalysisPage.tsx, src/components/Shell.tsx, package.json y playwright.config.ts. Se actualizaron ambos .env.example. Las variables AI_* existentes del .env del frontend se trasladaron al .env ignorado del backend, preservando valores ya configurados allí.

Las acciones conectadas se ejecutan en NestJS. El análisis visible se solicita al motor del backend y se vincula al episodio y evidencia correspondientes. La copia local se conserva y la pérdida de API activa el simulador con una sesión nueva para recuperación al recargar. El indicador de modo y los mensajes de actualización usan los componentes existentes. Hono conserva sus archivos y pruebas, mientras los comandos oficiales ejecutan NestJS.

## Fase 5 · Pruebas

Se añadieron src/simulation/simulation.spec.ts en NestJS, src/api/simulation.test.ts y e2e/backend.spec.ts en React. Se amplió src/ai/ai.service.spec.ts.

| Comprobación ejecutada | Resultado confirmado |
|---|---|
| Backend pnpm build | Compilación correcta |
| Arranque compilado node dist/main.js en puerto temporal | Salud 200 y validación JSON 400, proceso cerrado al terminar |
| Backend pnpm exec tsc --noEmit --incremental false | Correcto, incluye los tipos de pruebas |
| Backend pnpm test --runInBand | 55 pruebas correctas en 3 suites |
| Backend pnpm test:e2e --runInBand | 3 pruebas correctas en 1 suite |
| Backend ESLint sobre contratos, módulos, servicios y pruebas nuevos o editados | Sin errores ni advertencias |
| Frontend npm run build | Compilación y PWA correctas |
| Frontend npm run typecheck | Correcto |
| Frontend npm test | 39 pruebas correctas en 5 archivos |
| Frontend npm run lint | Sin errores, 1 advertencia en MySpacePage.tsx existente |
| Frontend npm run test:e2e | 4 recorridos correctos en Chromium |
| Recorrido principal repetido tras vincular análisis y evidencia | 1 recorrido correcto, TypeScript y lint comprobados de nuevo |

La compilación React advierte que el bundle principal supera 500 kB. La advertencia de React Hooks en MySpacePage.tsx corresponde a un archivo sin modificaciones en esta entrega. El lint dirigido del backend conserva intacto el formato del motor portado, cuya paridad se comprueba por separado.

Los recorridos de navegador verificaron síntomas persistidos realmente en NestJS, recuperación tras recarga, continuidad al perder la API, importación de la copia local al volver a cargar, flujo previo de alertas, análisis, inventario y comunicaciones, y accesibilidad sin infracciones graves detectadas por la prueba existente.

Durante la validación se corrigieron errores de tipos, diferencias de saltos de línea en la prueba de paridad y una expectativa de ausencia en un escenario que generaba nuevas lecturas. Chromium se instaló para ejecutar Playwright. Se amplió a 60 segundos la espera de arranque de NestJS tras un timeout durante comprobaciones simultáneas.

## Fase 6 · Documentación

Se actualizaron README.md en ambos repositorios y ambos .env.example. Se añadieron docs/audit.md, docs/nasa-resources.md y este informe. El README del backend incluye instalación, variables, arquitectura, contratos, rutas, solicitudes PowerShell, escenarios, comandos de prueba y limitaciones. Las fuentes NASA consultadas se documentan con enlaces oficiales y procedencia sintética de las cifras.

## Límites y comprobaciones pendientes de un despliegue real

La integración de la API externa de IA se comprobó mediante contratos y respuestas simuladas. No se envió una consulta a un proveedor real durante esta validación. Las claves de proveedor permanecen en el backend.

Los roles, PIN, perfiles y HMAC siguen siendo de demostración. La representación v2 cubre todos los campos de paquetes nuevos, con clave pública. La persistencia JSON es para una instancia y carece de cifrado. El prototipo usa datos ficticios y requiere revisión humana. Las líneas base y los umbrales existentes no se validaron clínicamente ni se derivaron de datasets NASA.

La continuidad local conserva la sesión remota anterior y crea una nueva al recuperar la copia local. La fusión entre sesiones requiere una decisión explícita posterior. El MVP queda preparado para ejecutar desde el frontend mediante npm run dev. Los siguientes pasos para un despliegue multiusuario incluyen autenticación real y persistencia transaccional.
