"use strict";

const MEALS = ["Breakfast", "Lunch", "Dinner"];
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const STORE_KEY = "courtyard-kitchen:v1";

const SEED_RECIPES = [
  {
    id: "seed-carbonara", name: "Spaghetti Carbonara", type: "Dinner", servings: 4, minutes: 25,
    ingredients: ["1 lb spaghetti", "4 egg yolks", "1 cup pecorino romano", "6 oz guanciale", "1 tsp black pepper"],
    steps: ["Boil the spaghetti in salted water.", "Crisp the guanciale in a pan.", "Whisk yolks, pecorino and pepper.", "Toss hot pasta with guanciale, then the egg mixture off the heat, loosening with pasta water."],
  },
  {
    id: "seed-caprese", name: "Caprese Salad", type: "Lunch", servings: 4, minutes: 10,
    ingredients: ["4 tomatoes", "8 oz fresh mozzarella", "1 bunch basil", "2 tbsp olive oil"],
    steps: ["Slice tomatoes and mozzarella.", "Layer with basil leaves.", "Drizzle with olive oil and season with salt."],
  },
  {
    id: "seed-frittata", name: "Zucchini Frittata", type: "Breakfast", servings: 4, minutes: 20,
    ingredients: ["8 eggs", "2 zucchini", "1/2 cup parmesan", "1 tbsp olive oil"],
    steps: ["Saute sliced zucchini in olive oil.", "Pour in beaten eggs and parmesan.", "Cook until edges set, then finish under the broiler."],
  },
  {
    id: "seed-risotto", name: "Mushroom Risotto", type: "Dinner", servings: 4, minutes: 40,
    ingredients: ["1.5 cups arborio rice", "8 oz mushrooms", "5 cups chicken broth", "1/2 cup parmesan", "1 onion", "2 tbsp butter"],
    steps: ["Saute onion and mushrooms in butter.", "Toast the rice, then add warm broth a ladle at a time, stirring.", "Finish with parmesan and butter."],
  },
  {
    id: "seed-tiramisu", name: "Tiramisu", type: "Dessert", servings: 8, minutes: 30,
    ingredients: ["24 ladyfingers", "1 lb mascarpone", "4 egg yolks", "1/2 cup sugar", "1.5 cups espresso", "2 tbsp cocoa powder"],
    steps: ["Whisk yolks and sugar, fold in mascarpone.", "Dip ladyfingers in espresso and layer with cream.", "Chill 4 hours and dust with cocoa."],
  },
];

/* ---------- state ---------- */
const $ = (id) => document.getElementById(id);
const CACHE_KEY = "ck:cache";
const OUTBOX_KEY = "ck:outbox";
const PASS_KEY = "ck:passcode";
const OLD_KEY = "courtyard-kitchen:v1"; // browser-only version of the app

const store = {
  get(k, fallback) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? fallback; } catch { return fallback; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

let state = store.get(CACHE_KEY, { recipes: [], plan: {}, checked: {} });
let outbox = store.get(OUTBOX_KEY, []);
let passcode = store.get(PASS_KEY, "");
let weekStart = mondayOf(new Date());
let editingId = null;
let viewingId = null;
let pickTarget = null;
let flushing = false;

function save() { store.set(CACHE_KEY, state); }

function setStatus(text) { $("status").textContent = text; }

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { "x-passcode": passcode, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) { const e = new Error("auth"); e.auth = true; throw e; }
  if (!res.ok) { const e = new Error(`HTTP ${res.status}`); e.status = res.status; throw e; }
  return res.json();
}

// Local change first, then queue the server write so the app works offline.
function mutate(method, path, body) {
  outbox.push({ method, path, body });
  store.set(OUTBOX_KEY, outbox);
  save();
  flush();
}

