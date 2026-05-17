# DealPilot

DealPilot is a real-world phone agent command desk for the YC Call My Agent hackathon. A user texts a mission, AgentPhone posts the message to DealPilot, and DealPilot calls the user or merchant back to collect details, negotiate, and prepare the next approval step.

The product is built around one idea: agents should not just chat. They should touch the real world, but with enough proof and approval gates that a human can trust what happened.

![DealPilot UI](screenshots/dealpilot-verified.png)

## Demo In One Minute

1. Open the dashboard at `http://127.0.0.1:3001/dealpilot`.
2. Text the AgentPhone SMS number with a mission.
3. AgentPhone delivers the inbound SMS to `POST /webhooks/agentphone`.
4. DealPilot records the mission, builds an operating brief, and starts an outbound AgentPhone call.
5. The voice webhook runs the restaurant or merchant conversation.
6. The UI shows live route checks, mission artifacts, webhook proof, and approval state.

Example SMS:

```text
Call me now for a demo. Mission: book dinner tomorrow at 7 PM for 2 people under Dhrumil, with 6:30 or 7:30 as backups and $50 approval limit.
```

## Why It Matters

Most agent demos stop at a transcript. DealPilot closes more of the real-world loop:

- The user gives a goal and spend limit.
- The agent calls through an actual phone channel.
- The system records mission state and provider evidence.
- The agent asks for missing details instead of pretending success.
- Payment, email, and browser actions are staged behind explicit approval.
- The proof trail is visible to the user and judge.

That makes DealPilot useful for reservations, appointments, repairs, intake forms, deposits, follow-ups, and any workflow where a human would normally call, browse, email, and coordinate.

## What Is Built

- Dark, pitch-ready DealPilot dashboard at `/dealpilot`.
- SMS mission intake through AgentPhone conversations.
- Public AgentPhone webhook handler.
- SMS-to-outbound-call automation.
- Voice-turn webhook responses for restaurant and merchant calls.
- Cancel/hangup handling for live calls.
- Gemini mission brief generation from user intent and public source evidence.
- Live AgentPhone status checks for agents, numbers, conversations, and calls.
- Provider readiness proof trail for Browser Use, Moss, Supermemory, AgentMail, and Sponge.
- Local static frontend and Node backend so the demo can run without a complex monorepo.

## Integrations

### AgentPhone

AgentPhone is the core action layer.

- Receives inbound SMS missions.
- Delivers message events to `POST /webhooks/agentphone`.
- Starts outbound calls with `POST /v1/calls`.
- Sends voice turns back to the same webhook.
- Shows live call, number, and conversation status in the dashboard.

DealPilot also handles call termination. If the user says `cancel`, `stop`, `end call`, `hang up`, `bye`, or `goodbye`, the webhook responds with:

```json
{"action":"hangup","hangup":true,"text":"Understood. I will end the call now."}
```

### Gemini

Gemini turns raw mission text into a concise operating brief.

- Extracts the mission objective.
- Produces talking points for the phone agent.
- Identifies constraints such as budget, time window, deposit, cancellation policy, and fallback options.
- Uses public source evidence when a website is provided or discovered.

### Browser Use

Browser Use is staged as the browser automation layer.

- Intended for checking booking pages, forms, checkout flows, and business websites.
- The dashboard reports Browser Use readiness in the proof trail.
- The current demo prepares the route without submitting forms or credentials.

### Moss

Moss is the low-latency semantic memory layer.

- Intended for searching prior mission context, preferences, call notes, vendor policies, and constraints.
- DealPilot checks Moss configuration and shows readiness in the mission artifacts.

### Supermemory

Supermemory is the universal memory and context layer.

- Intended for persistent user preferences, approval rules, and reusable mission context.
- DealPilot surfaces Supermemory readiness in the proof trail.

### AgentMail

AgentMail is staged for follow-up and receipts.

- Intended for sending confirmations, receiving merchant replies, and storing proof.
- DealPilot checks inbox readiness and keeps follow-up actions behind approval.

### Sponge

Sponge is staged as the payment approval layer.

- Intended for deposits, scoped payment routes, and merchant-limited spend.
- DealPilot tracks spend caps and approval limits before any payment action.

