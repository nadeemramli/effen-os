/* Temporary seed sanity check — run with `pnpm dlx tsx src/lib/seed/__check__.ts`. */
import { assertSeedInvariants, composeSeedSnapshot } from "./index";
import { sumRows } from "@/lib/domain/metrics";
import { dateKey } from "./clock";

assertSeedInvariants();
const s = composeSeedSnapshot();
const yesterday = dateKey(1);
const yRows = s.dailyRows.filter((r) => r.date === yesterday);
const t = sumRows(yRows);
const plan = s.dailyPlan.filter((p) => p.date === yesterday);
console.log("orders:", s.orders.length);
console.log("events:", s.orderEvents.length);
console.log("customers:", s.customers.length, "with orders:", s.customers.filter((c) => c.lifetimeOrders > 0).length);
console.log("yesterday revenue RM:", (t.netRevenue / 100).toFixed(0));
console.log("yesterday contribution RM:", (t.contribution / 100).toFixed(0));
console.log("yesterday plan RM:", (plan.reduce((x, p) => x + p.expectedContribution, 0) / 100).toFixed(0));
console.log("yesterday ad spend RM:", (t.adSpend / 100).toFixed(0));
console.log("yesterday orders:", t.orders, "new mix:", (t.newCustomerOrders / Math.max(t.orders, 1)).toFixed(2));
console.log("blended MER yesterday:", (t.netRevenue / Math.max(t.adSpend, 1)).toFixed(2));
console.log("pending recs:", s.recommendations.filter((r) => r.status === "pending").length);
console.log("stale ints:", s.integrations.filter((i) => i.status === "stale").length);
console.log("draft orders:", s.orders.filter((o) => o.isDraft).length);
console.log("exceptions:", s.orders.filter((o) => o.exceptionStatus !== "none").length);
console.log("OK");
