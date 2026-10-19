import { wrap, tx, roles, manage, entity, audit, list } from "./services.js";
import { cents, requireRule } from "./rules.js";
export function readRecords(app, path, Model, allowed) {
  app.get(
    "/api/records/" + path,
    roles(...allowed),
    wrap(async (req, res) => res.json(await list(Model, {}, req.query))),
  );
}
export function createRecord(
  app,
  path,
  Model,
  allowed,
  fields,
  check = () => {},
) {
  app.post(
    "/api/records/" + path,
    roles(...allowed),
    wrap(async (req, res) => {
      check(req);
      const body = Object.fromEntries(
        fields
          .filter((f) => req.body[f] !== undefined)
          .map((f) => [f, req.body[f]]),
      );
      if (path === "employee") body.salaryCents = cents(req.body.salary);
      res.status(201).json(
        await tx(async (s) => {
          const [item] = await Model.create([body], { session: s });
          await audit(req, s, "create", path, item.id);
          return item;
        }),
      );
    }),
  );
}
export function patchRecord(app, path, Model, allowed) {
  app.patch(
    "/api/records/" + path + "/:id",
    roles(...allowed),
    wrap(async (req, res) => {
      requireRule(Object.keys(req.body).length > 0, "No changes supplied");
      res.json(
        await tx(async (s) => {
          const item = await entity(Model, req.params.id, s),
            body = { ...req.body };
          if (body.salary !== undefined) {
            body.salaryCents = cents(body.salary);
            delete body.salary;
          }
          Object.assign(item, body);
          await item.save({ session: s });
          await audit(req, s, "record.update", path, item.id, {
            fields: Object.keys(body),
          });
          return item;
        }),
      );
    }),
  );
}