async function flush() {
  if (flushing) return true;
  flushing = true;
  try {
    while (outbox.length) {
      const job = outbox[0];
      try {
        await api(job.method, job.path, job.body);
      } catch (e) {
        if (e.auth) throw e;
        if (!e.status || e.status >= 500) throw e; // network or server trouble: keep and retry later
        // other 4xx: the server rejected it for good, drop it
      }
      outbox.shift();
      store.set(OUTBOX_KEY, outbox);
    }
    return true;
  } catch (e) {
    if (e.auth) askPasscode(); else setStatus("Offline — changes will sync when you're back");
    return false;
  } finally {
    flushing = false;
  }
}

async function sync() {
  if (!passcode) { askPasscode(); return; }
  setStatus("Syncing…");
  try {
    if (!(await flush())) return;
    await migrateOldData();
    let remote = await api("GET", "/api/state");
    if (!remote.recipes.length) {
      await api("POST", "/api/seed", { recipes: SEED_RECIPES });
      remote = await api("GET", "/api/state");
    }
    if (outbox.length) return; // new local edits landed meanwhile; they flush then sync again
    state = remote;
    save();
    render();
sync();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
    setStatus("Synced with the family");
  } catch (e) {
    if (e.auth) askPasscode(); else setStatus("Offline — showing saved copy");
  }
}

// Recipes and plans saved by the old browser-only version move to the server once.
async function migrateOldData() {
  const old = store.get(OLD_KEY, null);
  if (!old || !Array.isArray(old.recipes)) return;
  await api("POST", "/api/seed", { recipes: old.recipes });
  for (const [day, meals] of Object.entries(old.plan || {})) {
    for (const [meal, recipeId] of Object.entries(meals)) {
      await api("PUT", `/api/plan/${day}/${meal}`, { recipeId }).catch(() => {});
    }
  }
  store.del(OLD_KEY);
}

function askPasscode() {
  setStatus("Passcode needed");
  const d = $("loginDialog");
  if (!d.open) d.showModal();
}
$("loginForm").addEventListener("submit", (e) => {
  e.preventDefault();
  passcode = $("passcodeInput").value.trim();
  store.set(PASS_KEY, passcode);
  $("loginDialog").close();
  sync();
});
window.addEventListener("online", sync);
document.addEventListener("visibilitychange", () => { if (!document.hidden) sync(); });

/* ---------- helpers ---------- */
function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n[k] = v;
  }
  for (const kid of kids) n.append(kid);
  return n;
}
function mondayOf(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}
function dateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
const recipeById = (id) => state.recipes.find((r) => r.id === id);
const lines = (s) => s.split("\n").map((l) => l.trim()).filter(Boolean);

/* ---------- ingredient parsing ---------- */
const UNITS = { cups: "cup", cup: "cup", tbsp: "tbsp", tsp: "tsp", lbs: "lb", lb: "lb", oz: "oz", g: "g", kg: "kg", ml: "ml", l: "l", cloves: "clove", clove: "clove", cans: "can", can: "can", pinch: "pinch" };

function parseQty(s) {
  s = s.trim();
  const mixed = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return +mixed[1] + mixed[2] / mixed[3];
  const frac = s.match(/^(\d+)\/(\d+)$/);
  if (frac) return frac[1] / frac[2];
  return parseFloat(s);
}
function parseIngredient(line) {
  const m = line.match(/^((?:\d+\s+)?\d+\/\d+|\d*\.?\d+)?\s*(\S+)?\s*(.*)$/);
  let qty = m[1] ? parseQty(m[1]) : null;
  let unit = "";
  let name = line;
  if (qty !== null) {
    const u = (m[2] || "").toLowerCase();
    if (UNITS[u]) { unit = UNITS[u]; name = m[3]; }
    else name = [m[2], m[3]].filter(Boolean).join(" ");
  }
  name = name.replace(/^of\s+/i, "").trim() || line;
  return { qty, unit, name };
}
function fmtQty(n) {
  return String(Math.round(n * 100) / 100);
}

/* ---------- tabs ---------- */
document.querySelectorAll(".arches button").forEach((b) =>
  b.addEventListener("click", () => {
    document.querySelectorAll(".arches button").forEach((x) => x.classList.toggle("active", x === b));
    document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("active", p.id === b.dataset.tab));
    render();
sync();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  })
);

