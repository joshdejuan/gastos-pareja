import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } });

// Paleta categórica (validada para daltonismo); en modo oscuro se usa el paso oscuro del mismo tono
const PALETTE = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"];
const DARK = { "#2a78d6": "#3987e5", "#eb6834": "#d95926", "#1baf7a": "#199e70", "#eda100": "#c98500",
               "#e87ba4": "#d55181", "#008300": "#0ca30c", "#6250d6": "#9085e9", "#e34948": "#e66767" };
const darkMq = matchMedia("(prefers-color-scheme: dark)");
const col = (hex) => (darkMq.matches ? DARK[hex?.toLowerCase()] || hex : hex) || "#a8a29e";
const FREQ = { weekly: "cada semana", monthly: "cada mes", yearly: "cada año" };

const app = document.getElementById("app");
const S = { user: null, household: null, members: [], categories: [], month: firstOfMonth(new Date()),
            tx: [], view: "main", catKind: "expense" };

// ---------- utilidades ----------
const eur = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });
const fmt = (c) => eur.format(c / 100);
const monthFmt = new Intl.DateTimeFormat("es-ES", { month: "long", year: "numeric" });
const dayFmt = new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", month: "long" });
const shortFmt = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short" });
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
function firstOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function iso(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
const parseDate = (s) => new Date(s + "T00:00");
function parseCents(str) {
  const m = String(str).trim().match(/^(\d{1,7})(?:[.,](\d{1,2}))?$/);
  if (!m) return null;
  const c = Number(m[1]) * 100 + Number((m[2] || "0").padEnd(2, "0"));
  return c > 0 ? c : null;
}
const centsToInput = (c) => (c / 100).toFixed(2).replace(".", ",").replace(/,00$/, "");
function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "style") Object.assign(n.style, v);
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (k === "aria") for (const [a, b] of Object.entries(v)) n.setAttribute(`aria-${a}`, b);
    else n[k] = v;
  }
  n.append(...kids.filter((k) => k != null));
  return n;
}
const mount = (id) => app.replaceChildren(document.getElementById(id).content.cloneNode(true));
const $ = (s) => app.querySelector(s);
const byId = (id) => document.getElementById(id);
let toastT;
function toast(msg) {
  const t = byId("toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 3200);
}
const nameOf = (uid) => S.members.find((m) => m.user_id === uid)?.display_name ?? "—";
const catOf = (id) => S.categories.find((c) => c.id === id);
function check({ data, error }) { if (error) throw error; return data; }
async function busy(scope, fn) {
  const btns = scope.querySelectorAll("button"); btns.forEach((b) => (b.disabled = true));
  try { await fn(); } catch (e) { toast(friendly(e)); console.error(e); }
  finally { btns.forEach((b) => (b.disabled = false)); }
}
function friendly(e) {
  const m = e?.message || "Algo ha fallado";
  if (/Invalid login/i.test(m)) return "Email o contraseña incorrectos";
  if (/Email not confirmed/i.test(m)) return "Confirma tu email antes de entrar";
  if (/already registered/i.test(m)) return "Ese email ya tiene cuenta";
  if (/categories_name_uq|duplicate/i.test(m)) return "Ya existe una categoría con ese nombre";
  if (/Failed to fetch|NetworkError/i.test(m)) return "Sin conexión";
  return m;
}

// ---------- arranque y navegación ----------
sb.auth.onAuthStateChange((_e, session) => {
  const uid = session?.user?.id ?? null;
  if (uid === (S.user?.id ?? null) && app.dataset.ready) return;
  app.dataset.ready = "1";
  S.user = session?.user ?? null;
  setTimeout(() => route().catch((e) => toast(friendly(e))), 0);
});

async function route() {
  if (!S.user) return showAuth();
  const members = check(await sb.from("household_members").select("user_id, display_name"));
  if (!members.length) return showOnboard();
  S.members = members;
  S.household = check(await sb.from("households").select("id, name, invite_code").single());
  await sb.rpc("run_recurring");        // genera los periódicos que tocaban
  await loadCategories();
  S.view === "settings" ? showSettings() : showMain();
}
async function loadCategories() {
  S.categories = check(await sb.from("categories").select("id, kind, name, color, archived").order("created_at"));
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && S.household && S.view === "main" && !byId("tx-dialog").open) {
    sb.rpc("run_recurring").then(refresh);
  }
});
darkMq.addEventListener("change", () => S.view === "main" ? renderMonth() : S.view === "settings" && renderCats());

