// ===========================================================================
// Hogar de Oro · Presupuesto y Materiales
// Página estática que consulta Supabase directamente desde el navegador.
// Tablas: materiales, movimientos, solicitudes_materiales (ver tablas.sql).
// ===========================================================================

// ----- Rubros del presupuesto que no son materiales -----
const RUBROS_OTROS = ["Mano de obra", "Fletes", "Botar basura", "Imprevistos", "Otro gasto"];
const PORC_IMPREVISTOS = 0.05;
const PORC_UTILIDAD = 0.20;
const MONTO_FLETES = 100000;
const MONTO_BASURA = 150000;

// ----- Listas sugeridas (se completan con lo que el equipo vaya escribiendo) -----
const AREAS_BASE = ["Patrocinios"];

const RESPONSABLES = [
  "Andrey Enrique Arce Gutiérrez", "Zyan Levi Bolaños Arias", "Naomy Castro Mairena",
  "Loanna Castro Morales", "Marco Rodrigo Corrales Barrantes", "Gabriel Del Campo Gutiérrez",
  "Karim Figueroa Zúñiga", "Zhaid Gómez Alcázar", "Karina Gómez Sánchez", "Elisa Gutiérrez Feoli",
  "Ariela Lucía Hernández Araya", "Melany Hernández Solís", "Israel Larios Zamora",
  "Juan Pablo Mora Brenes", "Jixia Nova Rodríguez", "Oscar Palma Castellón", "Elián Porras Zúñiga",
  "María José Rodríguez Chanto", "María José Varela Montoya", "Luis Alejandro Varela Viloria",
  "Felipe de Jesús Sánchez Montero",
];

const ESTADOS_SOLICITUD = ["Enviada", "Donó todo", "Donó una parte", "Negada"];
const ESTADO_ABIERTA = "Enviada";

const LOGO = "logo.png?v=1";
const REFRESCO_MS = 30000;

// ===================== Conexión con Supabase =====================
const BASE = `${window.CONFIG.SUPABASE_URL}/rest/v1`;
const T_MATERIALES = `${BASE}/materiales`;
const T_MOVIMIENTOS = `${BASE}/movimientos`;
const T_SOLICITUDES = `${BASE}/solicitudes_materiales`;
const AUTH = `${window.CONFIG.SUPABASE_URL}/auth/v1`;
const LLAVE_SESION = "presupuesto_sesion";

let sesion = null;

function guardarSesion(datos) {
  sesion = {
    access_token: datos.access_token,
    refresh_token: datos.refresh_token,
    expires_at: Date.now() + (datos.expires_in || 3600) * 1000,
  };
  try { localStorage.setItem(LLAVE_SESION, JSON.stringify(sesion)); } catch (e) {}
}
function leerSesion() {
  try {
    const guardado = localStorage.getItem(LLAVE_SESION);
    if (guardado) sesion = JSON.parse(guardado);
  } catch (e) { sesion = null; }
  return sesion;
}
function borrarSesion() {
  sesion = null;
  try { localStorage.removeItem(LLAVE_SESION); } catch (e) {}
}

async function iniciarSesion(correo, clave) {
  const res = await fetch(`${AUTH}/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: window.CONFIG.SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email: correo, password: clave }),
  });
  const datos = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(datos.error_description || datos.msg || "Correo o contraseña incorrectos.");
  guardarSesion(datos);
}

async function renovarSesion() {
  if (!sesion || !sesion.refresh_token) return false;
  const res = await fetch(`${AUTH}/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { apikey: window.CONFIG.SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: sesion.refresh_token }),
  });
  if (!res.ok) return false;
  guardarSesion(await res.json());
  return true;
}

