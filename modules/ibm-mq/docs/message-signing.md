# Firma JWT de los mensajes IBM MQ

Esta implementación agrega autenticidad e integridad del mensaje al flujo REST cloud. Se mantiene Vercel + Supabase Cloud + IBM MQ Cloud. No utiliza el JWT de sesión del usuario y no requiere un worker local permanente.

## Recorrido

1. La API verifica la sesión, MFA y permisos de usuario como antes.
2. El productor obtiene el evento del outbox y valida su contrato con Zod.
3. Antes del POST a IBM, la aplicación crea un JWT firmado ES256 con una clave privada de mensajería.
4. IBM transporta ese JWT como texto por la API REST, manteniendo HTTPS, sus credenciales y sus permisos.
5. El consumidor conserva el token original en el inbox antes de retirar el mensaje de MQ.
6. Antes de interpretar el cuerpo y ejecutar SQL de negocio, verifica la firma y las condiciones del JWT con claves públicas de confianza.
7. El cuerpo autenticado se interpreta como JSON y pasa por Zod y las comprobaciones SQL existentes.
8. Entradas sin firma válida se conservan en cuarentena BOQ. No ejecutan el efecto de negocio.

Los recordatorios, solicitudes de resumen, respuestas y sobres BOQ se firman al salir. Las entradas procesadas y las respuestas recuperadas para el usuario se verifican al llegar. La BOQ sigue sin tener un consumidor automático.

## Qué se verifica

El verificador fija `ES256` y el tipo `authcdn-mq+jwt`. Exige `iss`, `aud`, `iat`, `exp` y `jti`. El `kid` solo selecciona claves del mapa público configurado localmente; no descarga claves desde una URL recibida en el mensaje.

La audiencia y el contexto firmado incluyen gestor y cola. Se firman también los valores esperados de ReplyTo y CorrelId, de modo que cambiar el destino de respuesta o la correlación invalida su uso. Se normalizan los IDs nulos de IBM y el sufijo local `@gestor` de ReplyTo.

`jti` conserva `eventId`, `requestId` o `inboxId`, cuando están disponibles. La firma no impide por sí sola reenviar un token válido: la deduplicación y la revalidación de negocio siguen siendo responsabilidad del inbox y las RPC existentes.

Cuando hay `expiresAt`, el JWT utiliza ese plazo, redondeado al segundo superior. Se admite una tolerancia de reloj de cinco segundos al verificar; SQL y el transporte siguen comprobando el plazo de negocio. Un token expirado va a cuarentena y no invoca la RPC de negocio. El mantenimiento SQL reconcilia los recordatorios QUEUED cuya vigencia terminó.

Los sobres BOQ sin TTL de transporte tienen JWT con vigencia de 24 horas. Esa vigencia no elimina el mensaje ni su evidencia. Una inspección forense posterior debe diferenciar comprobar la firma histórica de aceptar nuevamente el token como una entrada vigente.

## Archivos

| Pieza | Ubicación |
|---|---|
| Configuración, firma, verificación y adaptación del envío | `infrastructure/message-jwt.ts` |
| Integración antes de la RPC y antes de devolver el resumen | `application/cloud.ts` |
| Pruebas criptográficas negativas y positivas | `tests/unit/message-jwt.test.ts` |
| Flujo cloud firmado, concurrencia y bloqueo de entradas inválidas | `tests/unit/cloud.test.ts` |
| Generación puntual de claves, sin imprimirlas | `scripts/generate-message-signing-keys.mjs` |

El adaptador REST genérico no firma por sí solo. El orquestador cloud envuelve sus dos identidades con `withMessageSigning()`. Las herramientas históricas de `legacy/` conservan su comportamiento anterior.

## Configuración de servidor

| Variable | Contenido |
|---|---|
| `MQ_MESSAGE_JWT_ISSUER` | Emisor esperado; por defecto `urn:auth-cdn:mq`. |
| `MQ_MESSAGE_JWT_KEY_ID` | Identificador de la clave que firma nuevas publicaciones. |
| `MQ_MESSAGE_JWT_PRIVATE_KEY` | Clave EC P-256 privada, PEM PKCS#8. |
| `MQ_MESSAGE_JWT_PUBLIC_KEYS` | JSON que relaciona cada `kid` confiable con una clave pública PEM SPKI. |

Las variables son privadas de servidor y no llevan `NEXT_PUBLIC_`. Son independientes de las claves de Supabase y de las credenciales IBM. Se comprueba que la clave privada activa corresponde a su clave pública al crear el orquestador, antes de reservar trabajo. Sin configuración válida el flujo falla cerrado.

Desde la raíz del proyecto puede generarse un par de claves y un archivo de variables en una carpeta privada externa al repositorio:

```text
pnpm mq:keys ../mq-message-keys
```

El generador no imprime claves ni sobrescribe archivos existentes. El archivo `.env` generado contiene una clave privada: se configura en el entorno de servidor elegido, no se publica ni se incorpora al repositorio. No es un proceso que deba quedar encendido.

## Rotación y activación

Primero se distribuyen las claves públicas antigua y nueva a todos los verificadores. Después se cambia la clave privada y el `kid` que firman. La clave pública anterior se conserva mientras haya mensajes o trabajo pendiente que deba verificarse con ella. Se retira cuando el responsable decida dejar de confiar en esos mensajes.

El cambio de formato es estricto: JSON sin firma deja de aceptarse. Antes de activarlo hay que resolver los mensajes/inbox anteriores y coordinar los emisores, consumidores y el destino de Cron. La evidencia previa de esta rama muestra un Cron permanente dirigido al alias anterior y un Cron temporal del refactor ya retirado. No se deben mezclar esos despliegues sin coordinar el formato y las claves. Este cambio local no actualiza Vault ni el destino del Cron.

Los reintentos conservan el cuerpo de negocio persistido. La firma de transporte se genera al enviar, por lo que un reenvío puede cambiar el token y el MsgId, manteniendo el identificador lógico. Las salidas OUTPUT existentes conservan su recuperación y los errores de firma o envío no descartan el cuerpo persistido.

Una clave privada de aplicación autentica a quien controla esa clave, no directamente al usuario final. En esta arquitectura emisor y receptor viven en la misma aplicación Vercel; una separación futura puede entregar solo claves públicas a un receptor que no deba firmar.

## Límites

Una firma detecta modificaciones y acredita una clave emisora confiable. El contenido del JWT sigue siendo legible: no añade cifrado del cuerpo. HTTPS y los permisos de IBM permanecen necesarios. No sustituye Zod, RLS, autorización, deduplicación ni la gestión de claves.

Las evidencias cloud originales no prueban esta nueva capa. Antes de atribuirle funcionamiento desplegado deben probarse en un entorno coordinado un mensaje válido, uno alterado, uno sin firma, uno expirado, Request/Reply concurrente, recuperación de inbox y rotación.

Referencias: [jose](https://github.com/panva/jose), [verificación de JWT](https://github.com/panva/jose/blob/main/docs/jwt/verify/functions/jwtVerify.md) y [RFC 8725](https://www.rfc-editor.org/info/rfc8725/).
