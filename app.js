"use strict";

/* =====================================================================
   Gestión de Compras · Conequipos
   Cotización y selección de proveedores -> Orden de compra (PDF)
   ===================================================================== */

const sb = window.supabase.createClient(
  CONFIG.SUPABASE_URL,
  CONFIG.SUPABASE_KEY,
);

/* ---------- utilidades ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const money = (n) =>
  "$ " +
  new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 }).format(
    Math.round(Number(n) || 0),
  );
const num = (v) =>
  v === null || v === undefined || v === "" ? null : Number(v);
const pad = (n) => String(n).padStart(4, "0");
const today = () => new Date().toLocaleDateString("en-CA"); // yyyy-mm-dd en hora local
const fmtDate = (d) => {
  if (!d) return "";
  const [y, m, dd] = String(d).slice(0, 10).split("-");
  return `${dd}/${m}/${y}`;
};
const norm = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

function toast(msg, type = "") {
  const el = document.createElement("div");
  el.className = "toast " + type;
  el.textContent = msg;
  $("#toasts").appendChild(el);
  setTimeout(() => el.remove(), type === "err" ? 7000 : 3500);
}

function dbError(e, contexto) {
  console.error(contexto, e);
  let msg = e?.message || String(e);
  if (/Could not find the table|does not exist/i.test(msg))
    msg = "Falta crear las tablas en Supabase (revisa el SQL).";
  if (/row-level security|permission denied/i.test(msg))
    msg = "Supabase bloqueó la operación (revisa las políticas RLS).";
  if (/Failed to fetch|NetworkError/i.test(msg))
    msg = "No hay conexión con el servidor.";
  toast(`${contexto}: ${msg}`, "err");
}

/* Confirmación con diálogo propio (reemplaza el confirm() feo del navegador) */
function confirmar(titulo, mensaje, textoSi = "Sí, continuar") {
  return new Promise((resolve) => {
    const dlg = $("#dlg-confirm");
    $("#dlg-confirm-title").textContent = titulo;
    $("#dlg-confirm-msg").textContent = mensaje || "";
    $("#dlg-confirm-si").textContent = textoSi;

    const cerrar = (valor) => {
      dlg.close();
      $("#dlg-confirm-si").onclick = null;
      $("#dlg-confirm-no").onclick = null;
      dlg.oncancel = null;
      resolve(valor);
    };
    $("#dlg-confirm-si").onclick = () => cerrar(true);
    $("#dlg-confirm-no").onclick = () => cerrar(false);
    dlg.oncancel = () => cerrar(false); // tecla ESC
    dlg.showModal();
  });
}

/* ---------- opciones de calificación (puntos) ---------- */
const COND = [
  [3, "Contado"],
  [2, "8 a 30 días"],
  [1, "Más de 30 días"],
];
const OPOR = [
  [3, "Cumplido"],
  [2, "Poco cumplido"],
  [1, "Incumplido"],
];
const CALI = [
  [3, "Muy confiable"],
  [2, "Poco confiable"],
  [1, "No es confiable"],
];
const UNIDADES = CONFIG.UNIDADES_FIJAS; // <-- usa las fijas de config.js

/* ---------- estado ---------- */
const state = {
  productos: [],
  proveedores: [],
  ordenes: [],
  ordenActual: null,
  guardado: null,
  ultimoCalculo: null, // resultado mostrado tras pulsar Calcular
};

/* =====================================================================
   NAVEGACIÓN
   ===================================================================== */
function showView(name) {
  $$(".view").forEach((v) =>
    v.classList.toggle("active", v.id === "view-" + name),
  );
  $$("#tabs button").forEach((b) =>
    b.classList.toggle("active", b.dataset.view === name),
  );
  window.scrollTo({ top: 0 });
  if (name === "ordenes") cargarOrdenes();
  if (name === "productos") renderTablaProductos();
  if (name === "proveedores") renderTablaProveedores();
  if (name === "cotizacion") refrescarSelectores();
}
$("#tabs").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-view]");
  if (b) showView(b.dataset.view);
});

/* =====================================================================
   CARGA DE DATOS
   ===================================================================== */
async function cargarProductos() {
  const { data, error } = await sb
    .from("com_productos")
    .select("*")
    .eq("activo", true)
    .order("nombre_producto");
  if (error) return dbError(error, "No se pudieron cargar los productos");
  state.productos = data || [];
  refrescarSelectores();
  renderTablaProductos();
  // listas para el diálogo de producto
  $("#dl-tipos").innerHTML = tiposDisponibles()
    .map((t) => `<option value="${esc(t)}">`)
    .join("");
  $("#dl-unidades").innerHTML = unidadesDisponibles()
    .map((u) => `<option value="${esc(u)}">`)
    .join("");
}

async function cargarProveedores() {
  const { data, error } = await sb
    .from("com_proveedores")
    .select("*")
    .eq("activo", true)
    .order("nombre")
    .limit(2000);
  if (error) return dbError(error, "No se pudieron cargar los proveedores");
  state.proveedores = data || [];
  llenarSelectsProveedor();
  renderTablaProveedores();
  $$(".prov").forEach((el) => actualizarInfoProveedor(el));
}

/* =====================================================================
   SELECTORES DE PRODUCTO
   ===================================================================== */
/* Repinta SIEMPRE el select de tipo (21 fijos + creados) y deja producto listo */
function refrescarSelectores(tipoSeleccionado = "", productoId = null) {
  const tipoSel = $("#f-tipo");

  const tipos = tiposDisponibles();
  tipoSel.innerHTML =
    '<option value="">Selecciona…</option>' +
    tipos.map((t) => `<option>${esc(t)}</option>`).join("");

  // decide qué tipo dejar seleccionado
  if (tipoSeleccionado && tipos.includes(tipoSeleccionado))
    tipoSel.value = tipoSeleccionado;
  else tipoSel.value = "";

  // ahora llena productos según el tipo
  refrescarProductos(productoId);
  $("#hint-productos").hidden = state.productos.length > 0;
}

/* Llena el select de producto según el tipo actual */
function refrescarProductos(productoId = null) {
  const tipo = $("#f-tipo").value;
  const prodSel = $("#f-producto");
  const lista = state.productos.filter((p) => p.tipo_producto === tipo);

  prodSel.innerHTML =
    '<option value="">' +
    (tipo ? "Selecciona…" : "Primero elige el tipo") +
    "</option>" +
    lista
      .map(
        (p) =>
          `<option value="${p.id}">${esc(p.nombre_producto)}${p.descripcion ? " · " + esc(p.descripcion) : ""}</option>`,
      )
      .join("");

  prodSel.value =
    productoId && lista.some((p) => p.id === productoId)
      ? String(productoId)
      : "";
  aplicarProducto();
}

