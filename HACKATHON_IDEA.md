# DealPilot: The Agent That Calls, Books, and Pays

## One-liner

DealPilot is a real-world agent command center: pick a task, call the business with AgentPhone, remember every preference with Moss, pay a bounded deposit through Sponge, then write the proof trail back into the mission workspace.

## What It Does

Users create a mission such as:

- Book windshield repair before Wednesday with a deposit under $75
- Schedule a dentist appointment this week and complete intake
- Reserve catering for 24 people and pay the hold

DealPilot then:

1. Researches the business website, hours, policies, and contact channels.
2. Uses Browser Use to inspect booking and checkout flows without submitting forms or payment credentials.
3. Uses Moss to retrieve old call transcripts, user preferences, allergy notes, budget caps, and payment rules.
4. Calls the business with AgentPhone, handles hold music, asks follow-up questions, and negotiates an appointment.
5. Uses Sponge to create a scoped payment route or virtual card with merchant, amount, and expiration guardrails.
6. Confirms by SMS/email, creates the calendar event, stores the receipt, and logs the transcript in DealPilot.

## Why It Is Different

Most demos stop at "the agent called someone." DealPilot closes the entire real-world loop: call, negotiate, pay, confirm, and record proof. It is not a pitch deck agent. It either got the appointment and receipt, or it did not.

## Sponsor Fit

- AgentPhone: the core action channel for calling real businesses.
- Browser Use: safe browser automation for booking pages, forms, and checkout reconnaissance.
- Sponge: controlled financial infrastructure for deposits, virtual cards, wallet actions, and browser checkout.
- Moss: fast semantic memory over call transcripts, vendor policies, and user constraints.
- Apify / Browser automation: public research and fallback website extraction.
- AgentMail: follow-up inbox for receipts, confirmations, and vendor replies.
- DealPilot: CRM-grade workspace for contacts, missions, audit trail, receipts, and follow-ups.

## Demo Script

1. Open DealPilot.
2. Select "Hayes Auto Glass" with a $75 deposit cap.
3. Click "Call My Agent."
4. Watch the timeline: research, Moss memory, AgentPhone call, Sponge deposit, SMS approval, calendar/CRM update.
5. Show the artifacts: vendor brief, sponsor guardrails, receipt/proof trail.

## Judging Hook

"We built the missing trust layer for real-world agents. A human gives a goal and a spend limit. The agent makes the call, remembers context, uses money safely, and returns verifiable proof."