/* ---------- weekly plan ---------- */
function renderWeek() {
  const end = addDays(weekStart, 6);
  const fmt = (d) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  $("weekLabel").textContent = `${fmt(weekStart)} – ${fmt(end)}`;
  const todayKey = dateKey(new Date());
  const wrap = $("week");
  wrap.replaceChildren();
  DAYS.forEach((name, i) => {
    const d = addDays(weekStart, i);
    const key = dateKey(d);
    const day = el("div", { class: "day" + (key === todayKey ? " today" : "") }, el("h4", {}, `${name} ${d.getDate()}`));
    MEALS.forEach((meal) => {
      const r = recipeById((state.plan[key] || {})[meal]);
      const slot = el("button", { class: "slot" + (r ? " filled" : ""), type: "button", onclick: () => openPicker(key, meal, name) },
        el("small", {}, meal), r ? r.name : "+ add");
      day.append(slot);
    });
    wrap.append(day);
  });
}
$("prevWeek").onclick = () => { weekStart = addDays(weekStart, -7); render(); };
$("nextWeek").onclick = () => { weekStart = addDays(weekStart, 7); render(); };

function openPicker(key, meal, dayName) {
  pickTarget = { key, meal };
  $("pickTitle").textContent = `${dayName} ${meal.toLowerCase()}`;
  const list = $("pickList");
  list.replaceChildren();
  const sorted = [...state.recipes].sort((a, b) => (b.type === meal) - (a.type === meal) || a.name.localeCompare(b.name));
  if (!sorted.length) list.append(el("p", { class: "empty" }, "No recipes yet. Add some in the Recipe Book."));
  sorted.forEach((r) =>
    list.append(el("button", { type: "button", onclick: () => {
      (state.plan[key] ||= {})[meal] = r.id;
      mutate("PUT", `/api/plan/${key}/${meal}`, { recipeId: r.id });
      $("pickDialog").close(); render();
sync();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
    } }, `${r.name} · ${r.type}`))
  );
  $("pickDialog").showModal();
}
$("clearSlot").onclick = () => {
  if (pickTarget && state.plan[pickTarget.key]) {
    delete state.plan[pickTarget.key][pickTarget.meal];
    mutate("DELETE", `/api/plan/${pickTarget.key}/${pickTarget.meal}`);
  }
  $("pickDialog").close(); render();
sync();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
};
$("cancelPick").onclick = () => $("pickDialog").close();

/* ---------- recipes ---------- */
function renderRecipes() {
  const q = $("search").value.trim().toLowerCase();
  const grid = $("recipeGrid");
  grid.replaceChildren();
  const hits = state.recipes
    .filter((r) => !q || r.name.toLowerCase().includes(q) || r.ingredients.some((i) => i.toLowerCase().includes(q)))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (!hits.length) grid.append(el("p", { class: "empty" }, "Nothing simmering here yet."));
  hits.forEach((r) =>
    grid.append(el("button", { class: "card", type: "button", onclick: () => openView(r.id) },
      el("h4", {}, r.name),
      el("div", { class: "meta" }, el("span", { class: "tag" }, r.type), `${r.minutes} min · serves ${r.servings}`)))
  );
}
$("search").addEventListener("input", renderRecipes);

function openView(id) {
  const r = recipeById(id);
  if (!r) return;
  viewingId = id;
  const body = $("viewBody");
  body.replaceChildren(
    el("h3", {}, r.name),
    el("div", { class: "meta" }, el("span", { class: "tag" }, r.type), `${r.minutes} min · serves ${r.servings}`),
    el("h4", {}, "Ingredients"),
    el("ul", {}, ...r.ingredients.map((i) => el("li", {}, i))),
    el("h4", {}, "Method"),
    el("ol", {}, ...r.steps.map((s) => el("li", {}, s)))
  );
  $("viewDialog").showModal();
}
$("closeView").onclick = () => $("viewDialog").close();
$("editFromView").onclick = () => { $("viewDialog").close(); openEditor(viewingId); };

