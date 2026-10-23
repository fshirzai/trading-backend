import express from "express";
import { once } from "node:events";
import { Product, ProductVideo, ProductVideoChunk } from "../../models.js";
import { wrap, roles, entity, tx, audit } from "../../shared/services.js";
import { requireRule, RuleError } from "../../shared/rules.js";
const staff = () => roles("admin", "manager", "procurement");
async function sendVideo(req, res, publicOnly) {
  const p = await Product.findOne({
    _id: req.params.id,
    ...(publicOnly ? { active: true } : {}),
  }).lean();
  if (!p?.video) throw new RuleError("Video not found", 404);
  const v = await ProductVideo.findOne({
    _id: p.video,
    state: "Ready",
  }).lean();
  if (!v) throw new RuleError("Video not found", 404);
  let start = 0,
    end = v.size - 1;
  if (req.headers.range) {
    const m = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range);
    if (!m || +m[1] >= v.size) {
      res.setHeader("Content-Range", `bytes */${v.size}`);
      return res.status(416).end();
    }
    start = +m[1];
    end = Math.min(m[2] ? +m[2] : end, end, start + 1024 * 1024 - 1);
    if (end < start) return res.status(416).end();
    res.status(206);
    res.setHeader("Content-Range", `bytes ${start}-${end}/${v.size}`);
  }
  res.set({
    "Content-Type": v.mime,
    "Content-Length": String(end - start + 1),
    "Accept-Ranges": "bytes",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": publicOnly ? "public, max-age=300" : "private, no-store",
    "Content-Disposition": "inline",
  });
  const first = Math.floor(start / (1024 * 1024)),
    last = Math.floor(end / (1024 * 1024));
  for (let i = first; i <= last; i++) {
    if (res.destroyed) break;
    const part = await ProductVideoChunk.findOne({
      video: v._id,
      ordinal: i,
    })
      .select("+data")
      .lean();
    if (!part) {
      res.destroy();
      break;
    }
    const data = Buffer.from(part.data.buffer || part.data);
    const from = i === first ? start % (1024 * 1024) : 0;
    const to = i === last ? (end % (1024 * 1024)) + 1 : data.length;
    if (!res.write(data.subarray(from, to)))
      await Promise.race([once(res, "drain"), once(res, "close")]);
  }
  res.end();
}
export function mountPublicVideo(app) {
  app.get(
    "/api/catalog/:id/video",
    wrap((req, res) => sendVideo(req, res, true)),
  );
}
export function mountProductVideo(app) {
  const viewers = () => roles("admin", "manager", "seller", "procurement");
  app.get(
    "/api/products/:id/video",
    viewers(),
    wrap((req, res) => sendVideo(req, res, false)),
  );
  app.get(
    "/api/products/:id/video-info",
    viewers(),
    wrap(async (req, res) => {
      const p = await entity(Product, req.params.id);
      if (!p.video) throw new RuleError("Video not found", 404);
      const v = await entity(ProductVideo, p.video);
      requireRule(v.state === "Ready", "Video not ready");
      res.json({ size: v.size, mime: v.mime, id: v.id });
    }),
  );

  app.post(
    "/api/products/:id/video",
    staff(),
    wrap(async (req, res) =>
      res.status(201).json(
        await tx(async (s) => {
          const p = await entity(Product, req.params.id, s);
          const open = await ProductVideo.countDocuments({
            product: p.id,
            state: "Uploading",
          }).session(s);
          requireRule(open < 2, "Finish or remove previous video upload first");
          const [v] = await ProductVideo.create(
            [
              {
                product: p.id,
                owner: req.user.id,
                size: req.body.size,
                mime: req.body.mime,
              },
            ],
            { session: s },
          );
          return { id: v.id, chunkSize: 1024 * 1024 };
        }),
      ),
    ),
  );
  app.post(
    "/api/products/:id/video/:videoId/chunks",
    staff(),
    express.raw({ type: ["video/mp4", "video/webm"], limit: 1024 * 1024 }),
    wrap(async (req, res) =>
      res.json(
        await tx(async (s) => {
          const v = await entity(ProductVideo, req.params.videoId, s);
          requireRule(
            String(v.product) === req.params.id &&
              String(v.owner) === req.user.id &&
              v.state === "Uploading",
            "Upload not writable",
          );
          const ordinal = Number(req.headers["x-video-chunk"]);
          requireRule(
            /^\d{1,3}$/.test(req.headers["x-video-chunk"] || ""),
            "Chunk number required",
          );
          requireRule(
            Buffer.isBuffer(req.body) &&
              req.body.length > 0 &&
              req.headers["content-type"] === v.mime,
            "Video chunk required",
          );
          if (ordinal < v.chunks) {
            const old = await ProductVideoChunk.findOne({
              video: v.id,
              ordinal,
            })
              .select("+data")
              .session(s);
            requireRule(
              old && Buffer.from(old.data).equals(req.body),
              "Chunk differs from saved data",
            );
            return { received: v.received };
          }
          requireRule(ordinal === v.chunks, "Upload chunks in sequence");
          requireRule(
            req.body.length === Math.min(1024 * 1024, v.size - v.received),
            "Incorrect chunk size",
          );
          if (ordinal === 0)
            requireRule(
              v.mime === "video/mp4"
                ? req.body.subarray(4, 8).toString() === "ftyp"
                : req.body
                    .subarray(0, 4)
                    .equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])),
              "Invalid video file signature",
            );
          await ProductVideoChunk.create(
            [{ video: v.id, ordinal, data: req.body }],
            { session: s },
          );
          v.chunks++;
          v.received += req.body.length;
          await v.save({ session: s });
          return { received: v.received };
        }),
      ),
    ),
  );
  app.post(
    "/api/products/:id/video/:videoId/complete",
    staff(),
    wrap(async (req, res) =>
      res.json(
        await tx(async (s) => {
          const p = await entity(Product, req.params.id, s),
            v = await entity(ProductVideo, req.params.videoId, s);
          requireRule(
            String(v.product) === p.id &&
              String(v.owner) === req.user.id &&
              v.received === v.size,
            "Video incomplete",
          );
          if (String(p.video) === v.id && v.state === "Ready")
            return { product: p };
          requireRule(v.state === "Uploading", "Upload already used");
          const previous = p.video;
          p.video = v._id;
          v.state = "Ready";
          await v.save({ session: s });
          await p.save({ session: s });
          if (previous) {
            await ProductVideoChunk.deleteMany(
              { video: previous },
              { session: s },
            );
            await ProductVideo.deleteOne({ _id: previous }, { session: s });
          }
          await audit(req, s, "product.video.publish", "Product", p.id);
          return { product: p };
        }),
      ),
    ),
  );
  app.post(
    "/api/products/:id/video/remove",
    staff(),
    wrap(async (req, res) =>
      res.json(
        await tx(async (s) => {
          const p = await entity(Product, req.params.id, s);
          const videos = await ProductVideo.find({ product: p.id }).session(s);
          for (const v of videos) {
            await ProductVideoChunk.deleteMany({ video: v.id }, { session: s });
            await ProductVideo.deleteOne({ _id: v.id }, { session: s });
          }
          p.video = undefined;
          await p.save({ session: s });
          await audit(req, s, "product.video.remove", "Product", p.id);
          return { product: p };
        }),
      ),
    ),
  );
}
