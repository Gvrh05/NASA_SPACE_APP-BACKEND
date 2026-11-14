# Auditoría y arquitectura del MVP

## Estado inicial

Backend NestJS con AppModule y AiModule. AiController ofrece health, analyze, chat y space bajo /api/ai. AiService valida esquemas Zod y referencias. provider.ts maneja proveedores compatibles con OpenAI y Anthropic, cancelación y timeout. Faltan módulos de monitoreo, astronautas, alertas, seguimiento e historial. El parseo JSON fuera del manejador de errores puede devolver 500. La configuración lee claves desde el repositorio hermano.

React contiene el dominio completo en src/domain, IndexedDB, comunicaciones, inventario y diez escenarios deterministas. Las únicas peticiones HTTP previas son las cuatro rutas de IA. Vite ya apunta a NestJS en 3000 y npm run dev ya inicia NestJS. Hono duplica la IA y permanece como implementación histórica hasta completar la validación. El guard de IndexedDB solo valida algunos campos superficiales.

Los contratos de shared/types.ts cubren mediciones, episodios, síntomas, alertas, análisis y comunicaciones. Los contratos de IA coinciden en estructura. Las reglas de frescura son 45 minutos para signos, 36 horas para sueño y 30 minutos de retraso de recepción. El indicador observado usa frecuencia cardíaca y síntomas. Las líneas base restantes se exponen como comparaciones descriptivas. No se incorporan umbrales clínicos nuevos.

El HMAC original tiene clave pública de demostración y firma solo parte del paquete. La migración incorpora una representación v2 que cubre todos los campos de paquetes nuevos y conserva la clave pública del simulador. No autentica dispositivos ni protege contra un usuario del navegador. Los roles y PIN son simulados. El almacenamiento no tiene cifrado. El prototipo debe usarse con datos ficticios en loopback.

## Contratos y responsabilidades

SimulationModule contiene el estado por sesión, revisión y transacciones persistidas. POST /api/simulation inicializa una sesión o recupera la existente. POST /api/simulation/actions aplica acciones validadas del dominio con requestId y expectedRevision. Las peticiones usan X-Simulation-Id UUID, un identificador de simulación que no constituye autenticación.

AstronautsModule expone perfiles, líneas base y estado observado. MonitoringModule valida paquetes y consulta historial y última evidencia confiable. AlertsModule gestiona avisos con los permisos simulados. MedicalModule expone episodios, síntomas, análisis deterministas y comunicaciones. HistoryModule unifica eventos y filtros. AiModule conserva sus contratos.

El motor existente se conserva en src/simulation/domain y shared. React mantiene la copia necesaria para simulación sin API, selectores de presentación y bienestar privado. Las pruebas de paridad detectan divergencia de reglas y escenarios entre repositorios. En modo conectado, las mutaciones son ejecutadas por NestJS. IndexedDB conserva una copia recuperable. Ante pérdida de API se abre una nueva sesión local para evitar sobrescribir el estado remoto al recargar. Los datos privados de Mi espacio permanecen en su almacenamiento original.

## Persistencia elegida

Un archivo JSON versionado por sesión, con archivo temporal y rename atómico, permite ejecutar el MVP sin servidor de base de datos ni nuevas dependencias. Las operaciones sincrónicas de una instancia serializan lectura, validación, escritura y publicación. Las revisiones detectan conflictos entre pestañas y requestId previene reejecución. No soporta varias instancias escritoras. Para despliegue multiusuario se requiere una base transaccional y autenticación real.

## Prioridades

1. Preservar escenarios y contratos, validar estado y acciones.
2. Persistir transacciones y publicar módulos de monitoreo y seguimiento.
3. Conectar React y hacer explícita la alternativa local.
4. Probar integridad, idempotencia, permisos, ausencia de IA y flujo HTTP.
5. Documentar ejecución, recursos científicos y límites verificados.
