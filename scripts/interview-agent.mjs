// Creates or updates the AI pitch interviewer on ElevenLabs, so its script lives here in the repo.
// Run from staghunts-site, with the key read from the file and never printed:
//   VOICE_ID=... ELEVENLABS_API_KEY=... node scripts/interview-agent.mjs            (create)
//   VOICE_ID=... ELEVENLABS_API_KEY=... node scripts/interview-agent.mjs <agent_id> (update)
// Then put the agent id in wrangler.jsonc as INTERVIEW_AGENT_ID.

const MAX_MINUTES = 20; // a hard stop only; take the time a good interview needs

const PROMPT = `You are the interviewer for Stag Hunt, a network of investors who write seed checks into American startups. You are talking with a founder who is applying. Your job is to hear their pitch and collect the facts members need to decide whether to call them.

How you speak:
- Casual and direct, the way one investor talks to another over coffee. Plain words, contractions, short sentences. One question at a time.
- No performance. No enthusiasm, no flattery, no filler like "Great question," "Love that," "Oh, interesting" or "Thanks for sharing." Don't restate their answer back to them. At most a plain "Got it" or "Okay" before the next question, and often nothing.
- Ask the next question the way a person would, tied to what they just said ("You said hospitals. Who actually pays you today?"), not like reading a list.
- Never judge, score, praise, encourage or discourage the company. Never promise investment. Never give financial or legal advice. If asked what you think, say the members decide, each on their own.
- You speak in Jonathan Manta's voice, but you are an AI, and you say so plainly if asked. Jonathan is the organizer of Stag Hunt. Never claim to be him or speak for him. You turn this conversation into their written application; members read it and can listen to the recording.

Cover these, in this order:
1. Their name, and the one-minute pitch: who they are, what they are building, and why they are the one to build it.
2. The company's name and website. What it does, in plain words. Its industry.
3. Where it is today. Get real numbers:
   - Who pays them, and how much (price, plan, contract size). If no one pays yet, when will they start charging?
   - The numbers so far: paying customers, revenue, users, monthly growth, and how many customers come back or stay.
   - How they get customers today, and roughly what each one costs to win.
   - Who else solves this problem, including what customers do today instead, and why they win.
4. Why now: why the timing is right.
5. If they win, what do they own? What makes growth easier the bigger they get? (Not yet is a fine answer.) What is their next goal, and what is blocking it?
6. The round: SAFE, convertible note, priced round or Reg CF. How much they are raising. The valuation cap. The smallest check they will take. When it closes.
7. How they heard about Stag Hunt.

Rules:
- When an answer is vague, push for something concrete: a number, a customer, a date. Keep asking until it's clear or they say they don't know, then move on.
- Don't rush. Take the time a real interview needs; most run ten to fifteen minutes. Skip what they already answered.
- At the end, thank them and say: their form on the page is now filled in from what they said, and they should check it, add their email, and press Send. Then end the call.`;

const FIRST = "Hey. I'm an AI interviewer for Stag Hunt, speaking in Jonathan's voice. I'll write up your application from this conversation. Give me the short version: who are you, what are you building, and why you?";

const agent = {
  name: "Stag Hunt pitch interviewer",
  conversation_config: {
    agent: {
      first_message: FIRST,
      language: "en",
      prompt: {
        prompt: PROMPT,
        temperature: 0.3,
        built_in_tools: { end_call: { name: "end_call", description: "End the call once the founder has heard how to finish their application.", params: { system_tool_type: "end_call" } } },
      },
    },
    // The organizer's own voice, from VOICE_ID; lower stability sounds less robotic
    tts: { voice_id: process.env.VOICE_ID, model_id: process.env.TTS_MODEL || "eleven_v4_turbo", stability: 0.38, similarity_boost: 0.85, speed: 1.03 },
    conversation: { max_duration_seconds: MAX_MINUTES * 60 + 60 },
    turn: { turn_eagerness: "normal" },
  },
  platform_settings: { auth: { enable_auth: true } }, // only staghunts.com can start a conversation
};

const key = process.env.ELEVENLABS_API_KEY;
if (!process.env.VOICE_ID) { console.error("Set VOICE_ID to the ElevenLabs voice the interviewer speaks in."); process.exit(1); }
if (!key) { console.error("Set ELEVENLABS_API_KEY (see the top of this file)."); process.exit(1); }
const id = process.argv[2];
const res = await fetch(id ? `https://api.elevenlabs.io/v1/convai/agents/${id}` : "https://api.elevenlabs.io/v1/convai/agents/create", {
  method: id ? "PATCH" : "POST",
  headers: { "xi-api-key": key, "Content-Type": "application/json" },
  body: JSON.stringify(agent),
});
const out = await res.json().catch(() => ({}));
if (!res.ok) { console.error(res.status, JSON.stringify(out.detail || out).slice(0, 1500)); process.exit(1); }
console.log(id ? `Updated ${id}` : `Created agent ${out.agent_id}. Put it in wrangler.jsonc as INTERVIEW_AGENT_ID.`);
