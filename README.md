# AstroDeepSpace · HELIOS

Backend oficial NestJS de HELIOS (Health Evaluation & Life Indicators Observation System). Recibe mediciones simuladas, compara evidencia con líneas base individuales, genera avisos y organiza seguimiento humano. Incluye misión/etapas, preparación y Quirón Bot. Los datos, perfiles y protocolos son ficticios.

## Requisitos e instalación

Node.js 22 o superior y pnpm. El frontend React se mantiene en la carpeta hermana astrodeepspacenasa.

```powershell
pnpm install --frozen-lockfile
Copy-Item .env.example .env
pnpm start:dev
```

El servidor escucha en http://127.0.0.1:3000. La IA es opcional. Para iniciar ambos proyectos desde el frontend se usa npm run dev, después de instalar las dependencias de ambos repositorios. npm run dev:api también inicia NestJS.

## Configuración

| Variable | Uso y valor por defecto |
|---|---|
| PORT | Puerto HTTP, 3000 |
| CORS_ORIGINS | Orígenes permitidos separados por coma, localhost y 127.0.0.1 en 5173 |
| SIMULATION_DATA_DIR | Directorio de sesiones JSON, ./data/sessions |
| AI_PROVIDER | openai-compatible o anthropic |
| AI_API_KEY | Clave opcional del proveedor, exclusivamente en backend/.env |
| AI_BASE_URL | Base del proveedor compatible, https://api.openai.com/v1 |
| AI_MODEL | Modelo elegido, gpt-4o-mini para proveedor compatible |
| AI_TIMEOUT_MS | Tiempo de espera, 25000 ms |

El backend carga su propio .env y respeta variables ya definidas en el proceso. El frontend usa rutas relativas /api. Vite reenvía esas rutas a 3000. Para servir una compilación React, el servidor que la hospede debe reenviar /api a NestJS. Las claves nunca deben llevar el prefijo VITE_.

## Arquitectura

| Módulo | Responsabilidad |
|---|---|
| SimulationModule | Sesiones, contratos Zod, revisiones, idempotencia y persistencia |
| AstronautsModule | Perfiles ficticios, cinco líneas base y estado observado |
| MonitoringModule | Recepción de paquetes, historial, frescura, integridad y comparaciones |
| AlertsModule | Consulta, reconocimiento y cambios de estado según rol simulado |
| MedicalModule | Episodios, síntomas, análisis determinista y comunicaciones |
| HistoryModule | Eventos biométricos, alertas, síntomas, análisis, comunicaciones, rechazos y auditoría |
| NasaModule | Catálogo documental NASA y proxy de metadatos OSDR (OSD-288 / OSD-575) |
| AiModule | Quirón Bot / servicios de IA con esquemas y referencias verificadas |

El motor en src/simulation/domain proviene del dominio React. Los archivos conservados en React permiten ejecutar el simulador local cuando falta la API. Las pruebas de paridad comparan reglas y escenarios con el repositorio hermano, cuando está disponible. No se añadieron dependencias de ejecución.

El indicador observado conserva la regla previa basada en frecuencia cardíaca y síntomas. Las cinco magnitudes ofrecen comparaciones numéricas contra la línea base. La ausencia de evidencia produce no_recent_evaluation. Los signos se consideran recientes durante 45 minutos, el sueño durante 36 horas y un retraso de recepción superior a 30 minutos marca la lectura como antigua. Las lecturas futuras y de calidad cero quedan fuera de la evidencia confiable. Tres cifras idénticas del mismo sensor quedan pendientes de verificación.

## Sesiones y persistencia

Las rutas del dominio usan X-Simulation-Id con un UUID. POST /api/simulation crea una sesión con scenarioId o importa initialState versión 3 validado (`mission`, `prepItems`). Si la sesión existe, devuelve la copia persistida. Las respuestas del dominio incluyen simulated: true. El estado devuelve revision y state.

Cada mutación usa requestId UUID y expectedRevision. Un reintento con el mismo identificador y contenido devuelve el estado actual sin ejecutar otra vez. Reutilizar el identificador con otro contenido o usar una revisión antigua produce 409. React serializa las acciones. Las validaciones estructurales devuelven 400 y las restricciones de rol del servidor devuelven 403. Algunas restricciones funcionales heredadas del reductor se reflejan en state.notice con tono err y conservan la operación de dominio sin aplicar, para mantener el comportamiento de la interfaz.