function cabeceras(extra = {}) {
  return {
    apikey: window.CONFIG.SUPABASE_ANON_KEY,
    Authorization: `Bearer ${sesion ? sesion.access_token : window.CONFIG.SUPABASE_ANON_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function pedir(url, opciones = {}, reintento = true) {
  if (sesion && sesion.expires_at && Date.now() > sesion.expires_at - 60000) await renovarSesion();
  const opts = { ...opciones, headers: { ...cabeceras(), ...(opciones.headers || {}) } };
  const res = await fetch(url, opts);

  if ((res.status === 401 || res.status === 403) && reintento) {
    if (await renovarSesion()) return pedir(url, opciones, false);
    borrarSesion();
    mostrarLogin("Su sesión expiró. Vuelva a ingresar.");
    throw new Error("Sesión expirada.");
  }
  if (!res.ok) {
    let detalle = "";
    try { const d = await res.json(); detalle = d.message || d.hint || JSON.stringify(d); }
    catch (e) { detalle = `Error ${res.status}`; }
    if (/relation .* does not exist|Could not find the table/i.test(detalle)) {
      detalle = "Faltan las tablas del presupuesto en la base de datos. Hay que correr tablas.sql en Supabase.";
    }
    throw new Error(detalle);
  }
  if (res.status === 204) return null;
  const texto = await res.text();
  return texto ? JSON.parse(texto) : null;
}

const enviar = (url, metodo, cuerpo) => pedir(url, {
  method: metodo,
  headers: { Prefer: "return=representation" },
  body: JSON.stringify(cuerpo),
});

// ===================== Estado =====================
let materiales = [];
let movimientos = [];
let solicitudes = [];
let calculo = new Map();          // id material → { cantidad, donado, comprado, cantDon, cantCom }
let abiertas = new Map();         // id material → [nombres de empresas con solicitud abierta]

let pestanaActual = "materiales";
let capituloActual = "";
let marcados = new Set();
let porBorrar = null;              // { tabla, id, texto }

const $ = (id) => document.getElementById(id);

// ===================== Utilidades =====================
function escapar(t) {
  return String(t ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
const num = (n) => { const x = Number(n); return isNaN(x) ? 0 : x; };
function colones(n) {
  return "₡" + Math.round(num(n)).toLocaleString("es-CR");
}
function cantidad(n) {
  return num(n).toLocaleString("es-CR", { maximumFractionDigits: 2 });
}
function porcentaje(a, b) {
  if (!b) return a > 0 ? 100 : 0;
  return Math.max(0, Math.min(100, (a / b) * 100));
}
function hoyISO() {
  const f = new Date();
  return `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, "0")}-${String(f.getDate()).padStart(2, "0")}`;
}
function fechaCorta(iso) {
  if (!iso) return "";
  const [a, m, d] = String(iso).slice(0, 10).split("-");
  return d ? `${d}/${m}/${a}` : iso;
}
function fechaLarga() {
  const meses = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
                 "agosto", "setiembre", "octubre", "noviembre", "diciembre"];
  const f = new Date();
  return `${f.getDate()} de ${meses[f.getMonth()]} de ${f.getFullYear()}`;
}
function sinTildes(t) {
  return String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}
function nombreArea(area) {
  return String(area || "").replace(/^\s*[aá]rea\s+de\s+/i, "").trim();
}

function avisar(texto, esError = false) {
  const caja = $("aviso");
  caja.textContent = texto;
  caja.className = "aviso" + (esError ? " error" : "");
  clearTimeout(avisar.t);
  avisar.t = setTimeout(() => caja.classList.add("oculto"), esError ? 6000 : 4000);
}

function abrirModal(id) { $(id).classList.remove("oculto"); }
function cerrarModal(id) { $(id).classList.add("oculto"); }
document.querySelectorAll(".modal-fondo").forEach((fondo) => {
  fondo.addEventListener("mousedown", (e) => { if (e.target === fondo) fondo.classList.add("oculto"); });
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") document.querySelectorAll(".modal-fondo:not(.oculto)").forEach((m) => m.classList.add("oculto"));
});

function guardarMarcas() {
  try { localStorage.setItem("presupuesto_marcados", JSON.stringify([...marcados])); } catch (e) {}
}
function leerMarcas() {
  try { marcados = new Set(JSON.parse(localStorage.getItem("presupuesto_marcados") || "[]")); } catch (e) { marcados = new Set(); }
}

// ===================== Ingreso =====================
function mostrarLogin(mensaje = "") {
  $("aplicacion").classList.add("oculto");
  $("pantalla-login").classList.remove("oculto");
  $("login-error").textContent = mensaje;
  $("login-error").classList.toggle("oculto", !mensaje);
}
function mostrarAplicacion() {
  $("pantalla-login").classList.add("oculto");
  $("aplicacion").classList.remove("oculto");
}

$("form-login").addEventListener("submit", async (e) => {
  e.preventDefault();
  const boton = $("btn-entrar");
  boton.disabled = true;
  boton.textContent = "Entrando...";
  try {
    await iniciarSesion($("login-correo").value.trim(), $("login-clave").value);
    mostrarAplicacion();
    cargar();
  } catch (err) {
    $("login-error").textContent = err.message;
    $("login-error").classList.remove("oculto");
  } finally {
    boton.disabled = false;
    boton.textContent = "Entrar";
  }
});

$("btn-salir").onclick = () => { borrarSesion(); mostrarLogin(); };

// ===================== Cargar datos =====================
async function cargar(silencioso = false) {
  try {
    const [m, mv, s] = await Promise.all([
      pedir(`${T_MATERIALES}?select=*&order=orden.asc,id.asc`),
      pedir(`${T_MOVIMIENTOS}?select=*&order=fecha.desc,id.desc`),
      pedir(`${T_SOLICITUDES}?select=*&order=id.desc`),
    ]);
    materiales = m || [];
    movimientos = mv || [];
    solicitudes = s || [];
    $("aviso-conexion").classList.add("oculto");
    calcular();
    dibujarTodo();
  } catch (e) {
    if (!silencioso) {
      $("aviso-conexion").textContent = e.message;
      $("aviso-conexion").classList.remove("oculto");
    }
  }
}

function calcular() {
  calculo = new Map();
  materiales.forEach((m) => calculo.set(m.id, { cantDon: 0, cantCom: 0, donado: 0, comprado: 0 }));
  movimientos.forEach((mv) => {
    const c = mv.material_id != null ? calculo.get(mv.material_id) : null;
    if (!c) return;
    if (mv.tipo === "Compra") { c.cantCom += num(mv.cantidad); c.comprado += num(mv.valor); }
    else { c.cantDon += num(mv.cantidad); c.donado += num(mv.valor); }
  });
  calculo.forEach((c) => { c.cantidad = c.cantDon + c.cantCom; });

  abiertas = new Map();
  solicitudes.filter((s) => s.estado === ESTADO_ABIERTA).forEach((s) => {
    (s.materiales || []).forEach((it) => {
      if (!abiertas.has(it.id)) abiertas.set(it.id, []);
      const lista = abiertas.get(it.id);
      if (!lista.includes(s.empresa)) lista.push(s.empresa);
    });
  });
}

const esMaterial = (m) => (m.tipo || "Material") === "Material";
const costoMaterial = (m) => num(m.cantidad) * num(m.precio_unitario);
const faltante = (m) => Math.max(0, num(m.cantidad) - (calculo.get(m.id)?.cantidad || 0));
const completo = (m) => num(m.cantidad) > 0 && faltante(m) <= 1e-9;
const materialPorId = (id) => materiales.find((m) => String(m.id) === String(id));
function capitulos() {
  return [...new Set(materiales.filter(esMaterial).map((m) => m.capitulo))];
}

// ===================== Presupuesto =====================
function filasPresupuesto() {
  const sumaMov = (filtro) => {
    let donado = 0, comprado = 0;
    movimientos.filter(filtro).forEach((mv) => {
      if (mv.tipo === "Compra") comprado += num(mv.valor); else donado += num(mv.valor);
    });
    return { donado, comprado };
  };
  const fila = (rubro, presupuestado, mov, clase = "") => ({
    rubro, presupuestado, ...mov, clase,
    pendiente: Math.max(0, presupuestado - mov.donado - mov.comprado),
  });

  const directos = [];
  capitulos().forEach((cap) => {
    const ids = new Set(materiales.filter((m) => esMaterial(m) && m.capitulo === cap).map((m) => m.id));
    const presup = materiales.filter((m) => ids.has(m.id)).reduce((a, m) => a + costoMaterial(m), 0);
    directos.push(fila(`Materiales · ${cap}`, presup, sumaMov((mv) => ids.has(mv.material_id))));
  });
  const idsMO = new Set(materiales.filter((m) => !esMaterial(m)).map((m) => m.id));
  const presupMO = materiales.reduce((a, m) => a + num(m.costo_mano_obra), 0);
  directos.push(fila("Mano de obra", presupMO,
    sumaMov((mv) => mv.rubro === "Mano de obra" || idsMO.has(mv.material_id))));

  const totalDirectos = directos.reduce((a, f) => a + f.presupuestado, 0);
  const indirectos = [
    fila("Imprevistos (5 %)", totalDirectos * PORC_IMPREVISTOS, sumaMov((mv) => mv.rubro === "Imprevistos")),
    fila("Utilidad (20 %)", totalDirectos * PORC_UTILIDAD, { donado: 0, comprado: 0 }),
    fila("Fletes", MONTO_FLETES, sumaMov((mv) => mv.rubro === "Fletes")),
    fila("Botar basura", MONTO_BASURA, sumaMov((mv) => mv.rubro === "Botar basura")),
  ];
  const otros = sumaMov((mv) => mv.rubro === "Otro gasto" || (mv.material_id == null && !mv.rubro));
  if (otros.donado || otros.comprado) indirectos.push(fila("Otros gastos", 0, otros));

  const subtotal = (nombre, filas, clase) => filas.reduce((t, f) => ({
    ...t,
    presupuestado: t.presupuestado + f.presupuestado,
    donado: t.donado + f.donado,
    comprado: t.comprado + f.comprado,
    pendiente: t.pendiente + f.pendiente,
  }), { rubro: nombre, presupuestado: 0, donado: 0, comprado: 0, pendiente: 0, clase });

  const sd = subtotal("Total costos directos", directos, "fila-sub");
  const si = subtotal("Total costos indirectos", indirectos, "fila-sub");
  const total = subtotal("Gran total", [sd, si], "fila-total");
  return { directos, indirectos, sd, si, total };
}

// ===================== Dibujar =====================
function dibujarTodo() {
  dibujarResumen();
  dibujarChips();
  dibujarMateriales();
  dibujarPresupuesto();
  dibujarIngresos();
  dibujarSolicitudes();
  llenarListas();
  // No se redibuja la lista de la carta mientras alguien escribe una cantidad.
  if (!$("modal-carta").classList.contains("oculto") && !$("c-lista").contains(document.activeElement)) dibujarListaCarta();
}

function dibujarResumen() {
  const p = filasPresupuesto();
  $("r-presupuesto").textContent = colones(p.total.presupuestado);
  $("r-donado").textContent = colones(movimientos.filter((m) => m.tipo !== "Compra").reduce((a, m) => a + num(m.valor), 0));
  $("r-comprado").textContent = colones(movimientos.filter((m) => m.tipo === "Compra").reduce((a, m) => a + num(m.valor), 0));
  $("r-pendiente").textContent = colones(p.total.pendiente);
  $("r-pendiente-txt").textContent =
    `Falta por cubrir · ${Math.round(porcentaje(p.total.presupuestado - p.total.pendiente, p.total.presupuestado))} % cubierto`;

  const mats = materiales.filter(esMaterial);
  const presupMat = mats.reduce((a, m) => a + costoMaterial(m), 0);
  const cubiertoMat = mats.reduce((a, m) => a + Math.min(num(m.cantidad), calculo.get(m.id)?.cantidad || 0) * num(m.precio_unitario), 0);
  const pct = porcentaje(cubiertoMat, presupMat);
  $("av-titulo").textContent = `Materiales cubiertos: ${Math.round(pct)} %`;
  $("av-detalle").textContent =
    `${mats.filter(completo).length} de ${mats.length} materiales completos · ${colones(cubiertoMat)} de ${colones(presupMat)}`;
  $("av-barra").style.width = pct + "%";
  $("av-barra").parentElement.classList.toggle("lleno", pct >= 100);

  $("n-materiales").textContent = mats.length;
  $("n-ingresos").textContent = movimientos.length;
  $("n-solicitudes").textContent = solicitudes.filter((s) => s.estado === ESTADO_ABIERTA).length;
}

function dibujarChips() {
  const caps = capitulos();
  if (capituloActual && !caps.includes(capituloActual)) capituloActual = "";
  $("chips-capitulo").innerHTML = ["", ...caps].map((c) =>
    `<button class="chip${c === capituloActual ? " activa" : ""}" data-cap="${escapar(c)}">${c ? escapar(c) : "Todos los capítulos"}</button>`
  ).join("");
}
$("chips-capitulo").addEventListener("click", (e) => {
  const b = e.target.closest("[data-cap]");
  if (!b) return;
  capituloActual = b.dataset.cap;
  dibujarChips();
  dibujarMateriales();
});

function materialesVisibles() {
  const texto = sinTildes($("f-buscar").value.trim());
  const estado = $("f-estado").value;
  return materiales.filter(esMaterial).filter((m) => {
    if (capituloActual && m.capitulo !== capituloActual) return false;
    if (estado === "falta" && completo(m)) return false;
    if (estado === "completo" && !completo(m)) return false;
    if (estado === "solicitud" && !abiertas.has(m.id)) return false;
    if (texto && !sinTildes(`${m.codigo} ${m.descripcion} ${m.unidad}`).includes(texto)) return false;
    return true;
  });
}

function etiquetaAvance(m) {
  const c = calculo.get(m.id)?.cantidad || 0;
  if (completo(m)) return `<span class="etiqueta-estado e-completo">Completo</span>`;
  if (c > 0) return `<span class="etiqueta-estado e-parcial">Parcial</span>`;
  return `<span class="etiqueta-estado e-falta">Falta</span>`;
}

function dibujarMateriales() {
  const lista = materialesVisibles();
  const cuerpo = $("cuerpo-materiales");
  if (!lista.length) {
    cuerpo.innerHTML = `<tr><td colspan="12" class="vacio">${materiales.length ? "No hay materiales con ese filtro." : "Cargando materiales..."}</td></tr>`;
    actualizarBarraMarcados();
    return;
  }
  let html = "", capAnterior = null;
  lista.forEach((m) => {
    if (m.capitulo !== capAnterior) {
      capAnterior = m.capitulo;
      html += `<tr class="fila-capitulo"><td colspan="12">${escapar(m.capitulo)}</td></tr>`;
    }
    const c = calculo.get(m.id) || { cantidad: 0, cantDon: 0, cantCom: 0 };
    const falta = faltante(m);
    const pct = porcentaje(c.cantidad, num(m.cantidad));
    const detalle = [c.cantDon ? `${cantidad(c.cantDon)} donado` : "", c.cantCom ? `${cantidad(c.cantCom)} comprado` : ""]
      .filter(Boolean).join(" · ");
    const pedidas = abiertas.get(m.id) || [];
    html += `<tr class="${marcados.has(m.id) ? "marcada" : ""}">
      <td class="col-check"><input type="checkbox" data-marcar="${m.id}" ${marcados.has(m.id) ? "checked" : ""} aria-label="Marcar para la carta"></td>
      <td class="codigo">${escapar(m.codigo)}</td>
      <td class="desc">${escapar(m.descripcion)} ${etiquetaAvance(m)}</td>
      <td>${escapar(m.unidad)}</td>
      <td class="num">${cantidad(m.cantidad)}</td>
      <td class="num">${cantidad(c.cantidad)}${detalle ? `<span class="detalle-mov">${detalle}</span>` : ""}</td>
      <td class="num ${falta > 0 ? "faltan" : "listo"}">${falta > 0 ? cantidad(falta) : "—"}</td>
      <td><div class="barra-celda"><div class="barra${pct >= 100 ? " lleno" : ""}"><span style="width:${pct}%"></span></div><small>${Math.round(pct)}%</small></div></td>
      <td class="num">${colones(m.precio_unitario)}</td>
      <td class="num">${colones(costoMaterial(m))}</td>
      <td class="solicitado">${pedidas.map(escapar).join("<br>") || ""}</td>
      <td><div class="acciones-fila">
        <button class="btn-principal mini" data-registrar="${m.id}">Registrar</button>
        <button class="btn-texto mini" data-editar-material="${m.id}">Editar</button>
      </div></td>
    </tr>`;
  });
  cuerpo.innerHTML = html;
  actualizarBarraMarcados();
}

["f-buscar", "f-estado"].forEach((id) => $(id).addEventListener("input", dibujarMateriales));

$("cuerpo-materiales").addEventListener("click", (e) => {
  const reg = e.target.dataset.registrar;
  const ed = e.target.dataset.editarMaterial;
  if (reg) abrirIngreso({ material_id: Number(reg) });
  if (ed) abrirMaterial(materialPorId(ed));
});
$("cuerpo-materiales").addEventListener("change", (e) => {
  const id = e.target.dataset.marcar;
  if (!id) return;
  const n = Number(id);
  if (e.target.checked) marcados.add(n); else marcados.delete(n);
  guardarMarcas();
  e.target.closest("tr").classList.toggle("marcada", e.target.checked);
  actualizarBarraMarcados();
});

$("marcar-todos").addEventListener("change", (e) => {
  const lista = materialesVisibles();
  if (e.target.checked) lista.filter((m) => !completo(m)).forEach((m) => marcados.add(m.id));
  else lista.forEach((m) => marcados.delete(m.id));
  guardarMarcas();
  dibujarMateriales();
});

function actualizarBarraMarcados() {
  const ids = [...marcados].filter((id) => materialPorId(id));
  $("barra-marcados").classList.toggle("oculto", ids.length === 0);
  $("txt-marcados").textContent = ids.length === 1 ? "1 material marcado" : `${ids.length} materiales marcados`;
  const visibles = materialesVisibles().filter((m) => !completo(m));
  $("marcar-todos").checked = visibles.length > 0 && visibles.every((m) => marcados.has(m.id));
}
$("btn-quitar-marcas").onclick = () => { marcados.clear(); guardarMarcas(); dibujarMateriales(); };
$("btn-carta-marcados").onclick = () => abrirCarta({ desdeMarcados: true });

function dibujarPresupuesto() {
  const p = filasPresupuesto();
  const fila = (f) => {
    const cubierto = f.donado + f.comprado;
    const pct = porcentaje(cubierto, f.presupuestado);
    return `<tr class="${f.clase || ""}">
      <td>${escapar(f.rubro)}</td>
      <td class="num">${colones(f.presupuestado)}</td>
      <td class="num">${f.donado ? colones(f.donado) : "—"}</td>
      <td class="num">${f.comprado ? colones(f.comprado) : "—"}</td>
      <td class="num">${f.pendiente ? colones(f.pendiente) : "—"}</td>
      <td><div class="barra-celda"><div class="barra${pct >= 100 ? " lleno" : ""}"><span style="width:${pct}%"></span></div><small>${Math.round(pct)}%</small></div></td>
    </tr>`;
  };
  $("cuerpo-presupuesto").innerHTML =
    `<tr class="fila-capitulo"><td colspan="6">Costos directos</td></tr>` +
    p.directos.map(fila).join("") + fila(p.sd) +
    `<tr class="fila-capitulo"><td colspan="6">Costos indirectos</td></tr>` +
    p.indirectos.map(fila).join("") + fila(p.si) + fila(p.total);
}

function nombreMovimiento(mv) {
  if (mv.material_id != null) {
    const m = materialPorId(mv.material_id);
    return m ? `${m.codigo ? m.codigo + " " : ""}${m.descripcion}` : "Material borrado";
  }
  return mv.rubro || "Otro gasto";
}

function dibujarIngresos() {
  const texto = sinTildes($("i-buscar").value.trim());
  const tipo = $("i-tipo").value;
  const area = $("i-area").value;
  const lista = movimientos.filter((mv) => {
    if (tipo && mv.tipo !== tipo) return false;
    if (area && nombreArea(mv.area) !== area) return false;
    if (texto && !sinTildes([nombreMovimiento(mv), mv.origen, mv.responsable, mv.area, mv.observaciones].join(" ")).includes(texto)) return false;
    return true;
  });
  $("cuerpo-ingresos").innerHTML = lista.length ? lista.map((mv) => {
    const m = mv.material_id != null ? materialPorId(mv.material_id) : null;
    return `<tr>
      <td class="codigo">${fechaCorta(mv.fecha)}</td>
      <td><span class="etiqueta-estado ${mv.tipo === "Compra" ? "e-compra" : "e-donacion"}">${escapar(mv.tipo)}</span></td>
      <td class="desc">${escapar(nombreMovimiento(mv))}</td>
      <td class="num">${m ? `${cantidad(mv.cantidad)} ${escapar(m.unidad || "")}` : "—"}</td>
      <td class="num">${colones(mv.valor)}</td>
      <td>${escapar(mv.origen)}</td>
      <td>${escapar(nombreArea(mv.area))}</td>
      <td>${escapar(mv.responsable)}</td>
      <td>${escapar(mv.observaciones)}</td>
      <td><div class="acciones-fila">
        <button class="btn-secundario mini" data-editar-mov="${mv.id}">Editar</button>
        <button class="btn-peligro mini" data-borrar-mov="${mv.id}">Borrar</button>
      </div></td>
    </tr>`;
  }).join("") : `<tr><td colspan="10" class="vacio">${movimientos.length ? "No hay ingresos con ese filtro." : "Todavía no hay donaciones ni compras registradas."}</td></tr>`;
}
["i-buscar", "i-tipo", "i-area"].forEach((id) => $(id).addEventListener("input", dibujarIngresos));

$("cuerpo-ingresos").addEventListener("click", (e) => {
  const ed = e.target.dataset.editarMov;
  const bo = e.target.dataset.borrarMov;
  if (ed) abrirIngreso(movimientos.find((m) => String(m.id) === ed));
  if (bo) {
    const mv = movimientos.find((m) => String(m.id) === bo);
    confirmarBorrado(T_MOVIMIENTOS, bo, `¿Borrar el ingreso de ${nombreMovimiento(mv)} (${mv.origen || "sin origen"})?`);
  }
});

function dibujarSolicitudes() {
  const texto = sinTildes($("s-buscar").value.trim());
  const estado = $("s-estado").value;
  const lista = solicitudes.filter((s) => {
    if (estado && s.estado !== estado) return false;
    if (texto) {
      const mats = (s.materiales || []).map((x) => x.descripcion).join(" ");
      if (!sinTildes([s.empresa, s.contacto, s.area, s.responsable, mats].join(" ")).includes(texto)) return false;
    }
    return true;
  });
  $("cuerpo-solicitudes").innerHTML = lista.length ? lista.map((s) => `<tr>
      <td class="codigo">${fechaCorta(s.creado)}</td>
      <td><strong>${escapar(s.empresa)}</strong>${s.contacto ? `<span class="detalle-mov">${escapar(s.contacto)}</span>` : ""}</td>
      <td><ul class="lista-mats">${(s.materiales || []).map((x) =>
        `<li>${escapar(x.descripcion)}: ${escapar(x.cantidad)} ${escapar(x.unidad)}</li>`).join("")}</ul></td>
      <td>${escapar(nombreArea(s.area))}</td>
      <td>${escapar(s.responsable)}</td>
      <td><select class="select-estado" data-estado-sol="${s.id}">${ESTADOS_SOLICITUD.map((e) =>
        `<option${e === s.estado ? " selected" : ""}>${escapar(e)}</option>`).join("")}</select></td>
      <td><div class="acciones-fila">
        <button class="btn-secundario mini" data-ver-sol="${s.id}">Carta</button>
        <button class="btn-principal mini" data-donar-sol="${s.id}">Registrar donación</button>
        <button class="btn-peligro mini" data-borrar-sol="${s.id}">Borrar</button>
      </div></td>
    </tr>`).join("")
    : `<tr><td colspan="7" class="vacio">${solicitudes.length ? "No hay solicitudes con ese filtro." : "Todavía no se han guardado solicitudes. Se guardan desde Generar carta."}</td></tr>`;
}
["s-buscar", "s-estado"].forEach((id) => $(id).addEventListener("input", dibujarSolicitudes));

$("cuerpo-solicitudes").addEventListener("click", (e) => {
  const d = e.target.dataset;
  const s = solicitudes.find((x) => String(x.id) === (d.verSol || d.donarSol || d.borrarSol));
  if (!s) return;
  if (d.verSol) abrirCarta({ solicitud: s });
  if (d.donarSol) {
    const primero = (s.materiales || []).find((x) => materialPorId(x.id));
    abrirIngreso({
      tipo: "Donación", origen: s.empresa, area: s.area, responsable: s.responsable,
      material_id: primero ? primero.id : null,
      cantidad: primero && (s.materiales || []).length === 1 ? num(primero.cantidad) : "",
      observaciones: `Solicitud del ${fechaCorta(s.creado)}`,
    });
  }
  if (d.borrarSol) confirmarBorrado(T_SOLICITUDES, s.id, `¿Borrar la solicitud a ${s.empresa}?`);
});
$("cuerpo-solicitudes").addEventListener("change", async (e) => {
  const id = e.target.dataset.estadoSol;
  if (!id) return;
  try {
    await enviar(`${T_SOLICITUDES}?id=eq.${id}`, "PATCH", { estado: e.target.value });
    avisar(`Solicitud marcada como “${e.target.value}”.`);
    cargar();
  } catch (err) { avisar(err.message, true); }
});

function llenarListas() {
  const unicos = (arr) => [...new Set(arr.map((x) => String(x || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
  const areas = unicos([...AREAS_BASE, ...movimientos.map((m) => nombreArea(m.area)), ...solicitudes.map((s) => nombreArea(s.area))]);
  const opciones = (lista) => lista.map((x) => `<option value="${escapar(x)}">`).join("");
  $("lista-areas").innerHTML = opciones(areas);
  $("lista-responsables").innerHTML = opciones(unicos([...RESPONSABLES, ...movimientos.map((m) => m.responsable), ...solicitudes.map((s) => s.responsable)]));
  $("lista-origenes").innerHTML = opciones(unicos([...movimientos.map((m) => m.origen), ...solicitudes.map((s) => s.empresa)]));
  $("lista-capitulos").innerHTML = opciones(unicos(materiales.map((m) => m.capitulo)));

  const areaSel = $("i-area").value;
  $("i-area").innerHTML = `<option value="">Todas las áreas</option>` +
    areas.map((a) => `<option${a === areaSel ? " selected" : ""}>${escapar(a)}</option>`).join("");
  const estSel = $("s-estado").value;
  $("s-estado").innerHTML = `<option value="">Todos los estados</option>` +
    ESTADOS_SOLICITUD.map((e) => `<option${e === estSel ? " selected" : ""}>${escapar(e)}</option>`).join("");
}

// ===================== Pestañas =====================
$("pestanas").addEventListener("click", (e) => {
  const b = e.target.closest("[data-pestana]");
  if (!b) return;
  pestanaActual = b.dataset.pestana;
  document.querySelectorAll(".pestana").forEach((p) => p.classList.toggle("activa", p === b));
  ["materiales", "presupuesto", "ingresos", "solicitudes"].forEach((v) =>
    $("vista-" + v).classList.toggle("oculto", v !== pestanaActual));
});

// ===================== Registrar ingreso =====================
let valorTocado = false;

function tipoIngreso() { return document.querySelector('#g-tipo input:checked').value; }

function llenarSelectorMaterial(seleccion) {
  let html = `<option value="">— Seleccione —</option>`;
  capitulos().forEach((cap) => {
    html += `<optgroup label="${escapar(cap)}">` + materiales.filter((m) => esMaterial(m) && m.capitulo === cap).map((m) =>
      `<option value="m:${m.id}">${escapar((m.codigo ? m.codigo + " " : "") + m.descripcion)}</option>`).join("") + `</optgroup>`;
  });
  html += `<optgroup label="Otros rubros">` + RUBROS_OTROS.map((r) => `<option value="r:${escapar(r)}">${escapar(r)}</option>`).join("") + `</optgroup>`;
  $("g-material").innerHTML = html;
  $("g-material").value = seleccion || "";
}

function actualizarFormIngreso() {
  const compra = tipoIngreso() === "Compra";
  const sel = $("g-material").value;
  const m = sel.startsWith("m:") ? materialPorId(sel.slice(2)) : null;
  const editando = $("g-id").value;

  $("campo-cantidad").classList.toggle("oculto", !m);
  $("g-cantidad").required = !!m;
  $("g-unidad").textContent = m ? `(${m.unidad})` : "";

  if (m) {
    const c = calculo.get(m.id) || { cantidad: 0 };
    $("g-ayuda-material").textContent =
      `Requerido ${cantidad(m.cantidad)} ${m.unidad} · conseguido ${cantidad(c.cantidad)} · faltan ${cantidad(faltante(m))} · precio presupuesto ${colones(m.precio_unitario)}`;
  } else {
    $("g-ayuda-material").textContent = sel ? "Gasto o aporte que no es un material del presupuesto." : "";
  }

  $("g-rotulo-valor").innerHTML = compra ? `Monto pagado (₡) <span class="req">*</span>`
    : (m ? "Valor estimado (₡)" : `Valor estimado (₡) <span class="req">*</span>`);
  $("g-valor").required = compra || !m;
  $("g-rotulo-origen").innerHTML = (compra ? "Proveedor" : "Empresa o persona que donó") + ` <span class="req">*</span>`;
  $("g-origen").placeholder = compra ? "Ej. EPA Desamparados" : "Ej. Ferretería El Pochote";

  if (!compra && m && !valorTocado && !editando) {
    const q = num($("g-cantidad").value);
    $("g-valor").value = q ? Math.round(q * num(m.precio_unitario)) : "";
  }
  $("g-ayuda-valor").textContent = !compra && m ? "Se calcula con el precio del presupuesto. Puede cambiarlo." : "";
}

function abrirIngreso(datos = {}) {
  $("form-ingreso").reset();
  valorTocado = false;
  $("g-id").value = datos.id || "";
  $("titulo-ingreso").textContent = datos.id ? "Editar ingreso" : "Registrar ingreso";
  document.querySelector(`#g-tipo input[value="${datos.tipo === "Compra" ? "Compra" : "Donación"}"]`).checked = true;
  llenarSelectorMaterial(datos.material_id != null ? `m:${datos.material_id}` : (datos.rubro ? `r:${datos.rubro}` : ""));
  $("g-cantidad").value = datos.cantidad ?? "";
  $("g-valor").value = datos.id ? (datos.valor ?? "") : "";
  $("g-origen").value = datos.origen || "";
  $("g-area").value = nombreArea(datos.area);
  $("g-responsable").value = datos.responsable || "";
  $("g-fecha").value = datos.fecha || hoyISO();
  $("g-observaciones").value = datos.observaciones || "";
  actualizarFormIngreso();
  abrirModal("modal-ingreso");
  setTimeout(() => ($("g-material").value ? $("g-cantidad") : $("g-material")).focus(), 50);
}

