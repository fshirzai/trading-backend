import PDFDocument from "pdfkit";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { CompanyLogo, SystemSettings } from "../settings/settings.model.js";
import { orderItems } from "../inventory/reservations.service.js";
import { quotationDocument } from "./proforma.service.js";
const small = [
  "Zero",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
];
function words(n) {
  if (n < 20) return small[n];
  if (n < 100)
    return (
      [
        "",
        "",
        "Twenty",
        "Thirty",
        "Forty",
        "Fifty",
        "Sixty",
        "Seventy",
        "Eighty",
        "Ninety",
      ][Math.floor(n / 10)] + (n % 10 ? " " + words(n % 10) : "")
    );
  if (n < 1000)
    return (
      words(Math.floor(n / 100)) +
      " Hundred" +
      (n % 100 ? " " + words(n % 100) : "")
    );
  for (const [value, label] of [
    [1e9, "Billion"],
    [1e6, "Million"],
    [1000, "Thousand"],
  ])
    if (n >= value)
      return (
        words(Math.floor(n / value)) +
        " " +
        label +
        (n % value ? " " + words(n % value) : "")
      );
}
export function amountInWords(cents) {
  return (
    words(Math.floor(cents / 100)) +
    (Math.floor(cents / 100) === 1 ? " US Dollar" : " US Dollars") +
    (cents % 100
      ? " and " + words(cents % 100) + (cents % 100 === 1 ? " Cent" : " Cents")
      : "") +
    " Only."
  );
}
const money = (n) =>
  Number(n / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
const number = (n) =>
  Number(n).toLocaleString("en-US", { maximumFractionDigits: 6 });
export async function commercialPdf({
  order,
  customer,
  type = "proforma",
  invoice,
  config = {},
  draft = false,
}) {
  const terms =
    order.quotationDocument ||
    (await quotationDocument(
      customer,
      {
        issueDate: new Date(order.createdAt || Date.now())
          .toISOString()
          .slice(0, 10),
      },
      null,
      config,
    ));
  const doc = new PDFDocument({
    size: "A4",
    margin: 36,
    bufferPages: true,
    info: {
      Title:
        type === "proforma"
          ? "Proforma Invoice"
          : type === "packing-list"
            ? "Packing List"
            : "Commercial Invoice",
      Author: terms.seller?.name || "Trading Company",
    },
  });
  const chunks = [];
  const completed = new Promise((resolve, reject) => {
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  // Font bytes are explicitly traced and bundled for Arabic-script company/bank names.
  doc.registerFont(
    "Arabic",
    await readFile(new URL("./assets/NotoNaskhArabic.ttf", import.meta.url)),
  );
  doc.registerFont(
    "Regular",
    await readFile(new URL("./assets/DejaVuSans.ttf", import.meta.url)),
  );
  doc.registerFont(
    "Bold",
    await readFile(new URL("./assets/DejaVuSans-Bold.ttf", import.meta.url)),
  );
  const left = 36,
    width = 523.28,
    bottom = 796;
  let y = 36;
  const title =
    (draft ? "DRAFT - " : "") +
    (type === "proforma"
      ? "PROFORMA INVOICE"
      : type === "packing-list"
        ? "PACKING LIST"
        : "COMMERCIAL INVOICE");
  const reference =
    invoice?.number ||
    terms.reference ||
    "PI-" + String(order.id || order._id).toUpperCase();
  function font(text, bold = false) {
    doc.font(
      /[\u0600-\u06ff]/.test(String(text))
        ? "Arabic"
        : bold
          ? "Bold"
          : "Regular",
    );
  }
  function measure(text, w, size = 8.5, bold = false) {
    font(text, bold);
    return doc
      .fontSize(size)
      .heightOfString(String(text || "-"), { width: w, lineGap: 1 });
  }
  function text(value, x, top, w, size = 8.5, bold = false, align = "left") {
    font(value, bold);
    doc
      .fillColor("#152235")
      .fontSize(size)
      .text(String(value || "-"), x, top, { width: w, lineGap: 1, align });
  }
  function page() {
    doc.addPage();
    y = 36;
    text(title + " - CONTINUED", left, y, width, 13, true);
    y += 22;
    text(reference, left, y, width, 8);
    y += 24;
  }
  function ensure(h) {
    if (y + h > bottom) page();
  }
  function pair(a, b) {
    const cw = width / 2;
    const height =
      Math.max(
        ...[a, b].map(
          (block) =>
            24 +
            block.lines.reduce((n, l) => n + measure(l, cw - 18, 8.2) + 1, 0),
        ),
      ) + 7;
    ensure(height);
    for (const [i, block] of [a, b].entries()) {
      const x = left + i * cw;
      doc.lineWidth(0.6).strokeColor("#89919b").rect(x, y, cw, height).stroke();
      doc.fillColor("#edf0f3").rect(x, y, cw, 19).fill();
      text(block.title, x + 9, y + 6, cw - 18, 8.5, true);
      let ty = y + 25;
      for (const line of block.lines) {
        text(line, x + 9, ty, cw - 18, 8.2);
        ty += measure(line, cw - 18, 8.2) + 1;
      }
    }
    y += height;
  }
  text(title, left, y, width, 20, true, "center");
  y += 25;
  text(
    "Reference: " + reference + "  |  Version: " + (order.version || 1),
    left,
    y,
    width,
    8.5,
    false,
    "center",
  );
  y += 19;
  const settings = await SystemSettings.findById("company")
    .select("logoVersion")
    .lean();
  if (settings?.logoVersion) {
    const logo = await CompanyLogo.findById("company").select("+data").lean();
    if (logo?.data) {
      const bytes = Buffer.isBuffer(logo.data)
        ? logo.data
        : Buffer.from(logo.data.buffer || logo.data);
      const png = await sharp(bytes)
        .resize({ width: 220, height: 65, fit: "inside" })
        .png()
        .toBuffer();
      doc.image(png, left, y, { fit: [110, 33] });
      y += 42;
    }
  }
  const seller = terms.seller || {},
    buyer = terms.buyer || customer || {},
    bank = terms.bank || {};
  const paymentTerms =
    "Minimum 50% of product value before dispatch; remaining balance at handover.";
  pair(
    {
      title: "SELLER / EXPORTER",
      lines: [
        seller.name || "Trading Company",
        "Address: " + (seller.address || "-"),
        "Telephone: " + (seller.phone || "-"),
        "Email: " + (seller.email || "-"),
        "Registration No.: " + (seller.registrationNo || "-"),
        "Tax / TIN No.: " + (seller.taxNo || "-"),
      ],
    },
    {
      title: "PROFORMA / INVOICE DETAILS",
      lines: [
        "Invoice No.: " + reference,
        "Date: " +
          (terms.issueDate ||
            new Date(order.createdAt || Date.now()).toISOString().slice(0, 10)),
        "Valid until: " + (terms.validUntil || "As agreed"),
        "Currency: USD",
        "Payment terms: " + paymentTerms,
        "Delivery terms / Incoterms: " + (terms.deliveryTerms || "As agreed"),
      ],
    },
  );
  pair(
    {
      title: "BUYER / IMPORTER",
      lines: [
        buyer.name || customer?.name || "-",
        "Address: " + (buyer.address || "-"),
        "Country: " + (buyer.country || "-"),
        "Contact person: " + (buyer.contact || "-"),
        "Telephone: " + (buyer.phone || "-"),
        "Email: " + (buyer.email || "-"),
        "Registration / Tax No.: " +
          [buyer.registrationNo, buyer.taxNo].filter(Boolean).join(" / "),
      ],
    },
    {
      title: "SHIPPING / DELIVERY",
      lines: [
        "Country of origin: " +
          (terms.origin || orderItems(order)[0]?.snapshot?.origin || "-"),
        "Port / place of loading: " + (terms.loadingPlace || "-"),
        "Destination: " + (order.border || "-"),
        "Transport: " + (terms.transport || "-"),
        "Final delivery address: " +
          (terms.deliveryAddress || order.border || "-"),
        "Other instructions: " + (terms.instructions || "-"),
      ],
    },
  );
  y += 12;
  const widths = [30, 97, 146.28, 72, 82, 96];
  const headings = [
    "No.",
    "Quantity / Packaging",
    "Description of goods",
    "Unit price USD",
    "Total USD",
    "Remarks",
  ];
  function tableHead() {
    ensure(44);
    let x = left;
    for (let i = 0; i < widths.length; i++) {
      doc.fillColor("#edf0f3").rect(x, y, widths[i], 33).fill();
      doc.strokeColor("#89919b").rect(x, y, widths[i], 33).stroke();
      text(
        headings[i],
        x + 5,
        y + 8,
        widths[i] - 10,
        8,
        true,
        i > 2 && i < 5 ? "right" : "left",
      );
      x += widths[i];
    }
    y += 33;
  }
  tableHead();
  for (const [i, line] of orderItems(order).entries()) {
    const snap = line.snapshot || {};
    const quantity = [
      number(line.quantity) + " " + (snap.unit || "units"),
      snap.packaging || "",
      snap.bagCount
        ? number(snap.bagCount) + " bags x " + number(snap.bagWeightKg) + " kg"
        : "",
    ]
      .filter(Boolean)
      .join("\n");
    const values = [
      String(i + 1),
      quantity,
      [
        snap.name?.en || "Product",
        snap.grade ? "Grade: " + snap.grade : "",
        snap.origin ? "Origin: " + snap.origin : "",
      ]
        .filter(Boolean)
        .join("\n"),
      number(line.productCents / 100 / line.quantity) +
        " / " +
        (snap.unit || "unit"),
      type === "packing-list" ? "-" : money(line.productCents),
      snap.remarks || "-",
    ];
    if (type === "packing-list") values[3] = "-";
    const h = Math.max(
      43,
      ...values.map((v, j) => measure(v, widths[j] - 10) + 16),
    );
    if (y + h > bottom) {
      page();
      tableHead();
    }
    let x = left;
    for (const [j, v] of values.entries()) {
      doc
        .strokeColor("#89919b")
        .lineWidth(0.6)
        .rect(x, y, widths[j], h)
        .stroke();
      text(
        v,
        x + 5,
        y + 8,
        widths[j] - 10,
        8.5,
        false,
        j === 3 || j === 4 ? "right" : "left",
      );
      x += widths[j];
    }
    y += h;
  }
  if (type !== "packing-list") {
    for (const [label, value, strong] of [
      ["PRODUCT VALUE", order.productCents],
      ["DELIVERY FEES", order.feesCents || 0],
      ["TOTAL AMOUNT USD", order.totalCents, true],
    ]) {
      ensure(25);
      doc
        .fillColor(strong ? "#edf0f3" : "#ffffff")
        .rect(left, y, width, 25)
        .fill();
      doc.strokeColor("#89919b").rect(left, y, width, 25).stroke();
      text(label, left + 8, y + 8, width - 104, 8.5, !!strong, "right");
      text(money(value), left + width - 94, y + 8, 84, 9, !!strong, "right");
      y += 25;
    }
    y += 12;
    pair(
      { title: "AMOUNT IN WORDS", lines: [amountInWords(order.totalCents)] },
      {
        title: "PAYMENT / BANK INFORMATION",
        lines: [
          "Bank name: " + (bank.name || "-"),
          "Account name: " + (bank.accountName || "-"),
          "Account No. / IBAN: " + (bank.accountNumber || "-"),
          "SWIFT code: " + (bank.swiftCode || "-"),
          "Payment instructions: " +
            (bank.instructions ||
              "Use the agreed order reference for payment."),
        ],
      },
    );
  }
  y += 10;
  pair(
    {
      title: "NOTES / TERMS & CONDITIONS",
      lines: [
        type === "proforma"
          ? "Issued for quotation and payment purposes. Prices become binding upon acceptance."
          : "Reflects the recorded order and its agreed terms.",
        ...(terms.notes ? [terms.notes] : []),
        "Cancellation before dispatch: refund verified funds paid. After dispatch: retain 25% of order total.",
        "Return request window: " +
          (order.returnHours || 24) +
          " hours from the first handover. Returns require inspection and acceptable product condition.",
      ],
    },
    {
      title: "AUTHORIZED SIGNATURE / STAMP",
      lines: [
        " ",
        " ",
        "Name: " + (terms.signatory?.name || "-"),
        "Position: " + (terms.signatory?.position || "-"),
        "Signature / stamp: ____________________",
      ],
    },
  );
  const pages = doc.bufferedPageRange();
  for (let i = 0; i < pages.count; i++) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0;
    doc
      .moveTo(left, 810)
      .lineTo(left + width, 810)
      .strokeColor("#c4c9d0")
      .stroke();
    text(
      draft
        ? "UNSAVED DRAFT - NOT ISSUED"
        : type === "proforma"
          ? "PROFORMA INVOICE - NOT A FINAL COMMERCIAL INVOICE"
          : "GENERATED FROM RECORDED ORDER TERMS",
      left,
      817,
      width - 70,
      7,
    );
    text(
      "Page " + (i + 1) + " of " + pages.count,
      left + width - 68,
      817,
      68,
      7,
      false,
      "right",
    );
  }
  doc.end();
  return completed;
}
