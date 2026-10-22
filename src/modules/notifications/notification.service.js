import * as M from "../../models.js";
import { encrypt } from "../../shared/encryption.js";
const escape = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export async function notifyEvent(req, s, action, entity, value, details = {}) {
  const config = req.appConfig;
  if (!config) return;
  let order, party, linked;
  if (entity === "Order") order = await M.Order.findById(value).session(s);
  else if (
    [
      "Payment",
      "Shipment",
      "Return",
      "ProcurementRequest",
      "Purchase",
    ].includes(entity)
  ) {
    linked = await M[entity].findById(value).session(s);
    if (linked?.order) order = await M.Order.findById(linked.order).session(s);
  } else if (entity === "Inquiry") {
    linked = await M.Inquiry.findById(value).session(s);
    if (linked) party = await M.Party.findById(linked.customer).session(s);
  } else return;
  if (order) party = await M.Party.findById(order.customer).session(s);
  const procurement = ["Purchase", "ProcurementRequest"].includes(entity);
  const roleList = procurement
    ? ["admin", "manager", "procurement"]
    : ["admin", "manager", "seller"];
  const recipients = await M.User.find({
    active: true,
    emailVerified: true,
    $or: [
      { role: { $in: roleList } },
      ...(!procurement && party?.userId ? [{ _id: party.userId }] : []),
    ],
  }).session(s);
  const titles = {
    "inquiry.create": "Inquiry received",
    "proforma.issue": "Quotation ready for review",
    "proforma.revise": "Quotation revised",
    "proforma.accept": "Quotation accepted",
    "payment.submit": "Payment submitted for verification",
    "payment.verify": "Payment verified",
    "shipment.dispatch": "Shipment dispatched",
    "shipment.handover": "Delivery handover recorded",
    "return.request": "Return requested",
    "return.complete": "Return and refund completed",
    "return.reject": "Return rejected",
    "procurement.request": "Stock shortage requires procurement",
    "purchase.create": "Purchase recorded",
    "purchase.receive": "Purchase received",
  };
  const title = titles[action] || action.replaceAll(".", " ");
  for (const user of recipients) {
    const href = order
      ? "/#workspace/sales/" + order.id
      : entity === "Inquiry"
        ? "/#workspace/inquiries"
        : "/#workspace/procurement";
    const body = order
      ? `Order #${order.id.slice(-8)}: ${title}. Sign in to review the current record.`
      : `${title}. Sign in to review the record.`;
    const [notification] = await M.Notification.create(
      [
        {
          user: user.id,
          action,
          entity,
          entityId: String(value),
          title,
          body,
          href,
        },
      ],
      { session: s },
    );
    const url = new URL(href, config.frontendUrl).href;
    const summary =
      order && action.startsWith("proforma.")
        ? `<p>Quotation version ${order.version} - USD ${(order.totalCents / 100).toFixed(2)}</p>`
        : "";
    const payload = {
      to: user.email,
      subject: `${config.emailBrandName || "Trading Company"} - ${title}`,
      text: `${body}\n${url}`,
      html: `<div style="background:#edf2f7;padding:32px;font-family:Arial,sans-serif"><div style="max-width:600px;margin:auto;background:white;padding:32px;border-radius:12px"><h2 style="color:#15334f">${escape(config.emailBrandName || "Trading Company")}</h2><h3>${escape(title)}</h3><p>${escape(body)}</p>${summary}<a style="display:inline-block;background:#0d766e;color:white;padding:14px 22px;text-decoration:none;border-radius:6px" href="${escape(url)}">Open dashboard</a><p style="color:#607080;font-size:12px">Sign in to view protected records. This message does not confirm unverified bank funds.</p></div></div>`,
    };
    await M.EmailJob.create(
      [
        {
          notification: notification.id,
          payload: encrypt(JSON.stringify(payload), config.encryptionKey),
          availableAt: new Date(),
          validUntil: new Date(Date.now() + 7 * 86400000),
        },
      ],
      { session: s },
    );
  }
}