$("btn-ingreso").onclick = () => abrirIngreso();
$("g-cancelar").onclick = () => cerrarModal("modal-ingreso");
$("g-tipo").addEventListener("change", actualizarFormIngreso);
$("g-material").addEventListener("change", () => { valorTocado = false; actualizarFormIngreso(); });
$("g-cantidad").addEventListener("input", actualizarFormIngreso);
$("g-valor").addEventListener("input", () => { valorTocado = true; });

$("form-ingreso").addEventListener("submit", async (e) => {
  e.preventDefault();
  const sel = $("g-material").value;
  const m = sel.startsWith("m:") ? materialPorId(sel.slice(2)) : null;
  const cant = num($("g-cantidad").value);
  if (m && cant <= 0) { avisar("Escriba la cantidad que ingresó.", true); return; }

  const datos = {
    tipo: tipoIngreso(),
    material_id: m ? m.id : null,
    rubro: m ? null : sel.slice(2),
    cantidad: m ? cant : 0,
    valor: num($("g-valor").value),
    origen: $("g-origen").value.trim(),
    area: nombreArea($("g-area").value),
    responsable: $("g-responsable").value.trim(),
    fecha: $("g-fecha").value || hoyISO(),
    observaciones: $("g-observaciones").value.trim(),
  };
  const id = $("g-id").value;
  const boton = $("g-guardar");
  boton.disabled = true;
  boton.textContent = "Guardando...";
  try {
    if (id) await enviar(`${T_MOVIMIENTOS}?id=eq.${id}`, "PATCH", datos);
    else await enviar(T_MOVIMIENTOS, "POST", datos);
    cerrarModal("modal-ingreso");
    avisar(id ? "Ingreso actualizado." : `${datos.tipo} registrada.`);
    await cargar();
  } catch (err) {
    avisar(err.message, true);
  } finally {
    boton.disabled = false;
    boton.textContent = "Guardar";
  }
});

