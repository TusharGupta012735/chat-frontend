# /select — Cart & Quote (SSE)

## Purpose

The `/select` API places a cart (provider, address, and items — including F&B customizations) against a BPP and asks for a live quote. Because the BPP's `/on_select` response arrives asynchronously, this BFF pushes it to the frontend over a **Server-Sent Events (SSE)** stream instead of requiring the client to poll. The frontend calls `/select` right after the buyer finalizes their cart on a provider's menu page (or changes address/items).

**This stream is one-shot, scoped to this one `/select` call only (as of 2026-07-18, `SELECT-04`).** The backend closes it immediately after the `on_select` event is delivered — on every outcome (success, non-serviceable, or any error). Open a fresh stream (new `clientId`) before your next request (`/init`, etc.) — do not assume this connection is still usable afterward.

## Related APIs

`/select` is one step in the order lifecycle. See the sibling docs in this folder for the rest:

- `init.md` — checkout, cancellation terms
- `confirm.md` — order confirmation, payment proof
- `status.md` — order/fulfillment status polling
- `cancel.md` — buyer-initiated cancellation
- `update.md` — returns, replacements, order updates
- `track.md` — live rider tracking
- `issue.md` — post-order grievance/dispute (IGM)

## Request

Open the SSE stream **before** sending `POST /select`, using a freshly generated `clientId` (UUID v4), so no events are missed.

```bash
# 1. Open the SSE stream first
curl -N -H "Authorization: Bearer <token>" \
  https://<host>/api/v1/stream/a1b2c3d4-e5f6-7890-abcd-ef1234567890

# 2. Then send the select request, referencing the same client_id
curl -X POST https://<host>/api/v1/select \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "provider_id": "P001",
    "bpp_id": "seller-app.example.com",
    "location_id": "L1",
    "address_id": "1",
    "client_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "items": [
      {
        "item_id": "I001",
        "quantity": 2,
        "customizations": [
          { "id": "CG001-opt1", "cg_id": "CG001" }
        ]
      },
      {
        "item_id": "I002",
        "quantity": 1
      }
    ]
  }'
```

**Required fields:**

| Field | Type | Description |
|-------|------|-------------|
| `provider_id` | string | Provider ID from catalog |
| `bpp_id` | string | Seller app ID the provider belongs to — required because `provider_id` alone is not globally unique across BPPs. Comes from the `bpp_id` field already returned by `/providers` and `/items` responses. |
| `location_id` | string | Location ID from provider |
| `address_id` | number | Delivery address ID belonging to authenticated user |
| `items` | array | Array of items (see below) |

**Optional:**

| Field | Type | Description |
|-------|------|-------------|
| `fulfillment_id` | string | Fulfillment ID from provider. Omit and let the backend resolve it (recommended). If supplied but it doesn't match the provider's own fulfillment id (or the BPP-level Delivery fulfillment id), it is no longer rejected — the backend silently uses its own resolved value instead (as of 2026-07-28, `FULFILL-01`). |

**Recommended (not enforced, but strongly advised):**

| Field | Type | Description |
|-------|------|-------------|
| `client_id` | string | UUID matching the SSE connection opened in step 1. Always send this — the fallback delivery path only works if the SSE stream was opened with a JWT. |

**Item shape:**

```ts
interface SelectItem {
  item_id: string;          // catalog item ID
  quantity: number;         // default 1 if omitted
  customizations?: {        // omit for plain items
    id: string;             // customization item ID
    cg_id: string;          // customization group ID
  }[];
}
```

> `payment_type` is not accepted in this request — this BAP only ever supports BAP-collected prepaid, so there is nothing to send here.

## Response

`POST /select` returns `202 Accepted` immediately — this only acknowledges the request was queued, it is not the quote itself:

```json
{
  "transaction_id": "uuid",
  "message_id": "uuid",
  "status": "pending",
  "message": "Select request sent. SSE stream is open — response will be pushed."
}
```

