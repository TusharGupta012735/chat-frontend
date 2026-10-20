# /issue — Complaints & Grievances (IGM)

## Purpose

Lets a buyer raise a complaint about a placed order (missing item, wrong item, quality issue,
delayed delivery, etc.), track its status, and respond as the seller works it — providing
requested info, accepting or rejecting a proposed resolution (refund/replacement/return), and
finally closing the ticket once resolved. If the seller doesn't respond to a satisfactory
resolution, the buyer can escalate the complaint to a higher (GRIEVANCE) level, which brings in
Grievance Officers from both sides. The frontend never talks to the ONDC network directly — it
sends simple, slim requests to the BAP, and reads live status over SSE plus on-demand "hard
fetch" endpoints that return the full complaint history from the BAP's own database.

---

## Related APIs

- [`confirm.md`](./confirm.md) — order placement; `order_id` returned here is the same `order_id` used to raise an issue.
- [`status.md`](./status.md) — order fulfillment status polling (separate from issue status).
- [`cancel.md`](./cancel.md) — force-cancel can auto-raise an IGM complaint (`CANCEL_NO_RESPONSE`) if the seller doesn't respond.
- [`issue-chat.md`](./issue-chat.md) — support chat; pass `issue_id` to chat with support about this complaint (closing the chat never closes the complaint).
- [`update.md`](./update.md) — order update flow (unrelated to `/issue` updates, which use the same `POST /api/v1/issue` endpoint with an `action_code`).

---

## Request

### Raise a complaint (create)

```
POST /api/v1/issue
```

```bash
curl -X POST https://<host>/api/v1/issue \
  -H "Authorization: Bearer <jwt>" \
  -H "Content-Type: application/json" \
  -d '{
    "order_id": "od260410a3f9b2c1",
    "category_code": "ITEM_QUALITY",
    "descriptor_long_desc": "The food item was not prepared correctly...",
    "items": [
      { "id": "I1", "quantity": 2 },
      { "id": "I3", "quantity": 1 }
    ],
    "images": [
      { "url": "https://buyerapp.com/images/img1.png", "size_type": "xs" }
    ]
  }'
```

**Mandatory (all categories):** `order_id`, `category_code`, `descriptor_long_desc`, `items[]`
(≥1, each `{ id, quantity }` with non-empty `id` and `quantity ≥ 1`).

**Also mandatory (category-dependent):** `images[]` (≥1 entry) is required for `ITEM_QUANTITY`,
`WRONG_ITEM`, `ITEM_QUALITY`, `ITEM_EXPIRED`, and `PACKAGING_ISSUE`. Returns `400 images is
required` if omitted for these categories.

**Optional:** `images` (for all other categories), `media`.

**Optional — `igm_version`** (`"1.0.0"` \| `"2.0.0"`, create only, added 2026-10-07): explicitly
choose the complaint protocol. When sent, it **overrides** the seller's default; when omitted, the
backend picks the seller's default as before. Once the complaint is raised its version is fixed:
`igm_version` is ignored on updates. Use it only when you know the seller's protocol. Forcing a
version the seller doesn't support makes the seller reject or ignore the complaint (there is no
automatic fallback). Choosing `"1.0.0"` also brings the 1.0 limits: some categories return 422,
and there's no accept/reject.

**`category_code` dropdown** (send exactly one of these):

| `category_code` | Label | Images Required |
|---|---|---|
| `ITEM_MISSING` | Missing items | No |
| `ITEM_QUANTITY` | Quantity issue | Yes |
| `WRONG_ITEM` | Item mismatch | Yes |
| `ITEM_QUALITY` | Quality issue | Yes |
| `ITEM_EXPIRED` | Expired item | Yes |
| `ITEM_WRONGLY_RETURNED` | Incorrectly marked as returned | No |
| `PACKAGING_ISSUE` | Packaging issue | Yes |
| `DELIVERY_DELAY` | Delayed delivery | No |

> `CANCEL_NO_RESPONSE` is not user-facing — it is auto-raised by the force-cancel flow (see
> `cancel.md`).

### Update a complaint (accept/reject resolution, provide info, close, escalate)

```
POST /api/v1/issue
```