function productoSeleccionado() {
  const id = Number($("#f-producto").value);
  return state.productos.find((p) => p.id === id) || null;
}

function aplicarProducto() {
  const p = productoSeleccionado();
  const selU = $("#f-unidad");
  // armar opciones: fijas + las de productos
  const unidades = [
    ...new Set([
      ...CONFIG.UNIDADES_FIJAS,
      ...state.productos.map((x) => x.unidad_medida),
    ]),
  ].filter(Boolean);
  selU.innerHTML =
    '<option value="">Selecciona…</option>' +
    unidades.map((u) => `<option>${esc(u)}</option>`).join("");
  selU.value = p ? p.unidad_medida || "" : "";
  $("#f-descripcion").value = p ? p.descripcion || "" : "";
}
/* ---------- listas administrables (tipos y unidades) ---------- */
const LS_TIPOS = "com_tipos_extra";
const LS_UNIDADES = "com_unidades_extra";
const leerLS = (k) => {
  try {
    return JSON.parse(localStorage.getItem(k) || "[]");
  } catch {
    return [];
  }
};
const guardarLS = (k, arr) => localStorage.setItem(k, JSON.stringify(arr));

function tiposDisponibles() {
  const creados = leerLS(LS_TIPOS);
  return [...new Set([...CONFIG.TIPOS_FIJOS, ...creados])].sort((a, b) =>
    a.localeCompare(b, "es"),
  );
}
function unidadesDisponibles() {
  const creados = leerLS(LS_UNIDADES);
  const deProductos = state.productos
    .map((p) => p.unidad_medida)
    .filter(Boolean);
  const todas = [...CONFIG.UNIDADES_FIJAS, ...creados, ...deProductos];
  // deduplicar por forma normalizada (sin tildes, minúsculas), conservar el primero
  const vista = new Set();
  const salida = [];
  for (const u of todas) {
    const k = norm(u);
    if (!vista.has(k)) {
      vista.add(k);
      salida.push(u);
    }
  }
  return salida.sort((a, b) => a.localeCompare(b, "es"));
}

/* ---------- agregar / eliminar TIPO ---------- */
function agregarTipo() {
  $("#frm-tipo").reset();
  $("#dlg-tipo").showModal();
  $("#frm-tipo [name=nombre]").focus();
}

$("#frm-tipo").addEventListener("submit", (e) => {
  e.preventDefault();
  const nombre = e.target.nombre.value.trim();
  if (!nombre) return toast("Escribe un nombre.", "err");

  const tipos = tiposDisponibles();
  if (tipos.some((t) => norm(t) === norm(nombre)))
    return toast("Ese tipo ya existe.", "err");

  const creados = leerLS(LS_TIPOS);
  creados.push(nombre);
  guardarLS(LS_TIPOS, creados);

  $("#dlg-tipo").close();
  refrescarSelectores(nombre);
  actualizarDatalists();
  toast("Tipo agregado", "ok");
});

async function eliminarTipo() {
  const actual = $("#f-tipo").value;
  if (!actual) return toast("Primero elige el tipo a eliminar.", "err");

  if (CONFIG.TIPOS_FIJOS.some((t) => norm(t) === norm(actual)))
    return toast("Ese es un tipo base y no se puede eliminar.", "err");

  if (state.productos.some((p) => norm(p.tipo_producto) === norm(actual)))
    return toast("No se puede eliminar: tiene productos asociados.", "err");

  const ok = await confirmar(
    "Eliminar tipo",
    `¿Eliminar el tipo "${actual}"?\n\nNo afecta productos ni órdenes existentes.`,
    "Eliminar",
  );
  if (!ok) return;

  const creados = leerLS(LS_TIPOS).filter((t) => norm(t) !== norm(actual));
  guardarLS(LS_TIPOS, creados);

  refrescarSelectores();
  actualizarDatalists();
  toast("Tipo eliminado", "ok");
}

/* Mantiene actualizados los datalist del diálogo de producto */
function actualizarDatalists() {
  $("#dl-tipos").innerHTML = tiposDisponibles()
    .map((t) => `<option value="${esc(t)}">`)
    .join("");
  $("#dl-unidades").innerHTML = unidadesDisponibles()
    .map((u) => `<option value="${esc(u)}">`)
    .join("");
}

$("#btn-add-tipo").addEventListener("click", agregarTipo);
$("#btn-del-tipo").addEventListener("click", eliminarTipo);

$("#f-tipo").addEventListener("change", () => refrescarProductos());
$("#f-producto").addEventListener("change", aplicarProducto);

/* ---------- nuevo producto ---------- */
function abrirDialogoProducto() {
  const frm = $("#frm-producto");
  frm.reset();

  // Tipo fijo = el que está seleccionado afuera
  frm.tipo_producto.value = $("#f-tipo").value || "";

  // Llenar el select de unidades con las disponibles
  const selU = frm.unidad_medida;
  selU.innerHTML =
    '<option value="">Selecciona…</option>' +
    unidadesDisponibles()
      .map((u) => `<option>${esc(u)}</option>`)
      .join("");

  $("#dlg-producto").showModal();
  frm.nombre_producto.focus();
}

$("#frm-producto").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const fila = {
    tipo_producto: f.get("tipo_producto").trim(),
    nombre_producto: f.get("nombre_producto").trim(),
    unidad_medida: f.get("unidad_medida").trim(),
    descripcion: f.get("descripcion").trim() || null,
  };
  if (!fila.tipo_producto || !fila.nombre_producto || !fila.unidad_medida)
    return toast("Completa tipo, nombre y unidad.", "err");
  const dup = state.productos.find(
    (p) =>
      norm(p.tipo_producto) === norm(fila.tipo_producto) &&
      norm(p.nombre_producto) === norm(fila.nombre_producto) &&
      norm(p.descripcion) === norm(fila.descripcion) &&
      norm(p.unidad_medida) === norm(fila.unidad_medida),
  );
  if (dup) return toast("Ese producto ya existe.", "err");
  const btn = e.submitter;
  if (btn) btn.disabled = true;
  const { data, error } = await sb
    .from("com_productos")
    .insert(fila)
    .select()
    .single();
  if (btn) btn.disabled = false;
  if (error) return dbError(error, "No se pudo guardar el producto");
  $("#dlg-producto").close();
  await cargarProductos();
  $("#f-tipo").value = data.tipo_producto;
  refrescarProductos(data.id);
  toast("Producto agregado", "ok");
});

