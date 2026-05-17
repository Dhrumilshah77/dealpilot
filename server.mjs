import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const loadEnvFile = (filePath) => {
  if (!existsSync(filePath)) {
    return;
  }

  for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmedLine = line.trim();

    if (!trimmedLine || trimmedLine.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmedLine.indexOf('=');

    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmedLine.slice(0, separatorIndex).trim();
    const rawValue = trimmedLine.slice(separatorIndex + 1).trim();
    const value = rawValue.replace(/^['"]|['"]$/g, '');

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
};

loadEnvFile(join(__dirname, '.env'));

const port = Number(process.env.PORT ?? 3000);
const allowedOrigins = new Set([
  'http://127.0.0.1:3001',
  'http://localhost:3001',
  'http://127.0.0.1:3000',
  'http://localhost:3000',
]);

const truncate = (value, maxLength) =>
  value.length > maxLength ? `${value.slice(0, maxLength).trim()}...` : value;

const normalizeWhitespace = (value) => value.replace(/\s+/g, ' ').trim();

const stripHtml = (value) =>
  normalizeWhitespace(
    value
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  );

const decodeHtmlEntities = (value) =>
  value
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>');

const extractMetaContent = (html, name) => {
  const matcher = new RegExp(
    `<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']+)["'][^>]*>`,
    'i',
  );

  return decodeHtmlEntities(stripHtml(html.match(matcher)?.[1] ?? ''));
};

const fetchSourceEvidence = async (sourceUrl) => {
  if (typeof sourceUrl !== 'string' || !sourceUrl.startsWith('http')) {
    return undefined;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);

  try {
    const response = await fetch(sourceUrl, {
      headers: {
        'User-Agent':
          'DealPilot/1.0 (+https://agentphone.ai; hackathon readiness check)',
      },
      signal: controller.signal,
    });

    const html = await response.text();
    const title = decodeHtmlEntities(
      stripHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ''),
    );
    const description =
      extractMetaContent(html, 'description') ||
      extractMetaContent(html, 'og:description');

    return {
      description: truncate(description, 220),
      status: response.status,
      title: truncate(title, 120),
      url: response.url || sourceUrl,
    };
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
};

const getCorsHeaders = (origin) => ({
  'Access-Control-Allow-Credentials': 'true',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Origin': allowedOrigins.has(origin)
    ? origin
    : 'http://127.0.0.1:3001',
  'Content-Type': 'application/json; charset=utf-8',
  'X-DealPilot': 'true',
});

const sendJson = (response, statusCode, payload, origin) => {
  response.writeHead(statusCode, getCorsHeaders(origin));
  response.end(JSON.stringify(payload));
};

const readRawBody = (request) =>
  new Promise((resolve, reject) => {
    const chunks = [];

    request.on('data', (chunk) => chunks.push(chunk));
    request.on('error', reject);
    request.on('end', () => {
      const rawBody = Buffer.concat(chunks).toString('utf8');

      resolve(rawBody);
    });
  });

const parseJsonBody = (rawBody) => {
  if (!rawBody) {
    return {};
  }

  try {
    return JSON.parse(rawBody);
  } catch (error) {
    throw error;
  }
};

const readJsonBody = async (request) =>
  parseJsonBody(await readRawBody(request));

const userMissions = [];
const callSessions = new Map();
const processedWebhookEvents = new Set();
const webhookEvents = [];
const lastAutocallByParticipant = new Map();

const recordWebhookEvent = (event) => {
  webhookEvents.unshift({
    ...event,
    receivedAt: new Date().toISOString(),
  });

  webhookEvents.splice(25);
};

const normalizeMission = (request) => {
  const missionText = normalizeWhitespace(String(request.closePlan ?? ''));
  const accountName =
    normalizeWhitespace(String(request.accountName ?? '')).slice(0, 80) ||
    truncate(missionText, 64) ||
    'User mission';
  const spendCap =
    normalizeWhitespace(String(request.value ?? '')).slice(0, 80) ||
    'Spend cap needed';

  return {
    id:
      typeof request.id === 'string' && request.id
        ? request.id
        : `mission-${Date.now()}`,
    accountName,
    contactName:
      normalizeWhitespace(String(request.contactName ?? '')).slice(0, 80) ||
      'Created in DealPilot',
    contactRole:
      normalizeWhitespace(String(request.contactRole ?? '')).slice(0, 80) ||
      'User mission',
    website:
      typeof request.website === 'string' && request.website
        ? request.website
        : 'https://agentphone.ai',
    value: spendCap,
    stage:
      normalizeWhitespace(String(request.stage ?? '')).slice(0, 60) ||
      'Draft mission',
    closePlan: missionText || 'Ask the user for the mission details',
    objection:
      normalizeWhitespace(String(request.objection ?? '')).slice(0, 140) ||
      'Needs target, deadline, constraints, and spend cap confirmation',
    risk:
      typeof request.risk === 'number' && Number.isFinite(request.risk)
        ? request.risk
        : 34,
    owner:
      normalizeWhitespace(String(request.owner ?? '')).slice(0, 60) ||
      'DealPilot',
    lastTouch: 'Just added',
  };
};

const listMissions = () => ({ data: userMissions });

const addMission = (request) => {
  const mission = normalizeMission(request);

  userMissions.unshift(mission);

  return mission;
};

const createFallbackBrief = (request) => {
  const accountName = request.accountName ?? 'This account';
  const objection = request.objection ?? 'the current objection';

  return {
    mode: 'local',
    sourceUrl: request.website,
    summary: `${accountName} is a live DealPilot mission. The agent should acknowledge ${objection.toLowerCase()}, confirm the target, deadline, spend cap, and approval path before execution.`,
    signals: [
      {
        label: 'Mission risk',
        value: `${request.risk ?? 50}%`,
      },
      {
        label: 'Vendor constraint',
        value: objection,
      },
      {
        label: 'Approval route',
        value: request.value ?? 'User-approved spend cap',
      },
      {
        label: 'Context layer',
        value: 'Provider credentials are available for retrieval and recall',
      },
    ],
    talkingPoints: [
      `Lead with the booking objective for ${accountName}.`,
      'Confirm the approval path before any external execution.',
      'Ask for target, deadline, constraints, and spend cap before continuing.',
    ],
  };
};

const normalizeGeminiSignals = (signals, request) => {
  const normalizedSignals = Array.isArray(signals)
    ? signals.filter(
        (signal) =>
          typeof signal?.label === 'string' &&
          typeof signal?.value === 'string',
      )
    : [];

  return normalizedSignals.length > 0
    ? normalizedSignals.slice(0, 5)
    : createFallbackBrief(request).signals;
};

const normalizeGeminiTalkingPoints = (talkingPoints, request) => {
  const normalizedTalkingPoints = Array.isArray(talkingPoints)
    ? talkingPoints.filter((talkingPoint) => typeof talkingPoint === 'string')
    : [];

  return normalizedTalkingPoints.length > 0
    ? normalizedTalkingPoints.slice(0, 4)
    : createFallbackBrief(request).talkingPoints;
};

const tryParseJsonText = (rawText) => {
  try {
    return JSON.parse(rawText);
  } catch {
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      return undefined;
    }

    try {
      return JSON.parse(jsonMatch[0]);
    } catch {
      return undefined;
    }
  }
};

const createGeminiBrief = async (request) => {
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;

  if (!apiKey) {
    return undefined;
  }

  const sourceEvidence = await fetchSourceEvidence(request.website);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const model = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: `Return strict JSON for a DealPilot voice-agent mission. Use this shape: {"summary":"string","signals":[{"label":"string","value":"string"}],"talkingPoints":["string"]}. Keep it concise and operational. Use the live source evidence when present. Mission: ${JSON.stringify(
                    {
                      accountName: request.accountName,
                      closePlan: request.closePlan,
                      contactName: request.contactName,
                      contactRole: request.contactRole,
                      objection: request.objection,
                      projectName: process.env.GEMINI_PROJECT_NAME,
                      risk: request.risk,
                      value: request.value,
                      website: request.website,
                      sourceEvidence,
                    },
                  )}`,
                },
              ],
            },
          ],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.2,
          },
        }),
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        method: 'POST',
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      return undefined;
    }

    const payload = await response.json();
    const rawText =
      payload.candidates?.[0]?.content?.parts
        ?.map((part) => part.text ?? '')
        .join('') ?? '';
    const parsed = tryParseJsonText(rawText);

    if (!parsed) {
      return undefined;
    }

    return {
      mode: 'gemini',
      sourceEvidence,
      sourceUrl: request.website,
      summary:
        typeof parsed.summary === 'string'
          ? truncate(normalizeWhitespace(parsed.summary), 420)
          : createFallbackBrief(request).summary,
      signals: [
        ...(sourceEvidence?.title
          ? [
              {
                label: 'Source title',
                value: sourceEvidence.title,
              },
            ]
          : []),
        ...normalizeGeminiSignals(parsed.signals, request),
      ].slice(0, 5),
      talkingPoints: normalizeGeminiTalkingPoints(
        parsed.talkingPoints,
        request,
      ),
    };
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
};

