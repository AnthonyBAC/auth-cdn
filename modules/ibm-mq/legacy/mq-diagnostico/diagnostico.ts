import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { spawn } from "node:child_process";
import { access, chmod, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { createRequire } from "node:module";
import { basename, join } from "node:path";

// Diagnóstico de compatibilidad de ibmmq@2.1.9 en Vercel Functions.
// Solo MQCONNX + MQOPEN (INQUIRE) + MQCLOSE + MQDISC. Nunca MQPUT ni MQGET.
// No registra credenciales, claves ni contenido del keystore.

// Vercel expone un sistema de archivos de solo lectura salvo /tmp. El cliente
// redistribuible "no instalado" usa por defecto $HOME/IBM/MQ/data como ruta de
// datos y NO la crea automáticamente. Por eso se apunta MQ_OVERRIDE_DATA_PATH
// (documentado) a un directorio privado pre-creado bajo /tmp, sin sobrescribir
// HOME globalmente.
const DIR_HOME = "/tmp/mq-poc-home";
const DIR_DATA = "/tmp/mq-poc-data";
const DIR_KEYSTORE = "/tmp/mq-poc-keystore";

export type Etapa = "entorno" | "load" | "init" | "tcp" | "connx" | "open";

export const ETAPAS: Etapa[] = ["entorno", "load", "init", "tcp", "connx", "open"];

// Etapa adicional que no ejecuta MQCONNX: solo verifica la integridad del
// keystore reconstruido desde las variables Base64.
export const ETAPA_INTEGRIDAD = "integridad" as const;

// Etapa adicional que no ejecuta MQCONNX: verifica HOME/.mqm y MQ_OVERRIDE_DATA_PATH.
export const ETAPA_DIRECTORIOS = "directorios" as const;

// Etapa que lista (solo nombres y tamaños) los FFST/FDC/AMQERR generados por el
// cliente nativo en los directorios escribibles. No devuelve contenido.
export const ETAPA_DIAGNOSTICOS = "diagnosticos" as const;

// Etapa que ejecuta MQCONNX/MQDISC en un proceso hijo para que el padre sobreviva
// a un SIGSEGV y pueda inspeccionar los artefactos generados.
export const ETAPA_CHILD_CONNX = "child-connx" as const;

type Entorno = {
  keyRepository: string;
  queueManager: string;
  queue: string;
  channel: string;
  cipherSpec: string;
};

type RuntimeInfo = { node: string; glibc: string | null };

export type ResultadoMq =
  | {
      ok: true;
      etapa: Exclude<Etapa, "tcp">;
      runtime: RuntimeInfo;
      entornoPreparado: boolean;
      clienteCargado: boolean;
      estructurasInicializadas: boolean;
      connected: boolean;
      queueOpened: boolean;
      tls: boolean;
      queueManager: string;
      queue: string;
      channel: string;
      cipherSpec: string;
    }
  | {
      ok: false;
      error: {
        code: string;
        message: string;
        etapa: Exclude<Etapa, "tcp">;
        mqrc?: number;
        mqcc?: number;
      };
    };

export type ResultadoTcp =
  | { ok: true; etapa: "tcp"; host: string; port: number; runtime: RuntimeInfo }
  | {
      ok: false;
      etapa: "tcp";
      error: { code: string; message: string; host: string; port: number };
    };

export type DiagnosticoMq = ResultadoMq | ResultadoTcp;

function razon(error: unknown): { mqrc?: number; mqcc?: number } {
  const candidate = error as { mqrc?: unknown; mqcc?: unknown } | null | undefined;
  return {
    mqrc: typeof candidate?.mqrc === "number" ? candidate.mqrc : undefined,
    mqcc: typeof candidate?.mqcc === "number" ? candidate.mqcc : undefined
  };
}

// Hito mínimo antes/después de cada operación. Sin secretos, rutas ni valores.
function registrar(etapa: string, paso: string, extra?: Record<string, unknown>): void {
  console.log(JSON.stringify({ proceso: "mq-poc", etapa, paso, ...extra }));
}

// Versión de glibc del runtime, útil para contrastar el requisito GLIBC_2.28
// del Redistributable Client de MQ 10.0.0. No revela información sensible.
function infoRuntime(): RuntimeInfo {
  let glibc: string | null = null;
  try {
    const header = (process.report?.getReport?.() as { header?: { glibcVersionRuntime?: string } } | undefined)?.header;
    glibc = typeof header?.glibcVersionRuntime === "string" ? header.glibcVersionRuntime : null;
  } catch {
    glibc = null;
  }
  return { node: process.version, glibc };
}

// Crea un directorio privado y restrictivo bajo /tmp y fuerza los permisos.
async function asegurarDirectorio(privado: string): Promise<void> {
  await mkdir(privado, { recursive: true, mode: 0o700 });
  await chmod(privado, 0o700);
}

// Crea los directorios privados bajo /tmp sin tocar el entorno del proceso.
// El cliente redistribuible usa ${HOME}/.mqm para sus socket files (ruta acotada
// por sun_path) y necesita HOME escribible; MQ_OVERRIDE_DATA_PATH es la ruta de
// datos (no se crea automáticamente).
async function prepararDirectoriosSinEnv(): Promise<{ home: string; data: string }> {
  await asegurarDirectorio(DIR_HOME);
  await asegurarDirectorio(join(DIR_HOME, ".mqm"));
  await asegurarDirectorio(DIR_DATA);
  return { home: DIR_HOME, data: DIR_DATA };
}

let directoriosPreparados: Promise<void> | null = null;

function prepararDirectorios(): Promise<void> {
  if (!directoriosPreparados) {
    directoriosPreparados = (async () => {
      const { home, data } = await prepararDirectoriosSinEnv();
      process.env.HOME = home;
      process.env.MQ_OVERRIDE_DATA_PATH = data;
    })();
  }
  return directoriosPreparados;
}

export type EstadoDirectorio = {
  configurado: boolean;
  existe: boolean;
  esDirectorio: boolean;
  escribible: boolean;
};

// Describe un directorio sin revelar su ruta: solo devuelve booleanos.
export async function describirDirectorio(ruta: string | undefined): Promise<EstadoDirectorio> {
  if (!ruta) {
    return { configurado: false, existe: false, esDirectorio: false, escribible: false };
  }

  let info;
  try {
    info = await stat(ruta);
  } catch {
    return { configurado: true, existe: false, esDirectorio: false, escribible: false };
  }

  const esDirectorio = info.isDirectory();
  let escribible = false;
  if (esDirectorio) {
    try {
      await access(ruta, constants.W_OK);
      escribible = true;
    } catch {
      escribible = false;
    }
  }

  return { configurado: true, existe: true, esDirectorio, escribible };
}

function requerida(nombre: string): string {
  const valor = process.env[nombre];
  if (!valor) throw new Error(`Falta la variable de entorno ${nombre}.`);
  return valor;
}

// Materializa el keystore TLS desde las variables Base64 (o devuelve la ruta
// directa de MQ_TLS_KEY_REPOSITORY). Devuelve el "stem" que usa MQSCO.KeyRepository.
// Todo bajo /tmp con permisos restrictivos. No se sobrescribe HOME.
async function materializarKeystore(): Promise<string> {
  const kdb = process.env.MQ_TLS_KEY_REPOSITORY_BASE64;
  const sth = process.env.MQ_TLS_KEY_STH_BASE64;
  const rdb = process.env.MQ_TLS_KEY_RDB_BASE64;

  if (!kdb && !sth && !rdb) {
    const directo = process.env.MQ_TLS_KEY_REPOSITORY;
    if (!directo) {
      throw new Error("Falta MQ_TLS_KEY_REPOSITORY o el keystore en base64.");
    }
    return directo;
  }

  if (!kdb) {
    throw new Error("MQ_TLS_KEY_REPOSITORY_BASE64 es obligatorio para materializar el keystore.");
  }

  await asegurarDirectorio(DIR_KEYSTORE);
  const stem = join(DIR_KEYSTORE, "key");
  await writeFile(`${stem}.kdb`, Buffer.from(kdb, "base64"), { mode: 0o600 });
  if (sth) await writeFile(`${stem}.sth`, Buffer.from(sth, "base64"), { mode: 0o600 });
  if (rdb) await writeFile(`${stem}.rdb`, Buffer.from(rdb, "base64"), { mode: 0o600 });
  return stem;
}

// Prepara HOME/.mqm + MQ_OVERRIDE_DATA_PATH, materializa el keystore TLS y lee la
// configuración de conexión. Memoizado por proceso para evitar carreras.
let entornoPreparado: Promise<Entorno> | null = null;

function prepararEntorno(): Promise<Entorno> {
  if (!entornoPreparado) {
    entornoPreparado = (async () => {
      await prepararDirectorios();
      const keyRepository = await materializarKeystore();
      return {
        keyRepository,
        queueManager: requerida("MQ_QUEUE_MANAGER"),
        queue: process.env.MQ_POC_QUEUE ?? process.env.MQ_QUEUE ?? "",
        channel: requerida("MQ_CHANNEL"),
        cipherSpec: requerida("MQ_TLS_CIPHER_SPEC")
      };
    })();
  }
  return entornoPreparado;
}

// Mensaje seguro: solo nombres de variable, nunca valores, rutas ni secretos.
function mensajeEntorno(error: unknown): string {
  if (error instanceof Error && error.message.includes("variable de entorno")) {
    return error.message;
  }
  return "No se pudo preparar el entorno de IBM MQ (ruta de datos o keystore TLS).";
}

function resultadoBase(etapa: Exclude<Etapa, "tcp">, entorno: Entorno): Extract<ResultadoMq, { ok: true }> {
  return {
    ok: true,
    etapa,
    runtime: infoRuntime(),
    entornoPreparado: true,
    clienteCargado: false,
    estructurasInicializadas: false,
    connected: false,
    queueOpened: false,
    tls: true,
    queueManager: entorno.queueManager,
    queue: entorno.queue,
    channel: entorno.channel,
    cipherSpec: entorno.cipherSpec
  };
}

function parsearConexion(connectionName: string): { host: string; port: number } {
  const m = /^(.+?)\((\d+)\)$/.exec(connectionName.trim());
  if (m) return { host: m[1], port: Number(m[2]) };
  return { host: connectionName.trim(), port: 1414 };
}

// Solo abre un socket TCP al host:puerto y lo cierra. Sin credenciales, sin
// datos IBM MQ, sin mensajes. Timeout corto y acotado.
function etapaTcp(connectionName: string, timeoutMs = 3000): Promise<ResultadoTcp> {
  const { host, port } = parsearConexion(connectionName);
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    let settled = false;
    const terminar = (resultado: ResultadoTcp) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(resultado);
    };

    socket.setTimeout(timeoutMs, () =>
      terminar({
        ok: false,
        etapa: "tcp",
        error: { code: "TCP_TIMEOUT", message: "No se alcanzó host:puerto en el plazo configurado.", host, port }
      })
    );
    socket.once("connect", () => terminar({ ok: true, etapa: "tcp", host, port, runtime: infoRuntime() }));
    socket.once("error", () =>
      terminar({
        ok: false,
        etapa: "tcp",
        error: { code: "TCP_ERROR", message: "No se pudo conectar por TCP.", host, port }
      })
    );
  });
}