Se utiliza un archivo por sesión, escritura temporal y sustitución atómica. El proceso único serializa las transacciones mediante operaciones sincrónicas. No se admite ejecutar varias instancias escritoras sobre el mismo directorio. Los archivos quedan fuera de Git. Los JSON dañados se conservan y generan error para permitir recuperación. El cuerpo HTTP admite hasta 10 MB y las colecciones del contrato tienen límites.

IndexedDB conserva la copia del navegador. Ante pérdida de API, React continúa con el simulador local, muestra ese estado y asigna una sesión nueva para la siguiente recarga. La recarga importa la copia local en la sesión nueva, conservando la sesión remota anterior. No existe fusión automática entre ambas. El enlace Tierra del escenario es independiente de la conexión HTTP con NestJS. Los datos privados de Mi espacio conservan su almacenamiento local.

## Endpoints

| Método | Ruta | Contenido |
|---|---|---|
| POST, GET | /api/simulation | Inicializar o recuperar estado |
| POST | /api/simulation/actions | Acción del simulador con control de revisión |
| GET | /api/astronauts | Tripulación y líneas base |
| GET | /api/astronauts/:id | Perfil y estado observado |
| GET | /api/monitoring/measurements | Historial con crewId y kind opcional |
| GET | /api/monitoring/latest | Última evidencia confiable y comparación, requiere crewId y kind |
| POST | /api/monitoring/measurements | Paquete firmado del simulador, simulated debe ser true |
| GET | /api/alerts | Filtros crewId y status |
| POST | /api/alerts/:id/acknowledge | Reconocer aviso |
| POST | /api/alerts/:id/status | Cambiar status |
| GET | /api/medical/episodes | Episodios, filtro crewId |
| GET | /api/medical/episodes/:id | Detalle, síntomas, análisis y resumen |
| GET | /api/medical/episodes/:id/analysis | Análisis determinista, question opcional |
| POST | /api/medical/episodes/:id/analysis | Generar y guardar análisis determinista |
| POST | /api/medical/episodes/:id/review | Crear borrador de solicitud de revisión humana |
| POST | /api/medical/symptoms | Registrar síntomas o una nota |
| GET, POST | /api/medical/communications | Consultar o crear borradores |
| POST | /api/medical/communications/:id/status | Avanzar comunicación |
| GET | /api/history | Filtros crewId, from, to y type |
| GET | /api/supabase/health | Estado de configuración y alcance de Supabase |
| GET | /api/nasa/sources | Catálogo documental NASA + rangos EVA |
| GET | /api/nasa/osdr/studies | Estudios OSDR demo (OSD-288, OSD-575) |
| GET | /api/nasa/osdr/studies/:id | Metadatos OSDR en vivo (proxy) |
| GET | /api/ai/health | Disponibilidad del proveedor |
| POST | /api/ai/analyze | Análisis de contexto validado |
| POST | /api/ai/chat | Consulta con pregunta obligatoria |
| POST | /api/ai/space | Propuesta para Mi espacio |

Las fechas son milisegundos Unix del reloj simulado. kind admite heart_rate, spo2, temperature, respiratory_rate y sleep_hours. Las unidades son lpm, %, °C, rpm y h. El contrato valida valores finitos no negativos y los límites propios de porcentajes y horas diarias. Las ventanas y líneas base corresponden a demostración.

History type admite measurement, alert, symptom, analysis, communication, audit y rejected. La auditoría conserva transiciones de comunicación. El filtro por astronauta relaciona eventos de auditoría con su entidad cuando puede identificarla.

## Ejemplos en PowerShell