## Architecture

```text
User SMS
  -> AgentPhone number
  -> AgentPhone webhook
  -> DealPilot backend
  -> mission record
  -> Gemini brief
  -> AgentPhone outbound call
  -> voice webhook turns
  -> dashboard proof trail
```

Main files:

```text
server.mjs                 Backend, integrations, webhook, call orchestration
public/dealpilot.html      Dark dashboard UI
web.mjs                    Tiny static web server for /dealpilot
.env.example               Integration configuration template
HACKATHON_IDEA.md          Product narrative and judging hook
screenshots/               Demo screenshots
```

## API Surface

### Webhook

```text
GET  /webhooks/agentphone
POST /webhooks/agentphone
```

`GET` returns readiness and recent webhook events.

`POST` accepts AgentPhone message and voice events. SMS events create a mission and start a call. Voice events return the next sentence the agent should say.

### App API

```text
GET  /healthz
GET  /rest/dealpilot/live-status
GET  /rest/dealpilot/missions
POST /rest/dealpilot/missions
POST /rest/dealpilot/research
POST /rest/dealpilot/agentphone/call
POST /rest/dealpilot/browser-use/run
POST /rest/dealpilot/memory/sync
POST /rest/dealpilot/payment/authorize
POST /rest/dealpilot/email/follow-up
```

## Approval And Trust Model

DealPilot is designed for real-world action without reckless autonomy.

- It asks for missing target, time, budget, and fallback details.
- It confirms merchant, amount, cancellation policy, and receipt before payment.
- It does not ask for card details during a call.
- It does not claim a booking or purchase happened unless an external party confirms it.
- It exposes provider status and webhook events in the UI proof trail.
- It lets the user cancel live calls by voice.

## Run Locally

Create `.env` from `.env.example`.

Start the backend:

```bash
npm run start
```

Start the web UI in a second terminal:

```bash
npm run web
```

Open:

```text
http://127.0.0.1:3001/dealpilot
```

## Live Webhook Setup

Expose the backend on port `3000` with a public HTTPS tunnel:

```bash
npx cloudflared tunnel --url http://127.0.0.1:3000
```

Register this URL in AgentPhone:

```text
https://your-public-url/webhooks/agentphone
```

Once the webhook is active, text the AgentPhone SMS number with a mission. DealPilot should automatically call back. No extra confirmation message in chat is needed.

## Environment

Required for live AgentPhone calls:

```text
AGENTPHONE_API_KEY=
AGENTPHONE_AGENT_ID=
AGENTPHONE_FROM_NUMBER_ID=
AGENTPHONE_CALL_FROM_NUMBER_ID=
```

Recommended for webhook verification:

```text
DEALPILOT_AGENTPHONE_WEBHOOK_SECRET=
```

Required for Gemini briefs:

```text
GEMINI_API_KEY=
GEMINI_PROJECT_NAME=
GEMINI_MODEL=gemini-2.5-flash
```

Optional sponsor integrations:

```text
MOSS_PROJECT_ID=
MOSS_PROJECT_KEY=
MOSS_BASE_URL=
SUPERMEMORY_API_KEY=
AGENTMAIL_API_KEY=
AGENTMAIL_INBOX_ID=
BROWSER_USE_API_KEY=
SPONGE_API_KEY=
```

Do not commit `.env`. It is ignored by `.gitignore`.

## Verification

Syntax check:

```bash
npm run smoke
```

Manual cancel webhook test:

```bash
curl -sS -X POST http://127.0.0.1:3000/webhooks/agentphone \
  -H 'Content-Type: application/json' \
  --data-binary '{"id":"cancel-smoke","type":"agent.message","data":{"channel":"voice","callId":"demo-call","participant":"+16692209008","text":"cancel"}}'
```

Expected response:

```json
{"action":"hangup","hangup":true,"text":"Understood. I will end the call now."}
```

## Judging Hook

DealPilot is not a pitch-deck agent. It is a working phone agent workflow with live SMS intake, outbound calls, provider evidence, approval gates, and a visible proof trail. It demonstrates how real-world agents can act across phone, browser, email, memory, and payments without hiding the risk from the user.