export async function ejecutarDiagnostico(etapa: Etapa = "open"): Promise<DiagnosticoMq> {
  // Se registra la versión de runtime lo antes posible: si una etapa nativa
  // aborta con SIGSEGV, este hito ya queda en los logs.
  registrar(etapa, "runtime", { ...infoRuntime() });

  // ETAPA tcp: conectividad pura, sin tocar el cliente nativo ni IBM MQ.
  if (etapa === "tcp") {
    registrar("tcp", "tcp.antes");
    const connectionName = process.env.MQ_CONNECTION_NAME;
    if (!connectionName) {
      return {
        ok: false,
        etapa: "tcp",
        error: { code: "CONFIGURATION", message: "Falta la variable de entorno MQ_CONNECTION_NAME.", host: "", port: 0 }
      };
    }
    const resultado = await etapaTcp(connectionName);
    registrar("tcp", resultado.ok ? "tcp.ok" : "tcp.error");
    return resultado;
  }

  // ETAPA entorno: ruta de datos + keystore. No carga el cliente nativo.
  let entorno: Entorno;
  registrar(etapa, "entorno.antes");
  try {
    entorno = await prepararEntorno();
  } catch (error) {
    return {
      ok: false,
      error: { code: "ENVIRONMENT", message: mensajeEntorno(error), etapa: "entorno" }
    };
  }
  registrar(etapa, "entorno.ok");
  if (etapa === "entorno") return resultadoBase("entorno", entorno);

  // ETAPA load: carga diferida del cliente nativo.
  const require = createRequire(import.meta.url);
  let mq: typeof import("ibmmq");
  registrar(etapa, "load.antes");
  try {
    mq = require("ibmmq") as typeof import("ibmmq");
  } catch {
    return {
      ok: false,
      error: { code: "NATIVE_LOAD", message: "No se pudo cargar el cliente nativo IBM MQ.", etapa: "load" }
    };
  }
  registrar(etapa, "load.ok");
  if (etapa === "load") return resultadoBase("load", entorno);

  // ETAPA init: construcción de estructuras MQ sin conectar.
  const cno = new mq.MQCNO();
  const canal = new mq.MQCD();
  const tls = new mq.MQSCO();
  const credenciales = new mq.MQCSP();

  registrar(etapa, "init.antes");
  try {
    cno.Options = mq.MQC.MQCNO_CLIENT_BINDING | mq.MQC.MQCNO_RECONNECT_DISABLED;
    canal.ChannelName = entorno.channel;
    canal.ConnectionName = requerida("MQ_CONNECTION_NAME");
    canal.SSLCipherSpec = entorno.cipherSpec;
    canal.SSLPeerName = requerida("MQ_TLS_PEER_NAME");
    cno.ClientConn = canal;

    tls.KeyRepository = entorno.keyRepository;
    if (process.env.MQ_TLS_KEY_REPOSITORY_PASSWORD) {
      tls.KeyRepoPassword = process.env.MQ_TLS_KEY_REPOSITORY_PASSWORD;
    }
    if (process.env.MQ_TLS_CERTIFICATE_LABEL) {
      tls.CertificateLabel = process.env.MQ_TLS_CERTIFICATE_LABEL;
    }
    cno.SSLConfig = tls;

    credenciales.UserId = requerida("MQ_USERNAME");
    credenciales.Password = requerida("MQ_PASSWORD");
    cno.SecurityParms = credenciales;
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "CONFIGURATION",
        message: error instanceof Error && error.message.includes("variable de entorno")
          ? error.message
          : "No se pudo construir la configuración de IBM MQ.",
        etapa: "init"
      }
    };
  }
  registrar(etapa, "init.ok");
  if (etapa === "init") {
    const base = resultadoBase("init", entorno);
    return { ...base, estructurasInicializadas: true };
  }

  // ETAPA connx: MQCONNX con TLS (sin abrir cola).
  registrar(etapa, "connx.antes");
  let connection: Awaited<ReturnType<typeof mq.ConnxPromise>> | undefined;
  try {
    connection = await mq.ConnxPromise(entorno.queueManager, cno);
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "MQ_ERROR",
        message: "MQCONNX rechazó la conexión a IBM MQ.",
        etapa: "connx",
        ...razon(error)
      }
    };
  }
  registrar(etapa, "connx.ok");

  if (etapa === "connx") {
    try {
      await mq.DiscPromise(connection);
    } catch {
      // La desconexión no condiciona el resultado.
    }
    const base = resultadoBase("connx", entorno);
    return { ...base, clienteCargado: true, estructurasInicializadas: true, connected: true };
  }

  // ETAPA open: MQOPEN con MQOO_INQUIRE (no destructivo), cierre y desconexión.
  registrar(etapa, "open.antes");
  let handle: Awaited<ReturnType<typeof mq.OpenPromise>> | undefined;
  try {
    const od = new mq.MQOD();
    od.ObjectName = entorno.queue;
    od.ObjectType = mq.MQC.MQOT_Q;

    handle = await mq.OpenPromise(
      connection,
      od,
      mq.MQC.MQOO_INQUIRE | mq.MQC.MQOO_FAIL_IF_QUIESCING
    );

    await mq.ClosePromise(handle, 0);
    handle = undefined;
  } catch (error) {
    if (handle !== undefined) {
      try {
        await mq.ClosePromise(handle, 0);
      } catch {
        // La desconexión libera los recursos.
      }
    }
    if (connection !== undefined) {
      try {
        await mq.DiscPromise(connection);
      } catch {
        // No altera el resultado del diagnóstico.
      }
    }
    return {
      ok: false,
      error: {
        code: "MQ_ERROR",
        message: "MQOPEN (INQUIRE) no pudo abrir la cola.",
        etapa: "open",
        ...razon(error)
      }
    };
  }
  registrar(etapa, "open.ok");

  try {
    await mq.DiscPromise(connection);
  } catch {
    // La desconexión ya no condiciona el resultado.
  }

  return {
    ...resultadoBase("open", entorno),
    clienteCargado: true,
    estructurasInicializadas: true,
    connected: true,
    queueOpened: true
  };
}