// ===================== Agregar o editar material =====================
function abrirMaterial(m) {
  $("form-material").reset();
  $("m-id").value = m ? m.id : "";
  $("titulo-material").textContent = m ? "Editar material" : "Agregar material";
  $("m-codigo").value = m ? m.codigo || "" : "";
  $("m-capitulo").value = m ? m.capitulo : (capituloActual || "");
  $("m-descripcion").value = m ? m.descripcion : "";
  $("m-unidad").value = m ? m.unidad || "" : "";
  $("m-cantidad").value = m ? num(m.cantidad) : "";
  $("m-precio").value = m ? num(m.precio_unitario) : "";
  $("m-borrar").classList.toggle("oculto", !m);
  abrirModal("modal-material");
}
$("btn-agregar-material").onclick = () => abrirMaterial(null);
$("m-cancelar").onclick = () => cerrarModal("modal-material");
$("m-borrar").onclick = () => {
  const m = materialPorId($("m-id").value);
  if (!m) return;
  cerrarModal("modal-material");
  confirmarBorrado(T_MATERIALES, m.id, `¿Borrar ${m.descripcion} del presupuesto? Los ingresos que ya tenga quedan como “Material borrado”.`);
};
$("form-material").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = $("m-id").value;
  const datos = {
    codigo: $("m-codigo").value.trim(),
    capitulo: $("m-capitulo").value.trim(),
    descripcion: $("m-descripcion").value.trim(),
    unidad: $("m-unidad").value.trim(),
    cantidad: num($("m-cantidad").value),
    precio_unitario: num($("m-precio").value),
  };
  try {
    if (id) await enviar(`${T_MATERIALES}?id=eq.${id}`, "PATCH", datos);
    else await enviar(T_MATERIALES, "POST", { ...datos, tipo: "Material", orden: materiales.length + 1 });
    cerrarModal("modal-material");
    avisar(id ? "Material actualizado." : "Material agregado.");
    await cargar();
  } catch (err) { avisar(err.message, true); }
});

// ===================== Borrar =====================
function confirmarBorrado(tabla, id, texto) {
  porBorrar = { tabla, id };
  $("confirmar-texto").textContent = texto;
  abrirModal("modal-confirmar");
}
$("confirmar-cancelar").onclick = () => { porBorrar = null; cerrarModal("modal-confirmar"); };
$("confirmar-ok").onclick = async () => {
  if (!porBorrar) return;
  try {
    await pedir(`${porBorrar.tabla}?id=eq.${porBorrar.id}`, { method: "DELETE" });
    avisar("Eliminado.");
    await cargar();
  } catch (e) { avisar(e.message, true); }
  porBorrar = null;
  cerrarModal("modal-confirmar");
};

