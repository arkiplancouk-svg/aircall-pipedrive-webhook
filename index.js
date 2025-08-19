import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

const AIRCALL_API_ID = process.env.AIRCALL_API_ID;
const AIRCALL_API_TOKEN = process.env.AIRCALL_API_TOKEN;
const PIPEDRIVE_TOKEN = process.env.PIPEDRIVE_TOKEN;

// Healthcheck so Fly knows we're up
app.get("/", (_, res) => res.send("Webhook is alive!"));

// -------- Helpers --------
async function pd(path) {
  const sep = path.includes("?") ? "&" : "?";
  const url = `https://api.pipedrive.com${path}${sep}api_token=${PIPEDRIVE_TOKEN}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Pipedrive ${path} -> ${r.status}`);
  return r.json();
}

async function sendCard(callId, contents) {
  const url = `https://${AIRCALL_API_ID}:${AIRCALL_API_TOKEN}@api.aircall.io/v1/calls/${callId}/insight_cards`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents })
  });
}

const STAGE_CACHE = new Map();
function stripHtml(s = "") { return s.replace(/<[^>]+>/g, " "); }
function truncate(s, n) { return s.length > n ? s.slice(0, n - 1) + "…" : s; }

// -------- Webhook --------
app.post("/aircall/webhook", async (req, res) => {
  // Always ACK fast so Aircall doesn’t retry
  res.sendStatus(200);

  try {
    if (req.body?.event !== "call.created") return;

    const callId = req.body?.data?.id;
    const phone =
      req.body?.data?.raw_digits ||
      req.body?.data?.display_digits ||
      "";

    // 1) Find contact by phone
    const search = await pd(`/v1/persons/search?term=${encodeURIComponent(phone)}&fields=phone&exact_match=true`);
    const person = search?.data?.items?.[0]?.item;

    if (!person) {
      // Unknown caller — show the number so agent can copy it
      return sendCard(callId, [
        { type: "title", text: "Unknown contact" },
        { type: "shortText", label: "Number", text: phone }
      ]);
    }

    const personId = person.id;

    // 2) Get open deal, latest note, recent emails (in parallel)
    const [deals, notes, mails] = await Promise.all([
      pd(`/v1/deals?person_id=${personId}&status=open&limit=1`),
      pd(`/v1/notes?person_id=${personId}&limit=1&sort=add_time%20DESC`),
      pd(`/v1/mailbox/mailMessages?person_id=${personId}&limit=3&include_body=0`).catch(() => ({ data: [] }))
    ]);

    const topDeal = deals?.data?.[0];

    // 3) Resolve stage name (cache stages)
    let stageName = "";
    if (topDeal?.stage_id) {
      if (STAGE_CACHE.has(topDeal.stage_id)) {
        stageName = STAGE_CACHE.get(topDeal.stage_id);
      } else {
        const stages = await pd(`/v1/stages`);
        for (const st of stages?.data || []) STAGE_CACHE.set(st.id, st.name);
        stageName = STAGE_CACHE.get(topDeal.stage_id) || "";
      }
    }

    // 4) Build rows in the order you asked:
    // Contact name → Deal stage → Recent emails → Recent notes
    const contactUrl = `https://app.pipedrive.com/person/${personId}`;
    const dealUrl = topDeal ? `https://app.pipedrive.com/deal/${topDeal.id}` : undefined;

    const emailRows = (mails?.data || []).map(m => ({
      type: "shortText",
      label: "Email",
      text: `${m.subject || "(no subject)"} — ${new Date(m.add_time).toLocaleString()}`,
      link: m.mail_view_url || undefined
    }));

    const note = notes?.data?.[0];
    const noteRow = note?.content
      ? [{ type: "shortText", label: "Latest note", text: truncate(stripHtml(note.content), 120) }]
      : [];

    const rows = [
      { type: "title", text: person.name, link: contactUrl },
      topDeal && { type: "shortText", label: "Deal stage", text: stageName || `Stage ID ${topDeal.stage_id}`, link: dealUrl },
      ...emailRows,
      ...noteRow
    ].filter(Boolean);

    await sendCard(callId, rows);
  } catch (err) {
    console.error("Webhook error:", err);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on :${PORT}`));