/* ---------- eliminar (ocultar) producto ---------- */
async function desactivarProducto(p) {  
  if (!p) return;
  if (
    !(await confirmar(
      "Eliminar producto",
      `¿Eliminar "${p.nombre_producto}" de la lista de productos?\n\nLas cotizaciones y órdenes anteriores no se pierden.`,
      "Eliminar",
    ))
  )
    return;
  const { error } = await sb.from('com_productos').delete().eq('id', p.id);
  if (error) return dbError(error, "No se pudo eliminar el producto");
  await cargarProductos();
  if (
    $("#f-producto").value &&
    !state.productos.some((p) => p.id === Number($("#f-producto").value))
  ) {
    refrescarProductos(null);
  }
  toast("Producto eliminado", "ok");
}

/* ---------- tabla de productos ---------- */
function renderTablaProductos() {
  const q = norm($("#q-productos").value);
  const lista = state.productos.filter(
    (p) =>
      !q ||
      norm(`${p.tipo_producto} ${p.nombre_producto} ${p.descripcion}`).includes(
        q,
      ),
  );
  $("#tbl-productos tbody").innerHTML = lista
    .map(
      (p) => `
    <tr><td>${esc(p.tipo_producto)}</td><td><b>${esc(p.nombre_producto)}</b></td><td>${esc(p.descripcion)}</td><td>${esc(p.unidad_medida)}</td>
    <td class="row-actions"><button class="icon-btn danger" data-del-prod="${p.id}" title="Eliminar" aria-label="Eliminar">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/></svg></button></td></tr>`,
    )
    .join("");
  $("#hint-productos-2").hidden = state.productos.length > 0;
}
$("#q-productos").addEventListener("input", renderTablaProductos);
$("#tbl-productos").addEventListener("click", (e) => {
  const b = e.target.closest("[data-del-prod]");
  if (b)
    desactivarProducto(
      state.productos.find((p) => p.id === Number(b.dataset.delProd)),
    );
});

/* ---------- agregar / eliminar PRODUCTO desde la cotización ---------- */
$("#btn-add-producto").addEventListener("click", () => {
  abrirDialogoProducto(); // reutiliza el diálogo existente (prellena el tipo actual)
});

async function eliminarProductoSeleccionado() {
  const p = productoSeleccionado();
  if (!p) return toast("Primero elige el producto a eliminar.", "err");
  await desactivarProducto(p); // usa el confirmar() bonito que ya tiene
}
$("#btn-del-producto").addEventListener("click", eliminarProductoSeleccionado);

/* =====================================================================
   PROVEEDORES (tabla y alta)
   ===================================================================== */
function renderTablaProveedores() {
  const q = norm($("#q-proveedores").value);
  const lista = state.proveedores
    .filter(
      (p) =>
        !q ||
        norm(`${p.nombre} ${p.nit} ${p.ciudad} ${p.rep_ventas}`).includes(q),
    )
    .slice(0, 400);
  $("#tbl-proveedores tbody").innerHTML = lista
    .map(
      (p) => `
    <tr>
      <td><b>${esc(p.nombre)}</b></td>
      <td>${esc(p.nit)}</td>
      <td>${esc(p.telefono)}</td>
      <td>${esc(p.direccion)}</td>
      <td>${esc(p.ciudad)}</td>
      <td>${esc(p.email)}</td>
      <td class="row-actions">
        <button class="icon-btn danger" data-del-prov="${p.id}" title="Eliminar" aria-label="Eliminar proveedor">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/></svg>
        </button>
      </td>
    </tr>`,
    )
    .join("");
}
$("#q-proveedores").addEventListener("input", renderTablaProveedores);
$("#btn-nuevo-proveedor").addEventListener("click", () => {
  $("#frm-proveedor").reset();
  $("#dlg-proveedor").showModal();
});
$("#frm-proveedor").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  Object.keys(f).forEach((k) => (f[k] = f[k].trim() || null));
  if (!f.nombre) return toast("Escribe el nombre del proveedor.", "err");
  if (state.proveedores.some((p) => norm(p.nombre) === norm(f.nombre)))
    return toast("Ya existe un proveedor con ese nombre.", "err");
  const { error } = await sb.from("com_proveedores").insert(f);
  if (error) return dbError(error, "No se pudo guardar el proveedor");
  $("#dlg-proveedor").close();
  await cargarProveedores();
  toast("Proveedor agregado", "ok");
});
$("#tbl-proveedores").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-del-prov]");
  if (!b) return;
  const p = state.proveedores.find((x) => x.id === Number(b.dataset.delProv));
  if (!p) return;
  const ok = await confirmar(
    "Eliminar proveedor",
    `¿Eliminar a "${p.nombre}" de la lista?\n\nLas órdenes anteriores no se pierden.`,
    "Eliminar",
  );
  if (!ok) return;
 const { error } = await sb.from('com_proveedores').delete().eq('id', p.id);
  if (error) return dbError(error, "No se pudo eliminar el proveedor");
  await cargarProveedores();
  toast("Proveedor eliminado", "ok");
});

/* =====================================================================
   FORMULARIO DE COTIZACIÓN: tarjetas de proveedor
   ===================================================================== */
function grupoChips(titulo, nombre, opciones, i) {
  return (
    `<div class="group"><span class="lbl">${titulo}</span><div class="chips">` +
    opciones
      .map(
        ([v, t]) =>
          `<label class="chip"><input type="radio" name="${nombre}-${i}" value="${v}"><span>${t}<b></b></span></label>`,
      )
      .join("") +
    `</div></div>`
  );
}

function tarjetaProveedor(i) {
  return `
  <article class="card prov" data-i="${i}">
    <div class="ribbon" hidden>MEJOR OPCIÓN</div>
    <h3>Proveedor ${i + 1}${i === 2 ? " <small>(opcional)</small>" : ""}</h3>
   <label class="field">Proveedor
  <select class="f-prov">
    <option value="">Selecciona…</option>
  </select>
</label>
    <div class="prov-info"></div>
    <label class="field">Precio unitario
      <input class="f-precio" type="number" min="0" step="any" inputmode="decimal" placeholder="0">
    </label>
    ${grupoChips("Condiciones comerciales", "cond", COND, i)}
    <div class="group"><span class="lbl">Precio — puntaje automático</span>
      <div class="auto-precio"><span class="ap-texto">Ingresa los precios</span><b class="ap-pts"></b></div></div>
    ${grupoChips("Oportunidad en la entrega", "opor", OPOR, i)}
    ${grupoChips("Calidad del insumo / servicio", "cali", CALI, i)}
    <div class="group"><span class="lbl">Garantía</span>
      <div class="chips inline">
        <label class="chip"><input type="radio" name="gar-${i}" value="SI"><span>SÍ<b></b></span></label>
        <label class="chip"><input type="radio" name="gar-${i}" value="NO"><span>NO<b></b></span></label>
      </div>
      <label class="field dias-box" hidden>Días de garantía
        <input class="f-dias" type="number" min="0" step="1" inputmode="numeric" placeholder="0">
      </label>
    </div>
    <div class="total"><span>Total puntos</span><div><b class="f-total">—</b><small>/ 15</small></div></div>
  </article>`;
}