// ---------- login ----------
function showAuth() {
  S.view = "auth"; mount("tpl-auth");
  const f = $("#auth-form");
  const creds = () => ({ email: f.email.value.trim(), password: f.password.value });
  f.addEventListener("submit", (e) => { e.preventDefault(); busy(f, async () => check(await sb.auth.signInWithPassword(creds()))); });
  $("#btn-signup").addEventListener("click", () => {
    if (!f.reportValidity()) return;
    busy(f, async () => {
      const d = check(await sb.auth.signUp({ ...creds(), options: { emailRedirectTo: location.href.split("#")[0] } }));
      if (!d.session) toast("Te hemos enviado un email para confirmar la cuenta");
    });
  });
}

// ---------- crear / unirse ----------
function showOnboard() {
  S.view = "onboard"; mount("tpl-onboard");
  const cf = $("#create-form"), jf = $("#join-form");
  cf.addEventListener("submit", (e) => { e.preventDefault(); busy(cf, async () => {
    check(await sb.rpc("create_household", { p_name: cf.hname.value, p_display_name: cf.dname.value })); await route(); }); });
  jf.addEventListener("submit", (e) => { e.preventDefault(); busy(jf, async () => {
    check(await sb.rpc("join_household", { p_code: jf.code.value, p_display_name: jf.dname.value })); await route(); }); });
  $("#btn-logout").addEventListener("click", () => sb.auth.signOut());
}

// ---------- pantalla principal ----------
function showMain() {
  S.view = "main"; mount("tpl-main");
  $("#h-name").textContent = S.household.name;
  if (S.members.length < 2) { $("#invite-banner").hidden = false; $("#invite-code").textContent = S.household.invite_code; }
  $("#m-prev").addEventListener("click", () => moveMonth(-1));
  $("#m-next").addEventListener("click", () => moveMonth(1));
  $("#btn-settings").addEventListener("click", showSettings);
  $("#fab").addEventListener("click", () => openTx());
  refresh();
}
function moveMonth(n) { S.month = new Date(S.month.getFullYear(), S.month.getMonth() + n, 1); refresh(); }

async function refresh() {
  if (S.view !== "main") return;
  $("#m-label").textContent = cap(monthFmt.format(S.month));
  const from = iso(S.month), to = iso(new Date(S.month.getFullYear(), S.month.getMonth() + 1, 1));
  const tx = await sb.from("transactions").select("id, kind, category_id, amount_cents, description, spent_on, recurring_id, created_by")
    .in("kind", ["expense", "income"])
    .gte("spent_on", from).lt("spent_on", to).order("spent_on", { ascending: false }).order("created_at", { ascending: false });
  try {
    S.tx = check(tx);
    if (S.view === "main") renderMonth();
  } catch (e) { toast(friendly(e)); }
}

function renderMonth() {
  const exp = S.tx.filter((t) => t.kind === "expense"), inc = S.tx.filter((t) => t.kind === "income");
  const sum = (a) => a.reduce((s, t) => s + t.amount_cents, 0);
  const tIn = sum(inc), tOut = sum(exp);
  $("#k-in").textContent = fmt(tIn); $("#k-out").textContent = fmt(tOut);
  $("#k-net").textContent = (tIn - tOut < 0 ? "−" : "") + fmt(Math.abs(tIn - tOut));
  renderChart(exp, tOut);
  renderList();
}