// ===================== Generador de carta =====================
// La carta sigue el modelo "Carta_Donacion_Materiales_Hogar_de_Oro": A4, membrete
// en Georgia, cuerpo en Calibri, tabla de materiales por capítulo y firma de Gerencia.
let cartaSel = new Map();      // id material → { cantidad, unidad, descripcion, grupo }
let solicitudCarta = null;     // solicitud que se está viendo o editando

const FIRMA = { nombre: "Felipe de Jesús Sánchez Montero", puesto: "Gerencia del Proyecto", correo: "felsanchez@estudiantec.cr" };
const ASUNTO = "Solicitud de donación de materiales de construcción";
const SINGULAR = {
  unidades: "unidad", "láminas": "lámina", bolsas: "bolsa", cajas: "caja",
  galones: "galón", "metros lineales": "metro lineal", metros: "metro",
};
const COLOR = { oro: "#A8801F", cafe: "#6B5410", fondoCab: "#FAF6EC", fondoGrupo: "#F3EEDE", lineaFuerte: "#DDD5BC", linea: "#E8E8E8" };

const fechaCarta = () => `Alajuela, ${fechaLarga()}`;
const grupoCarta = (m) => m.grupo_carta || String(m.capitulo || "").replace(/^\s*\d+\.\s*/, "");
const unidadCarta = (m) => m.unidad_carta || m.unidad || "";
const ordenCarta = (m) => (m.orden_carta != null ? Number(m.orden_carta) : 1000 + num(m.orden));

function formatoCant(c) {
  const t = String(c ?? "").trim();
  const n = Number(t.replace(",", "."));
  return t !== "" && !isNaN(n) ? n.toLocaleString("es-CR", { maximumFractionDigits: 2 }) : t;
}
function textoCantidad(cant, unidad) {
  const n = Number(String(cant).replace(",", "."));
  const u = n === 1 ? (SINGULAR[unidad] || unidad) : unidad;
  return `${formatoCant(cant)} ${u}`.trim();
}
function nombreCarta(m, cant) {
  return String(m.nombre_carta || m.descripcion || "").replace("{cantidad}", formatoCant(cant) || "…");
}

// Lo que se pide: la cantidad del presupuesto (sin desperdicio) menos lo ya conseguido.
function cantidadSugerida(m) {
  const conseguido = calculo.get(m.id)?.cantidad || 0;
  const base = num(m.cantidad_base) > 0 ? num(m.cantidad_base) : num(m.cantidad);
  let q = Math.ceil(Math.max(0, base - conseguido) - 1e-9);
  if (q <= 0) q = Math.ceil(faltante(m) - 1e-9);
  if (q <= 0) q = Math.ceil(base - 1e-9);
  return q;
}

function seleccionar(m) {
  cartaSel.set(m.id, { cantidad: String(cantidadSugerida(m)), unidad: unidadCarta(m) });
}

function abrirCarta({ desdeMarcados = false, solicitud = null } = {}) {
  solicitudCarta = solicitud;
  cartaSel = new Map();
  if (solicitud) {
    (solicitud.materiales || []).forEach((x) => cartaSel.set(Number(x.id),
      { cantidad: String(x.cantidad ?? ""), unidad: x.unidad || "", descripcion: x.descripcion, grupo: x.grupo || "" }));
    $("c-empresa").value = solicitud.empresa || "";
    $("c-persona").value = solicitud.contacto || "";
    $("c-area").value = nombreArea(solicitud.area);
    $("c-responsable").value = solicitud.responsable || "";
    $("c-fecha").value = solicitud.fecha || fechaCarta();
  } else {
    const ids = desdeMarcados || marcados.size ? [...marcados] : [];
    ids.map(materialPorId).filter((m) => m && esMaterial(m)).forEach(seleccionar);
    $("c-empresa").value = "";
    $("c-persona").value = "";
    $("c-fecha").value = fechaCarta();
  }
  $("c-ver-completos").checked = false;
  $("c-guardar").textContent = solicitud ? "Guardar cambios de la solicitud" : "Guardar solicitud";
  dibujarListaCarta();
  revisarEmpresa();
  pintarCarta();
  abrirModal("modal-carta");
}
$("btn-carta").onclick = () => abrirCarta();
$("carta-cerrar").onclick = () => cerrarModal("modal-carta");

const materialesCarta = () => materiales.filter(esMaterial).sort((a, b) => ordenCarta(a) - ordenCarta(b));

function dibujarListaCarta() {
  const verTodos = $("c-ver-completos").checked;
  let html = "", grupo = null;
  materialesCarta().filter((m) => verTodos || !completo(m) || cartaSel.has(m.id)).forEach((m) => {
    const g = grupoCarta(m);
    if (g !== grupo) { grupo = g; html += `<div class="grupo">${escapar(g)}</div>`; }
    const s = cartaSel.get(m.id);
    const cant = s ? s.cantidad : String(cantidadSugerida(m));
    const falta = faltante(m);
    const pedido = abiertas.has(m.id) ? ` · ya pedido a ${escapar(abiertas.get(m.id).join(", "))}` : "";
    html += `<div class="item-carta">
      <input type="checkbox" id="ck-${m.id}" data-ck="${m.id}" ${s ? "checked" : ""}>
      <label class="nombre" for="ck-${m.id}"><span class="nombre-txt">${escapar(nombreCarta(m, cant))}</span>
        <small>${falta > 0 ? `Faltan ${cantidad(falta)} ${escapar(m.unidad)}` : "Completo"}${pedido}</small></label>
      <input type="number" min="0" step="any" data-cant="${m.id}" value="${escapar(cant)}" ${s ? "" : "disabled"} aria-label="Cantidad">
      <input type="text" data-unid="${m.id}" value="${escapar(s ? s.unidad : unidadCarta(m))}" ${s ? "" : "disabled"} aria-label="Unidad">
    </div>`;
  });
  // Materiales de una solicitud guardada que ya no están en el presupuesto
  [...cartaSel.entries()].filter(([id]) => !materialPorId(id)).forEach(([id, s]) => {
    html += `<div class="item-carta">
      <input type="checkbox" id="ck-${id}" data-ck="${id}" checked>
      <label class="nombre" for="ck-${id}"><span class="nombre-txt">${escapar(s.descripcion)}</span><small>Ya no está en el presupuesto</small></label>
      <input type="number" data-cant="${id}" value="${escapar(s.cantidad)}" aria-label="Cantidad">
      <input type="text" data-unid="${id}" value="${escapar(s.unidad)}" aria-label="Unidad">
    </div>`;
  });
  $("c-lista").innerHTML = html || `<p class="vacio">Todos los materiales están completos.</p>`;
}

$("c-ver-completos").addEventListener("change", dibujarListaCarta);
$("c-marcar-faltan").onclick = () => {
  materialesCarta().filter((m) => !completo(m) && !cartaSel.has(m.id)).forEach(seleccionar);
  dibujarListaCarta();
  pintarCarta();
};
$("c-desmarcar").onclick = () => { cartaSel.clear(); dibujarListaCarta(); pintarCarta(); };

$("c-lista").addEventListener("change", (e) => {
  const ck = e.target.dataset.ck;
  if (!ck) return;
  const id = Number(ck);
  const fila = e.target.closest(".item-carta");
  const inCant = fila.querySelector("[data-cant]");
  const inUnid = fila.querySelector("[data-unid]");
  if (e.target.checked) {
    const previo = cartaSel.get(id) || {};
    cartaSel.set(id, { ...previo, cantidad: inCant.value, unidad: inUnid.value });
  } else {
    cartaSel.delete(id);
  }
  inCant.disabled = inUnid.disabled = !e.target.checked;
  pintarCarta();
});
$("c-lista").addEventListener("input", (e) => {
  const id = Number(e.target.dataset.cant || e.target.dataset.unid);
  if (!id || !cartaSel.has(id)) return;
  const s = cartaSel.get(id);
  if (e.target.dataset.cant) {
    s.cantidad = e.target.value;
    const m = materialPorId(id);
    if (m) e.target.closest(".item-carta").querySelector(".nombre-txt").textContent = nombreCarta(m, s.cantidad);
  } else {
    s.unidad = e.target.value;
  }
  pintarCarta();
});

["c-persona", "c-area", "c-responsable", "c-fecha"].forEach((id) => $(id).addEventListener("input", pintarCarta));
$("c-empresa").addEventListener("input", () => { revisarEmpresa(); pintarCarta(); });

function revisarEmpresa() {
  const nombre = sinTildes($("c-empresa").value.trim());
  const previas = nombre ? solicitudes.filter((s) => sinTildes(s.empresa) === nombre && (!solicitudCarta || s.id !== solicitudCarta.id)) : [];
  $("c-origen").textContent = previas.length
    ? `Ojo: a esta empresa ya se le envió ${previas.length === 1 ? "una solicitud" : previas.length + " solicitudes"} (${previas.map((s) =>
        `${fechaCorta(s.creado)}, ${nombreArea(s.area) || "sin área"}, ${s.estado}`).join("; ")}).`
    : (solicitudCarta ? `Solicitud guardada el ${fechaCorta(solicitudCarta.creado)} · estado: ${solicitudCarta.estado}` : "");
}

function itemsCarta() {
  const lista = [];
  cartaSel.forEach((s, id) => {
    const m = materialPorId(id);
    lista.push({
      id,
      orden: m ? ordenCarta(m) : 1e6,
      descripcion: m ? nombreCarta(m, s.cantidad) : s.descripcion,
      cantidad: String(s.cantidad ?? "").trim(),
      unidad: String(s.unidad ?? "").trim(),
      grupo: m ? grupoCarta(m) : (s.grupo || "Otros materiales"),
      fusion: m ? (m.fusion_carta || "") : "",
    });
  });
  return lista.sort((a, b) => a.orden - b.orden).map(({ orden, ...x }) => x);
}