| Field | Type | Description |
|-------|------|-------------|
| `transaction_id` | string | ONDC transaction ID for this order flow — reused across `/init`, `/confirm`, etc. |
| `message_id` | string | ONDC message ID for this specific `/select` call |
| `status` | string | Always `"pending"` on a `202` — the real result arrives via the `on_select` SSE event |
| `message` | string | Human-readable status message |

## SSE events

**Route:** `GET /api/v1/stream/:clientId` (requires `Authorization: Bearer <token>`)

### `on_select`

Fired once the BPP's `/on_select` response has been processed — success, non-serviceable, or an error. **This is always the last event on this stream** — the backend closes the connection right after writing it (see `SELECT_REQUEST_FAILED` below for the one case that fires without any `/on_select` webhook ever having been sent).

```js
es.addEventListener("on_select", (e) => {
  const data = JSON.parse(e.data);
  // handle data — see shape below
});
```

| Field | Type | Description |
|-------|------|-------------|
| `transaction_id` | string | Matches the transaction from the `/select` response |
| `status` | string | `"received"` on a normal outcome, `"error"` for a validation/processing failure or a synchronous BPP NACK |
| `error` | object \| null | `{ code, message, itemIds?, details? }` — present on any error, `null` on clean success (see Error codes below) |
| `isServiceable` | boolean | Whether the fulfillment is serviceable for the delivery address |
| `quote` | object \| null | `{ ttl, expiresAt, total, currency }` — only present on clean success. `expiresAt` is a Unix ms timestamp; if `Date.now() >= quote.expiresAt`, the quote is stale and `/select` must be re-called before proceeding to `/init` |
| `items` | array \| undefined | `[{ item_id, quantity, price }]` — only present on clean success |
| `fulfillment` | object \| undefined | `{ id, type, tat }` — only present on clean success (single fulfillment per order) |
| `breakup` | array \| undefined | `[{ title_type, title, price }]` — non-item charge lines (delivery, tax, packing, discount, offer, misc), only present on clean success. Use this plus `items` to render the full order total breakdown; `quote.total` is only the grand total. |
| `showAiDonation` | boolean \| undefined | Hardcoded `true`. Informs frontend whether to show the AI donation option during checkout. |

> **Buyer amounts (added 2026-10-09, delivery rule changed 2026-10-12).** `quote.total` and
> `breakup` differ from the seller's ONDC quote in one way only:
> - `packing` and `misc` lines (e.g. "Packaging Charge", "Convenience Fee") are still sent, with
>   `price: "0.00"`. The buyer is never charged for them.
> - The `delivery` line is the seller's **actual delivery fee**, with no discount applied here.
>   The discounted (computed) delivery charge appears from the `on_init` event onward.
> - `item` and `tax` lines are unchanged. `quote.total` = items + tax + actual delivery, and the
>   breakup still sums to it.
>
> Example: a seller quote of ₹394.91 (items 257, tax 12.85, packing 20.06, misc 6, delivery 99)
> streams here as packing 0, misc 0, delivery 99, total **₹368.85**. At `on_init` the same order
> shows delivery 29 and total **₹298.85** for a non-Elite buyer (delivery 0 and ₹269.85 for
> Elite). A promo code is applied later, at payment, on top of the `on_init` amount.


**Stream closes after `on_select` (2026-07-18, `SELECT-04`):** the backend ends this connection immediately after delivering `on_select`, on every outcome. **Confirmed against the buyer Flutter app** (`select_api_service.dart:208-212`): it already cancels its own stream subscription and closes its HTTP client unconditionally right after parsing `on_select` — on success, any BPP error, an HTTP error, an SSE error, or a timeout — so the backend closing too is complementary, not something the app was relying on it for.

