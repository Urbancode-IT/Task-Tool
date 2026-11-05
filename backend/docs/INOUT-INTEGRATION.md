# In Out → Seyal attendance integration

When the In Out attendance app marks someone **on leave**, **absent** or **present**,
it sends that to Seyal straight away. Seyal then:

- treats leave and absent days as non-working days: no EOD report is required, the
  EOD lock does not apply, and an EOD lock already set for that day is cleared;
- shows the day on the member's dashboard ("On leave (In Out)" / "Absent (In Out)");
- lists the person under **Admin → Attendance** for that day, with the reason.

A later "present" for the same day removes In Out's mark. Leave a member entered in
Seyal themselves is never changed by In Out.

## 1. Endpoint

```
POST https://api.seyal.urbancode.in/api/integrations/inout/attendance
Content-Type: application/json
X-InOut-Key: <shared secret>
```

This is a server-to-server call. Make it from the In Out **backend**, never from a
browser, so the secret is never exposed.

### The shared secret

- Generate it once, at least 24 characters, for example:
  `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- On the Seyal server put it in `backend/.env` as `INOUT_WEBHOOK_SECRET=…`, then
  `pm2 restart Task-Tool-backend --update-env`.
- In In Out keep it in its own environment configuration (not in source code) and
  send it in the `X-InOut-Key` header.
- Share it between the two teams through a password manager, not chat or email.

## 2. What to send

One record, or up to 500 at once as `{ "records": [ … ] }`.

| Field | Required | Meaning |
|---|---|---|
| `email` | yes | The person's email. Must be the same email as their Seyal account (case does not matter). |
| `date` | yes, or `from` + `to` | The day, `YYYY-MM-DD`. |
| `from`, `to` | instead of `date` | A range of days, inclusive, at most 62 days. Use this for multi-day leave. |
| `status` | yes | See the table below. |
| `reason` | no | Leave type or reason, shown to admins (for example "Sick leave", "Family function"). Up to 200 characters. |

### Status values

| Send | Seyal records |
|---|---|
| `leave`, `on_leave`, `sick_leave`, `casual_leave`, `earned_leave`, `privilege_leave`, `medical_leave`, `comp_off`, `CL`, `SL`, `EL`, `PL`, `ML` | **On leave** |
| `absent`, `lop`, `loss_of_pay`, `no_show`, `A` | **Absent** |
| `present`, `checked_in`, `wfh`, `work_from_home`, `on_duty`, `half_day`, `P` | **Present**: clears In Out's leave/absent mark for that day |

Spaces and hyphens are accepted (`"Casual Leave"`, `"half-day"`). A half day counts
as present, so the person still files their EOD for that day.

### Examples

Single day absent:

```json
{ "email": "asha@urbancode.in", "date": "2026-11-03", "status": "absent" }
```

Approved leave for three days, with a reason:

```json
{ "email": "asha@urbancode.in", "from": "2026-11-10", "to": "2026-11-12", "status": "casual_leave", "reason": "Family function" }
```

Several people at once (for example a nightly catch-up of the day's attendance):

```json
{
  "records": [
    { "email": "asha@urbancode.in", "date": "2026-11-03", "status": "absent" },
    { "email": "ravi@urbancode.in", "date": "2026-11-03", "status": "sick_leave", "reason": "Fever" },
    { "email": "meena@urbancode.in", "date": "2026-11-03", "status": "present" }
  ]
}
```

Leave cancelled after it was sent: send `present` for those days.

## 3. Response

`200 OK`, with counts of days applied and anything Seyal could not use:

```json
{
  "leave": 3, "absent": 1, "present": 1, "unlocked": 0,
  "unmatched": [ { "email": "new.joiner@urbancode.in", "date": "2026-11-03", "status": "leave" } ],
  "invalid":   [ { "email": "asha@urbancode.in", "date": "2026-11-05", "status": "holiday-ish" } ]
}
```

- `unmatched`: no Seyal user has that email. Fix the email in one of the apps; admins
  also see these under Admin → Attendance.
- `invalid`: missing email, bad date or range, or a status word Seyal does not know.

| Status | Meaning | What In Out should do |
|---|---|---|
| 200 | Processed (check `unmatched` / `invalid`) | Nothing more |
| 400 | No records, or more than 500 | Fix the request |
| 401 | Wrong or missing `X-InOut-Key` | Check the secret |
| 503 | Integration switched off on Seyal, or database down | Retry later |
| 5xx / timeout | Seyal unavailable | Retry with back-off (1 min, 5 min, 15 min) |

Sending the same record twice is safe; the result is the same.

## 4. Code to call it from In Out

Node.js (18+):

```js
async function pushAttendanceToSeyal(records) {
  const res = await fetch('https://api.seyal.urbancode.in/api/integrations/inout/attendance', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-InOut-Key': process.env.SEYAL_INOUT_KEY },
    body: JSON.stringify({ records }),
  });
  if (!res.ok) throw new Error(`Seyal attendance push failed: ${res.status}`);
  return res.json();
}
```

Java (Spring, `RestClient`):

```java
RestClient.create("https://api.seyal.urbancode.in")
    .post().uri("/api/integrations/inout/attendance")
    .header("X-InOut-Key", System.getenv("SEYAL_INOUT_KEY"))
    .contentType(MediaType.APPLICATION_JSON)
    .body(Map.of("records", records))
    .retrieve()
    .body(Map.class);
```

Python (`requests`):

```python
requests.post(
    "https://api.seyal.urbancode.in/api/integrations/inout/attendance",
    headers={"X-InOut-Key": os.environ["SEYAL_INOUT_KEY"]},
    json={"records": records},
    timeout=15,
).raise_for_status()
```

Call it right after In Out saves an absence, an approved leave, a leave cancellation
or a check-in that replaces an earlier absence. A nightly batch of the whole day is a
good safety net in case a live call failed.

## 5. Testing

From any machine (replace the secret and email):

```
curl -X POST https://api.seyal.urbancode.in/api/integrations/inout/attendance \
  -H "Content-Type: application/json" \
  -H "X-InOut-Key: <secret>" \
  -d '{"email":"asha@urbancode.in","date":"2026-11-03","status":"leave","reason":"Test"}'
```

Then open Seyal → Admin → Attendance, pick that day, and check the person is listed
as "On leave" from "In Out". Send `"status":"present"` for the same day to undo it.
