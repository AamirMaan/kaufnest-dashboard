// scripts/support/register-trello-webhook.mjs
//
// One-off: registers the board webhook with Trello.
// Deliberately a script, not a route — nobody should be able to re-register
// webhooks by hitting a URL.
//
//   node scripts/support/register-trello-webhook.mjs
//
// Trello sends a HEAD request to the callback URL during registration, so the
// app must already be deployed and reachable at TRELLO_WEBHOOK_CALLBACK_URL.
// localhost will not work — use a tunnel if you need to test locally.

const { TRELLO_API_KEY, TRELLO_API_TOKEN, TRELLO_BOARD_ID, TRELLO_WEBHOOK_CALLBACK_URL } =
  process.env;

for (const [name, value] of Object.entries({
  TRELLO_API_KEY, TRELLO_API_TOKEN, TRELLO_BOARD_ID, TRELLO_WEBHOOK_CALLBACK_URL,
})) {
  if (!value) {
    console.error(`Missing ${name}`);
    process.exit(1);
  }
}

const res = await fetch(
  `https://api.trello.com/1/webhooks?key=${TRELLO_API_KEY}&token=${TRELLO_API_TOKEN}`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      idModel: TRELLO_BOARD_ID,
      callbackURL: TRELLO_WEBHOOK_CALLBACK_URL,
      description: "Boughtopia support bug tracker",
    }),
  }
);

const body = await res.text();
if (!res.ok) {
  console.error(`Registration failed (${res.status}): ${body}`);
  process.exit(1);
}
console.error(`Webhook registered: ${body}`);