```powershell
$sessionId = [guid]::NewGuid().ToString()
$headers = @{ 'X-Simulation-Id' = $sessionId }
$rootUrl = 'http://127.0.0.1:3000'
$snapshot = Invoke-RestMethod -Method Post -Uri "$rootUrl/api/simulation" -Headers $headers -ContentType 'application/json' -Body '{"scenarioId":"gradual-fatigue"}'

$payload = @{
  requestId = [guid]::NewGuid().ToString()
  expectedRevision = $snapshot.revision
  crewId = 'elena-torres'
  symptoms = @('mareo')
  note = 'Autorreporte para revisión humana'
} | ConvertTo-Json
$snapshot = Invoke-RestMethod -Method Post -Uri "$rootUrl/api/medical/symptoms" -Headers $headers -ContentType 'application/json' -Body $payload

Invoke-RestMethod -Uri "$rootUrl/api/monitoring/latest?crewId=elena-torres&kind=heart_rate" -Headers $headers
Invoke-RestMethod -Uri "$rootUrl/api/history?crewId=elena-torres&type=symptom" -Headers $headers
```

Para ingresar un paquete desde un cliente de prueba, se usa signedPacket del motor con messageId único, sequence creciente, crewId, sensorId, kind, value, measuredAt, receivedAt, signalQuality y context. El POST lleva requestId, expectedRevision, simulated: true y packet. La prueba src/simulation/simulation.spec.ts contiene ejemplos ejecutables de ingestión, alteración y reintentos.

## Escenarios y seguimiento humano

Se conservan baseline, gradual-fatigue, frozen-sensor, missing-data, repeated-message, altered-message, link-down, stale-normal, unwell-normal y pulse-escalation. La misma semilla produce el mismo estado inicial. Los cambios y avisos requieren interpretación humana.

Las comunicaciones avanzan draft → queued → sent → received. Un enlace simulado cortado mantiene la cola pendiente. Sent conserva receivedAt en null hasta confirmación humana. La solicitud de revisión crea un borrador y el motor de IA no ejecuta acciones médicas.

## IA y seguridad del prototipo

La IA externa valida JSON, esquema y referencias del contexto. Los errores de JSON y esquema devuelven 422. Los proveedores tienen timeout y cancelación. Sin clave se responde 503 desde los endpoints externos, mientras /api/medical conserva el análisis local_engine. Las respuestas del proveedor se etiquetan model.

El prototipo solicita revisión humana, evita diagnósticos definitivos y probabilidades clínicas, y no ejecuta tratamientos. El esquema garantiza la estructura de una respuesta. La revisión clínica de su contenido sigue siendo humana.

Los roles medical, astronaut y ops son simulados y seleccionables. Las restricciones se comprueban también en el servidor. X-Simulation-Id identifica una sesión de demostración y no autentica a una persona. El servicio se limita a loopback. Una publicación requiere autenticación real y almacenamiento transaccional con controles de acceso.

HMAC-SHA256 v2 cubre todos los campos de los paquetes nuevos. Conserva una clave pública de demostración y sirve para detectar alteraciones del simulador. Las mediciones históricas ya aceptadas pueden provenir de la representación anterior. Los archivos y los datos del navegador están en texto claro.

Los archivos server/ de React conservan la implementación histórica de Hono para trazabilidad y sus pruebas. Los comandos oficiales y Playwright usan únicamente NestJS. La lógica privada de bienestar y la alternativa sin API conservan su ejecución local.

## Pruebas

```powershell
pnpm build
pnpm test --runInBand
pnpm test:e2e --runInBand
```

Desde el frontend se ejecutan npm run build, npm test, npm run lint y npm run test:e2e. Para Playwright debe estar instalado Chromium mediante npx playwright install chromium.

Jest prueba escenarios, paridad, validación, persistencia, firmas, duplicados, calidad, antigüedad, alertas, roles, comunicaciones, análisis sin proveedor y JSON de IA inválido. Playwright comprueba el recorrido previo, accesibilidad, persistencia real en NestJS y continuidad local al cortar la API. Los resultados de esta implementación se registran en docs/validation.md.

## Recursos NASA

Se consultaron Human Research Roadmap y las publicaciones oficiales de OSDR para documentar la relación científica del escenario de fatiga. Los datos de ejecución son sintéticos y no se importaron datasets NASA. La procedencia y el uso concreto están en [recursos científicos](docs/nasa-resources.md). La auditoría y las decisiones de migración están en [auditoría](docs/audit.md).

## DONKI, RadLab y OSDR

NASA environmental integration is separate from simulation and medical alerts. See [contracts, verified sources, configuration and tests](docs/NASA-INTEGRATION.md). Configure NASA_API_KEY exclusively in this backend.