// Filas de la tabla: título de capítulo y materiales. Las brochas de 3" y 4" con la
// misma cantidad van en una sola fila ("3 de cada una"), como en el modelo.
function filasCarta(items) {
  const filas = [];
  const usados = new Set();
  let grupo = null;
  items.forEach((x, i) => {
    if (usados.has(i)) return;
    if (x.grupo !== grupo) { grupo = x.grupo; filas.push({ grupo }); }
    if (x.fusion) {
      const iguales = items.map((y, j) => [y, j]).filter(([y, j]) => j !== i && !usados.has(j) &&
        y.fusion === x.fusion && y.grupo === x.grupo && y.cantidad === x.cantidad && y.unidad === x.unidad);
      if (iguales.length) {
        iguales.forEach(([, j]) => usados.add(j));
        filas.push({ material: x.fusion, cantidad: `${formatoCant(x.cantidad)} de cada una` });
        return;
      }
    }
    filas.push({ material: x.descripcion, cantidad: textoCantidad(x.cantidad, x.unidad) });
  });
  return filas;
}

function datosCarta() {
  return {
    empresa: $("c-empresa").value.trim(),
    persona: $("c-persona").value.trim(),
    area: nombreArea($("c-area").value),
    responsable: $("c-responsable").value.trim(),
    fecha: $("c-fecha").value.trim(),
    items: itemsCarta(),
  };
}

function piezasCarta() {
  const d = datosCarta();
  return {
    ...d,
    destinatario: d.empresa || "A quien interese",
    filas: filasCarta(d.items),
    antes: [
      [{ t: "Reciba un cordial saludo." }],
      [{ t: "Somos cerca de " }, { t: "70 estudiantes", b: true },
       { t: " de Ingeniería en Producción Industrial e Ingeniería Física del Instituto Tecnológico de Costa Rica (TEC) y, como parte del curso PI-4802 Administración de Proyectos, desarrollamos " },
       { t: "Hogar de Oro", b: true },
       { t: ", una iniciativa en beneficio del Hogar de Ancianos Santiago Crespo Calvo, en Alajuela. Ahí viven " },
       { t: "203 adultos mayores", b: true },
       { t: ", muchos de ellos en situación de riesgo social y sin una red familiar que los acompañe, para quienes esa institución es su única casa y su único apoyo." }],
      [{ t: "En julio de 2026, " }, { t: "un incendio afectó 20 habitaciones", b: true },
       { t: " del Hogar y dejó a esos residentes sin su espacio propio. Desde entonces trabajamos para contribuir con la recuperación de las áreas afectadas." }],
      [{ t: "La obra que estamos ejecutando es " }, { t: "la reconstrucción del pasillo techado", b: true },
       { t: " que conecta las áreas comunes con los pabellones donde viven los residentes. Ese pasillo hoy no existe, por lo que los adultos mayores no pueden trasladarse con seguridad de un lugar a otro, sobre todo en época lluviosa. El proyecto cuenta con planos y presupuesto elaborados por la arquitecta Rosaura Molina Vargas, carné A-7024." }],
      [{ t: "Por esta razón nos dirigimos a ustedes para solicitar, respetuosamente, " },
       { t: "la donación de materiales de construcción", b: true },
       { t: " para esta obra. Cualquier aporte es bien recibido, sea con alguno de los materiales del siguiente detalle, con una parte de ellos o con un descuento especial sobre el precio de venta:" }],
    ],
    despues: [
      [{ t: "Agradecemos sinceramente su tiempo y la consideración de esta solicitud. Quedamos a disposición para ampliar la información o mostrarles los planos de la obra." }],
    ],
  };
}

// ---- Vista previa ----
function pintarCarta() {
  const d = piezasCarta();
  const parrafo = (partes) => `<p>${partes.map((x) => x.b ? `<strong>${escapar(x.t)}</strong>` : escapar(x.t)).join("")}</p>`;
  const filas = d.filas.length
    ? d.filas.map((f) => f.grupo
        ? `<tr class="grupo"><td colspan="2">${escapar(f.grupo)}</td></tr>`
        : `<tr><td>${escapar(f.material)}</td><td class="cant">${escapar(f.cantidad)}</td></tr>`).join("")
    : `<tr><td colspan="2"><span class="dato">Marque los materiales que se van a pedir</span></td></tr>`;
  $("carta-vista").innerHTML = `<div class="hoja">
    <div class="membrete">
      <img src="${LOGO}" alt="Hogar de Oro">
      <div>
        <div class="marca">HOGAR DE ORO</div>
        <div class="lema">Porque su memoria no se quema, se honra.</div>
        <div class="curso">Instituto Tecnológico de Costa Rica, curso PI-4802 Administración de Proyectos</div>
      </div>
    </div>
    <div class="regla"></div>
    <p class="fecha">${escapar(d.fecha)}</p>
    <p class="linea"><strong>${escapar(d.destinatario)}</strong></p>
    ${d.persona ? `<p class="linea">${escapar(d.persona)}</p>` : ""}
    <p class="linea" style="margin-bottom:14px">Presente</p>
    <p style="margin-bottom:14px"><strong>Asunto:</strong> ${ASUNTO}</p>
    ${d.antes.map(parrafo).join("")}
    <table class="mats"><thead><tr><th>Material</th><th>Cantidad</th></tr></thead><tbody>${filas}</tbody></table>
    ${d.despues.map(parrafo).join("")}
    <p style="margin-top:14px">Atentamente,</p>
    <div class="firma">
      <strong>${FIRMA.nombre}</strong>
      <div class="gris">${FIRMA.puesto}</div>
      <div class="gris">${FIRMA.correo}</div>
    </div>
  </div>`;
}

function validarCarta(paraGuardar = false) {
  const d = datosCarta();
  if (!d.items.length) return "Marque al menos un material.";
  if (d.items.some((x) => !x.cantidad)) return "Hay un material marcado sin cantidad.";
  if (paraGuardar) {
    if (!d.empresa) return "Para guardar la solicitud escriba la empresa o persona.";
    if (!d.area) return "Para guardar la solicitud escriba el área que la envía.";
    if (!d.responsable) return "Para guardar la solicitud escriba el responsable.";
  }
  return "";
}

function nombreArchivoCarta() {
  const limpio = (datosCarta().empresa || "A quien interese").replace(/[^a-zA-Z0-9 áéíóúñÁÉÍÓÚÑüÜ._-]/g, "").trim();
  return `Carta donación materiales - ${limpio}`;
}

// ---- Word (.docx real, igual al modelo) ----
const URL_DOCX = "https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.js";

async function bytesLogo() {
  if (LOGO.startsWith("data:")) {
    const b = atob(LOGO.split(",")[1]);
    return Uint8Array.from(b, (c) => c.charCodeAt(0));
  }
  return new Uint8Array(await (await fetch(LOGO)).arrayBuffer());
}

