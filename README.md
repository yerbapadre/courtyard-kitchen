# La Corte — Family Kitchen

A meal planning and recipe app for the family, dressed like an Italian courtyard: terracotta, ochre, stucco and cypress.

- **Weekly Table** — plan breakfast, lunch and dinner for each day of the week
- **Recipe Book** — add, edit, search and delete recipes (a few Italian classics included)
- **Market List** — a shopping list built from the week's plan, with quantities combined and checkboxes

No build step and no server. Data is saved in your browser (localStorage).

## Run it

Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000
```

Ingredients are entered one per line, e.g. `2 cups flour` or `1 lb spaghetti`, so the market list can add them up.