```bash
curl -X POST https://<host>/api/v1/issue \
  -H "Authorization: Bearer <jwt>" \
  -H "Content-Type: application/json" \
  -d '{
    "issue_id": "IGM260423a3f9b2c1",
    "action_code": "RESOLUTION_ACCEPTED",
    "resolution_id": "RESO-1"
  }'
```

Send **only `issue_id` + `action_code`** (plus `resolution_id` / `descriptor_long_desc` /
`images` where relevant) — do not resend `order_id`, `category_code`, or any refs/actors. The
issue must belong to the authenticated caller.

| `action_code` | Extra fields | Notes |
|---|---|---|
| `RESOLUTION_ACCEPTED` | `resolution_id` (**required**) | Accept a proposed resolution. Not available when `capabilities.canAcceptOrRejectResolution` is `false` (returns `400`) |
| `RESOLUTION_REJECTED` | `resolution_id` (**required**) | Reject a proposed resolution — seller must propose a new one |
| `INFO_PROVIDED` | `descriptor_long_desc`, `images` (optional) | Provide requested info |
| `CLOSED` | `rating` (optional: `THUMBS-UP` \| `THUMBS-DOWN`) | Close the ticket after the resolution is executed. Send `rating` only when `capabilities.canRate` is `true` (IGM 1.0 sellers). It's ignored otherwise |
| `OPEN` | — | Re-open / keep open |
| `ESCALATED` | — | Escalate to GRIEVANCE level (see below) |

### Escalate to Grievance level

```bash
curl -X POST https://<host>/api/v1/issue \
  -H "Authorization: Bearer <jwt>" \
  -H "Content-Type: application/json" \
  -d '{
    "issue_id": "IGM260423a3f9b2c1",
    "action_code": "ESCALATED"
  }'
```

Only allowed when the issue is at `ISSUE` level, not `CLOSED`, and already has a `RESOLVED` or
`RESOLUTION_ACCEPTED` action in its history. `level: "GRIEVANCE"` is set automatically — do not
send `level`.

### Check issue status

```bash
curl -X POST https://<host>/api/v1/issue_status \
  -H "Authorization: Bearer <jwt>" \
  -H "Content-Type: application/json" \
  -d '{
    "issue_id": "IGM260423a3f9b2c1",
    "order_id": "od260410a3f9b2c1"
  }'
```

---

## Response

**Create response:**

```json
{
  "success": true,
  "issue_id": "IGM260423a3f9b2c1",
  "message_id": "M1",
  "transaction_id": "T2",
  "message": "Complaint raised successfully. You will be notified when the seller responds."
}
```

**Status-check response:**

```json
{
  "success": true,
  "issue_id": "IGM260423a3f9b2c1",
  "message_id": "M2"
}
```

**Hard-fetch response** (`GET /api/v1/issue/issues/:order_id`, `GET /api/v1/issue/detail/:issue_id`,
`GET /api/v1/issue/my?limit=20&offset=0`) — returns the full complaint tree, no ONDC re-call:

```jsonc
{
  "issueId": "IGM260423a3f9b2c1",
  "orderId": "od260410a3f9b2c1",
  "transactionId": "T2",
  "status": "PROCESSING",
  "level": "ISSUE",
  "categoryCode": "ITEM_QUALITY",
  "descriptorCode": "ITM004",
  "descriptorShortDesc": "Quality issue",
  "descriptorLongDesc": "The food item was not prepared correctly...",
  "expectedResponseTime": "PT2H",
  "expectedResolutionTime": "P1D",
  "lastActionId": "A3",
  "createdAt": "...", "updatedAt": "...",
  "actors":  [{ "actorId": "...", "actorType": "CONSUMER", "infoJson": { "person": {}, "contact": {} } }],
  "actions": [
    {
      "actionId": "A1", "descriptorCode": "OPEN", "descriptorShortDesc": "...",
      "actionBy": "...", "actorDetailsJson": { "name": "..." }, "updatedAt": "...",
      "resolutions": [
        { "resolutionId": "RESO-1", "descriptorCode": "REFUND",
          "requestedRefundAmountCurrency": "INR", "requestedRefundAmountValue": "120.00" }
      ]
    }
  ]
}
```