// ---- Integridad del keystore reconstruido (sin MQCONNX) ----

export type IntegridadArchivo = {
  existe: boolean;
  tamano: number;
  coincide: boolean;
};

export type ResultadoIntegridad =
  | {
      ok: true;
      etapa: typeof ETAPA_INTEGRIDAD;
      prefijoConsistente: boolean;
      archivos: { kdb: IntegridadArchivo; sth: IntegridadArchivo; rdb: IntegridadArchivo };
    }
  | {
      ok: false;
      etapa: typeof ETAPA_INTEGRIDAD;
      error: { code: string; message: string };
    };

function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

// Compara los bytes reconstruidos con los SHA-256 originales. No devuelve
// hashes, contenido, rutas absolutas ni variables de entorno.
export function evaluarArchivos(
  reconstruidos: { kdb: Buffer | null; sth: Buffer | null; rdb: Buffer | null },
  esperados: { kdb?: string; sth?: string; rdb?: string }
): { kdb: IntegridadArchivo; sth: IntegridadArchivo; rdb: IntegridadArchivo } {
  const evaluar = (bytes: Buffer | null, esperado: string | undefined): IntegridadArchivo => {
    const existe = bytes !== null && bytes.length > 0;
    let coincide = false;
    if (existe && esperado && /^[0-9a-f]{64}$/i.test(esperado)) {
      coincide = sha256Hex(bytes).toLowerCase() === esperado.toLowerCase();
    }
    return { existe, tamano: bytes ? bytes.length : 0, coincide };
  };

  return {
    kdb: evaluar(reconstruidos.kdb, esperados.kdb),
    sth: evaluar(reconstruidos.sth, esperados.sth),
    rdb: evaluar(reconstruidos.rdb, esperados.rdb)
  };
}