async function documentoDocx() {
  const D = window.docx;
  const d = piezasCarta();
  const hex = (c) => c.replace("#", "");
  const NADA = { style: D.BorderStyle.NONE, size: 0, color: "FFFFFF" };
  const SIN_BORDES = { top: NADA, bottom: NADA, left: NADA, right: NADA, insideHorizontal: NADA, insideVertical: NADA };
  const linea = (color) => ({ style: D.BorderStyle.SINGLE, size: 4, color: hex(color) });
  const TEXTO = 9306;                     // ancho útil A4 con los márgenes del modelo (twips)
  const COL = [7050, 2542];               // columnas de la tabla del modelo

  const parrafo = (partes, extra = {}) => new D.Paragraph({
    alignment: D.AlignmentType.JUSTIFIED,
    spacing: { after: 140, line: 259 },
    children: partes.map((x) => new D.TextRun({ text: x.t, bold: !!x.b })),
    ...extra,
  });
  const simple = (texto, extra = {}, run = {}) => new D.Paragraph({
    spacing: { after: 0, line: 259 }, ...extra,
    children: [new D.TextRun({ text: texto, ...run })],
  });

  // Membrete
  const membrete = new D.Table({
    width: { size: TEXTO, type: D.WidthType.DXA },
    columnWidths: [1080, TEXTO - 1080],
    borders: SIN_BORDES,
    rows: [new D.TableRow({
      children: [
        new D.TableCell({
          width: { size: 1080, type: D.WidthType.DXA }, borders: SIN_BORDES,
          verticalAlign: D.VerticalAlign.CENTER,
          margins: { left: 160, right: 0, top: 0, bottom: 0 },
          children: [new D.Paragraph({ children: [new D.ImageRun({ data: await bytesLogo(), transformation: { width: 61, height: 61 } })] })],
        }),
        new D.TableCell({
          width: { size: TEXTO - 1080, type: D.WidthType.DXA }, borders: SIN_BORDES,
          verticalAlign: D.VerticalAlign.CENTER,
          margins: { left: 180, right: 0, top: 0, bottom: 0 },
          children: [
            simple("HOGAR DE ORO", {}, { font: "Georgia", size: 40, color: hex(COLOR.oro), characterSpacing: 110 }),
            simple("Porque su memoria no se quema, se honra.", {}, { font: "Georgia", italics: true, size: 17, color: "666666" }),
            simple("Instituto Tecnológico de Costa Rica, curso PI-4802 Administración de Proyectos", {}, { size: 16, color: "777777" }),
          ],
        }),
      ],
    })],
  });

  // Tabla de materiales
  const celda = (texto, { negrita = false, color = "000000", fondo = null, centro = false, span = 1, ancho, abajo = COLOR.linea, seguir = false } = {}) =>
    new D.TableCell({
      columnSpan: span,
      width: { size: ancho, type: D.WidthType.DXA },
      shading: fondo ? { type: D.ShadingType.CLEAR, color: "auto", fill: hex(fondo) } : undefined,
      verticalAlign: D.VerticalAlign.CENTER,
      margins: { top: 50, bottom: 50, left: 115, right: 115 },
      borders: { top: linea(COLOR.linea), left: linea(COLOR.linea), right: linea(COLOR.linea), bottom: linea(abajo) },
      children: [new D.Paragraph({
        alignment: centro ? D.AlignmentType.CENTER : D.AlignmentType.LEFT,
        spacing: { after: 0, line: 240 },
        keepNext: seguir,
        children: [new D.TextRun({ text: texto, bold: negrita, color, size: 19 })],
      })],
    });
  const filas = [new D.TableRow({
    tableHeader: true, cantSplit: true,
    children: [
      celda("Material", { negrita: true, color: hex(COLOR.cafe), fondo: COLOR.fondoCab, ancho: COL[0], abajo: COLOR.lineaFuerte }),
      celda("Cantidad", { negrita: true, color: hex(COLOR.cafe), fondo: COLOR.fondoCab, ancho: COL[1], abajo: COLOR.lineaFuerte }),
    ],
  })];
  d.filas.forEach((f) => {
    filas.push(new D.TableRow({
      cantSplit: true,
      children: f.grupo
        ? [celda(f.grupo, { negrita: true, color: hex(COLOR.cafe), fondo: COLOR.fondoGrupo, span: 2, ancho: COL[0] + COL[1], abajo: COLOR.lineaFuerte, seguir: true })]
        : [celda(f.material, { ancho: COL[0] }), celda(f.cantidad, { ancho: COL[1], centro: true })],
    }));
  });
  const tabla = new D.Table({
    width: { size: COL[0] + COL[1], type: D.WidthType.DXA },
    columnWidths: COL,
    layout: D.TableLayoutType.FIXED,
    rows: filas,
  });

  const firma = [
    simple("Atentamente,", { spacing: { before: 120, after: 0, line: 259 }, keepNext: true, keepLines: true }),
    new D.Paragraph({ spacing: { before: 0, after: 0, line: 1160, lineRule: D.LineRuleType.EXACT }, keepNext: true, children: [] }),
    new D.Paragraph({
      spacing: { after: 0, line: 259 }, keepNext: true, indent: { right: 260 },
      border: { top: { style: D.BorderStyle.SINGLE, size: 6, color: hex(COLOR.oro), space: 4 } },
      children: [new D.TextRun({ text: FIRMA.nombre, bold: true, size: 20 })],
    }),
    simple(FIRMA.puesto, { keepNext: true }, { size: 18, color: "555555" }),
    simple(FIRMA.correo, {}, { size: 18, color: "555555" }),
  ];

  return new D.Document({
    creator: "Hogar de Oro",
    title: "Solicitud de donación de materiales de construcción",
    styles: { default: { document: { run: { font: "Calibri", size: 21 } } } },
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 720, right: 1280, bottom: 720, left: 1320 } } },
      children: [
        membrete,
        new D.Paragraph({
          spacing: { before: 0, after: 200 },
          border: { bottom: { style: D.BorderStyle.SINGLE, size: 6, color: hex(COLOR.oro), space: 1 } },
          children: [],
        }),
        simple(d.fecha, { alignment: D.AlignmentType.RIGHT, spacing: { after: 260, line: 259 } }),
        simple(d.destinatario, {}, { bold: true }),
        ...(d.persona ? [simple(d.persona)] : []),
        simple("Presente", { spacing: { before: 40, after: 180, line: 259 } }),
        new D.Paragraph({
          spacing: { after: 180, line: 259 },
          children: [new D.TextRun({ text: "Asunto: ", bold: true }), new D.TextRun(ASUNTO)],
        }),
        ...d.antes.map((p) => parrafo(p)),
        tabla,
        new D.Paragraph({ spacing: { after: 0 }, children: [] }),
        ...d.despues.map((p) => parrafo(p)),
        ...firma,
      ],
    }],
  });
}

// ---- PDF: mismas fuentes que el modelo (equivalentes libres de Calibri y Georgia) ----
const URL_FUENTES = "https://cdn.jsdelivr.net/npm/@fontsource";
const ARCHIVOS_FUENTES = {
  "Carlito-Regular.woff": `${URL_FUENTES}/carlito@5.2.5/files/carlito-latin-400-normal.woff`,
  "Carlito-Bold.woff": `${URL_FUENTES}/carlito@5.2.5/files/carlito-latin-700-normal.woff`,
  "Carlito-Italic.woff": `${URL_FUENTES}/carlito@5.2.5/files/carlito-latin-400-italic.woff`,
  "Gelasio-Regular.woff": `${URL_FUENTES}/gelasio@5.2.5/files/gelasio-latin-400-normal.woff`,
  "Gelasio-Italic.woff": `${URL_FUENTES}/gelasio@5.2.5/files/gelasio-latin-400-italic.woff`,
};
let logoBase64 = null;
let fuentesPdf = null;     // true: Carlito/Gelasio cargadas · false: se usa Roboto

async function cargarLogo() {
  if (LOGO.startsWith("data:")) return LOGO;
  if (logoBase64) return logoBase64;
  const blob = await (await fetch(LOGO)).blob();
  logoBase64 = await new Promise((ok) => {
    const l = new FileReader();
    l.onload = () => ok(l.result);
    l.readAsDataURL(blob);
  });
  return logoBase64;
}
function cargarGuion(url) {
  return new Promise((ok, mal) => {
    const s = document.createElement("script");
    s.src = url; s.onload = ok; s.onerror = () => mal(new Error("No se pudo cargar una parte de la página. Revise la conexión a internet."));
    document.head.appendChild(s);
  });
}
function aBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let texto = "";
  for (let i = 0; i < bytes.length; i += 0x8000) texto += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(texto);
}
async function prepararPdf() {
  if (!(window.pdfMake && window.pdfMake.vfs)) {
    await cargarGuion("https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.10/pdfmake.min.js");
    await cargarGuion("https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.10/vfs_fonts.js");
  }
  if (fuentesPdf !== null) return;
  try {
    const nombres = Object.keys(ARCHIVOS_FUENTES);
    const incrustadas = window.FUENTES_INCRUSTADAS;
    const datos = incrustadas ? nombres.map((n) => incrustadas[n]) : await Promise.all(nombres.map(async (n) => {
      const r = await fetch(ARCHIVOS_FUENTES[n]);
      if (!r.ok) throw new Error("fuente");
      return aBase64(await r.arrayBuffer());
    }));
    nombres.forEach((n, i) => { window.pdfMake.vfs[n] = datos[i]; });
    window.pdfMake.fonts = {
      Roboto: { normal: "Roboto-Regular.ttf", bold: "Roboto-Medium.ttf", italics: "Roboto-Italic.ttf", bolditalics: "Roboto-MediumItalic.ttf" },
      Carlito: { normal: "Carlito-Regular.woff", bold: "Carlito-Bold.woff", italics: "Carlito-Italic.woff", bolditalics: "Carlito-Bold.woff" },
      Gelasio: { normal: "Gelasio-Regular.woff", bold: "Gelasio-Regular.woff", italics: "Gelasio-Italic.woff", bolditalics: "Gelasio-Italic.woff" },
    };
    fuentesPdf = true;
  } catch (e) {
    fuentesPdf = false;
  }
}

// cortes: capítulos que deben empezar en hoja nueva para que su título no quede solo al final de una hoja
function definicionPdf(logo, cortes = new Set()) {
  const d = piezasCarta();
  const cuerpo = fuentesPdf ? "Carlito" : "Roboto";
  const serif = fuentesPdf ? "Gelasio" : "Roboto";
  const ANCHO = 465;   // ancho útil de la hoja A4 con los márgenes del modelo
  const texto = (partes) => ({
    text: partes.map((x) => ({ text: x.t, bold: !!x.b })),
    alignment: "justify", margin: [0, 0, 0, 7], lineHeight: 1.08,
  });

  // La tabla se arma por tramos: uno nuevo solo donde haga falta pasar un capítulo a la hoja siguiente.
  const cabecera = () => [
    { text: "Material", bold: true, color: COLOR.cafe, fillColor: COLOR.fondoCab },
    { text: "Cantidad", bold: true, color: COLOR.cafe, fillColor: COLOR.fondoCab },
  ];
  const tramos = [];
  let tramo = null, grupo = -1, primeraDelGrupo = false;
  const nuevoTramo = (saltar) => { tramo = { filas: [cabecera()], fuertes: new Set([0]), saltar }; tramos.push(tramo); };
  nuevoTramo(false);
  d.filas.forEach((f) => {
    if (f.grupo) {
      grupo++;
      if (cortes.has(grupo) && tramo.filas.length > 1) nuevoTramo(true);
      tramo.fuertes.add(tramo.filas.length);
      tramo.filas.push([{ text: f.grupo, bold: true, color: COLOR.cafe, fillColor: COLOR.fondoGrupo, colSpan: 2, id: "g" + grupo }, {}]);
      primeraDelGrupo = true;
    } else {
      tramo.filas.push([{ text: f.material, ...(primeraDelGrupo ? { id: "p" + grupo } : {}) }, { text: f.cantidad, alignment: "center" }]);
      primeraDelGrupo = false;
    }
  });
  const tablas = tramos.map((t, i) => {
    const fuertes = t.fuertes;
    return {
      ...(t.saltar ? { pageBreak: "before" } : {}),
      table: { headerRows: 1, widths: [340.5, 115], body: t.filas },
      layout: {
        hLineWidth: () => 0.5, vLineWidth: () => 0.5,
        hLineColor: (k) => (fuertes.has(k - 1) ? COLOR.lineaFuerte : COLOR.linea),
        vLineColor: () => COLOR.linea,
        paddingLeft: () => 6, paddingRight: () => 6, paddingTop: () => 2.5, paddingBottom: () => 2.5,
      },
      fontSize: 9.5, margin: [0, i === 0 ? 1 : 0, 0, i === tramos.length - 1 ? 9 : 0],
    };
  });

  return {
    pageSize: "A4",
    pageMargins: [66, 36, 64, 36],
    defaultStyle: { font: cuerpo, fontSize: 10.5, color: "#000000" },
    content: [
      {
        columns: [
          { width: 54, stack: [{ image: logo, width: 46, height: 46, margin: [8, 0, 0, 0] }] },
          {
            width: "*", margin: [9, 0, 0, 0],
            stack: [
              { text: "HOGAR DE ORO", font: serif, fontSize: 20, color: COLOR.oro, characterSpacing: 5.5, lineHeight: 0.98 },
              { text: "Porque su memoria no se quema, se honra.", font: serif, italics: true, fontSize: 8.5, color: "#666666", margin: [0, 0, 0, 1] },
              { text: "Instituto Tecnológico de Costa Rica, curso PI-4802 Administración de Proyectos", fontSize: 8, color: "#777777" },
            ],
          },
        ],
      },
      { canvas: [{ type: "line", x1: 0, y1: 0, x2: ANCHO, y2: 0, lineWidth: 0.7, lineColor: COLOR.oro }], margin: [-1, 16, 0, 10] },
      { text: d.fecha, alignment: "right", margin: [0, 0, 0, 13] },
      { text: d.destinatario, bold: true },
      ...(d.persona ? [{ text: d.persona }] : []),
      { text: "Presente", margin: [0, 2, 0, 11] },
      { text: [{ text: "Asunto: ", bold: true }, ASUNTO], margin: [0, 0, 0, 11] },
      ...d.antes.map(texto),
      ...tablas,
      ...d.despues.map(texto),
      {
        unbreakable: true,
        stack: [
          { text: "Atentamente,", margin: [0, 8, 0, 0] },
          { canvas: [{ type: "line", x1: 0, y1: 0, x2: 452, y2: 0, lineWidth: 0.7, lineColor: COLOR.oro }], margin: [0, 58, 0, 5] },
          { text: FIRMA.nombre, bold: true, fontSize: 10 },
          { text: FIRMA.puesto, fontSize: 9, color: "#555555", margin: [0, 1, 0, 0] },
          { text: FIRMA.correo, fontSize: 9, color: "#555555" },
        ],
      },
    ],
  };
}