const research = async (request) =>
  (await createGeminiBrief(request)) ?? createFallbackBrief(request);

const agentPhoneApiGet = async (path) => {
  if (!process.env.AGENTPHONE_API_KEY) {
    return { data: [], total: 0 };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(`https://api.agentphone.ai/v1/${path}`, {
      headers: {
        Authorization: `Bearer ${process.env.AGENTPHONE_API_KEY}`,
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      return { data: [], total: 0, error: response.status };
    }

    return await response.json();
  } catch {
    return { data: [], total: 0, error: 'unavailable' };
  } finally {
    clearTimeout(timeout);
  }
};

const agentPhoneApiPost = async (path, body) => {
  if (!process.env.AGENTPHONE_API_KEY) {
    return {
      ok: false,
      status: 'missing_key',
      body: { detail: 'AgentPhone is not configured.' },
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch(`https://api.agentphone.ai/v1/${path}`, {
      body: JSON.stringify(body),
      headers: {
        Authorization: `Bearer ${process.env.AGENTPHONE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
      signal: controller.signal,
    });
    const rawText = await response.text();
    const responseBody = tryParseJsonText(rawText) ?? {
      detail: truncate(rawText, 300),
    };

    return {
      body: responseBody,
      ok: response.ok,
      status: response.status,
    };
  } catch (error) {
    return {
      ok: false,
      status: 'unavailable',
      body: {
        detail: error instanceof Error ? error.message : 'Request failed.',
      },
    };
  } finally {
    clearTimeout(timeout);
  }
};

const extractInboundMessage = (payload) => {
  const data = payload.data ?? payload.message ?? payload;
  const message =
    data.text ??
    data.body ??
    data.content ??
    data.message ??
    data.lastMessagePreview ??
    payload.text ??
    payload.body ??
    '';
  const participant =
    data.participant ??
    data.from ??
    data.fromNumber ??
    data.sender ??
    data.customerNumber ??
    payload.participant ??
    payload.from;
  const phoneNumberId =
    data.phoneNumberId ?? data.numberId ?? data.toNumberId ?? payload.numberId;

  return {
    callId:
      data.callId ??
      data.call?.id ??
      data.conversationId ??
      payload.callId ??
      payload.call?.id,
    channel: data.channel ?? payload.channel,
    conversationId: data.conversationId ?? data.conversation?.id ?? payload.id,
    eventId:
      payload.id ??
      payload.eventId ??
      data.id ??
      `${participant ?? 'unknown'}-${data.createdAt ?? Date.now()}`,
    eventType: payload.type ?? payload.event ?? payload.name ?? 'message',
    message: normalizeWhitespace(String(message)),
    participant: typeof participant === 'string' ? participant : undefined,
    phoneNumber: data.phoneNumber ?? data.to ?? data.toNumber,
    phoneNumberId:
      typeof phoneNumberId === 'string' ? phoneNumberId : undefined,
  };
};

const createVoiceResponse = (inbound) => {
  const callId = inbound.callId ?? inbound.participant ?? 'default';
  const session = callSessions.get(callId) ?? { turn: 0 };
  const transcript = inbound.message.toLowerCase();
  let text;
  let hangup = false;
  let action;

  if (
    /\b(cancel|stop|end call|hang up|hangup|goodbye|bye)\b/i.test(transcript)
  ) {
    text = 'Understood. I will end the call now.';
    hangup = true;
    action = 'hangup';
  } else if (
    /\b(booked|confirmed|reserved|you are set|all set)\b/i.test(transcript)
  ) {
    text =
      'Great, thank you. I have the reservation marked as confirmed. I will send the user the time, party size, and any deposit or cancellation details for final review.';
    hangup = true;
    action = 'hangup';
  } else if (
    /\b(no|not available|unavailable|full|cannot)\b/i.test(transcript)
  ) {
    text =
      'Understood. Could you check 6:30 PM or 7:30 PM tomorrow for two people instead? The reservation name is Dhrumil.';
  } else if (/\b(deposit|card|fee|prepay|hold)\b/i.test(transcript)) {
    text =
      'Thanks. What is the deposit amount and cancellation policy? I will not provide card details on this call; I need to take that back for approval.';
  } else if (session.turn === 0) {
    text =
      'Hi, this is DealPilot calling for Dhrumil. I am trying to book dinner tomorrow at 7 PM for two people. Is that available?';
  } else if (session.turn === 1) {
    text =
      'Thanks. If 7 PM is available, please hold it under Dhrumil. If not, could you check 6:30 PM or 7:30 PM?';
  } else {
    text =
      'That helps. Please confirm the reservation time, party size, name, and whether any deposit or cancellation policy applies.';
  }

  callSessions.set(callId, {
    turn: session.turn + 1,
  });

  return hangup ? { action, hangup, text } : { text };
};

const createMissionFromInboundMessage = (inbound) => {
  const spendCap = inbound.message.match(/\$\s?\d[\d,]*/)?.[0];
  const website = inbound.message.match(/https?:\/\/\S+/)?.[0];

  return addMission({
    accountName:
      inbound.message.length > 64
        ? `${inbound.message.slice(0, 61).trim()}...`
        : inbound.message,
    closePlan: inbound.message,
    contactName: inbound.participant ?? 'SMS sender',
    contactRole: 'Inbound SMS mission',
    id: `sms-${Date.now()}`,
    objection:
      'Confirm target, time window, cancellation policy, and deposit requirement',
    owner: 'DealPilot webhook',
    risk: spendCap ? 24 : 38,
    stage: 'SMS mission',
    value: spendCap ? `${spendCap} approval limit` : 'Approval limit needed',
    website: website ?? 'https://agentphone.ai',
  });
};

const shouldAutocall = (inbound) => {
  if (!inbound.participant || inbound.message.length < 8) {
    return false;
  }

  if (/\b(stop|cancel|unsubscribe|wrong number)\b/i.test(inbound.message)) {
    return false;
  }

  return true;
};

const resolveCallFromNumberId = async (inboundPhoneNumberId) => {
  if (process.env.AGENTPHONE_CALL_FROM_NUMBER_ID) {
    return process.env.AGENTPHONE_CALL_FROM_NUMBER_ID;
  }

  if (inboundPhoneNumberId) {
    return inboundPhoneNumberId;
  }

  const numbers = await agentPhoneApiGet('numbers?limit=20');
  const smsNumber = (numbers.data ?? []).find(
    (number) => number.type === 'sms',
  );

  return smsNumber?.id ?? process.env.AGENTPHONE_FROM_NUMBER_ID;
};

const buildAutocallPrompt = (mission) =>
  `You are DealPilot, a professional phone agent for a live YC hackathon demo. The user texted this mission: "${mission.closePlan}". Call the user back and gather the missing details needed to execute it. If they ask you to roleplay a merchant or restaurant host, continue naturally. For reservations, confirm party size, date, time, backup times, name, deposit amount, cancellation policy, and next approval step. Do not ask for card details. Do not claim a booking, payment, email, or purchase is completed unless the external party confirms it. Keep the call concise, warm, and operational.`;

const startWebhookAutocall = async (inbound, mission) => {
  const now = Date.now();
  const lastAutocallAt =
    lastAutocallByParticipant.get(inbound.participant) ?? 0;

  if (now - lastAutocallAt < 45_000) {
    return {
      skipped: true,
      reason: 'cooldown',
    };
  }

  const fromNumberId = await resolveCallFromNumberId(inbound.phoneNumberId);

  if (!fromNumberId || !process.env.AGENTPHONE_AGENT_ID) {
    return {
      skipped: true,
      reason: 'missing_call_route',
    };
  }

  lastAutocallByParticipant.set(inbound.participant, now);

  const callResponse = await agentPhoneApiPost('calls', {
    agentId: process.env.AGENTPHONE_AGENT_ID,
    fromNumberId,
    initialGreeting:
      'Hi, this is DealPilot. I got your text mission and I am calling to collect the details needed to run it.',
    systemPrompt: buildAutocallPrompt(mission),
    toNumber: inbound.participant,
  });

  if (!callResponse.ok) {
    lastAutocallByParticipant.delete(inbound.participant);
  }

  return callResponse;
};

const verifyAgentPhoneWebhookSignature = (request, rawBody) => {
  const secret = process.env.DEALPILOT_AGENTPHONE_WEBHOOK_SECRET;

  if (!secret) {
    return true;
  }

  const signature =
    request.headers['x-agentphone-signature'] ??
    request.headers['agentphone-signature'] ??
    request.headers['x-webhook-signature'];

  if (typeof signature !== 'string') {
    return false;
  }

  const actual = signature.replace(/^sha256=/, '');
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const actualBuffer = Buffer.from(actual, 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');

  if (actualBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(actualBuffer, expectedBuffer);
};

const handleAgentPhoneWebhook = async (request, rawBody) => {
  if (!verifyAgentPhoneWebhookSignature(request, rawBody)) {
    return {
      accepted: false,
      status: 'invalid_signature',
    };
  }

  const payload = parseJsonBody(rawBody);
  const inbound = extractInboundMessage(payload);
  const voiceEvent =
    inbound.channel === 'voice' ||
    inbound.eventType.includes('voice') ||
    inbound.eventType.includes('call');
  const messageEvent =
    inbound.eventType.includes('message') || inbound.eventType === 'sms';

  if (voiceEvent) {
    const response = createVoiceResponse(inbound);

    recordWebhookEvent({
      callId: inbound.callId,
      eventId: inbound.eventId,
      eventType: inbound.eventType,
      message: inbound.message,
      participant: inbound.participant,
      status: 'voice_response',
    });

    return response;
  }

  if (processedWebhookEvents.has(inbound.eventId)) {
    return {
      accepted: true,
      duplicate: true,
      eventId: inbound.eventId,
    };
  }

  processedWebhookEvents.add(inbound.eventId);

  if (!messageEvent || !shouldAutocall(inbound)) {
    recordWebhookEvent({
      eventId: inbound.eventId,
      eventType: inbound.eventType,
      message: inbound.message,
      participant: inbound.participant,
      status: 'recorded',
    });

    return {
      accepted: true,
      action: 'recorded',
      eventId: inbound.eventId,
    };
  }

  const mission = createMissionFromInboundMessage(inbound);
  const call = await startWebhookAutocall(inbound, mission);

  recordWebhookEvent({
    callId: call.body?.id,
    callStatus: call.body?.status,
    eventId: inbound.eventId,
    eventType: inbound.eventType,
    message: inbound.message,
    participant: inbound.participant,
    status: call.ok ? 'call_started' : 'call_failed',
  });

  return {
    accepted: true,
    action: call.ok ? 'call_started' : 'call_failed',
    call: {
      id: call.body?.id,
      status: call.body?.status,
    },
    eventId: inbound.eventId,
    mission,
  };
};

const liveStatus = async () => {
  const [numbers, agents, calls, conversations] = await Promise.all([
    agentPhoneApiGet('numbers?limit=20'),
    agentPhoneApiGet('agents?limit=20'),
    agentPhoneApiGet('calls?limit=5'),
    agentPhoneApiGet('conversations?limit=20'),
  ]);

  return {
    checkedAt: new Date().toISOString(),
    agentMail: {
      configured: Boolean(process.env.AGENTMAIL_API_KEY),
      inboxId: process.env.AGENTMAIL_INBOX_ID,
    },
    agentPhone: {
      agents: agents.data ?? [],
      calls: calls.data ?? [],
      conversations: conversations.data ?? [],
      numbers: numbers.data ?? [],
      totalAgents: agents.total ?? agents.data?.length ?? 0,
      totalCalls: calls.total ?? calls.data?.length ?? 0,
      totalConversations:
        conversations.total ?? conversations.data?.length ?? 0,
      totalNumbers: numbers.total ?? numbers.data?.length ?? 0,
    },
    browserUse: {
      configured: Boolean(process.env.BROWSER_USE_API_KEY),
    },
    gemini: {
      configured: Boolean(
        process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY,
      ),
      projectName: process.env.GEMINI_PROJECT_NAME,
    },
    memory: {
      mossConfigured: Boolean(
        process.env.MOSS_PROJECT_ID && process.env.MOSS_PROJECT_KEY,
      ),
      supermemoryConfigured: Boolean(process.env.SUPERMEMORY_API_KEY),
    },
    payments: {
      spongeConfigured: Boolean(process.env.SPONGE_API_KEY),
    },
    webhook: {
      recentEvents: webhookEvents.slice(0, 5),
      totalEvents: webhookEvents.length,
    },
  };
};

const startAgentPhoneCall = (request) => {
  const hasKey = Boolean(process.env.AGENTPHONE_API_KEY);
  const hasLiveTarget = Boolean(
    process.env.AGENTPHONE_AGENT_ID && process.env.DEALPILOT_DEMO_TO_NUMBER,
  );

  if (!hasKey) {
    return {
      mode: 'simulated',
      status: 'simulated',
      detail: 'AgentPhone route is not configured in this environment.',
    };
  }

  if (
    process.env.AGENTPHONE_AGENT_ID &&
    process.env.AGENTPHONE_FROM_NUMBER_ID &&
    !process.env.DEALPILOT_DEMO_TO_NUMBER
  ) {
    return {
      mode: 'agentphone',
      status: 'configured',
      detail: `AgentPhone agent is attached to ${
        process.env.DEALPILOT_AGENTPHONE_IMESSAGE_NUMBER ??
        'the configured inbound number'
      }. Text that number to run the live iMessage test.`,
    };
  }

  if (!hasLiveTarget || process.env.DEALPILOT_ENABLE_LIVE_CALLS !== 'true') {
    return {
      mode: 'simulated',
      status: 'configured',
      detail:
        'AgentPhone is configured. Voice launch requires a selected destination number and live-call approval flag.',
    };
  }

  return {
    mode: 'agentphone',
    status: 'configured',
    detail: `AgentPhone is ready to place a guarded live call for ${
      request.accountName ?? 'this mission'
    }.`,
  };
};

const syncMemory = (request) => {
  const hasMossCredentials = Boolean(
    process.env.MOSS_PROJECT_ID && process.env.MOSS_PROJECT_KEY,
  );
  const hasSupermemoryCredentials = Boolean(process.env.SUPERMEMORY_API_KEY);

  if (!hasMossCredentials && !hasSupermemoryCredentials) {
    return {
      mode: 'simulated',
      status: 'simulated',
      detail:
        'Context providers are not configured; DealPilot is using the local mission context.',
    };
  }

  return {
    mode: 'configured',
    status: 'configured',
    detail: `${
      hasMossCredentials
        ? 'Moss project credentials are loaded'
        : 'Moss is not configured'
    }; ${
      hasSupermemoryCredentials
        ? 'Supermemory key is loaded'
        : 'Supermemory is not configured'
    }. Context layer is ready for retrieval and ranking for ${
      request.accountName ?? 'this account'
    }.`,
  };
};

const runBrowserUse = (request) => {
  if (!process.env.BROWSER_USE_API_KEY) {
    return {
      mode: 'simulated',
      status: 'simulated',
      detail: 'Browser Use is not configured in this environment.',
    };
  }

  return {
    mode: 'configured',
    status: 'configured',
    detail: `Browser Use key is loaded. DealPilot can inspect ${
      request.website ?? request.accountName ?? 'the vendor site'
    } when DEALPILOT_ENABLE_LIVE_BROWSER_USE=true.`,
  };
};

const authorizePayment = (request) => {
  if (!process.env.SPONGE_API_KEY) {
    return {
      mode: 'simulated',
      status: 'simulated',
      detail: 'Sponge is not configured in this environment.',
    };
  }

  return {
    mode: 'configured',
    status: 'configured',
    detail: `Sponge credentials are loaded for a guarded deposit route (${
      request.value ?? 'user-approved cap'
    }). Approval is required before payment execution.`,
  };
};

const prepareFollowUpEmail = (request) => {
  if (!process.env.AGENTMAIL_API_KEY) {
    return {
      mode: 'simulated',
      status: 'simulated',
      detail: 'AgentMail is not configured in this environment.',
    };
  }

  return {
    mode: 'configured',
    status: 'configured',
    detail: `AgentMail inbox is ready to draft the confirmation for ${
      request.accountName ?? 'this mission'
    }. Follow-up is staged for approval.`,
  };
};

const routeHandlers = {
  '/rest/dealpilot/agentphone/call': startAgentPhoneCall,
  '/rest/dealpilot/browser-use/run': runBrowserUse,
  '/rest/dealpilot/email/follow-up': prepareFollowUpEmail,
  '/rest/dealpilot/memory/sync': syncMemory,
  '/rest/dealpilot/missions': addMission,
  '/rest/dealpilot/payment/authorize': authorizePayment,
  '/rest/dealpilot/research': research,
};

const getRouteHandlers = {
  '/rest/dealpilot/live-status': liveStatus,
  '/rest/dealpilot/missions': listMissions,
};

const server = createServer(async (request, response) => {
  const origin = request.headers.origin;

  if (request.method === 'OPTIONS') {
    sendJson(response, 204, {}, origin);
    return;
  }

  const url = new URL(request.url ?? '/', `http://${request.headers.host}`);

  if (request.method === 'GET' && url.pathname === '/healthz') {
    sendJson(response, 200, { status: 'ok', service: 'dealpilot' }, origin);
    return;
  }

  if (request.method === 'GET' && url.pathname === '/client-config') {
    sendJson(response, 200, { clientConfig: {} }, origin);
    return;
  }

  if (
    request.method === 'GET' &&
    (url.pathname === '/webhooks/agentphone' ||
      url.pathname === '/rest/dealpilot/agentphone/webhook')
  ) {
    sendJson(
      response,
      200,
      {
        recentEvents: webhookEvents.slice(0, 5),
        status: 'ready',
        webhookPath: '/webhooks/agentphone',
      },
      origin,
    );
    return;
  }

  if (
    request.method === 'POST' &&
    (url.pathname === '/webhooks/agentphone' ||
      url.pathname === '/rest/dealpilot/agentphone/webhook')
  ) {
    try {
      const rawBody = await readRawBody(request);
      const result = await handleAgentPhoneWebhook(request, rawBody);

      sendJson(response, result.accepted === false ? 401 : 200, result, origin);
    } catch {
      sendJson(
        response,
        400,
        { accepted: false, error: 'Webhook payload could not be processed.' },
        origin,
      );
    }

    return;
  }

  const getHandler = getRouteHandlers[url.pathname];

  if (request.method === 'GET' && getHandler) {
    sendJson(response, 200, await getHandler(), origin);
    return;
  }

  const handler = routeHandlers[url.pathname];

  if (request.method !== 'POST' || !handler) {
    sendJson(response, 404, { error: 'Not found' }, origin);
    return;
  }

  try {
    const body = await readJsonBody(request);
    const result = await handler(body);

    sendJson(response, 200, result, origin);
  } catch {
    sendJson(
      response,
      400,
      { error: 'DealPilot could not read this request.' },
      origin,
    );
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`DealPilot backend listening on http://127.0.0.1:${port}`);
});