async function leerArchivo(stem: string, extension: string): Promise<Buffer | null> {
  try {
    return await readFile(`${stem}.${extension}`);
  } catch {
    return null;
  }
}

// Reutiliza materializarKeystore, recalcula SHA-256 de los bytes reconstruidos y
// los compara con los originales. No ejecuta MQCONNX, MQPUT ni MQGET.
export async function ejecutarIntegridad(esperados: {
  kdb?: string;
  sth?: string;
  rdb?: string;
}): Promise<ResultadoIntegridad> {
  let stem: string;
  try {
    stem = await materializarKeystore();
  } catch (error) {
    return {
      ok: false,
      etapa: ETAPA_INTEGRIDAD,
      error: { code: "ENVIRONMENT", message: mensajeEntorno(error) }
    };
  }

  const kdb = await leerArchivo(stem, "kdb");
  const sth = await leerArchivo(stem, "sth");
  const rdb = await leerArchivo(stem, "rdb");

  // Los tres archivos comparten el mismo "stem" y viven en la ruta esperada por
  // MQSCO.KeyRepository. Se comprueba que exista al menos uno y que el prefijo
  // no contenga espacios (requisito de IBM MQ para la ruta de datos).
  const prefijo = basename(stem);
  const prefijoConsistente =
    (kdb !== null || sth !== null || rdb !== null) && !/\s/.test(prefijo);

  return {
    ok: true,
    etapa: ETAPA_INTEGRIDAD,
    prefijoConsistente,
    archivos: evaluarArchivos({ kdb, sth, rdb }, esperados)
  };
}