function pintarProveedores() {
  $("#provs").innerHTML = [0, 1, 2].map(tarjetaProveedor).join("");
  llenarSelectsProveedor();
}

/* Rellena los <select> de proveedor con la lista cargada */
function llenarSelectsProveedor() {
  const opciones = state.proveedores
    .map((p) => `<option value="${esc(p.nombre)}">${esc(p.nombre)}</option>`)
    .join("");
  $$(".f-prov").forEach((sel) => {
    const actual = sel.value;
    sel.innerHTML = '<option value="">Selecciona…</option>' + opciones;
    if (actual) sel.value = actual;
  });
}

function proveedorPorNombre(nombre) {
  const n = norm(nombre.trim());
  return n ? state.proveedores.find((p) => norm(p.nombre) === n) || null : null;
}

function actualizarInfoProveedor(el) {
  const p = proveedorPorNombre($(".f-prov", el).value);
  $(".prov-info", el).innerHTML = p
    ? `Tel: ${esc(p.telefono || "—")}<br>${esc(p.direccion || "—")}${p.ciudad ? " · " + esc(p.ciudad) : ""}`
    : $(".f-prov", el).value.trim()
      ? '<span style="color:#c0392b">No está en la lista de proveedores</span>'
      : "";
}

/* =====================================================================
   CÁLCULO DE PUNTOS (misma lógica del Excel, con precio automático)
   ===================================================================== */
function leerProveedores() {
  return $$(".prov").map((el, i) => {
    const nombre = $(".f-prov", el).value.trim();
    const radio = (n) => {
      const r = $(`input[name="${n}-${i}"]:checked`, el);
      return r ? r.value : null;
    };
    const precio = parseFloat($(".f-precio", el).value);
    return {
      i,
      el,
      nombre,
      prov: proveedorPorNombre(nombre),
      precio: Number.isFinite(precio) ? precio : null,
      cond: num(radio("cond")),
      opor: num(radio("opor")),
      cali: num(radio("cali")),
      gar: radio("gar"),
      dias: parseInt($(".f-dias", el).value, 10) || 0,
    };
  });
}

/* Garantía: se compara contra los días de los otros proveedores (quien no da garantía cuenta 0).
   Más días que todos = 3 · menos que todos = 1 · en medio o empate = 2 · sin garantía = 0 */
function puntosGarantia(p, activos) {
  if (p.gar === "NO") return 0;
  if (p.gar !== "SI") return null;
  const otros = activos
    .filter((o) => o !== p)
    .map((o) => (o.gar === "SI" ? o.dias : 0));
  if (!otros.length) return 2;
  if (otros.every((d) => p.dias > d)) return 3;
  if (otros.every((d) => p.dias < d)) return 1;
  return 2;
}

/* Precio: el más barato = 3, el del medio = 2, el más caro = 1 (todos iguales = 2) */
function puntosPrecio(p, activos) {
  const precios = activos.filter((a) => a.precio > 0).map((a) => a.precio);
  if (!(p.precio > 0) || precios.length < 2) return null;
  const min = Math.min(...precios),
    max = Math.max(...precios);
  if (min === max) return 2;
  return p.precio === min ? 3 : p.precio === max ? 1 : 2;
}

/* Texto estilo Excel para el precio */
function textoPrecio(pts) {
  if (pts === 3) return "Más económico al Prom";
  if (pts === 1) return "Más costoso al promedio";
  if (pts === 2) return "Precio promedio";
  return "Ingresa los precios";
}

function calcular() {
  const todos = leerProveedores();
  const activos = todos.filter((p) => p.nombre || p.precio !== null);
  const problemas = [];

  // La cantidad es obligatoria: sin ella no se calcula nada
  const cant = parseFloat($("#f-cantidad").value);
  const faltaCantidad = !(cant > 0);
  const faltaTipo = !$("#f-tipo").value;

  // Puntajes por proveedor (solo si hay cantidad)
  activos.forEach((p) => {
    p.sPrecio = puntosPrecio(p, activos);
    p.sGar = puntosGarantia(p, activos);

    const faltan = [];
    if (!p.prov)
      faltan.push(
        p.nombre ? "elegir un proveedor de la lista" : "elegir el proveedor",
      );
    if (!(p.precio > 0)) faltan.push("el precio");
    if (p.cond === null) faltan.push("condiciones comerciales");
    if (p.opor === null) faltan.push("oportunidad en la entrega");
    if (p.cali === null) faltan.push("calidad");
    if (p.gar === null) faltan.push("garantía");
    p.completo = faltan.length === 0;
    if (faltan.length)
      problemas.push(`Proveedor ${p.i + 1}: falta ${faltan.join(", ")}.`);
    p.total = p.completo ? p.cond + p.sPrecio + p.opor + p.cali + p.sGar : null;
  });

  if (faltaTipo) problemas.unshift("Elige el tipo de producto.");
  if (faltaCantidad) problemas.unshift("Escribe la cantidad.");

  // Si falta la cantidad, NO hay ganador (aunque todo lo demás esté bien)
  let ganador = null,
    empate = false;
  if (!problemas.length && !faltaCantidad && !faltaTipo) {
    const orden = [...activos].sort(
      (a, b) => b.total - a.total || a.precio - b.precio,
    );
    ganador = orden[0];
    const top = orden.filter((p) => p.total === ganador.total);
    empate = top.length > 1;
  }

  return {
    todos,
    activos,
    problemas,
    ganador,
    empate,
    faltaCantidad,
    faltaTipo,
  };
}

