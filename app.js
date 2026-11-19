import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, experimental: { passkey: true } },
});

// Paleta categórica (validada para daltonismo); en modo oscuro se usa el paso oscuro del mismo tono
const PALETTE = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"];
const DARK = { "#2a78d6": "#3987e5", "#eb6834": "#d95926", "#1baf7a": "#199e70", "#eda100": "#c98500",
               "#e87ba4": "#d55181", "#008300": "#0ca30c", "#6250d6": "#9085e9", "#e34948": "#e66767" };
const darkMq = matchMedia("(prefers-color-scheme: dark)");
const col = (hex) => (darkMq.matches ? DARK[hex?.toLowerCase()] || hex : hex) || "#a8a29e";
const UNIT = { weekly: ["semana", "semanas"], monthly: ["mes", "meses"], yearly: ["año", "años"] };

const app = document.getElementById("app");
const S = { user: null, household: null, members: [], categories: [], month: firstOfMonth(new Date()),
            tx: [], view: "main", catKind: "expense", q: "", fcat: "", searchRows: null };

// ---------- utilidades ----------
const eur = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });
const eur0 = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const fmt = (c) => eur.format(c / 100);
const fmt0 = (c) => eur0.format(Math.round(c / 100));
const monthFmt = new Intl.DateTimeFormat("es-ES", { month: "long", year: "numeric" });
const monShort = new Intl.DateTimeFormat("es-ES", { month: "short" });
const dayFmt = new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", month: "long" });
const dayFmtY = new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const shortFmt = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short" });
const shortFmtY = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", year: "numeric" });
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
function firstOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
const addMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, 1);
function iso(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
const parseDate = (s) => new Date(s + "T00:00");
const shortDate = (s) => { const d = parseDate(s); return (d.getFullYear() === new Date().getFullYear() ? shortFmt : shortFmtY).format(d); };
function parseCents(str) {
  const m = String(str).trim().replace(/\s|€/g, "").match(/^(\d{1,7})(?:[.,](\d{1,2}))?$/);
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
const SVGNS = "http://www.w3.org/2000/svg";
function svg(tag, attrs = {}, ...kids) {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  n.append(...kids);
  return n;
}
const mount = (id) => app.replaceChildren(document.getElementById(id).content.cloneNode(true));
const $ = (s) => app.querySelector(s);
const byId = (id) => document.getElementById(id);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};
let toastT;
function toast(msg) {
  const t = byId("toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 3400);
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
  const m = e?.message || String(e || "Algo ha fallado");
  if (/Invalid login/i.test(m)) return "Email o contraseña incorrectos";
  if (/Email not confirmed|email_not_confirmed/i.test(m)) return "Confirma tu email antes de entrar";
  if (/already registered/i.test(m)) return "Ese email ya tiene cuenta";
  if (/categories_name_uq|duplicate/i.test(m)) return "Ya existe una categoría con ese nombre";
  if (/NotAllowedError|cancel|aborted|timed out/i.test(m)) return "Se canceló la verificación";
  if (/passkey|webauthn/i.test(m) && /disabled|not enabled|not supported|unsupported|feature/i.test(m))
    return "Face ID / huella aún no está activado en Supabase";
  if (/Failed to fetch|NetworkError/i.test(m)) return "Sin conexión";
  return m;
}
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const canPasskey = () => !!window.PublicKeyCredential;

// Fechas de repetición (igual que PostgreSQL: el 31 cae el último día en meses cortos)
function stepDate(startIso, freq, every, k) {
  const [y, m, d] = startIso.split("-").map(Number);
  if (freq === "weekly") return iso(new Date(y, m - 1, d + 7 * every * k));
  const months = (freq === "monthly" ? every : 12 * every) * k;
  const tm = m - 1 + months, ty = y + Math.floor(tm / 12), mm = ((tm % 12) + 12) % 12;
  return iso(new Date(ty, mm, Math.min(d, new Date(ty, mm + 1, 0).getDate())));
}
const freqLabel = (f, n) => n === 1 ? `Cada ${UNIT[f][0]}` : `Cada ${n} ${UNIT[f][1]}`;

// ---------- arranque y navegación ----------
sb.auth.onAuthStateChange((evt, session) => {
  const uid = session?.user?.id ?? null;
  if (uid === (S.user?.id ?? null) && app.dataset.ready) return;
  app.dataset.ready = "1";
  S.user = session?.user ?? null;
  if (!S.user) stopRealtime();
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
  startRealtime();
  S.view === "settings" ? showSettings() : showMain();
}
async function loadCategories() {
  S.categories = check(await sb.from("categories").select("id, kind, name, color, archived, monthly_budget_cents").order("created_at"));
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && S.household && S.view === "main" && !byId("tx-dialog").open) {
    sb.rpc("run_recurring").then(refresh);
  }
});
darkMq.addEventListener("change", () => S.view === "main" ? renderAll() : S.view === "settings" && renderCats());

// ---------- tiempo real ----------
let rt = null;
const rtRefresh = debounce(() => { if (S.view === "main" && !byId("tx-dialog").open) refresh(); }, 400);
function startRealtime() {
  if (rt || !S.household) return;
  const filter = `household_id=eq.${S.household.id}`;
  rt = sb.channel(`hogar-${S.household.id}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "transactions", filter }, rtRefresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "categories", filter }, async () => {
      await loadCategories();
      if (S.view === "main") renderAll(); else if (S.view === "settings") renderCats();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "recurring", filter }, () => {
      if (S.view === "settings") renderRecurring();
    })
    .subscribe((status) => { const l = byId("live"); if (l) l.hidden = status !== "SUBSCRIBED"; S.live = status === "SUBSCRIBED"; });
}
function stopRealtime() { if (rt) { sb.removeChannel(rt); rt = null; S.live = false; } }

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
  if (canPasskey() && store.get("pk-has") === "1") {
    $("#btn-passkey").hidden = false; $("#passkey-or").hidden = false;
    f.querySelector("button.primary").classList.remove("primary");
  }
  $("#btn-passkey").addEventListener("click", (e) => busy(e.target.parentElement, async () => check(await sb.auth.signInWithPasskey())));
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
  $("#live").hidden = !S.live;
  if (S.members.length < 2) { $("#invite-banner").hidden = false; $("#invite-code").textContent = S.household.invite_code; }
  $("#m-prev").addEventListener("click", () => moveMonth(-1));
  $("#m-next").addEventListener("click", () => moveMonth(1));
  $("#btn-settings").addEventListener("click", showSettings);
  $("#fab").addEventListener("click", () => openTx());

  // búsqueda y filtro
  const q = $("#q"), fc = $("#fcat");
  q.value = S.q;
  fillCatFilter();
  fc.value = S.fcat;
  q.addEventListener("input", debounce(() => { S.q = q.value.trim(); runSearch(); }, 300));
  fc.addEventListener("change", () => { S.fcat = fc.value; S.q ? runSearch() : renderList(); });

  offerPasskey();
  refresh();
}
function fillCatFilter() {
  const fc = $("#fcat"); if (!fc) return;
  const opts = [el("option", { value: "", textContent: "Todas" })];
  for (const [kind, label] of [["expense", "Gastos"], ["income", "Ingresos"]]) {
    const g = el("optgroup", { label });
    S.categories.filter((c) => c.kind === kind && !c.archived).forEach((c) => g.append(el("option", { value: c.id, textContent: c.name })));
    opts.push(g);
  }
  fc.replaceChildren(...opts); fc.value = S.fcat;
}
function moveMonth(n) { S.month = addMonths(S.month, n); refresh(); }

async function refresh() {
  if (S.view !== "main") return;
  $("#m-label").textContent = cap(monthFmt.format(S.month));
  const from = iso(S.month), to = iso(addMonths(S.month, 1));
  const [tx, trend, prev] = await Promise.all([
    sb.from("transactions").select("id, kind, category_id, amount_cents, description, spent_on, recurring_id, created_by")
      .in("kind", ["expense", "income"])
      .gte("spent_on", from).lt("spent_on", to).order("spent_on", { ascending: false }).order("created_at", { ascending: false }),
    sb.rpc("month_totals", { p_end: from, p_months: 12 }),
    sb.rpc("category_totals", { p_from: iso(addMonths(S.month, -3)), p_to: from }),
  ]);
  try {
    S.tx = check(tx); S.trend = check(trend); S.prevCats = check(prev);
    if (S.view === "main") { renderAll(); if (S.q) runSearch(); }
  } catch (e) { toast(friendly(e)); }
}

function renderAll() {
  if (S.view !== "main" || !S.tx) return;
  const exp = S.tx.filter((t) => t.kind === "expense"), inc = S.tx.filter((t) => t.kind === "income");
  const sum = (a) => a.reduce((s, t) => s + t.amount_cents, 0);
  const tIn = sum(inc), tOut = sum(exp);
  $("#k-in").textContent = fmt(tIn); $("#k-out").textContent = fmt(tOut);
  $("#k-net").textContent = (tIn - tOut < 0 ? "−" : "") + fmt(Math.abs(tIn - tOut));
  const byCat = new Map();
  for (const t of exp) byCat.set(t.category_id, (byCat.get(t.category_id) || 0) + t.amount_cents);
  renderBudgets(byCat);
  renderChart(byCat, tOut);
  renderTrend();
  renderInsights(byCat, tOut);
  fillCatFilter();
  if (!S.q) renderList();
}

// ---------- presupuestos ----------
function renderBudgets(byCat) {
  const cats = S.categories.filter((c) => c.kind === "expense" && !c.archived && c.monthly_budget_cents);
  $("#budget-sec").hidden = !cats.length;
  if (!cats.length) return;
  const now = new Date(), isCurrent = S.month.getMonth() === now.getMonth() && S.month.getFullYear() === now.getFullYear();
  const dayShare = isCurrent ? now.getDate() / new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() : 1;
  let tb = 0, ts = 0;
  const rows = cats.map((c) => {
    const spent = byCat.get(c.id) || 0, b = c.monthly_budget_cents, ratio = spent / b;
    tb += b; ts += spent;
    const over = spent > b, warn = !over && ratio >= 0.9;
    const fill = el("span", { className: "fl" + (over ? " over" : ""), style: { width: `${Math.min(ratio, 1) * 100}%`, background: over ? "" : col(c.color) } });
    const status = over ? `⚠ ${fmt0(spent - b)} por encima` : warn ? `Casi agotado · quedan ${fmt0(b - spent)}` : `Quedan ${fmt0(b - spent)}`;
    return el("div", { className: "b" + (over ? " is-over" : "") },
      el("div", { className: "bh" },
        el("span", { className: "nm" }, el("span", { className: "dot", style: { background: col(c.color) } }), c.name),
        el("span", { className: "v", textContent: `${fmt0(spent)} / ${fmt0(b)}` })),
      el("div", { className: "tr", role: "progressbar", aria: { valuenow: Math.round(ratio * 100), valuemin: 0, valuemax: 100, label: `${c.name}: ${Math.round(ratio * 100)} % del presupuesto` } },
        fill, isCurrent && !over ? el("span", { className: "today", style: { left: `${dayShare * 100}%` }, title: "Lo que tocaría llevar gastado hoy" }) : null),
      el("div", { className: "bs" + (over ? " over" : warn ? " warn" : ""), textContent: status }));
  });
  $("#budgets").replaceChildren(...rows);
  $("#budget-total").textContent = `En total: ${fmt0(ts)} de ${fmt0(tb)} presupuestados` + (isCurrent ? " · la marca vertical indica lo que tocaría llevar hoy" : "");
}

// ---------- gráfico por categoría ----------
function renderChart(byCat, total) {
  const box = $("#chart");
  if (!total) { box.replaceChildren(el("p", { className: "muted", textContent: "Sin gastos este mes" })); return; }
  const rows = [...byCat].map(([id, v]) => ({ id, c: catOf(id) || { name: "Sin categoría", color: "#a8a29e" }, v })).sort((a, b) => b.v - a.v);
  const max = rows[0].v;
  const pct = (v) => Math.round((v / total) * 100);
  const tip = (r) => `${r.c.name}: ${fmt(r.v)} (${pct(r.v)} %)`;
  const stack = el("div", { className: "stack", role: "img", aria: { label: "Reparto del gasto: " + rows.map(tip).join(", ") } },
    ...rows.map((r) => el("span", { title: tip(r), style: { flex: `${r.v} 0 0`, background: col(r.c.color) } })));
  box.replaceChildren(stack, ...rows.map((r) =>
    el("div", { className: "r", title: `${tip(r)} · toca para ver sus movimientos`, onclick: () => { S.fcat = r.id; $("#fcat").value = r.id; renderList(); $("#m-list").scrollIntoView({ behavior: "smooth", block: "start" }); } },
      el("span", { className: "dot", style: { background: col(r.c.color) } }),
      el("span", { className: "nm", textContent: r.c.name }),
      el("span", { className: "tr" }, el("span", { className: "fl", style: { display: "block", width: `${(r.v / max) * 100}%`, background: col(r.c.color) } })),
      el("span", { className: "v" }, fmt(r.v), el("small", { textContent: `${pct(r.v)} %` })))));
}

// ---------- evolución 12 meses ----------
function renderTrend() {
  const box = $("#trend");
  const months = Array.from({ length: 12 }, (_, i) => addMonths(S.month, i - 11));
  const map = new Map((S.trend || []).map((r) => [r.month, r]));
  const data = months.map((d) => ({ d, key: iso(d), inc: Number(map.get(iso(d))?.income || 0), exp: Number(map.get(iso(d))?.expense || 0) }));
  const max = Math.max(...data.map((r) => Math.max(r.inc, r.exp)));
  if (!max) { box.replaceChildren(el("p", { className: "muted", textContent: "Aún no hay datos de meses anteriores" })); return; }
  const W = 520, H = 150, top = 18, base = 122, colW = W / 12, bw = Math.min(14, colW * 0.3);
  const nice = (v) => { const p = 10 ** Math.floor(Math.log10(v)); return [1, 2, 2.5, 5, 10].map((m) => m * p).find((x) => x >= v); };
  const gmax = nice(max / 100) * 100, y = (v) => base - (v / gmax) * (base - top);
  const bar = (x, v, cls) => {
    if (!v) return svg("rect", { x, y: base - 1, width: bw, height: 1, class: cls, opacity: ".35" });
    const h = Math.max(base - y(v), 2), r = Math.min(3, h / 2), yt = base - h;
    return svg("path", { class: cls, d: `M${x},${base}V${yt + r}Q${x},${yt} ${x + r},${yt}H${x + bw - r}Q${x + bw},${yt} ${x + bw},${yt + r}V${base}Z` });
  };
  const g = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "trend-svg", role: "img",
    "aria-label": "Ingresos y gastos de los últimos 12 meses: " + data.map((r) => `${monthFmt.format(r.d)}: ingresos ${fmt0(r.inc)}, gastos ${fmt0(r.exp)}`).join("; ") });
  g.append(svg("line", { x1: 0, x2: W, y1: top, y2: top, class: "grid" }),
           svg("text", { x: 0, y: top - 5, class: "axis" }, document.createTextNode(fmt0(gmax))),
           svg("line", { x1: 0, x2: W, y1: base, y2: base, class: "baseline" }));
  data.forEach((r, i) => {
    const cx = i * colW + colW / 2, sel = i === 11;
    if (sel) g.append(svg("rect", { x: i * colW + 2, y: top - 2, width: colW - 4, height: base - top + 22, rx: 8, class: "sel" }));
    g.append(bar(cx - bw - 1, r.inc, "in"), bar(cx + 1, r.exp, "out"),
      svg("text", { x: cx, y: base + 16, class: "axis" + (sel ? " cur" : ""), "text-anchor": "middle" }, document.createTextNode(monShort.format(r.d).replace(".", ""))));
    const hit = svg("rect", { x: i * colW, y: 0, width: colW, height: H, class: "hit", tabindex: "0" });
    const show = (ev) => showTip(ev, [cap(monthFmt.format(r.d)), `Ingresos ${fmt(r.inc)}`, `Gastos ${fmt(r.exp)}`, `Ahorro ${r.inc - r.exp < 0 ? "−" : ""}${fmt(Math.abs(r.inc - r.exp))}`]);
    hit.addEventListener("pointerenter", show); hit.addEventListener("pointermove", show);
    hit.addEventListener("pointerleave", hideTip); hit.addEventListener("focus", show); hit.addEventListener("blur", hideTip);
    hit.addEventListener("click", () => { hideTip(); if (!sel) { S.month = r.d; refresh(); } });
    g.append(hit);
  });
  box.replaceChildren(g);
}
function showTip(ev, lines) {
  const t = byId("tip");
  t.replaceChildren(el("strong", { textContent: lines[0] }), ...lines.slice(1).map((l) => el("div", { textContent: l })));
  t.hidden = false;
  const r = ev.target.getBoundingClientRect ? ev.target.getBoundingClientRect() : { left: ev.clientX, top: ev.clientY, width: 0 };
  const x = Math.min(Math.max((ev.clientX ?? r.left + r.width / 2) + 12, 8), innerWidth - t.offsetWidth - 8);
  const yv = Math.max((ev.clientY ?? r.top) - t.offsetHeight - 12, 8);
  t.style.left = x + "px"; t.style.top = yv + "px";
}
const hideTip = () => (byId("tip").hidden = true);

// ---------- comparativa ----------
function renderInsights(byCat, total) {
  const ul = $("#insights"); const out = [];
  const prevMonth = (S.trend || []).find((r) => r.month === iso(addMonths(S.month, -1)));
  const now = new Date(), isCurrent = S.month.getMonth() === now.getMonth() && S.month.getFullYear() === now.getFullYear();
  const pctTxt = (p) => `${Math.abs(Math.round(p * 100))} %`;
  if (prevMonth && Number(prevMonth.expense) > 0 && total > 0) {
    const pe = Number(prevMonth.expense), p = (total - pe) / pe;
    if (Math.abs(p) >= 0.03)
      out.push({ up: p > 0, text: `En total, ${pctTxt(p)} ${p > 0 ? "más" : "menos"} que ${monthFmt.format(addMonths(S.month, -1)).split(" ")[0]} (${fmt0(total)} frente a ${fmt0(pe)})${isCurrent ? ", y el mes aún no ha terminado" : ""}` });
    else out.push({ up: null, text: `En total, prácticamente igual que el mes pasado (${fmt0(total)})` });
  }
  const prev = new Map((S.prevCats || []).map((r) => [r.category_id, Number(r.total) / 3]));
  const ids = new Set([...byCat.keys(), ...prev.keys()]);
  const changes = [];
  for (const id of ids) {
    const cur = byCat.get(id) || 0, avg = prev.get(id) || 0, c = catOf(id);
    if (!c || (cur < 2000 && avg < 2000)) continue;
    if (!avg) { changes.push({ id, diff: cur, text: `${c.name}: ${fmt0(cur)}, sin gasto en los 3 meses anteriores`, up: true }); continue; }
    const p = (cur - avg) / avg;
    if (Math.abs(p) >= 0.15 && Math.abs(cur - avg) >= 1000)
      changes.push({ id, diff: Math.abs(cur - avg), up: p > 0, text: `${c.name}: ${pctTxt(p)} ${p > 0 ? "más" : "menos"} que la media de los 3 meses anteriores (${fmt0(cur)} frente a ${fmt0(avg)})` });
  }
  changes.sort((a, b) => b.diff - a.diff).slice(0, 3).forEach((c) => out.push(c));
  if (!out.length) out.push({ up: null, text: (S.trend || []).some((r) => r.month < iso(S.month)) ? "Sin cambios destacables respecto a los meses anteriores" : "Cuando tengáis más meses registrados, aquí veréis cómo cambian vuestros gastos" });
  ul.replaceChildren(...out.map((o) => el("li", { className: o.up === true ? "up" : o.up === false ? "down" : "" },
    el("span", { className: "ic", aria: { hidden: "true" }, textContent: o.up === true ? "↑" : o.up === false ? "↓" : "•" }), el("span", { textContent: o.text }))));
}

// ---------- lista, búsqueda y filtro ----------
function txRow(t, withYear) {
  const c = catOf(t.category_id);
  const meta = [c?.name ?? "Sin categoría", `añadido por ${t.created_by === S.user.id ? "ti" : nameOf(t.created_by)}`].join(" · ");
  return el("li", { className: "tap", tabIndex: 0, onclick: () => openTx(t), onkeydown: (e) => e.key === "Enter" && openTx(t) },
    el("div", { className: "main" },
      el("div", { className: "t", textContent: t.description }),
      el("div", { className: "s" }, c ? el("span", { className: "dot", style: { background: col(c.color) } }) : null,
        el("span", { textContent: meta + (t.recurring_id ? " · ↻" : "") }))),
    el("span", { className: t.kind === "income" ? "a in" : "a", textContent: (t.kind === "income" ? "+" : "−") + fmt(t.amount_cents) }));
}
function renderRows(rows, emptyText, withYear) {
  const list = $("#m-list");
  if (!rows.length) { list.replaceChildren(el("li", { className: "empty", textContent: emptyText })); return; }
  const out = []; let last = null;
  for (const t of rows) {
    if (t.spent_on !== last) { last = t.spent_on; out.push(el("li", { className: "day", textContent: (withYear ? dayFmtY : dayFmt).format(parseDate(t.spent_on)) })); }
    out.push(txRow(t, withYear));
  }
  list.replaceChildren(...out);
}
function renderList() {
  if (S.view !== "main") return;
  const rows = S.fcat ? S.tx.filter((t) => t.category_id === S.fcat) : S.tx;
  const c = catOf(S.fcat);
  $("#list-title").textContent = c ? `Movimientos · ${c.name} (${fmt(rows.reduce((s, t) => s + t.amount_cents, 0))})` : "Movimientos";
  renderRows(rows, S.fcat ? "No hay movimientos de esta categoría este mes" : "Aún no hay movimientos este mes. Pulsa + para añadir uno.");
}
async function runSearch() {
  if (S.view !== "main") return;
  if (!S.q) { renderList(); return; }
  const clean = S.q.replace(/[%_*\\(),."']/g, " ").trim();
  if (!clean) { renderList(); return; }
  let query = sb.from("transactions").select("id, kind, category_id, amount_cents, description, spent_on, recurring_id, created_by")
    .in("kind", ["expense", "income"]).ilike("description", `%${clean}%`)
    .order("spent_on", { ascending: false }).order("created_at", { ascending: false }).limit(100);
  if (S.fcat) query = query.eq("category_id", S.fcat);
  const { data, error } = await query;
  if (error) return toast(friendly(error));
  if (S.q.replace(/[%_*\\(),."']/g, " ").trim() !== clean) return;   // llegó una búsqueda más nueva
  const tot = data.filter((t) => t.kind === "expense").reduce((s, t) => s + t.amount_cents, 0);
  $("#list-title").textContent = `${data.length === 100 ? "100+" : data.length} resultado${data.length === 1 ? "" : "s"}` + (tot ? ` · ${fmt(tot)} en gastos` : "");
  renderRows(data, `Nada coincide con «${S.q}»`, true);
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

function repeatSpec() {
  const v = f.repeat.value;
  if (!v) return null;
  let freq, every;
  if (v === "custom") { freq = f.unit.value; every = Math.min(Math.max(Math.round(Number(f.every.value) || 1), 1), 12); }
  else [freq, every] = [v.split(":")[0], Number(v.split(":")[1])];
  let end = null;
  if (f.endmode.value === "date" && f.enddate.value) end = f.enddate.value;
  if (f.endmode.value === "count") {
    const n = Math.min(Math.max(Math.round(Number(f.endcount.value) || 1), 1), 500);
    end = stepDate(f.date.value, freq, every, n - 1);
  }
  return { freq, every, end };
}
function updateRepeatUI() {
  const v = f.repeat.value;
  byId("repeat-custom").hidden = v !== "custom";
  byId("repeat-end").hidden = !v;
  byId("end-date-wrap").hidden = f.endmode.value !== "date";
  byId("end-count-wrap").hidden = f.endmode.value !== "count";
  byId("date-label").textContent = v ? "Primera vez" : "Fecha";
  const p = byId("repeat-preview");
  const spec = repeatSpec();
  if (!spec || !f.date.value) { p.hidden = true; return; }
  if (spec.end && spec.end < f.date.value) { p.hidden = false; p.textContent = "La fecha final es anterior a la primera"; return; }
  const next = [];
  for (let k = 0; k < 4; k++) { const d = stepDate(f.date.value, spec.freq, spec.every, k); if (spec.end && d > spec.end) break; next.push(shortDate(d)); }
  let times = "";
  if (spec.end) { let n = 0; while (n < 600 && stepDate(f.date.value, spec.freq, spec.every, n) <= spec.end) n++; times = ` · ${n} ${n === 1 ? "vez" : "veces"}, hasta el ${shortDate(spec.end)}`; }
  const amt = parseCents(f.amount.value);
  p.hidden = false;
  p.textContent = `${freqLabel(spec.freq, spec.every)}${amt ? ` · ${fmt(amt)}` : ""}${times}. Próximas: ${next.join(", ")}${next.length === 4 && (!spec.end || stepDate(f.date.value, spec.freq, spec.every, 4) <= spec.end) ? "…" : ""}`;
}
["change", "input"].forEach((ev) => f.addEventListener(ev, (e) => {
  if (["repeat", "every", "unit", "endmode", "enddate", "endcount", "date", "amount"].includes(e.target.name)) updateRepeatUI();
}));

function openTx(t = null) {
  editing = t; f.reset();
  setKind(t?.kind ?? "expense");
  if (t) {
    f.amount.value = centsToInput(t.amount_cents); f.desc.value = t.description; f.cat.value = t.category_id;
    f.date.value = t.spent_on;
    byId("tx-meta").textContent = `Añadido por ${t.created_by === S.user.id ? "ti" : nameOf(t.created_by)}` +
      (t.recurring_id ? " · generado por un movimiento periódico (puedes cambiar la serie en Ajustes)" : "");
  } else {
    const today = new Date();
    f.date.value = S.month.getMonth() === today.getMonth() && S.month.getFullYear() === today.getFullYear() ? iso(today) : iso(S.month);
    byId("tx-meta").textContent = "";
  }
  byId("repeat-block").hidden = !!t;
  byId("tx-delete").hidden = !t;
  updateRepeatUI();
  dlg.showModal();
  if (!t) f.amount.focus();
}

f.addEventListener("submit", (e) => {
  e.preventDefault();
  const cents = parseCents(f.amount.value);
  if (!cents) return toast("Importe no válido");
  if (!f.cat.value) return toast("Crea antes una categoría en Ajustes");
  const row = { category_id: f.cat.value, amount_cents: cents, description: f.desc.value.trim() };
  const spec = editing ? null : repeatSpec();
  if (spec?.end && spec.end < f.date.value) return toast("La fecha final es anterior a la primera");
  busy(f, async () => {
    if (editing) {
      check(await sb.from("transactions").update({ ...row, spent_on: f.date.value }).eq("id", editing.id));
      toast("Cambios guardados");
    } else if (spec) {
      check(await sb.from("recurring").insert({ ...row, paid_by: S.user.id, household_id: S.household.id, kind,
        frequency: spec.freq, interval_count: spec.every, start_date: f.date.value, next_date: f.date.value, end_date: spec.end }));
      check(await sb.rpc("run_recurring"));
      toast(`Guardado · ${freqLabel(spec.freq, spec.every).toLowerCase()}`);
    } else {
      check(await sb.from("transactions").insert({ ...row, paid_by: S.user.id, household_id: S.household.id, kind, spent_on: f.date.value }));
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

// ---------- Face ID / huella (passkeys) ----------
async function offerPasskey() {
  if (!canPasskey() || store.get("pk-asked") === "1" || store.get("pk-has") === "1") return;
  try {
    if (!(await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable())) return;
    const { data } = await sb.auth.passkey.list();
    if (data?.length) { store.set("pk-has", "1"); return; }
  } catch { return; }
  const b = $("#passkey-banner"); if (!b) return;
  b.hidden = false;
  $("#pk-no").addEventListener("click", () => { store.set("pk-asked", "1"); b.hidden = true; });
  $("#pk-yes").addEventListener("click", () => busy(b, async () => {
    await registerPasskey(); b.hidden = true; store.set("pk-asked", "1");
  }));
}
async function registerPasskey() {
  check(await sb.auth.registerPasskey());
  store.set("pk-has", "1");
  toast("Listo: la próxima vez podrás entrar con Face ID o huella");
}

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

  $("#pk-add").addEventListener("click", (e) => busy(e.target.parentElement, async () => { await registerPasskey(); renderPasskeys(); }));
  renderCats(); renderRecurring(); renderPasskeys();
}

let openSwatch = null;
function renderCats() {
  const list = $("#cat-list"); if (!list) return;
  $("#budget-hint").hidden = S.catKind !== "expense";
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
    let budget = null;
    if (S.catKind === "expense") {
      budget = el("input", { className: "budget", inputMode: "decimal", placeholder: "—", value: c.monthly_budget_cents ? centsToInput(c.monthly_budget_cents) : "",
        aria: { label: `Presupuesto mensual de ${c.name} en euros` } });
      budget.addEventListener("change", async () => {
        const raw = budget.value.trim(), v = raw ? parseCents(raw) : null;
        if (raw && !v) { toast("Presupuesto no válido"); budget.value = c.monthly_budget_cents ? centsToInput(c.monthly_budget_cents) : ""; return; }
        const { error } = await sb.from("categories").update({ monthly_budget_cents: v }).eq("id", c.id);
        if (error) return toast(friendly(error));
        c.monthly_budget_cents = v; toast(v ? `Presupuesto de ${c.name}: ${fmt(v)} al mes` : `Sin presupuesto para ${c.name}`);
      });
    }
    items.push(el("li", {},
      el("button", { className: "swatch", style: { background: col(c.color) }, aria: { label: "Cambiar color" },
        onclick: () => { openSwatch = openSwatch === c.id ? null : c.id; renderCats(); } }),
      name,
      budget ? el("span", { className: "budget-wrap" }, budget, el("span", { className: "cur-s", textContent: "€/mes" })) : null,
      el("button", { className: "x", textContent: "×", title: "Quitar categoría", aria: { label: `Quitar ${c.name}` }, onclick: async () => {
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
  const list = $("#rec-list"); if (!list) return;
  const { data: rows, error } = await sb.from("recurring")
    .select("id, kind, category_id, amount_cents, description, frequency, interval_count, start_date, end_date, next_date, active, created_by").order("created_at");
  if (error) return toast(friendly(error));
  if (S.view !== "settings") return;
  if (!rows.length) { list.replaceChildren(el("li", { className: "empty", textContent: "No tenéis movimientos periódicos" })); return; }
  list.replaceChildren(...rows.map((r) => recRow(r)));
}
function recRow(r) {
  const finished = r.end_date && r.next_date > r.end_date;
  const state = finished ? "finalizado" : !r.active ? "en pausa" : `próximo: ${shortDate(r.next_date)}`;
  const info = [freqLabel(r.frequency, r.interval_count), catOf(r.category_id)?.name, state,
    r.end_date && !finished ? `hasta el ${shortDate(r.end_date)}` : null,
    `creado por ${r.created_by === S.user.id ? "ti" : nameOf(r.created_by)}`].filter(Boolean).join(" · ");
  const li = el("li", {},
    el("div", { className: "main" },
      el("div", { className: "t", textContent: `${r.description} · ${r.kind === "income" ? "+" : "−"}${fmt(r.amount_cents)}` }),
      el("div", { className: "s", textContent: info })),
    el("div", { className: "rec-actions" },
      el("button", { className: "link", textContent: "Editar", onclick: () => li.replaceWith(recEditRow(r)) }),
      finished ? null : el("button", { className: "link", textContent: r.active ? "Pausar" : "Reanudar", onclick: async () => {
        const { error } = await sb.from("recurring").update({ active: !r.active }).eq("id", r.id);
        if (error) return toast(friendly(error)); renderRecurring();
      } }),
      el("button", { className: "link danger", textContent: "Eliminar", onclick: async () => {
        if (!confirm(`¿Eliminar «${r.description}»? Los movimientos ya creados se mantienen.`)) return;
        const { error } = await sb.from("recurring").delete().eq("id", r.id);
        if (error) return toast(friendly(error)); renderRecurring();
      } })));
  return li;
}
function recEditRow(r) {
  const form = el("form", { className: "rec-edit" });
  const desc = el("input", { value: r.description, maxLength: 120, required: true, aria: { label: "Concepto" } });
  const amt = el("input", { value: centsToInput(r.amount_cents), inputMode: "decimal", required: true, aria: { label: "Importe" } });
  const end = el("input", { type: "date", value: r.end_date || "", min: r.start_date, aria: { label: "Último día (opcional)" } });
  form.append(
    el("label", {}, "Concepto", desc),
    el("div", { className: "row" }, el("label", {}, "Importe (€)", amt), el("label", {}, "Termina (opcional)", end)),
    el("p", { className: "hint", textContent: "Los cambios se aplican a los próximos movimientos; los ya creados no cambian." }),
    el("div", { className: "dialog-actions" }, el("span", { className: "spacer" }),
      el("button", { type: "button", className: "btn", textContent: "Cancelar", onclick: () => renderRecurring() }),
      el("button", { className: "btn primary", textContent: "Guardar" })));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const c = parseCents(amt.value); if (!c) return toast("Importe no válido");
    busy(form, async () => {
      check(await sb.from("recurring").update({ description: desc.value.trim(), amount_cents: c, end_date: end.value || null }).eq("id", r.id));
      toast("Movimiento periódico actualizado"); renderRecurring();
    });
  });
  return el("li", { className: "editing" }, form);
}

async function renderPasskeys() {
  const list = $("#pk-list"); if (!list) return;
  if (!canPasskey()) { $("#pk-add").hidden = true; $("#pk-hint").textContent = "Este navegador no admite Face ID / huella."; return; }
  let keys = [];
  try { const { data, error } = await sb.auth.passkey.list(); if (error) throw error; keys = data || []; }
  catch (e) { list.replaceChildren(); $("#pk-hint").textContent = friendly(e); return; }
  if (keys.length) store.set("pk-has", "1");
  list.replaceChildren(...keys.map((k) => el("li", {},
    el("div", { className: "main" },
      el("div", { className: "t", textContent: k.friendly_name || "Passkey" }),
      el("div", { className: "s", textContent: `Añadida el ${shortDate(String(k.created_at).slice(0, 10))}` + (k.last_used_at ? ` · último uso ${shortDate(String(k.last_used_at).slice(0, 10))}` : "") })),
    el("button", { className: "link danger", textContent: "Quitar", onclick: async () => {
      if (!confirm("¿Quitar este acceso con Face ID / huella?")) return;
      const { error } = await sb.auth.passkey.delete({ passkeyId: k.id });
      if (error) return toast(friendly(error));
      renderPasskeys();
    } }))));
}

function exportCsv() {
  const esc = (v) => { let s = String(v ?? ""); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return `"${s.replace(/"/g, '""')}"`; };
  const kindName = { expense: "Gasto", income: "Ingreso" };
  const rows = [["Fecha", "Tipo", "Concepto", "Categoría", "Importe", "Añadido por"]]
    .concat((S.tx || []).map((t) => [t.spent_on, kindName[t.kind], t.description, catOf(t.category_id)?.name ?? "",
      (t.amount_cents / 100).toFixed(2).replace(".", ","), nameOf(t.created_by)]));
  const csv = "﻿" + rows.map((r) => r.map(esc).join(";")).join("\r\n");
  const a = el("a", { href: URL.createObjectURL(new Blob([csv], { type: "text/csv" })), download: `movimientos-${iso(S.month).slice(0, 7)}.csv` });
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