// ---- Verificación de HOME/.mqm y MQ_OVERRIDE_DATA_PATH (sin MQCONNX) ----

export type DiagnosticoDirectorios =
  | {
      ok: true;
      etapa: typeof ETAPA_DIRECTORIOS;
      crudo: { home: EstadoDirectorio; mqm: EstadoDirectorio; dataPath: EstadoDirectorio };
      preparado: { home: EstadoDirectorio; mqm: EstadoDirectorio; dataPath: EstadoDirectorio };
    }
  | {
      ok: false;
      etapa: typeof ETAPA_DIRECTORIOS;
      error: { code: string; message: string };
    };

// Informa el estado de HOME, ${HOME}/.mqm y MQ_OVERRIDE_DATA_PATH antes y después
// de prepararlos. No ejecuta MQCONNX ni revela rutas absolutas.
export async function ejecutarDiagnosticoDirectorios(): Promise<DiagnosticoDirectorios> {
  const homeCrudo = process.env.HOME;
  const dataCrudo = process.env.MQ_OVERRIDE_DATA_PATH;

  const crudo = {
    home: await describirDirectorio(homeCrudo),
    mqm: await describirDirectorio(homeCrudo ? join(homeCrudo, ".mqm") : undefined),
    dataPath: await describirDirectorio(dataCrudo)
  };

  try {
    await prepararDirectorios();
  } catch {
    return {
      ok: false,
      etapa: ETAPA_DIRECTORIOS,
      error: { code: "ENVIRONMENT", message: "No se pudo preparar HOME o MQ_OVERRIDE_DATA_PATH." }
    };
  }

  const homePreparado = process.env.HOME;
  const dataPreparado = process.env.MQ_OVERRIDE_DATA_PATH;

  const preparado = {
    home: await describirDirectorio(homePreparado),
    mqm: await describirDirectorio(homePreparado ? join(homePreparado, ".mqm") : undefined),
    dataPath: await describirDirectorio(dataPreparado)
  };

  return { ok: true, etapa: ETAPA_DIRECTORIOS, crudo, preparado };
}

