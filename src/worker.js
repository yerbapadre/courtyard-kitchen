// API for La Corte. Static files are served by the assets binding;
// only /api/* reaches this Worker (see run_worker_first in wrangler.jsonc).

const MEALS = ["Breakfast", "Lunch", "Dinner"];
const TYPES = ["Breakfast", "Lunch", "Dinner", "Dessert"];
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

async function sameSecret(a, b) {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const x = new Uint8Array(ha), y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

const strList = (v) => Array.isArray(v) ? v.filter((s) => typeof s === "string").map((s) => s.slice(0, 500)).slice(0, 100) : [];

function cleanRecipe(body, id) {
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 200) : "";
  if (!name || !TYPES.includes(body.type)) return null;
  return {
    id,
    name,
    type: body.type,
    servings: Math.min(Math.max(parseInt(body.servings, 10) || 1, 1), 100),
    minutes: Math.min(Math.max(parseInt(body.minutes, 10) || 0, 0), 10000),
    ingredients: strList(body.ingredients),
    steps: strList(body.steps),
  };
}

async function readBody(request) {
  try { return await request.json(); } catch { return null; }
}

async function getState(db) {
  const [recipes, plan, checked] = await db.batch([
    db.prepare("SELECT * FROM recipes ORDER BY name"),
    db.prepare("SELECT day, meal, recipe_id FROM plan"),
    db.prepare("SELECT week, item FROM checked"),
  ]);
  const planMap = {};
  for (const p of plan.results) (planMap[p.day] ||= {})[p.meal] = p.recipe_id;
  const checkedMap = {};
  for (const c of checked.results) (checkedMap[c.week] ||= {})[c.item] = true;
  return {
    recipes: recipes.results.map((r) => ({
      id: r.id, name: r.name, type: r.type, servings: r.servings, minutes: r.minutes,
      ingredients: JSON.parse(r.ingredients), steps: JSON.parse(r.steps),
    })),
    plan: planMap,
    checked: checkedMap,
  };
}

function saveRecipe(db, r) {
  return db.prepare(
    `INSERT INTO recipes (id, name, type, servings, minutes, ingredients, steps, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
     ON CONFLICT(id) DO UPDATE SET name = ?2, type = ?3, servings = ?4, minutes = ?5,
       ingredients = ?6, steps = ?7, updated_at = ?8`
  ).bind(r.id, r.name, r.type, r.servings, r.minutes, JSON.stringify(r.ingredients), JSON.stringify(r.steps), Date.now());
}

async function route(request, env, url) {
  const db = env.DB;
  const path = url.pathname;
  const method = request.method;
  let m;

  if (path === "/api/state" && method === "GET") return json(await getState(db));

  if ((m = path.match(/^\/api\/recipes\/([\w-]{1,64})$/))) {
    const id = m[1];
    if (method === "PUT") {
      const body = await readBody(request);
      const r = body && cleanRecipe(body, id);
      if (!r) return json({ error: "Invalid recipe" }, 400);
      await saveRecipe(db, r).run();
      return json({ ok: true });
    }
    if (method === "DELETE") {
      // plan rows go with it via ON DELETE CASCADE; D1 enforces foreign keys
      await db.batch([
        db.prepare("DELETE FROM plan WHERE recipe_id = ?1").bind(id),
        db.prepare("DELETE FROM recipes WHERE id = ?1").bind(id),
      ]);
      return json({ ok: true });
    }
  }

  if ((m = path.match(/^\/api\/plan\/(\d{4}-\d{2}-\d{2})\/(\w+)$/))) {
    const [, day, meal] = m;
    if (!DAY_RE.test(day) || !MEALS.includes(meal)) return json({ error: "Invalid slot" }, 400);
    if (method === "PUT") {
      const body = await readBody(request);
      if (!body || typeof body.recipeId !== "string") return json({ error: "recipeId required" }, 400);
      const exists = await db.prepare("SELECT 1 FROM recipes WHERE id = ?1").bind(body.recipeId).first();
      if (!exists) return json({ error: "Unknown recipe" }, 404);
      await db.prepare(
        "INSERT INTO plan (day, meal, recipe_id) VALUES (?1, ?2, ?3) ON CONFLICT(day, meal) DO UPDATE SET recipe_id = ?3"
      ).bind(day, meal, body.recipeId).run();
      return json({ ok: true });
    }
    if (method === "DELETE") {
      await db.prepare("DELETE FROM plan WHERE day = ?1 AND meal = ?2").bind(day, meal).run();
      return json({ ok: true });
    }
  }

  if ((m = path.match(/^\/api\/checked\/(\d{4}-\d{2}-\d{2})$/))) {
    const week = m[1];
    if (method === "PUT") {
      const body = await readBody(request);
      if (!body || typeof body.item !== "string" || !body.item || body.item.length > 300) return json({ error: "item required" }, 400);
      if (body.checked) {
        await db.prepare("INSERT OR IGNORE INTO checked (week, item) VALUES (?1, ?2)").bind(week, body.item).run();
      } else {
        await db.prepare("DELETE FROM checked WHERE week = ?1 AND item = ?2").bind(week, body.item).run();
      }
      return json({ ok: true });
    }
    if (method === "DELETE") {
      await db.prepare("DELETE FROM checked WHERE week = ?1").bind(week).run();
      return json({ ok: true });
    }
  }

  if (path === "/api/seed" && method === "POST") {
    // One-time import of recipes (used for the starter set and for moving over
    // anything saved in the old browser-only version). Existing ids are kept.
    const body = await readBody(request);
    if (!body || !Array.isArray(body.recipes)) return json({ error: "recipes required" }, 400);
    const stmts = [];
    for (const raw of body.recipes.slice(0, 500)) {
      const id = typeof raw.id === "string" && /^[\w-]{1,64}$/.test(raw.id) ? raw.id : null;
      const r = id && cleanRecipe(raw, id);
      if (!r) continue;
      stmts.push(db.prepare(
        `INSERT OR IGNORE INTO recipes (id, name, type, servings, minutes, ingredients, steps, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
      ).bind(r.id, r.name, r.type, r.servings, r.minutes, JSON.stringify(r.ingredients), JSON.stringify(r.steps), Date.now()));
    }
    if (stmts.length) await db.batch(stmts);
    return json({ ok: true, imported: stmts.length });
  }

  return json({ error: "Not found" }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

    if (!env.FAMILY_PASSCODE) return json({ error: "Server is missing FAMILY_PASSCODE" }, 500);
    const sent = request.headers.get("x-passcode") || "";
    if (!(await sameSecret(sent, env.FAMILY_PASSCODE))) return json({ error: "Wrong passcode" }, 401);

    try {
      return await route(request, env, url);
    } catch (e) {
      console.error(e);
      return json({ error: "Server error" }, 500);
    }
  },
};