function renderChart(exp, total) {
  const box = $("#chart");
  if (!total) { box.replaceChildren(el("p", { className: "muted", textContent: "Sin gastos este mes" })); return; }
  const by = new Map();
  for (const t of exp) by.set(t.category_id, (by.get(t.category_id) || 0) + t.amount_cents);
  const rows = [...by].map(([id, v]) => ({ c: catOf(id) || { name: "Sin categoría", color: "#a8a29e" }, v })).sort((a, b) => b.v - a.v);
  const max = rows[0].v;
  const pct = (v) => Math.round((v / total) * 100);
  const tip = (r) => `${r.c.name}: ${fmt(r.v)} (${pct(r.v)} %)`;
  const stack = el("div", { className: "stack", role: "img", aria: { label: "Reparto del gasto: " + rows.map(tip).join(", ") } },
    ...rows.map((r) => el("span", { title: tip(r), style: { flex: `${r.v} 0 0`, background: col(r.c.color) } })));
  box.replaceChildren(stack, ...rows.map((r) =>
    el("div", { className: "r", title: tip(r) },
      el("span", { className: "dot", style: { background: col(r.c.color) } }),
      el("span", { className: "nm", textContent: r.c.name }),
      el("span", { className: "tr" }, el("span", { className: "fl", style: { display: "block", width: `${(r.v / max) * 100}%`, background: col(r.c.color) } })),
      el("span", { className: "v" }, fmt(r.v), el("small", { textContent: `${pct(r.v)} %` })))));
}

function renderList() {
  const list = $("#m-list");
  if (!S.tx.length) { list.replaceChildren(el("li", { className: "empty", textContent: "Aún no hay movimientos este mes. Pulsa + para añadir uno." })); return; }
  const out = []; let lastDay = null;
  for (const t of S.tx) {
    if (t.spent_on !== lastDay) { lastDay = t.spent_on; out.push(el("li", { className: "day", textContent: dayFmt.format(parseDate(t.spent_on)) })); }
    const c = catOf(t.category_id);
    const meta = [c?.name ?? "Sin categoría", `añadido por ${t.created_by === S.user.id ? "ti" : nameOf(t.created_by)}`].join(" · ");
    out.push(el("li", { className: "tap", tabIndex: 0, onclick: () => openTx(t), onkeydown: (e) => e.key === "Enter" && openTx(t) },
      el("div", { className: "main" },
        el("div", { className: "t", textContent: t.description }),
        el("div", { className: "s" }, c ? el("span", { className: "dot", style: { background: col(c.color) } }) : null,
          el("span", { textContent: meta + (t.recurring_id ? " · ↻" : "") }))),
      el("span", { className: t.kind === "income" ? "a in" : "a", textContent: (t.kind === "income" ? "+" : "−") + fmt(t.amount_cents) })));
  }
  list.replaceChildren(...out);
}

// ---------- formulario de movimiento ----------
const dlg = byId("tx-dialog"), f = byId("tx-form");
let editing = null, kind = "expense";

function setKind(k) {
  kind = k;
  byId("tx-kind").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.kind === k));
  const cats = S.categories.filter((c) => c.kind === k && (!c.archived || c.id === editing?.category_id));
  const prev = f.cat.value;
  f.cat.replaceChildren(...cats.map((c) => el("option", { value: c.id, textContent: c.name })));
  if (cats.some((c) => c.id === prev)) f.cat.value = prev;
}
byId("tx-kind").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b && !editing) setKind(b.dataset.kind); });
byId("tx-cancel").addEventListener("click", () => dlg.close());

function openTx(t = null) {
  editing = t; f.reset();
  byId("tx-kind").classList.toggle("locked", !!t);
  setKind(t?.kind ?? "expense");
  if (t) {
    f.amount.value = centsToInput(t.amount_cents); f.desc.value = t.description; f.cat.value = t.category_id;
    f.date.value = t.spent_on;
    byId("tx-meta").textContent = `Añadido por ${t.created_by === S.user.id ? "ti" : nameOf(t.created_by)}` +
      (t.recurring_id ? " · generado por un movimiento periódico (gestiónalo en Ajustes)" : "");
  } else {
    const today = new Date();
    f.date.value = S.month.getMonth() === today.getMonth() && S.month.getFullYear() === today.getFullYear()
      ? iso(today) : iso(S.month);
    byId("tx-meta").textContent = "";
  }
  byId("repeat-wrap").hidden = !!t;
  byId("tx-delete").hidden = !t;
  dlg.showModal();
  if (!t) f.amount.focus();
}

