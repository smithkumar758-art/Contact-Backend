// Receives the contact form, validates it, saves it to Supabase,
// and sends an email notification through Resend.

const headers = {
  "Access-Control-Allow-Origin": "*", // lets any website call this
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

const reply = (statusCode, body) => ({
  statusCode,
  headers,
  body: JSON.stringify(body),
});

exports.handler = async (event) => {
  // Browsers send an OPTIONS "preflight" request before the real POST
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers };
  if (event.httpMethod !== "POST") return reply(405, { error: "Use POST" });

  // 0. Check your settings (environment variables) are there
  const key = (process.env.SUPABASE_SERVICE_KEY || "").trim();
  const rawUrl = (process.env.SUPABASE_URL || "").trim();
  if (!key || !rawUrl) {
    console.log("Missing setting: SUPABASE_URL or SUPABASE_SERVICE_KEY");
    return reply(500, { error: "Server setup problem: check SUPABASE_URL and SUPABASE_SERVICE_KEY." });
  }
  let baseUrl;
  try {
    baseUrl = new URL(rawUrl).origin; // keeps only https://xxxx.supabase.co
  } catch {
    console.log("SUPABASE_URL is not a valid web address:", rawUrl);
    return reply(500, { error: "Server setup problem: SUPABASE_URL is not a valid address." });
  }

  // 1. Read the data
  let data;
  try {
    data = JSON.parse(event.body);
  } catch {
    return reply(400, { error: "Invalid data" });
  }

  const name = (data.name || "").trim();
  const email = (data.email || "").trim();
  const subject = (data.subject || "").trim();
  const message = (data.message || "").trim();

  // 2. Validate (never trust the browser, anyone can send requests directly)
  if (!name || !email || !subject || !message) {
    return reply(400, { error: "All fields are required." });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return reply(400, { error: "Please enter a valid email." });
  }
  if (name.length > 100 || subject.length > 150 || message.length > 2000) {
    return reply(400, { error: "Message is too long." });
  }

  // 3. Save to the database
  const dbHeaders = {
    apikey: key,
    "Content-Type": "application/json",
    Prefer: "return=minimal",
  };
  if (key.startsWith("eyJ")) dbHeaders.Authorization = `Bearer ${key}`; // old-style keys only
  const dbRes = await fetch(`${baseUrl}/rest/v1/messages`, {
    method: "POST",
    headers: dbHeaders,
    body: JSON.stringify({ name, email, subject, message }),
  });
  if (!dbRes.ok) {
    console.log("Supabase error:", dbRes.status, await dbRes.text());
    return reply(500, { error: "Could not save your message." });
  }

  // 4. Email notification (if this fails, the message is still saved)
  try {
    const mailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${(process.env.RESEND_API_KEY || "").trim()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Portfolio <onboarding@resend.dev>",
        to: (process.env.NOTIFY_EMAIL || "").trim(),
        subject: `New message: ${subject}`,
        text: `From: ${name} (${email})\n\n${message}`,
      }),
    });
    if (!mailRes.ok) console.log("Resend error:", mailRes.status, await mailRes.text());
  } catch (err) {
    console.log("Email failed:", err.message);
  }

  return reply(200, { ok: true });
};