// ---- Detección de FFST/FDC/AMQERR (sin leer contenido) ----

export type FicheroDiagnostico = { nombre: string; tamano: number };

export type DiagnosticoArtefactos =
  | {
      ok: true;
      etapa: typeof ETAPA_DIAGNOSTICOS;
      errores: { directorioExiste: boolean; ficheros: FicheroDiagnostico[] };
      mqm: { directorioExiste: boolean; ficheros: FicheroDiagnostico[] };
    }
  | {
      ok: false;
      etapa: typeof ETAPA_DIAGNOSTICOS;
      error: { code: string; message: string };
    };

// Lista únicamente nombres y tamaños de los archivos de un directorio. No lee
// ni devuelve contenido, rutas absolutas ni variables de entorno.
export async function listarDirectorio(
  dir: string
): Promise<{ directorioExiste: boolean; ficheros: FicheroDiagnostico[] }> {
  try {
    const entradas = await readdir(dir, { withFileTypes: true });
    const ficheros: FicheroDiagnostico[] = [];
    for (const entrada of entradas) {
      if (!entrada.isFile()) continue;
      try {
        const info = await stat(join(dir, entrada.name));
        ficheros.push({ nombre: entrada.name, tamano: info.size });
      } catch {
        // Se omite si no se puede leer el metadato.
      }
    }
    ficheros.sort((a, b) => a.nombre.localeCompare(b.nombre));
    return { directorioExiste: true, ficheros };
  } catch {
    return { directorioExiste: false, ficheros: [] };
  }
}

// El cliente nativo de IBM MQ escribe FFST (*.FDC) y AMQERR*.LOG en
// MQ_OVERRIDE_DATA_PATH/errors, y usa HOME/.mqm para sus socket files. Tras un
// fallo nativo, sus nombres codifican el "probe id" que identifica el componente.
export async function ejecutarDiagnosticoArtefactos(): Promise<DiagnosticoArtefactos> {
  try {
    await prepararDirectorios();
  } catch {
    return {
      ok: false,
      etapa: ETAPA_DIAGNOSTICOS,
      error: { code: "ENVIRONMENT", message: "No se pudo preparar HOME o MQ_OVERRIDE_DATA_PATH." }
    };
  }

  const data = process.env.MQ_OVERRIDE_DATA_PATH ?? "";
  const home = process.env.HOME ?? "";

  const errores = await listarDirectorio(join(data, "errors"));
  const mqm = await listarDirectorio(join(home, ".mqm"));

  return { ok: true, etapa: ETAPA_DIAGNOSTICOS, errores, mqm };
}

// ---- MQCONNX/MQDISC en proceso hijo (el padre sobrevive a un SIGSEGV) ----