f.addEventListener("submit", (e) => {
  e.preventDefault();
  const cents = parseCents(f.amount.value);
  if (!cents) return toast("Importe no válido");
  if (!f.cat.value) return toast("Crea antes una categoría en Ajustes");
  const row = { category_id: f.cat.value, amount_cents: cents, description: f.desc.value.trim() };
  const mine = { paid_by: S.user.id };
  busy(f, async () => {
    if (editing) {
      check(await sb.from("transactions").update({ ...row, spent_on: f.date.value }).eq("id", editing.id));
      toast("Cambios guardados");
    } else if (f.repeat.value) {
      check(await sb.from("recurring").insert({ ...row, ...mine, household_id: S.household.id, kind, frequency: f.repeat.value,
        start_date: f.date.value, next_date: f.date.value }));
      check(await sb.rpc("run_recurring"));
      toast(`Guardado · se repetirá ${FREQ[f.repeat.value]}`);
    } else {
      check(await sb.from("transactions").insert({ ...row, ...mine, household_id: S.household.id, kind, spent_on: f.date.value }));
      toast(kind === "income" ? "Ingreso guardado" : "Gasto guardado");
    }
    dlg.close();
    S.month = firstOfMonth(parseDate(f.date.value));
    refresh();
  });
});

byId("tx-delete").addEventListener("click", () => {
  if (!editing || !confirm(`¿Eliminar «${editing.description}»?`)) return;
  busy(f, async () => { check(await sb.from("transactions").delete().eq("id", editing.id)); dlg.close(); toast("Eliminado"); refresh(); });
});

// ---------- ajustes ----------
function showSettings() {
  S.view = "settings"; mount("tpl-settings");
  $("#btn-back").addEventListener("click", () => { S.view = "main"; showMain(); });
  $("#btn-logout").addEventListener("click", () => { S.view = "main"; sb.auth.signOut(); });
  $("#btn-csv").addEventListener("click", exportCsv);
  app.querySelectorAll(".seg button").forEach((b) => b.addEventListener("click", () => {
    S.catKind = b.dataset.kind;
    app.querySelectorAll(".seg button").forEach((x) => x.classList.toggle("on", x === b));
    renderCats();
  }));
  app.querySelectorAll(".seg button").forEach((x) => x.classList.toggle("on", x.dataset.kind === S.catKind));

  const add = $("#cat-add");
  add.addEventListener("submit", (e) => {
    e.preventDefault();
    const used = new Set(S.categories.filter((c) => c.kind === S.catKind && !c.archived).map((c) => c.color));
    const color = PALETTE.find((p) => !used.has(p)) ?? PALETTE[used.size % PALETTE.length];
    busy(add, async () => {
      check(await sb.from("categories").insert({ household_id: S.household.id, kind: S.catKind, name: add.name.value.trim(), color }));
      add.reset(); await loadCategories(); renderCats();
    });
  });

  const nf = $("#name-form");
  nf.dname.value = nameOf(S.user.id);
  nf.addEventListener("submit", (e) => { e.preventDefault(); busy(nf, async () => {
    check(await sb.from("household_members").update({ display_name: nf.dname.value.trim() }).eq("user_id", S.user.id));
    S.members = check(await sb.from("household_members").select("user_id, display_name")); toast("Nombre guardado"); }); });
  if (S.members.length < 2) $("#s-code").textContent = S.household.invite_code; else $("#s-code-wrap").hidden = true;

  renderCats(); renderRecurring();
}

