// Ninja Van API client + payload builder. Shadow mode uses ONLY
// buildOrderPayload; getToken/createOrder run in live mode.
//
// Endpoints are config, not law: NV_API_BASE (env, default api.ninjavan.co)
// and the country code from the connection. Path versions (2.0 oauth,
// 4.2 orders) MUST be re-verified against current NV docs before any store
// flips to live (ADR-0006 runbook step 2) — shadow mode never calls out.

// deno-lint-ignore-file no-explicit-any

export interface OrderLike {
  id: number;
  integration_id: number;
  source_order_id: string;
  order_number: string | null;
  total: number | string;
  currency_code: string;
  customer: Record<string, string | null>;
  items: { sku: string | null; name: string | null; quantity: number }[];
  raw: any;
}

export interface CorrectionLike {
  corrected: Record<string, string>;
}

/** Corrections overlay → shipping block → billing block, per field. */
function field(order: OrderLike, correction: CorrectionLike | null, key: string): string {
  const corrected = correction?.corrected?.[key];
  if (corrected && corrected.trim() !== "") return corrected.trim();
  const shipping = order.raw?.shipping?.[key];
  if (typeof shipping === "string" && shipping.trim() !== "") return shipping.trim();
  const billing = order.raw?.billing?.[key];
  if (typeof billing === "string" && billing.trim() !== "") return billing.trim();
  return "";
}

function recipientName(order: OrderLike, correction: CorrectionLike | null): string {
  const corrected = correction?.corrected?.name;
  if (corrected && corrected.trim() !== "") return corrected.trim();
  const ship = [order.raw?.shipping?.first_name, order.raw?.shipping?.last_name]
    .filter(Boolean).join(" ").trim();
  if (ship !== "") return ship;
  return [order.raw?.billing?.first_name, order.raw?.billing?.last_name]
    .filter(Boolean).join(" ").trim();
}

/** +60/+65 normalization — mirrors the ship_grades suggestion logic. */
export function normalizePhone(rawPhone: string, market: string): string {
  const digits = rawPhone.replace(/[^0-9]/g, "");
  if (market === "SG") {
    if (/^(65)?[89][0-9]{7}$/.test(digits)) return "+65" + digits.slice(-8);
    return rawPhone;
  }
  if (/^(60)?0?1[0-9]{8,9}$/.test(digits)) return "+60" + digits.replace(/^(60|0)/, "");
  return rawPhone;
}

export function idempotencyKey(order: OrderLike): string {
  return `FK-${order.integration_id}-${order.source_order_id}`;
}

/**
 * Full NV order-create body (v4.2 shape). Pure — same inputs, same payload.
 * Pickup ("from") comes from the store connection's config.nv_pickup, which
 * must be filled from Fighter's current consignments before payloads are
 * meaningful for fidelity review (ADR-0006 OQ2); a placeholder keeps shadow
 * generation running and is obvious in review.
 */
export function buildOrderPayload(
  order: OrderLike,
  correction: CorrectionLike | null,
  conn: { config?: any },
): Record<string, unknown> {
  const market: string = conn.config?.country_code ?? "MY";
  const phone = normalizePhone(field(order, correction, "phone") || (order.customer?.phone ?? ""), market);
  const codMethods = ["cod", "cash_on_delivery"];
  const isCod = codMethods.includes(String(order.raw?.payment_method ?? "").toLowerCase());
  const deliveryStart = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10);

  return {
    service_type: "Parcel",
    service_level: conn.config?.nv_service_level ?? "Standard",
    reference: { merchant_order_number: idempotencyKey(order) },
    from: conn.config?.nv_pickup ?? {
      name: "PLACEHOLDER — set config.nv_pickup on the store connection",
      phone_number: "",
      email: "",
      address: {
        address1: "", city: "", state: "", country: market, postcode: "",
      },
    },
    to: {
      name: recipientName(order, correction),
      phone_number: phone,
      email: order.customer?.email ?? "",
      address: {
        address1: field(order, correction, "address_1"),
        address2: order.raw?.shipping?.address_2 || order.raw?.billing?.address_2 || "",
        city: field(order, correction, "city"),
        state: field(order, correction, "state"),
        country: market,
        postcode: field(order, correction, "postcode"),
      },
    },
    parcel_job: {
      is_pickup_required: false,
      delivery_start_date: deliveryStart,
      delivery_timeslot: {
        start_time: "09:00",
        end_time: "18:00",
        timezone: market === "SG" ? "Asia/Singapore" : "Asia/Kuala_Lumpur",
      },
      ...(isCod ? { cash_on_delivery: Number(order.total) } : {}),
      dimensions: { weight: Number(conn.config?.nv_default_weight_kg ?? 1) },
      items: (order.items ?? []).map((li) => ({
        item_description: li.name ?? li.sku ?? "item",
        quantity: li.quantity || 1,
      })),
    },
  };
}

const NV_BASE = Deno.env.get("NV_API_BASE") ?? "https://api.ninjavan.co";

/** OAuth client_credentials token, cached in nv_tokens. Live mode only. */
export async function getToken(supabase: any, countryCode: string): Promise<string> {
  const { data: cached } = await supabase
    .from("nv_tokens").select("access_token, expires_at").eq("provider", "ninjavan").maybeSingle();
  if (cached && new Date(cached.expires_at).getTime() > Date.now() + 60_000) {
    return cached.access_token;
  }

  const { data: secrets } = await supabase.rpc("get_nv_secrets");
  const clientId = secrets?.[0]?.client_id;
  const clientKey = secrets?.[0]?.client_key;
  if (!clientId || !clientKey) throw new Error("NV credentials not configured");

  const res = await fetch(`${NV_BASE}/${countryCode}/2.0/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientKey,
      grant_type: "client_credentials",
    }),
  });
  if (!res.ok) throw new Error(`NV oauth failed: HTTP ${res.status}`);
  const token = await res.json();

  await supabase.from("nv_tokens").upsert({
    provider: "ninjavan",
    access_token: token.access_token,
    expires_at: new Date(Date.now() + (token.expires_in ?? 3600) * 1000).toISOString(),
  });
  return token.access_token;
}

/** Live mode only — never reached while fulfilment_mode is 'shadow'. */
export async function createOrder(
  token: string,
  countryCode: string,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; body: any }> {
  const res = await fetch(`${NV_BASE}/${countryCode}/4.2/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, body };
}
