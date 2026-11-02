CREATE TABLE recipes (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL,
  servings    INTEGER NOT NULL DEFAULT 4,
  minutes     INTEGER NOT NULL DEFAULT 0,
  ingredients TEXT NOT NULL DEFAULT '[]',
  steps       TEXT NOT NULL DEFAULT '[]',
  updated_at  INTEGER NOT NULL
);

CREATE TABLE plan (
  day       TEXT NOT NULL,
  meal      TEXT NOT NULL,
  recipe_id TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  PRIMARY KEY (day, meal)
);

CREATE TABLE checked (
  week TEXT NOT NULL,
  item TEXT NOT NULL,
  PRIMARY KEY (week, item)
);
