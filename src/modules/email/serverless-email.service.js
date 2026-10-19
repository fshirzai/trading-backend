import { EmailJob } from "./email.model.js";
import { deliverOne } from "./email.service.js";

// Bounded request-scoped work. Database leases in deliverOne coordinate instances.
export async function drainEmailJobs(
  config,
  {
    deliver = deliverOne,
    nextJob = () =>
      EmailJob.findOne({ state: "Queued", validUntil: { $gt: new Date() } })
        .sort({ availableAt: 1 })
        .select("availableAt")
        .lean(),
    now = Date.now,
    pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    budgetMs = 75000,
    maxJobs = 10,
  } = {},
) {
  const deadline = now() + budgetMs;
  let processed = 0;
  while (processed < maxJobs && now() < deadline) {
    if (await deliver(config)) {
      processed++;
      continue;
    }
    const next = await nextJob();
    if (!next) break;
    const delay = Math.max(250, new Date(next.availableAt).getTime() - now());
    if (!Number.isFinite(delay) || now() + delay + 15000 >= deadline) break;
    await pause(delay);
  }
  return processed;
}