**If you're integrating a different client** (e.g. a browser-based frontend using the standard `EventSource` API): you must call `eventSource.close()` yourself as soon as `on_select` arrives, and not rely on the connection closing on its own. `EventSource`'s default behavior is to auto-reconnect any closed connection (roughly every 3s) unless the client explicitly closes it first, and the backend cannot suppress that once the initial response headers are sent — skipping this call means the browser will keep silently re-opening `GET /stream/:clientId` for a transaction that will never receive another event. This isn't a dropped-connection scenario to recover from — it's the expected, successful end of this stream.

If the connection drops **before** `on_select` arrives (a genuine network/proxy failure, not the post-delivery close above), there is no event replay and no polling fallback endpoint for `/select` — the receiving end has no way to distinguish "closed after a successful delivery" from "closed for an unrelated reason before delivery" (the buyer app's own `onDone` handler just logs either way). In that case: generate a **new** `clientId`, open a new SSE stream with it, then immediately call `POST /select` again with that new `client_id` — this re-sends the request to the BPP from scratch.

## Error codes

**HTTP errors on `POST /select` (non-`202`):**

| Status | Meaning | Frontend action |
|--------|---------|------------------|
| `400` | Invalid request body — missing required fields, no delivery fulfillment on file for the provider, or unknown item/customization IDs (response includes `invalidIds` for the last case) | Show `error` message from body |
| `401` | Missing or invalid JWT | Redirect to login |
| `403` | Address does not belong to authenticated user | Show error, prompt to pick a different address |
| `404` | Provider not found | Show error, return to provider list |
| `500` | Internal server error | Show generic error, allow retry. As of 2026-07-18 this case (and a `404`) now ALSO fires an `on_select` SSE event with `error.code = "SELECT_REQUEST_FAILED"` on the same stream, so you no longer need to special-case this HTTP response if you're already driving the UI off the SSE stream — the HTTP status is still returned for callers that check it directly. |

**Errors inside the `on_select` SSE event** (`data.error.code`):

| Code | Meaning | Frontend action |
|------|---------|------------------|
| `30009` | Dropoff location not serviceable by logistics provider | Show `error.message` |
| `40002` | Item quantity unavailable (out of stock) — either a whole item, or just one customization option on an otherwise-fine item | Highlight entries in `error.itemIds` (`{ itemId, name }[]`) and show `error.message`. `itemId` may be a base item's catalog id **or** a customization option's catalog id (the same id you sent in `items[].item_id` / `items[].customizations[].id` at `/select` time) — check `error.details[].customizationId` if you need to know which case it is. |
| `30023` | Cart value below minimum order value | Show `error.message` |
| any other code | Any ONDC error code the BPP can return | Show `error.message` — it is always a safe, spec-resolved description regardless of whether the code is one you specifically handle |
| `VALIDATION_FAILED` | This BFF's own business-rule check failed (not an ONDC code) | Show `error.message` |
| `PROCESSING_FAILED` | Processing failed after all retries were exhausted | Show `error.message`, allow retry |
| `SELECT_NACK` | The BPP synchronously rejected `/select` itself — fires immediately, no `on_select` webhook follows | Show `error.message`, allow retry |
| `SELECT_REQUEST_FAILED` | The BFF couldn't even send `/select` to the BPP — network timeout, connection failure, or a non-compliant BPP returning a raw HTTP error instead of an ONDC NACK. Fires immediately, no `on_select` webhook follows. | Show `error.message`, allow retry |

Additionally, if `isServiceable` is `false` with no `error`, show a "delivery not available for this location" message — the BPP returned a response but cannot service this address.

## Changelog

- **2026-10-12:** `delivery` in `on_select` is now the seller's actual fee (no discount); `quote.total` = quote − packing/misc. The discounted delivery charge starts at `on_init`.
- **2026-10-09:** `quote.total` and `breakup` are now buyer-payable. `packing`/`misc` are streamed as `"0.00"` and `delivery` as the computed (discounted) charge. The ONDC quote sent to the seller is unchanged.