function openEditor(id) {
  editingId = id;
  const f = $("recipeForm");
  const r = id ? recipeById(id) : { name: "", type: "Dinner", servings: 4, minutes: 30, ingredients: [], steps: [] };
  $("dialogTitle").textContent = id ? "Edit recipe" : "New recipe";
  f.name.value = r.name;
  f.type.value = r.type;
  f.servings.value = r.servings;
  f.minutes.value = r.minutes;
  f.ingredients.value = r.ingredients.join("\n");
  f.steps.value = r.steps.join("\n");
  $("deleteRecipe").hidden = !id;
  $("recipeDialog").showModal();
}
$("newRecipe").onclick = () => openEditor(null);
$("cancelRecipe").onclick = () => $("recipeDialog").close();
$("recipeForm").addEventListener("submit", () => {
  const f = $("recipeForm");
  const r = {
    id: editingId || "r-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: f.name.value.trim(),
    type: f.type.value,
    servings: +f.servings.value || 1,
    minutes: +f.minutes.value || 0,
    ingredients: lines(f.ingredients.value),
    steps: lines(f.steps.value),
  };
  const i = state.recipes.findIndex((x) => x.id === r.id);
  if (i >= 0) state.recipes[i] = r; else state.recipes.push(r);
  const { id, ...fields } = r;
  mutate("PUT", `/api/recipes/${id}`, fields);
  render();
sync();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
});
$("deleteRecipe").onclick = () => {
  const r = recipeById(editingId);
  if (!r || !confirm(`Delete "${r.name}"?`)) return;
  state.recipes = state.recipes.filter((x) => x.id !== editingId);
  for (const day of Object.values(state.plan)) {
    for (const m of Object.keys(day)) if (day[m] === editingId) delete day[m];
  }
  mutate("DELETE", `/api/recipes/${editingId}`);
  $("recipeDialog").close(); render();
sync();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
};

/* ---------- shopping list ---------- */
function buildShopping() {
  const totals = new Map();
  for (let i = 0; i < 7; i++) {
    const day = state.plan[dateKey(addDays(weekStart, i))] || {};
    for (const meal of MEALS) {
      const r = recipeById(day[meal]);
      if (!r) continue;
      for (const line of r.ingredients) {
        const p = parseIngredient(line);
        const key = `${p.name.toLowerCase()}|${p.unit}`;
        const cur = totals.get(key) || { name: p.name, unit: p.unit, qty: 0, hasQty: false };
        if (p.qty !== null) { cur.qty += p.qty; cur.hasQty = true; }
        totals.set(key, cur);
      }
    }
  }
  return [...totals.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));
}
function renderShop() {
  const box = $("shopList");
  box.replaceChildren();
  const items = buildShopping();
  if (!items.length) {
    box.append(el("p", { class: "empty" }, "Plan some meals and the market list will appear here."));
    return;
  }
  const wk = dateKey(weekStart);
  const checked = (state.checked[wk] ||= {});
  const section = el("div", { class: "aisle" });
  items.forEach(([key, it]) => {
    const label = [it.hasQty ? fmtQty(it.qty) : "", it.unit, it.name].filter(Boolean).join(" ");
    const cb = el("input", { type: "checkbox", checked: !!checked[key], onchange: () => {
      if (cb.checked) checked[key] = true; else delete checked[key];
      mutate("PUT", `/api/checked/${wk}`, { item: key, checked: cb.checked });
      renderShop();
    } });
    section.append(el("label", { class: "item" + (checked[key] ? " done" : "") }, cb, el("span", {}, label)));
  });
  box.append(section);
}
$("clearChecked").onclick = () => {
  const wk = dateKey(weekStart);
  state.checked[wk] = {};
  mutate("DELETE", `/api/checked/${wk}`);
  renderShop();
};

/* ---------- boot ---------- */
function render() { renderWeek(); renderRecipes(); renderShop(); }
render();
sync();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
