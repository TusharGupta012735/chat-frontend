# Admin Panel — Issues (IGM Complaints)

**Audience**: Admin panel frontend developer.

## Purpose

Lets the admin panel browse every IGM complaint raised across all orders/users (not scoped to one
buyer), and drill into a single complaint to see its full update history — who did what and when,
across buyer, seller NP, and Grievance Officer actors — without querying the database directly.
Read-only: the admin panel cannot raise, update, or close a complaint through these endpoints.

---

## Related APIs

- [`admin-orders.md`](./admin-orders.md) — order search/filters, stats and range analytics.
- [`issue.md`](./issue.md) — the buyer-facing complaint flow that creates the data shown here.
- [`admin-chats.md`](./admin-chats.md) — support chats; open one about a complaint with `POST /admin/chats { issue_id }`.

---

## Authentication

Same as every other `/admin/*` route: `Authorization: Bearer <admin jwt>` (token's `role` claim
must be `ADMIN` or one of the configured admin roles). Missing/invalid token → `401`; valid token
but wrong role → `403`.

---

## Request

### List complaints (paginated, filterable)

```
GET /api/v1/admin/issues
```

```bash
curl "https://<host>/api/v1/admin/issues?status=OPEN&level=ISSUE&page=1&limit=20" \
  -H "Authorization: Bearer <admin jwt>"
```