// Código fijo que se ejecuta en el hijo con `node -e`. Solo MQCONNX + MQDISC.
// No acepta entrada del usuario; por tanto no permite ejecutar comandos arbitrarios.
const CODIGO_HIJO = `
(function () {
  function limiteCore() {
    try {
      var t = require("fs").readFileSync("/proc/self/limits", "utf8");
      var idx = t.indexOf("Max core file size");
      if (idx === -1) { return -1; }
      var rest = t.substring(idx + "Max core file size".length).trim();
      var soft = rest.split(/ +/)[0];
      if (soft === "unlimited") { return -1; }
      var n = Number(soft);
      return isFinite(n) ? n : -1;
    } catch (e) { return -1; }
  }

  var core = limiteCore();
  console.log("CHILD_CORE_LIMIT " + core);

  var dry = process.env.MQ_POC_CHILD_DRY_RUN === "1";
  var mq = require("ibmmq");
  if (dry) { console.log("CHILD_DRY_RUN_OK"); return; }

  if (core !== 0) { console.log("CHILD_CORE_BLOCKED"); return; }

  function req(n) { var v = process.env[n]; if (!v) { throw new Error("missing " + n); } return v; }

  var cno = new mq.MQCNO();
  cno.Options = mq.MQC.MQCNO_CLIENT_BINDING | mq.MQC.MQCNO_RECONNECT_DISABLED;
  var cd = new mq.MQCD();
  cd.ChannelName = req("MQ_CHANNEL");
  cd.ConnectionName = req("MQ_CONNECTION_NAME");
  cd.SSLCipherSpec = req("MQ_TLS_CIPHER_SPEC");
  cd.SSLPeerName = req("MQ_TLS_PEER_NAME");
  cno.ClientConn = cd;
  var sco = new mq.MQSCO();
  sco.KeyRepository = req("MQ_TLS_KEY_REPOSITORY");
  if (process.env.MQ_TLS_KEY_REPOSITORY_PASSWORD) { sco.KeyRepoPassword = process.env.MQ_TLS_KEY_REPOSITORY_PASSWORD; }
  if (process.env.MQ_TLS_CERTIFICATE_LABEL) { sco.CertificateLabel = process.env.MQ_TLS_CERTIFICATE_LABEL; }
  cno.SSLConfig = sco;
  var csp = new mq.MQCSP();
  csp.UserId = req("MQ_USERNAME");
  csp.Password = req("MQ_PASSWORD");
  cno.SecurityParms = csp;

  mq.ConnxPromise(req("MQ_QUEUE_MANAGER"), cno).then(function (conn) {
    console.log("CHILD_CONNX_OK");
    return mq.DiscPromise(conn).then(function () { console.log("CHILD_DISC_OK"); });
  }).catch(function (e) {
    console.log("CHILD_CONNX_REJECTED " + JSON.stringify({ mqrc: e && e.mqrc, mqcc: e && e.mqcc }));
  });
})();
`;

export type ResultadoHijo =
  | {
      resultado: "OK" | "RECHAZADO" | "DRY_RUN" | "CORE_BLOQUEADO";
      codigoSalida: number | null;
      senal: null;
      mqrc?: number;
      mqcc?: number;
    }
  | { resultado: "SENAL" | "TIMEOUT" | "ERROR"; codigoSalida: number | null; senal: string | null };

export type ResultadoChildConnx = {
  ok: true;
  etapa: typeof ETAPA_CHILD_CONNX;
  hijo: ResultadoHijo;
  coreDumpsDeshabilitados: boolean;
  errores: { directorioExiste: boolean; ficheros: FicheroDiagnostico[] };
  mqm: { directorioExiste: boolean; total: number };
  probeIds: string[];
};

type SalidaHijo = {
  codigoSalida: number | null;
  senal: string | null;
  tiempoAgotado: boolean;
  stdout: string;
};

function ejecutarHijoMq(env: NodeJS.ProcessEnv, timeoutMs: number): Promise<SalidaHijo> {
  return new Promise((resolve) => {
    let stdout = "";
    let child: ReturnType<typeof spawn>;

    try {
      // Wrapper fijo: establece RLIMIT_CORE=0 y reemplaza el shell por node. El
      // script de shell y los argumentos son fijos (no hay interpolación de
      // entrada del usuario).
      child = spawn(
        "/bin/sh",
        ["-c", 'ulimit -c 0; exec "$0" "$@"', process.execPath, "-e", CODIGO_HIJO],
        { env, cwd: process.cwd() }
      );
    } catch {
      resolve({ codigoSalida: null, senal: null, tiempoAgotado: false, stdout: "" });
      return;
    }

    child.stdout?.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr?.on("data", () => {
      // Se ignora para no devolver contenido sensible.
    });

    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // El proceso pudo terminar antes.
      }
      resolve({ codigoSalida: null, senal: null, tiempoAgotado: true, stdout });
    }, timeoutMs);

    child.on("error", () => {
      clearTimeout(timer);
      resolve({ codigoSalida: null, senal: null, tiempoAgotado: false, stdout });
    });

    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ codigoSalida: code, senal: signal, tiempoAgotado: false, stdout });
    });
  });
}

