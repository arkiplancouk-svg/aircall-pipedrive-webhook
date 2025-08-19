import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

const AIRCALL_API_ID = process.env.AIRCALL_API_ID;
const AIRCALL_API_TOKEN = process.env.AIRCALL_API_TOKEN;
const PIPEDRIVE_TOKEN = process.env.PIPEDRIVE_TOKEN;

// --- Helpers ---
async function pd(path) {
  const sep = path.includes("?") ? "&" : "?";
  const url = `https://api.pipedrive.com${path}${sep}api_token=${PIPEDRIVE_TOKEN}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Pipedrive ${path} failed ${r.status}`);
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

function stripHtml(s = "") {
  return s.replace(/<[^>]+>/g, " ");
}
function truncate(s, n) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

// --- Webhook endpoint ---
app.post("/aircall/webhook", async (req, res) => {
  res.sendStatus(200); // acknowledge quickly

  try {
    if (req.body.event !== "call.created") return;
    const callId = req.body?.data?.id;
    const phone = req.body?.data?.raw_digits || req.body?.data?.display_digits || "";

    // 1. Find person in Pipedrive
    const search = await pd(`/v1/persons/search?term=${encodeURIComponent(phone)}&fields=phone&exact_match=true`);
    const person = search?.data?.items?.[0]?.item;
    if (!person) {
      return sendCard(callId, [
        { type: "title", text: "Unknown contact" },
        { type: "shortText", label: "Number", text: phone }
      ]);
    }

    const personId = person.id;

    // 2. Fetch deals, note, and recent emails
    const [deals, notes, mails] = await Promise.all([
      pd(`/v1/deals?person_id=${personId}&status=open&limit=1`),
      pd(`/v1/notes?person_id=${personId}&limit=1&sort=add_time%20DESC`),
      pd(`/v1/mailbox/mailMessages?person_id=${personId}&limit=3&include_body=0`).catch(() => ({ data: [] }))
    ]);

    const deal = deals?.data?.[0];
    const note = notes?.data?.[0];
    const emails = (mails?.data || []).map(m => ({
      type: "shortText",
      label: "Email",
      text: `${m.subject || "(no subject)"} — ${new Date(m.add_time).toLocaleString()}`,
      link: m.mail_view_url || undefined
    }));

    // 3. Build card
    const rows = [
      { type: "title", text: person.name, link: `https://app.pipedrive.com/person/${personId}` },
      deal && { type: "shortText", label: "Deal stage", text: deal.stage_id ? `Stage ID: ${deal.stage_id}` : "—", link: `https://app.pipedrive.com/deal/${deal.id}` },
      ...emails,
      note && { type: "shortText", label: "Latest note", text: truncate(stripHtml(note.content), 120) }
    ].filter(Boolean);

    await sendCard(callId, rows);

  } catch (e) {
    console.error("Webhook error:", e);
  }
});

app.listen(3000, () => console.log("Webhook server running on :3000"));