/* Pinta resultados en las tarjetas */
function pintarResultado(r, explicito = false) {
  r.todos.forEach((p) => {
    const el = p.el;
    const act = r.activos.includes(p);
    // Si falta la cantidad, no mostramos total (queda "—")
    const mostrarTotal = act && p.total !== null && !r.faltaCantidad;
    $(".f-total", el).textContent = mostrarTotal ? p.total : "—";

    const ap = $(".ap-texto", el),
      pts = $(".ap-pts", el);
    if (act && p.sPrecio && !r.faltaCantidad) {
      ap.textContent = textoPrecio(p.sPrecio);
      pts.textContent = p.sPrecio;
    } else {
      ap.textContent = textoPrecio(null);
      pts.textContent = "";
    }

    $(".dias-box", el).hidden = p.gar !== "SI";
    const esG = r.ganador === p;
    el.classList.toggle("winner", esG);
    $(".ribbon", el).hidden = !esG;
  });

  const box = $("#resumen");
  if (r.ganador) {
    const g = r.ganador;
    box.className = "resumen ok";
    box.innerHTML =
      `<b>Proveedor ganador: ${esc(g.prov.nombre)}</b> con ${g.total} puntos.` +
      (r.empate
        ? "<br>Hubo empate en puntos: se desempató por el menor precio."
        : "");
    box.hidden = false;
  } else if (explicito && r.problemas.length) {
    box.className = "resumen warn";
    box.innerHTML =
      "<b>Aún no se puede calcular el ganador:</b><ul>" +
      r.problemas.map((x) => `<li>${esc(x)}</li>`).join("") +
      "</ul>";
    box.hidden = false;
  } else box.hidden = true;
}

function refrescar(explicito = false) {
  const r = calcular();
  if (explicito) {
    pintarResultado(r, true);
    state.ultimoCalculo = r;
  } else {
    // Al modificar datos, ocultamos el resultado anterior hasta pulsar Calcular
    pintarResultado(
      {
        todos: r.todos,
        activos: r.activos,
        problemas: [],
        ganador: null,
        empate: false,
        faltaCantidad: true,
      },
      false,
    );
    state.ultimoCalculo = null;
  }
  return r;
}

$("#provs").addEventListener("input", (e) => {
  if (e.target.classList.contains("f-prov"))
    actualizarInfoProveedor(e.target.closest(".prov"));
  refrescar();
});
$("#provs").addEventListener("change", (e) => {
  if (e.target.classList.contains("f-prov"))
    actualizarInfoProveedor(e.target.closest(".prov"));
  refrescar();
});
$("#btn-calcular").addEventListener("click", () => {
  const r = refrescar(true);
  if (!r.ganador) toast("Faltan datos para calcular.", "err");
  $("#resumen").scrollIntoView({ behavior: "smooth", block: "center" });
});

$("#btn-reset").addEventListener("click", async () => {
  if ($$(".f-prov").some((i) => i.value) || $("#f-cantidad").value) {
    const ok = await confirmar(
      "Limpiar cotización",
      "¿Limpiar toda la cotización?",
      "Sí, limpiar",
    );
    if (!ok) return;
  }
  resetFormulario();
});

function resetFormulario() {
  state.guardado = null;
  state.ultimoCalculo = null;
  refrescarSelectores(); // tipos SIEMPRE + producto en "Primero elige el tipo"
  $("#f-descripcion").value = "";
  $("#f-unidad").value = "";
  $("#f-cantidad").value = "";
  pintarProveedores();
  $$(".prov").forEach((el) => actualizarInfoProveedor(el));
  $("#resumen").hidden = true;
}

/* =====================================================================
   GUARDAR: cotización -> (opcional) orden de compra
   ===================================================================== */
function validarParaGuardar() {
  const p = productoSeleccionado();
  const cant = parseFloat($("#f-cantidad").value);
  const errores = [];
  if (!p) errores.push("Elige el producto.");
  if (!(cant > 0)) errores.push("Escribe la cantidad.");
  const r = calcular();
  if (!r.ganador) errores.push(...r.problemas);
  return { p, cant, r, errores };
}