### Field / type table (top-level fields the frontend renders)

| Field | Type | Notes |
|---|---|---|
| `issueId` | string | `IGM<YYMMDD><random8>` format |
| `orderId` | string | BAP order UUID |
| `transactionId` | string | ONDC transaction id (internal correlation only) |
| `status` | enum | `OPEN` \| `PROCESSING` \| `RESOLVED` \| `CLOSED` |
| `level` | enum | `ISSUE` \| `GRIEVANCE` \| `DISPUTE` |
| `categoryCode` | string | The dropdown code the buyer selected |
| `descriptorShortDesc` / `descriptorLongDesc` | string | Human-readable complaint text |
| `expectedResponseTime` / `expectedResolutionTime` | ISO 8601 duration | Fixed at `PT2H` / `P1D` |
| `actions[]` | array | Ordered history; render the latest entry as current state |
| `actions[].resolutions[]` | array | Present only on a `RESOLUTION_PROPOSED` action — render as buyer's choice buttons |
| `actions[].resolutions[]` (IGM 1.0 sellers) | array | No `RESOLUTION_PROPOSED` step — the seller's final resolution arrives on the `RESOLVED` action. Show it read-only; there are no accept/reject buttons |
| `igmVersion` | `"1.0.0"` \| `"2.0.0"` | The complaint protocol this seller uses. Fixed for the complaint's lifetime (added 2026-10-05) |
| `capabilities` | object | Use these flags to decide which buttons to render (see below) |
| `v1Meta` | object \| null | IGM 1.0 complaints only: `resolutionSupport` (the seller's support contact / chat link / GRO info) and `rating`. Always `null` for 2.0 complaints |

### `capabilities` (added 2026-10-05)

Returned on every complaint from `GET /api/v1/issue/detail/:issue_id`, `GET /api/v1/issue/my` and
`GET /api/v1/issue/issues/:order_id`. Some sellers still use the older IGM 1.0 protocol, so drive
the UI from these flags rather than assuming every complaint supports every action:

| Flag | IGM 2.0 | IGM 1.0 | UI meaning |
|---|---|---|---|
| `canAcceptOrRejectResolution` | `true` | `false` | Hide the accept/reject resolution buttons when `false` |
| `multipleResolutionOptions` | `true` | `false` | 1.0 sellers send one final resolution, not a list of choices |
| `itemLevelResolutions` | `true` | `false` | — |
| `structuredInfoExchange` | `true` | `false` | Answering a seller's info request still works the same way (`INFO_PROVIDED`) |
| `canEscalate` | `true` | `true` | — |
| `canClose` | `true` | `true` | — |
| `canRate` | `false` | `true` | Show a 👍/👎 rating on close when `true` |

---

## SSE events / hard-fetch

**Flow:** open SSE stream → rebind for the order → render enriched SSE events as they arrive →
optionally hard-fetch full history.

```
1. GET  /api/v1/stream/:clientId                                    (open SSE stream)
2. POST /api/v1/issue/subscribe { "order_id": "...", "clientId": "..." }   (rebind, 24h TTL)
3. Receive "issue" SSE events (render directly, no extra call needed)
4. (optional) GET /api/v1/issue/issues/:order_id  or  GET /api/v1/issue/detail/:issue_id
```

`POST /api/v1/issue/subscribe` response: `{ "success": true, "transaction_id": "..." }` (404 if
the order is unknown). Rebind before opening an order's issue view — the SSE binding has a 24h
TTL and complaints are often raised days after the order.

**SSE event types:**

| Event | Trigger |
|---|---|
| `issue` with `type: "ISSUE_UPDATED"` | Issue status changes (OPEN → PROCESSING → etc.) |
| `issue` with `type: "RESOLUTION_PROPOSED"` | Seller proposed resolution options — buyer responds with `resolution_id` |
| `issue` with `type: "ISSUE_STATUS_UPDATED"` | `/on_issue_status` received |
| `issue` with `type: "ISSUE_ESCALATED"` | Buyer's escalation to GRIEVANCE succeeded |

**Enriched event shape** (render without a follow-up call):

```jsonc
{
  "type": "RESOLUTION_PROPOSED",
  "issueId": "IGM260423a3f9b2c1",
  "orderId": "od260410a3f9b2c1",
  "transactionId": "T2",
  "status": "PROCESSING",
  "level": "ISSUE",
  "action": {
    "actionId": "A4",
    "code": "RESOLUTION_PROPOSED",
    "shortDesc": "Resolution options provided",
    "actionBy": "seller.ondc.mock",
    "actorDetails": { "name": "Seller Support" },
    "images": null,
    "refId": null, "refType": null
  },
  "actors": [ { "id": "...", "type": "CONSUMER", "info": {} },
              { "id": "seller.ondc.mock", "type": "COUNTERPARTY_NP", "info": {} } ],
  "resolutions": [
    { "resolutionId": "RESO-1", "descriptorCode": "REFUND",
      "requestedRefundAmountValue": "120.00", "requestedRefundAmountCurrency": "INR" },
    { "resolutionId": "RESO-2", "descriptorCode": "REPLACEMENT" }
  ]
}
```

> If the app is backgrounded (no live SSE stream), the same update arrives as a thin FCM push:
> `{ title, body, data: { type: "issue", issue_id, order_id, event } }`. On receipt, hard-fetch
> the full issue to render it.

---

## Error codes

| Error | When | Frontend action |
|---|---|---|
| `400 images is required` | Create, category requires images but none sent | Prompt buyer to attach at least one image |
| `404 ISSUE_NOT_FOUND` | Update sent for unknown `issue_id` | Show "complaint not found" |
| `403 FORBIDDEN` | Update sent for an issue not owned by the caller | Show generic error, do not retry |
| `400` (missing/invalid `action_code`) | Update missing `action_code`, or missing `resolution_id` on accept/reject | Fix request — likely a client bug |
| `INVALID_ESCALATION` | Escalate attempted, issue already GRIEVANCE+ | Hide escalate button once already escalated |
| `ISSUE_ALREADY_CLOSED` | Escalate attempted on a CLOSED issue | Hide escalate button on closed issues |
| `ESCALATION_NOT_ALLOWED` | Escalate attempted with no RESOLVED/RESOLUTION_ACCEPTED action yet | Hide escalate button until seller has proposed/resolved |
| `400 IGM_OPERATION_NOT_SUPPORTED_FOR_VERSION` | Accept/reject resolution sent for a complaint whose `capabilities.canAcceptOrRejectResolution` is `false` | Hide those buttons using `capabilities`; offer close/escalate instead |
| `400 Invalid rating` | `rating` not `THUMBS-UP`/`THUMBS-DOWN` | Fix the request (client bug) |
| `400 Invalid igm_version` | Create sent `igm_version` other than `"1.0.0"`/`"2.0.0"` | Fix the request (client bug), or omit the field to use the seller default |
| `422 IGM_V1_UNSUPPORTED_CATEGORY` | The seller uses IGM 1.0 and doesn't support the chosen `category_code` (currently `ITEM_EXPIRED` and `ITEM_WRONGLY_RETURNED`) | Show the returned `message` ("This complaint type is not supported by this seller") and suggest contacting support. Nothing was sent to the seller |
| `422 IGM_V1_MAPPING_ERROR` | The seller uses IGM 1.0 and the order is missing data that protocol requires (e.g. order/delivery state) | Show a generic "couldn't file this complaint right now, please contact support" message. Do not retry automatically |

---

## Changelog

- **2026-10-05:** some sellers still use the older IGM 1.0 complaint protocol. Every complaint
  now carries `igmVersion` + `capabilities` (+ `v1Meta`), `CLOSED` accepts an optional `rating`,
  and there are new `400`/`422` errors. All changes are additive; responses for existing
  (IGM 2.0) complaints are unchanged apart from the new fields.
- **2026-10-07:** create (`POST /api/v1/issue` without `issue_id`) accepts an optional
  `igm_version` that overrides the seller's default protocol version. New error:
  `400 Invalid igm_version`.
- **2026-10-19:** complaints can now have a support chat — see [`issue-chat.md`](./issue-chat.md).
  No change to any `/issue` request or response.