function interpretarHijo(salida: SalidaHijo, dryRun: boolean): ResultadoHijo {
  if (salida.tiempoAgotado) {
    return { resultado: "TIMEOUT", codigoSalida: null, senal: null };
  }
  if (salida.senal) {
    return { resultado: "SENAL", codigoSalida: null, senal: salida.senal };
  }
  if (dryRun && salida.stdout.includes("CHILD_DRY_RUN_OK")) {
    return { resultado: "DRY_RUN", codigoSalida: 0, senal: null };
  }
  if (salida.stdout.includes("CHILD_CORE_BLOCKED")) {
    return { resultado: "CORE_BLOQUEADO", codigoSalida: 0, senal: null };
  }
  if (salida.stdout.includes("CHILD_CONNX_OK")) {
    return { resultado: "OK", codigoSalida: 0, senal: null };
  }
  const rechazo = /CHILD_CONNX_REJECTED\s+(\{.*\})/.exec(salida.stdout);
  if (rechazo) {
    let mqrc: number | undefined;
    let mqcc: number | undefined;
    try {
      const datos = JSON.parse(rechazo[1]) as { mqrc?: unknown; mqcc?: unknown };
      if (typeof datos.mqrc === "number") mqrc = datos.mqrc;
      if (typeof datos.mqcc === "number") mqcc = datos.mqcc;
    } catch {
      // Sin códigos recuperables.
    }
    return { resultado: "RECHAZADO", codigoSalida: salida.codigoSalida, senal: null, mqrc, mqcc };
  }
  return { resultado: "ERROR", codigoSalida: salida.codigoSalida, senal: null };
}

// Extrae el límite "Max core file size" reportado por el hijo. Devuelve null si
// no pudo determinarse.
function extraerCoreSoft(stdout: string): number | null {
  const coincidencia = /CHILD_CORE_LIMIT\s+(-?\d+)/.exec(stdout);
  if (!coincidencia) return null;
  const valor = Number(coincidencia[1]);
  return Number.isFinite(valor) ? valor : null;
}

// Extrae únicamente el "Probe Id" de un FDC usando un patrón permitido y
// validando que el token no contenga información sensible.
export async function extraerProbeId(ruta: string): Promise<string | null> {
  let contenido: string;
  try {
    contenido = await readFile(ruta, "utf8");
  } catch {
    return null;
  }

  const coincidencia = /Probe\s+Id\s*:?\s*-?\s*(\S+)/i.exec(contenido);
  if (!coincidencia) return null;
  const token = coincidencia[1].toUpperCase();
  return /^[A-Z0-9]{4,12}$/.test(token) ? token : null;
}

async function extraerProbeIds(dirErrores: string): Promise<string[]> {
  const { ficheros } = await listarDirectorio(dirErrores);
  const ids: string[] = [];
  for (const fichero of ficheros) {
    if (!/\.FDC$/i.test(fichero.nombre)) continue;
    const id = await extraerProbeId(join(dirErrores, fichero.nombre));
    if (id) ids.push(id);
  }
  return ids;
}

export async function ejecutarChildConnx(dryRun = false): Promise<ResultadoChildConnx | { ok: false; etapa: typeof ETAPA_CHILD_CONNX; error: { code: string; message: string } }> {
  let home: string;
  let data: string;
  let stem: string | undefined;

  try {
    const directorios = await prepararDirectoriosSinEnv();
    home = directorios.home;
    data = directorios.data;
    if (!dryRun) {
      stem = await materializarKeystore();
    }
  } catch (error) {
    return {
      ok: false,
      etapa: ETAPA_CHILD_CONNX,
      error: { code: "ENVIRONMENT", message: mensajeEntorno(error) }
    };
  }

  // El hijo recibe su propio entorno (HOME/MQ_OVERRIDE_DATA_PATH/keystore) sin
  // modificar el entorno del proceso padre.
  const envHijo: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    MQ_OVERRIDE_DATA_PATH: data,
    MQ_POC_CHILD_DRY_RUN: dryRun ? "1" : "0"
  };
  if (!dryRun && stem) {
    envHijo.MQ_TLS_KEY_REPOSITORY = stem;
  }

  const salida = await ejecutarHijoMq(envHijo, 20_000);
  const hijo = interpretarHijo(salida, dryRun);
  const coreSoft = extraerCoreSoft(salida.stdout);

  const errores = await listarDirectorio(join(data, "errors"));
  const mqmL = await listarDirectorio(join(home, ".mqm"));
  const probeIds = await extraerProbeIds(join(data, "errors"));

  return {
    ok: true,
    etapa: ETAPA_CHILD_CONNX,
    hijo,
    coreDumpsDeshabilitados: coreSoft === 0,
    errores,
    mqm: { directorioExiste: mqmL.directorioExiste, total: mqmL.ficheros.length },
    probeIds
  };
}
