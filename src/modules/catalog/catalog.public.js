import { Product } from "./catalog.model.js";
import { wrap, entity, list } from "../../shared/services.js";
import { RuleError } from "../../shared/rules.js";
export function mountPublicCatalog(app) {
  app.get(
    "/api/catalog/filters",
    wrap(async (req, res) => {
      const [categories, origins, grades] = await Promise.all(
        ["category", "origin", "grade"].map((k) =>
          Product.distinct(k, { active: true }).maxTimeMS(5000),
        ),
      );
      res.json({
        categories: categories.filter(Boolean).sort(),
        origins: origins.filter(Boolean).sort(),
        grades: grades.filter(Boolean).sort(),
      });
    }),
  );
  app.get(
    "/api/catalog/:id",
    wrap(async (req, res) => {
      const p = await entity(Product, req.params.id);
      if (!p.active) throw new RuleError("Product not found", 404);
      res.json(p);
    }),
  );
  app.get(
    "/api/catalog",
    wrap(async (req, res) => {
      const filter = { active: true };
      for (const k of ["category", "origin", "grade"])
        if (req.query[k]) filter[k] = req.query[k];
      res.json(await list(Product, filter, req.query));
    }),
  );
}