$("#btn-guardar").addEventListener("click", () => {
  const v = validarParaGuardar();
  if (v.errores.length) {
    toast(v.errores[0], "err");
    if (!v.r.ganador)
      $("#resumen").scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  const g = v.r.ganador;
  const dlg = $("#dlg-oc"),
    f = $("#frm-oc");
  $("#oc-resumen").innerHTML =
    `Ganador: <b>${esc(g.prov.nombre)}</b> · ${g.total} puntos · ${esc(v.p.nombre_producto)} × ${v.cant}`;
  f.dias_plazo.value = g.cond === 3 ? 0 : g.cond === 2 ? 30 : 60;
  f.iva_pct.value = CONFIG.IVA_DEFECTO;
  f.descuento_valor.value = 0;
  f.elaboro.value = localStorage.getItem("oc_elaboro") || "";
  f.aprobo.value = localStorage.getItem("oc_aprobo") || "";
  dlg.showModal();
});

function datosFormularioOC() {
  const f = $("#frm-oc");
  return {
    fecha_entrega: f.fecha_entrega.value || null,
    dias_plazo: parseInt(f.dias_plazo.value, 10) || 0,
    iva_pct: parseFloat(f.iva_pct.value) || 0,
    descuento_valor: parseFloat(f.descuento_valor.value) || 0,
    descuento_tipo: f.descuento_tipo.value || null,
    contribuyente: f.contribuyente.value || null,
    regimen: f.regimen.value || null,
    factura_cotizacion: f.factura_cotizacion.value.trim() || null,
    autorretenedor: f.autorretenedor.value || null,
    gravada: f.gravada.value || null,
    elaboro: f.elaboro.value.trim() || null,
    aprobo: f.aprobo.value.trim() || null,
    observaciones: f.observaciones.value.trim() || null,
  };
}

async function guardarCotizacion(v) {
  if (state.guardado) return state.guardado.cotId;
  const g = v.r.ganador;
  const { data: cot, error } = await sb
    .from("com_cotizaciones")
    .insert({
      fecha: today(),
      producto_id: v.p.id,
      producto: v.p.nombre_producto,
      descripcion: $("#f-descripcion").value.trim() || null,
      unidad_medida: v.p.unidad_medida,
      cantidad: v.cant,
      proveedor_ganador_id: g.prov.id,
      estado: "Guardada",
    })
    .select()
    .single();
  if (error) throw error;
  const filas = v.r.activos.map((p) => ({
    cotizacion_id: cot.id,
    proveedor_id: p.prov.id,
    precio: p.precio,
    cond_comerciales: p.cond,
    calificacion_precio: p.sPrecio,
    oportunidad: p.opor,
    calidad: p.cali,
    garantia: p.gar === "SI",
    dias_garantia: p.gar === "SI" ? p.dias : 0,
    total_puntos: p.total,
    es_ganador: p === g,
  }));
  const { error: e2 } = await sb
    .from("com_cotizacion_proveedores")
    .insert(filas);
  if (e2) throw e2;
  state.guardado = { cotId: cot.id };
  return cot.id;
}

async function procesarGuardado(generarOrden) {
  const v = validarParaGuardar();
  if (v.errores.length) return toast(v.errores[0], "err");
  const g = v.r.ganador;
  const d = datosFormularioOC();
  const botones = $$("#dlg-oc button");
  botones.forEach((b) => (b.disabled = true));
  try {
    const cotId = await guardarCotizacion(v);
    if (!generarOrden) {
      $("#dlg-oc").close();
      toast("Cotización guardada", "ok");
      resetFormulario();
      return;
    }
    const bruto = g.precio * v.cant;
    const sub = Math.max(bruto - d.descuento_valor, 0);
    const iva = Math.round(sub * d.iva_pct) / 100;
    const total = sub + iva;
    const prov = g.prov;
    const { data: oc, error } = await sb
      .from("com_ordenes_compra")
      .insert({
        rep_ventas: prov.rep_ventas || null,
        fax: prov.telefono || null,
        autorretenedor: d.autorretenedor || null,
        gravada: d.gravada || null,
        factura_cotizacion: d.factura_cotizacion || null,
        // las rojas quedan vacías al crear; se llenan luego en la base:
        especificaciones_tecnicas: null,
        cumplimiento: null,
        precio_eval: null,
        apoyo_tecnico: null,
        pedido_completo: null,
        promedio: null,
        cotizacion_id: cotId,
        fecha_pedido: today(),
        fecha_entrega: d.fecha_entrega,
        proveedor_id: prov.id,
        proveedor_nombre: prov.nombre,
        proveedor_nit: prov.nit,
        proveedor_telefono: prov.telefono,
        proveedor_direccion: prov.direccion,
        proveedor_email: prov.email,
        proveedor_ciudad: prov.ciudad,
        producto: v.p.nombre_producto,
        descripcion: $("#f-descripcion").value.trim() || null,
        unidad_medida: v.p.unidad_medida,
        cantidad: v.cant,
        precio_unitario: g.precio,
        condiciones_pago: g.cond === 3 ? "Contado" : "Crédito",
        dias_plazo: d.dias_plazo,
        garantia: g.gar,
        dias_garantia: g.gar === "SI" ? g.dias : 0,
        puntaje: g.total,
        valor_bruto: bruto,
        descuento_valor: d.descuento_valor,
        iva,
        valor_total: total,
        descuento_tipo: d.descuento_tipo,
        contribuyente: d.contribuyente,
        regimen: d.regimen,
        elaboro: d.elaboro,
        aprobo: d.aprobo,
        observaciones: d.observaciones,
        estado: "Vigente",
      })

      .select("*, com_proveedores(rep_ventas)")
      .single();
    if (error) throw error;
    if (d.elaboro) localStorage.setItem("oc_elaboro", d.elaboro);
    if (d.aprobo) localStorage.setItem("oc_aprobo", d.aprobo);
    $("#dlg-oc").close();
    resetFormulario();
    state.volverA = "cotizacion";
    mostrarOrden(oc, d.iva_pct);
    toast(`Orden de compra N° ${pad(oc.consecutivo)} generada`, "ok");
  } catch (e) {
    dbError(
      e,
      state.guardado
        ? "La cotización se guardó pero no se pudo crear la orden"
        : "No se pudo guardar",
    );
  } finally {
    botones.forEach((b) => (b.disabled = false));
  }
}

$("#frm-oc").addEventListener("submit", (e) => {
  e.preventDefault();
  procesarGuardado(true);
});

/* cierre genérico de diálogos */
document.addEventListener("click", (e) => {
  if (e.target.closest("[data-close]")) e.target.closest("dialog").close();
});

/* =====================================================================
   ORDEN DE COMPRA (réplica del formato 08F-03)
   ===================================================================== */
function ivaPorcentaje(oc, pctForzado) {
  if (pctForzado !== undefined) return pctForzado;
  const sub = (oc.valor_bruto || 0) - (oc.descuento_valor || 0);
  return sub > 0
    ? Math.round((oc.iva / sub) * 10000) / 100
    : CONFIG.IVA_DEFECTO;
}

function ocHTML(oc, ivaPct) {
  const box = (on) => `<i class="box${on ? " on" : ""}"></i>`;
  const sub = (oc.valor_bruto || 0) - (oc.descuento_valor || 0);
  const rep = oc.com_proveedores?.rep_ventas || "";
  const filas = [
    `<tr>
      <td class="c">1</td><td>${esc(oc.producto)}</td><td>${esc(oc.descripcion)}</td>
      <td class="c">${esc(oc.unidad_medida)}</td><td class="n">${esc(oc.cantidad)}</td>
      <td class="n">${money(oc.precio_unitario)}</td><td class="n">${money(oc.valor_bruto)}</td></tr>`,
  ];
  for (let i = 0; i < 13; i++)
    filas.push(
      "<tr><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>",
    );
  const L = (k, v) =>
    `<div class="oc-line"><span class="k">${k}</span><span class="v">${esc(v)}</span></div>`;
  return `
  <div class="oc-sheet" id="oc-sheet">
    <div class="oc-head">
      <div><img src="logo.png" alt="Conequipos"><div class="nit">NIT 800.039.236-2</div></div>
      <div class="oc-title"><h1>ORDEN DE COMPRA</h1>Calle 86 No 51-39 ITAGÜÍ<br>Telefax (4) 4441331 ó 5602850<br>E-mail: logistica@conequipos.com.co</div>
      <div class="oc-no">No <b>${pad(oc.consecutivo)}</b></div>
    </div>

    <div class="oc-sec">DATOS DEL PROVEEDOR</div>
    <div class="oc-grid">
      <div>${L("PROVEEDOR", oc.proveedor_nombre)}${L("DIRECCIÓN", oc.proveedor_direccion)}${L("CIUDAD", oc.proveedor_ciudad)}${L("REPRESENTANTE DE VENTAS", rep)}</div>
      <div>${L("TELÉFONO", oc.proveedor_telefono)}${L("NIT", oc.proveedor_nit)}${L("E-MAIL", oc.proveedor_email)}${L("FECHA PEDIDO", fmtDate(oc.fecha_pedido))}</div>
    </div>

    <div class="oc-sec">CONDICIONES COMERCIALES</div>
    <div class="oc-grid">
      <div>${L("PLAZO", oc.condiciones_pago)}${L("DÍAS", oc.dias_plazo)}</div>
      <div>${L("FECHA DE ENTREGA", fmtDate(oc.fecha_entrega))}
        <div class="oc-line"><span class="k">GARANTÍA</span><span class="v">${oc.garantia === "SI" ? "SÍ" + (oc.dias_garantia ? " · " + oc.dias_garantia + " días" : "") : "NO"}</span></div></div>
    </div>

    <div class="oc-grid" style="margin-top:6px">
      <div>
        <div class="oc-opts"><span class="k">DESCUENTO:</span><span>${box(oc.descuento_tipo === "Condicionado")}Condicionado</span><span>${box(oc.descuento_tipo === "Pie factura")}Pie factura</span></div>
        <div class="oc-opts"><span class="k">CONTRIBUYENTE:</span><span>${box(oc.contribuyente === "Pequeño")}Pequeño</span><span>${box(oc.contribuyente === "Grande")}Grande</span></div>
        <div class="oc-opts"><span class="k">RÉGIMEN:</span><span>${box(oc.regimen === "Común")}Común</span><span>${box(oc.regimen === "Simplificado")}Simplificado</span></div>
        <div class="oc-opts"><span class="k">AUTORRETENEDOR:</span><span>${box((oc.autorretenedor || "").toLowerCase().startsWith("s"))}Sí</span><span>${box((oc.autorretenedor || "").toLowerCase().startsWith("n"))}No</span></div>
        <div class="oc-opts"><span class="k">GRAVADA:</span><span>${box((oc.gravada || "").toLowerCase().startsWith("s"))}Sí</span><span>${box((oc.gravada || "").toLowerCase().startsWith("n"))}No</span></div>

      </div>
      <div>${L("IVA", ivaPct + "%")}</div>
    </div>

    <table class="oc-items">
      <colgroup><col style="width:5%"><col style="width:20%"><col style="width:27%"><col style="width:9%"><col style="width:9%"><col style="width:14%"><col style="width:16%"></colgroup>
      <thead><tr><th>ITEM</th><th>PRODUCTO</th><th>DESCRIPCIÓN</th><th>UNIDAD</th><th>CANT.</th><th>VR. UNITARIO</th><th>VALOR TOTAL</th></tr></thead>
      <tbody>${filas.join("")}</tbody>
    </table>
    <table class="oc-tot">
      <tr><th>TOTAL BRUTO</th><th>DESCUENTO GLOBAL</th><th>SUBTOTAL</th><th>IVA</th><th>VALOR TOTAL</th></tr>
      <tr><td>${money(oc.valor_bruto)}</td><td>${money(oc.descuento_valor)}</td><td>${money(sub)}</td><td>${money(oc.iva)}</td><td>${money(oc.valor_total)}</td></tr>
    </table>
    <div class="oc-obs">${esc(oc.observaciones)}</div>
    <div class="oc-sign">${L("ELABORÓ:", oc.elaboro)}${L("APROBÓ:", oc.aprobo)}</div>
    <div class="oc-note">NOTA: Toda factura debe ser original y copia. No debe presentar tachones ni enmendadura.</div>
    <div class="oc-foot"><span>Versión 01<br>SISTEMA DE GESTIÓN DE LA CALIDAD</span><span style="text-align:right">Aprobado: 05/08/2008<br>08F-03</span></div>
  </div>`;
}

function mostrarOrden(oc, ivaPct) {
  state.ordenActual = oc;
  $("#oc-host").innerHTML = ocHTML(oc, ivaPorcentaje(oc, ivaPct));
  showView("orden");
}

$("#btn-orden-volver").addEventListener("click", () =>
  showView(state.volverA || "cotizacion"),
);
$("#btn-orden-imprimir").addEventListener("click", () => window.print());
$("#btn-orden-pdf").addEventListener("click", async () => {
  const oc = state.ordenActual;
  if (!oc) return;
  const btn = $("#btn-orden-pdf");
  btn.disabled = true;
  btn.textContent = "Generando…";
  try {
    const nombre = `OC_${pad(oc.consecutivo)}_${(oc.proveedor_nombre || "").replace(/[^\w]+/g, "_").slice(0, 30)}.pdf`;
    await html2pdf()
      .set({
        margin: [6, 6, 6, 6],
        filename: nombre,
        image: { type: "jpeg", quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, scrollX: 0, scrollY: 0 },
        jsPDF: { unit: "mm", format: "letter", orientation: "portrait" },
      })
      .from($("#oc-sheet"))
      .save();
  } catch (e) {
    console.error(e);
    toast(
      'No se pudo generar el PDF. Usa "Imprimir" y elige Guardar como PDF.',
      "err",
    );
  }
  btn.disabled = false;
  btn.textContent = "Descargar PDF";
});

/* =====================================================================
   ÓRDENES (la "base de datos" que ve la señora)
   ===================================================================== */
async function cargarOrdenes() {
  const { data, error } = await sb
    .from("com_base_ordenes")
    .select("*")
    .limit(5000);
  if (error) return dbError(error, "No se pudieron cargar las órdenes");
  // ascendente por número de orden (0001, 0002...) y ocultar "Eliminada"
  state.ordenes = (data || [])
    .filter((o) => o.estado !== "Eliminada")
    .sort((a, b) => Number(a.orden_compra) - Number(b.orden_compra));
  renderOrdenes();
}
function renderOrdenes() {
  const q = norm($("#q-ordenes").value);
  const lista = state.ordenes.filter(
    (o) =>
      !q ||
      norm(
        `${o.orden_compra} ${o.proveedor} ${o.producto_o_servicio} ${o.nit}`,
      ).includes(q),
  );

  const filas = lista
    .map(
      (o) => `
    <tr>
      <td>${esc(o.ctd)}</td>
      <td><b>${pad(o.orden_compra)}</b></td>
      <td>${fmtDate(o.fecha_pedido)}</td>
      <td>${esc(o.anio)}</td>
      <td>${esc(o.factura_cotizacion)}</td>
      <td>${esc(o.proveedor)}</td>
      <td>${esc(o.direccion_electronica)}</td>
      <td>${esc(o.ciudad)}</td>
      <td>${esc(o.representante_de_ventas)}</td>
      <td>${esc(o.producto_o_servicio)}</td>
      <td>${esc(o.tel)}</td>
      <td>${esc(o.direccion)}</td>
      <td>${esc(o.nit)}</td>
      <td>${esc(o.fax)}</td>
      <td>${fmtDate(o.fecha_de_entrega)}</td>
      <td>${esc(o.contribuyente)}</td>
      <td>${esc(o.regimen)}</td>
      <td>${esc(o.autorretenedor)}</td>
      <td>${esc(o.gravada)}</td>
      <td class="num">${money(o.valor_compra)}</td>
      <td>${esc(o.observaciones)}</td>
      <td class="eval">${esc(o.especificaciones_tecnicas)}</td>
      <td class="eval">${esc(o.cumplimiento)}</td>
      <td class="eval">${esc(o.precio)}</td>
      <td class="eval">${esc(o.apoyo_tecnico)}</td>
      <td class="eval">${esc(o.pedido_completo)}</td>
      <td class="eval">${esc(o.promedio)}</td>
      <td><span class="tag ${o.estado === "Vigente" ? "" : "off"}">${esc(o.estado)}</span></td>
      <td class="row-actions">
        <button class="btn ghost small" data-ver="${o.orden_compra}">Ver / PDF</button>
        ${o.estado === "Vigente" ? `<button class="btn ghost small" data-anular="${o.orden_compra}">Anular</button>` : ""}
        <button class="icon-btn danger" data-del-orden="${o.orden_compra}" title="Eliminar" aria-label="Eliminar orden">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/></svg>
        </button>
      </td>
    </tr>`,
    )
    .join("");

  $("#tbl-ordenes tbody").innerHTML = filas;
  $("#hint-ordenes").hidden = state.ordenes.length > 0;
}

$("#q-ordenes").addEventListener("input", renderOrdenes);

$("#tbl-ordenes").addEventListener("click", async (e) => {
  const ver = e.target.closest("[data-ver]");
  const anu = e.target.closest("[data-anular]");
  const del = e.target.closest("[data-del-orden]");

  if (ver) {
    const { data, error } = await sb
      .from("com_ordenes_compra")
      .select("*, com_proveedores(rep_ventas)")
      .eq("consecutivo", ver.dataset.ver)
      .single();
    if (error) return dbError(error, "No se pudo abrir la orden");
    state.volverA = "ordenes";
    mostrarOrden(data);
  }

  if (anu) {
    const ok = await confirmar(
      "Anular orden",
      `¿Anular la orden de compra N° ${pad(anu.dataset.anular)}?`,
      "Anular",
    );
    if (!ok) return;
    const { error } = await sb
      .from("com_ordenes_compra")
      .update({ estado: "Anulada" })
      .eq("consecutivo", anu.dataset.anular);
    if (error) return dbError(error, "No se pudo anular");
    toast("Orden anulada", "ok");
    cargarOrdenes();
  }

if (del) {
  const ok = await confirmar('Eliminar orden', `¿Eliminar la orden N° ${pad(del.dataset.delOrden)} definitivamente?`, 'Eliminar');
  if (!ok) return;
  const cons = del.dataset.delOrden;
  // buscar la orden para saber su cotización
  const { data: oc } = await sb.from('com_ordenes_compra').select('id, cotizacion_id').eq('consecutivo', cons).single();
  const { error } = await sb.from('com_ordenes_compra').delete().eq('consecutivo', cons);
  if (error) return dbError(error, 'No se pudo eliminar la orden');
  if (oc?.cotizacion_id) {
    await sb.from('com_cotizacion_proveedores').delete().eq('cotizacion_id', oc.cotizacion_id);
    await sb.from('com_cotizaciones').delete().eq('id', oc.cotizacion_id);
  }
  toast('Orden eliminada', 'ok');
  cargarOrdenes();
}
});

/* Descarga a Excel respetando el orden y colores del Excel original:
   columnas verdes hasta OBSERVACIONES, columnas rojas de evaluación al final */
$('#btn-excel').addEventListener('click', () => {
  if (!state.ordenes.length) return toast('No hay órdenes para descargar.', 'err');

  const cols = [
    ['ctd', 'CTD', 'verde'],
    ['orden_compra', 'ORDEN DE COMPRA', 'verde'],
    ['fecha_pedido', 'FECHA PEDIDO', 'verde'],
    ['anio', 'AÑO', 'verde'],
    ['factura_cotizacion', 'FACTURA O COTIZACION', 'verde'],
    ['proveedor', 'PROVEEDOR', 'verde'],
    ['direccion_electronica', 'DIRECCION ELECTRONICA', 'verde'],
    ['ciudad', 'CIUDAD', 'verde'],
    ['representante_de_ventas', 'REPRESENTANTE DE VENTAS', 'verde'],
    ['producto_o_servicio', 'PRODUCTO O SERVICIO QUE SUMINISTRA', 'verde'],
    ['tel', 'TEL', 'verde'],
    ['direccion', 'DIRECCION', 'verde'],
    ['nit', 'NIT', 'verde'],
    ['fax', 'FAX', 'verde'],
    ['fecha_de_entrega', 'FECHA DE ENTREGA', 'verde'],
    ['contribuyente', 'CONTRIBUYENTE', 'verde'],
    ['regimen', 'REGIMEN', 'verde'],
    ['autorretenedor', 'AUTORRETENEDOR', 'verde'],
    ['gravada', 'GRAVADA', 'verde'],
    ['valor_compra', 'VALOR COMPRA', 'verde'],
    ['observaciones', 'OBSERVACIONES', 'verde'],
    ['especificaciones_tecnicas', 'ESPECIFICACIONES TECNICAS', 'rojo'],
    ['cumplimiento', 'CUMPLIMIENTO', 'rojo'],
    ['precio', 'PRECIO', 'rojo'],
    ['apoyo_tecnico', 'APOYO TECNICO', 'rojo'],
    ['pedido_completo', 'PEDIDO COMPLETO', 'rojo'],
    ['promedio', 'PROMEDIO', 'rojo']
  ];

  const celda = v => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const head = cols.map(([, label, color]) =>
    `<th style="background:${color === 'rojo' ? '#ff0000' : '#00b050'};color:#fff;border:1px solid #000;font-weight:bold;padding:4px">${label}</th>`
  ).join('');

  const body = state.ordenes.map(o =>
    '<tr>' + cols.map(([key, , color]) =>
      `<td style="border:1px solid #000;padding:3px;${color === 'rojo' ? 'background:#ffcccc' : ''}">${celda(o[key])}</td>`
    ).join('') + '</tr>'
  ).join('');

  const html =
    '<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"></head><body>' +
    '<table style="border-collapse:collapse">' +
    `<thead><tr>${head}</tr></thead><tbody>${body}</tbody>` +
    '</table></body></html>';

  const blob = new Blob(['\ufeff' + html], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `Ordenes_de_compra_${today()}.xls`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('Excel descargado', 'ok');
});

/* =====================================================================
   INICIO
   ===================================================================== */
pintarProveedores();
Promise.all([cargarProductos(), cargarProveedores()]);