| Query param | Type | Notes |
|---|---|---|
| `page` | int | default `1` |
| `limit` | int | default `20`, max `100` |
| `status` | enum | `OPEN` \| `PROCESSING` \| `RESOLVED` \| `CLOSED` — invalid value → `400` |
| `level` | enum | `ISSUE` \| `GRIEVANCE` \| `DISPUTE` — invalid value → `400` |
| `bpp_id` | string | exact match on the seller NP that owns the underlying order |
| `category_code` | string | exact match, e.g. `ITEM_QUALITY` (see `issue.md`'s dropdown table) |
| `source_id` | string | exact match — the buyer user id who raised the complaint |
| `search` | string | prefix match against `issue_id`, `order_id`, or `transaction_id` |
| `from` / `to` | ISO date | filters on when the complaint was raised |

All filters are optional and combine with AND.

### Complaint detail

```
GET /api/v1/admin/issues/:issue_id
```

```bash
curl https://<host>/api/v1/admin/issues/IGM260423a3f9b2c1 \
  -H "Authorization: Bearer <admin jwt>"
```

---

## Response

### List — `GET /admin/issues`

```jsonc
{
  "issues": [
    {
      "issue_id": "IGM260423a3f9b2c1",
      "order_id": "od260410a3f9b2c1",
      "transaction_id": "T2",
      "bpp_id": "seller.ondc.mock",
      "status": "PROCESSING",
      "level": "ISSUE",
      "category_code": "ITEM_QUALITY",
      "descriptor": { "code": "ITM004", "short_desc": "Quality issue" },
      "source_id": "user_123",
      "complainant_id": "ONDC_BAP",
      "created_by": "Jane Doe",
      "last_action_id": "A3",
      "action_count": 4,
      "actor_count": 2,
      "created_at": "2026-08-20T10:15:00.000Z",
      "updated_at": "2026-08-21T09:02:00.000Z"
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 12 },
  "server_time": "2026-08-25T06:00:00.000Z"
}
```

**Field / type table**

| Field | Type | Notes |
|---|---|---|
| `issue_id` | string | `IGM<YYMMDD><random8>` format — use as the key to open detail |
| `order_id` / `transaction_id` | string | the order this complaint is about |
| `bpp_id` | string | seller NP handling the order |
| `status` | enum | `OPEN` \| `PROCESSING` \| `RESOLVED` \| `CLOSED` |
| `level` | enum | `ISSUE` \| `GRIEVANCE` \| `DISPUTE` |
| `category_code` | string | buyer's dropdown selection |
| `descriptor.code` / `.short_desc` | string | ONDC descriptor code + human-readable label |
| `created_by` | string \| null | display name of whoever raised it |
| `action_count` / `actor_count` | int | quick activity signal — open detail for the full timeline |
| `igm_version` | `"1.0.0"` \| `"2.0.0"` | which IGM protocol this seller uses (added 2026-10-05) |
| `pagination.total` | int | total matching rows across all pages, not just this page |

### Detail — `GET /admin/issues/:issue_id`

```jsonc
{
  "issue": {
    "issue_id": "IGM260423a3f9b2c1",
    "order_id": "od260410a3f9b2c1",
    "transaction_id": "T2",
    "bpp_id": "seller.ondc.mock",
    "bpp_uri": "https://seller.ondc.mock/",
    "city": "std:080",
    "status": "PROCESSING",
    "level": "ISSUE",
    "category_code": "ITEM_QUALITY",
    "descriptor": {
      "code": "ITM004",
      "short_desc": "Quality issue",
      "long_desc": "The food item was not prepared correctly...",
      "additional_desc_url": null,
      "additional_desc_content_type": null,
      "images": [{ "url": "https://buyerapp.com/images/img1.png", "size_type": "xs" }],
      "media": null
    },
    "source_id": "user_123",
    "complainant_id": "ONDC_BAP",
    "created_by": "Jane Doe",
    "expected_response_time": "PT2H",
    "expected_resolution_time": "P1D",
    "last_action_id": "A3",
    "item_refs": [
      { "ref_id": "I1", "ref_type": "ITEM", "tags": [{ "code": "message.order.items", "list": [{ "code": "quantity.selected.count", "value": "2" }] }] }
    ],
    "actors": [
      { "actor_id": "user_123", "actor_type": "CONSUMER", "info": { "person": { "name": "Jane Doe" }, "contact": { "phone": "9876543210", "email": "jane@email.com" } } },
      { "actor_id": "seller.ondc.mock", "actor_type": "COUNTERPARTY_NP", "info": { "org": { "name": "seller.ondc.mock::ONDC:RET11" } } }
    ],
    "actions": [
      {
        "action_id": "A1",
        "descriptor_code": "OPEN",
        "descriptor_short_desc": "Complaint raised",
        "updated_at": "2026-08-20T10:15:00.000Z",
        "action_by": "user_123",
        "actor_details": { "name": "Jane Doe" },
        "ref_id": null, "ref_type": null, "images": null,
        "resolutions": []
      },
      {
        "action_id": "A3",
        "descriptor_code": "RESOLUTION_PROPOSED",
        "descriptor_short_desc": "Resolution options provided",
        "updated_at": "2026-08-21T09:02:00.000Z",
        "action_by": "seller.ondc.mock",
        "actor_details": { "name": "Seller Support" },
        "ref_id": null, "ref_type": null, "images": null,
        "resolutions": [
          { "resolution_id": "RESO-1", "descriptor_code": "REFUND", "descriptor_short_desc": null,
            "ref_id": null, "ref_type": null,
            "requested_refund_amount_currency": "INR", "requested_refund_amount_value": "120.00", "tags": null }
        ]
      }
    ],
    "created_at": "2026-08-20T10:15:00.000Z",
    "updated_at": "2026-08-21T09:02:00.000Z",
    "chat_id": "8c1f2a4e-…"
  }
}
```

**Field / type table**

| Field | Type | Notes |
|---|---|---|
| `chat_id` | string \| null | The complaint's support chat: its open chat, else its most recent one, else `null`. Open it with `GET /admin/chats/:chat_id` (added 2026-10-19) |
| `actions[]` | array | The full update timeline, oldest first — **this is the "all updates from each actor" view**. Each entry's `action_by`/`actor_details` says who performed that step (buyer, seller NP, or GRO on escalation); render as a timeline/audit log. |
| `actions[].descriptor_code` | enum | `OPEN` \| `PROCESSING` \| `INFO_REQUESTED` \| `INFO_PROVIDED` \| `INFO_NOT_AVAILABLE` \| `RESOLUTION_PROPOSED` \| `RESOLUTION_ACCEPTED` \| `RESOLUTION_REJECTED` \| `RESOLUTION_CASCADED` \| `RESOLVED` \| `CLOSED` \| `ESCALATED` \| `CASCADED` |
| `actions[].resolutions[]` | array | Present only on a `RESOLUTION_PROPOSED` action |
| `actors[]` | array | The bounded actor roster for this complaint (consumer, interfacing NP, counterparty NP, +GRO actors once escalated) — use to resolve a display name/org for any `action_by` id that doesn't already carry `actor_details` |
| `item_refs[]` | array | Which catalog item(s) the complaint is about |
| `igm_version` | `"1.0.0"` \| `"2.0.0"` | Protocol pinned when the complaint was raised (added 2026-10-05) |
| `capabilities` | object | Same flags the buyer app gets: `canAcceptOrRejectResolution`, `multipleResolutionOptions`, `itemLevelResolutions`, `structuredInfoExchange`, `canEscalate`, `canClose`, `canRate` |
| `v1_meta` | object \| null | IGM 1.0 only: `resolutionSupport` (seller support contact/chat link/GROs), `rating`, `lastInfoRequest`. On a 1.0 `REFUND` resolution, **no automatic refund is issued** — ops must refund manually |

---

## Error codes

| Error | When | Frontend action |
|---|---|---|
| `400 invalid status: <value>` | `status` query param not one of the 4 valid values | Fix the request — likely a client bug |
| `400 invalid level: <value>` | `level` query param not one of the 3 valid values | Fix the request — likely a client bug |
| `404 Issue not found: <issue_id>` | Detail requested for an unknown `issue_id` | Show "complaint not found" |
| `401` / `403` | Missing/invalid token, or non-admin role | Redirect to admin login |

---

## Changelog

- 2026-10-19 — Detail response adds `chat_id` (the complaint's support chat, or `null`) — additive. See
  [`admin-chats.md`](./admin-chats.md).