// Arma el PDF una vez para ver en qué hoja cae cada fila; si un título de capítulo
// quedó solo al final de una hoja, ese capítulo empieza en la hoja siguiente.
async function maquetarPdf(logo) {
  const cortes = new Set();
  for (let vuelta = 0; vuelta < 4; vuelta++) {
    const paginas = {};
    const def = definicionPdf(logo, cortes);
    def.pageBreakBefore = (n) => {
      if (n.id && n.startPosition) paginas[n.id] = n.startPosition.pageNumber;
      return false;
    };
    await new Promise((ok) => window.pdfMake.createPdf(def).getBuffer(ok));
    const solo = Object.keys(paginas).filter((k) => k[0] === "g").map((k) => Number(k.slice(1)))
      .find((g) => paginas["p" + g] && paginas["p" + g] !== paginas["g" + g]);
    if (solo === undefined) return definicionPdf(logo, cortes);
    cortes.add(solo);
  }
  return definicionPdf(logo, cortes);
}

function descargar(blob, nombre) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

$("c-word").onclick = async () => {
  const error = validarCarta();
  if (error) { avisar(error, true); return; }
  const boton = $("c-word");
  boton.disabled = true;
  boton.textContent = "Armando el Word...";
  try {
    if (!window.docx) await cargarGuion(URL_DOCX);
    const blob = await window.docx.Packer.toBlob(await documentoDocx());
    if (await descargar(blob, nombreArchivoCarta() + ".docx") !== false) avisar("Carta descargada en Word.");
  } catch (e) {
    avisar(e.message, true);
  } finally {
    boton.disabled = false;
    boton.textContent = "Descargar en Word";
  }
};

$("c-pdf").onclick = async () => {
  const error = validarCarta();
  if (error) { avisar(error, true); return; }
  const boton = $("c-pdf");
  boton.disabled = true;
  boton.textContent = "Armando el PDF...";
  try {
    const logo = await cargarLogo();
    await prepararPdf();
    const def = await maquetarPdf(logo);
    const blob = await new Promise((ok) => window.pdfMake.createPdf(def).getBlob(ok));
    if (await descargar(blob, nombreArchivoCarta() + ".pdf") !== false) avisar("PDF descargado.");
  } catch (e) {
    avisar(e.message, true);
  } finally {
    boton.disabled = false;
    boton.textContent = "Descargar en PDF";
  }
};

$("c-guardar").onclick = async () => {
  const error = validarCarta(true);
  if (error) { avisar(error, true); return; }
  const d = datosCarta();
  const datos = {
    empresa: d.empresa, contacto: d.persona, area: d.area, responsable: d.responsable, fecha: d.fecha,
    materiales: d.items.map(({ fusion, ...x }) => x),
  };
  const boton = $("c-guardar");
  boton.disabled = true;
  try {
    if (solicitudCarta) {
      await enviar(`${T_SOLICITUDES}?id=eq.${solicitudCarta.id}`, "PATCH", datos);
      avisar("Solicitud actualizada.");
    } else {
      const r = await enviar(T_SOLICITUDES, "POST", { ...datos, estado: ESTADO_ABIERTA });
      solicitudCarta = r && r[0] ? r[0] : null;
      d.items.forEach((x) => marcados.delete(x.id));
      guardarMarcas();
      avisar("Solicitud guardada. Ya aparece en la pestaña Solicitudes.");
    }
    $("c-guardar").textContent = "Guardar cambios de la solicitud";
    await cargar();
    revisarEmpresa();
  } catch (e) {
    avisar(e.message, true);
  } finally {
    boton.disabled = false;
  }
};

// ===================== Excel =====================
$("btn-excel").onclick = () => {
  if (typeof XLSX === "undefined") { avisar("No se pudo cargar el generador de Excel.", true); return; }
  const libro = XLSX.utils.book_new();

  const hojaMateriales = materiales.filter(esMaterial).map((m) => {
    const c = calculo.get(m.id) || { cantDon: 0, cantCom: 0, cantidad: 0 };
    return {
      "Código": m.codigo || "", "Capítulo": m.capitulo, "Material": m.descripcion, "Unidad": m.unidad || "",
      "Requerido": num(m.cantidad), "Donado": c.cantDon, "Comprado": c.cantCom,
      "Faltante": faltante(m), "Precio unitario": num(m.precio_unitario), "Costo presupuestado": costoMaterial(m),
      "Estado": completo(m) ? "Completo" : (c.cantidad > 0 ? "Parcial" : "Falta"),
      "Solicitado a": (abiertas.get(m.id) || []).join(", "),
    };
  });
  const p = filasPresupuesto();
  const hojaPresupuesto = [...p.directos, p.sd, ...p.indirectos, p.si, p.total].map((f) => ({
    "Rubro": f.rubro, "Presupuestado": Math.round(f.presupuestado * 100) / 100,
    "Donado": f.donado, "Comprado": f.comprado, "Falta por cubrir": Math.round(f.pendiente * 100) / 100,
  }));
  const hojaIngresos = [...movimientos].reverse().map((mv) => {
    const m = mv.material_id != null ? materialPorId(mv.material_id) : null;
    return {
      "Fecha": fechaCorta(mv.fecha), "Tipo": mv.tipo, "Material o rubro": nombreMovimiento(mv),
      "Cantidad": m ? num(mv.cantidad) : "", "Unidad": m ? m.unidad : "", "Valor": num(mv.valor),
      "Donante o proveedor": mv.origen || "", "Área": nombreArea(mv.area), "Responsable": mv.responsable || "",
      "Observaciones": mv.observaciones || "",
    };
  });
  const hojaSolicitudes = [...solicitudes].reverse().map((s) => ({
    "Fecha": fechaCorta(s.creado), "Empresa": s.empresa, "Contacto": s.contacto || "",
    "Materiales": (s.materiales || []).map((x) => `${x.descripcion}: ${x.cantidad} ${x.unidad}`).join("; "),
    "Área": nombreArea(s.area), "Responsable": s.responsable || "", "Estado": s.estado || "",
  }));

  const agregar = (nombre, filas, anchos) => {
    const hoja = XLSX.utils.json_to_sheet(filas.length ? filas : [{}]);
    hoja["!cols"] = anchos.map((w) => ({ wch: w }));
    XLSX.utils.book_append_sheet(libro, hoja, nombre);
  };
  agregar("Materiales", hojaMateriales, [8, 30, 44, 8, 11, 10, 11, 10, 14, 18, 11, 30]);
  agregar("Presupuesto", hojaPresupuesto, [46, 16, 14, 14, 16]);
  agregar("Ingresos", hojaIngresos, [11, 10, 44, 10, 8, 12, 30, 16, 30, 34]);
  agregar("Solicitudes", hojaSolicitudes, [11, 30, 24, 70, 16, 30, 14]);
  XLSX.writeFile(libro, "Presupuesto_y_materiales_Hogar_de_Oro.xlsx");
};

// ===================== Arranque =====================
leerMarcas();
if (/PEGAR/.test(window.CONFIG.SUPABASE_URL + window.CONFIG.SUPABASE_ANON_KEY)) {
  mostrarLogin("Falta poner la dirección y la clave de Supabase en config.js.");
  $("btn-entrar").disabled = true;
} else
if (leerSesion()) { mostrarAplicacion(); cargar(); }
else mostrarLogin();

// Todas las áreas trabajan a la vez: se refresca solo cada 30 s y al volver a la pestaña.
setInterval(() => {
  if (sesion && document.visibilityState === "visible") cargar(true);
}, REFRESCO_MS);
document.addEventListener("visibilitychange", () => {
  if (sesion && document.visibilityState === "visible") cargar(true);
});