let openSwatch = null;
function renderCats() {
  const list = $("#cat-list"); if (!list) return;
  const cats = S.categories.filter((c) => c.kind === S.catKind && !c.archived);
  const items = [];
  for (const c of cats) {
    const name = el("input", { value: c.name, maxLength: 30, aria: { label: "Nombre de la categoría" } });
    name.addEventListener("change", async () => {
      const v = name.value.trim(); if (!v || v === c.name) { name.value = c.name; return; }
      const { error } = await sb.from("categories").update({ name: v }).eq("id", c.id);
      if (error) { toast(friendly(error)); name.value = c.name; return; }
      c.name = v; toast("Categoría renombrada");
    });
    items.push(el("li", {},
      el("button", { className: "swatch", style: { background: col(c.color) }, aria: { label: "Cambiar color" },
        onclick: () => { openSwatch = openSwatch === c.id ? null : c.id; renderCats(); } }),
      name,
      el("button", { className: "link danger", textContent: "Quitar", onclick: async () => {
        if (!confirm(`¿Quitar «${c.name}»? Los movimientos que ya la usan la conservarán.`)) return;
        const { error } = await sb.from("categories").update({ archived: true }).eq("id", c.id);
        if (error) return toast(friendly(error));
        c.archived = true; renderCats();
      } })));
    if (openSwatch === c.id) {
      items.push(el("li", { className: "swatches" }, ...PALETTE.map((p) =>
        el("button", { className: p === c.color ? "on" : "", style: { background: col(p) }, aria: { label: `Color ${p}` },
          onclick: async () => {
            const { error } = await sb.from("categories").update({ color: p }).eq("id", c.id);
            if (error) return toast(friendly(error));
            c.color = p; openSwatch = null; renderCats();
          } }))));
    }
  }
  list.replaceChildren(...(items.length ? items : [el("li", { className: "muted", textContent: "No hay categorías" })]));
}

async function renderRecurring() {
  const list = $("#rec-list");
  const rows = check(await sb.from("recurring").select("id, kind, category_id, amount_cents, description, frequency, next_date, active, created_by").order("created_at"));
  if (S.view !== "settings") return;
  if (!rows.length) { list.replaceChildren(el("li", { className: "empty", textContent: "No tienes movimientos periódicos" })); return; }
  list.replaceChildren(...rows.map((r) => el("li", {},
    el("div", { className: "main" },
      el("div", { className: "t", textContent: `${r.description} · ${r.kind === "income" ? "+" : "−"}${fmt(r.amount_cents)}` }),
      el("div", { className: "s", textContent: [cap(FREQ[r.frequency]), catOf(r.category_id)?.name,
        r.active ? `próximo: ${shortFmt.format(parseDate(r.next_date))}` : "en pausa",
        `creado por ${r.created_by === S.user.id ? "ti" : nameOf(r.created_by)}`].filter(Boolean).join(" · ") })),
    el("div", { className: "rec-actions" },
      el("button", { className: "link", textContent: r.active ? "Pausar" : "Reanudar", onclick: async () => {
        const { error } = await sb.from("recurring").update({ active: !r.active }).eq("id", r.id);
        if (error) return toast(friendly(error)); renderRecurring();
      } }),
      el("button", { className: "link danger", textContent: "Eliminar", onclick: async () => {
        if (!confirm(`¿Eliminar «${r.description}»? Los movimientos ya creados se mantienen.`)) return;
        const { error } = await sb.from("recurring").delete().eq("id", r.id);
        if (error) return toast(friendly(error)); renderRecurring();
      } })))));
}

function exportCsv() {
  const esc = (v) => { let s = String(v ?? ""); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return `"${s.replace(/"/g, '""')}"`; };
  const kindName = { expense: "Gasto", income: "Ingreso" };
  const rows = [["Fecha", "Tipo", "Concepto", "Categoría", "Importe", "Añadido por"]]
    .concat(S.tx.map((t) => [t.spent_on, kindName[t.kind], t.description, catOf(t.category_id)?.name ?? "",
      (t.amount_cents / 100).toFixed(2).replace(".", ","), nameOf(t.created_by)]));
  const csv = "﻿" + rows.map((r) => r.map(esc).join(";")).join("\r\n");
  const a = el("a", { href: URL.createObjectURL(new Blob([csv], { type: "text/csv" })), download: `movimientos-${iso(S.month).slice(0, 7)}.csv` });
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
