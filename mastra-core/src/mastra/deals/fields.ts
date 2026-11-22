// What founder conversations can tell us about a startup, and the longest answer kept for each.
// One source for the drafters' instructions, the cleanup step and the Knowledge page.
// Ported from the live site (staghunts-site/src/index.js, DRAFT_FIELDS).

export const ROUND_TYPES = ["SAFE", "Convertible note", "Priced round", "Reg CF", "Other"] as const;

export const DEAL_FIELDS = {
  company: { max: 80, about: "The company's name." },
  website: { max: 300, about: "The company's website, only if said out loud." },
  sector: {
    max: 80,
    about: "The space they're in, in two or three words (e.g. fintech, climate, dev tools).",
  },
  one_liner: {
    max: 400,
    about: "What the company does, explained plainly in one or two sentences.",
  },
  customers: {
    max: 400,
    about:
      "Who pays the company and how much (price, plan, contract size). 'No one yet' if the founder says so.",
  },
  traction: {
    max: 400,
    about:
      "The numbers so far, as stated: paying customers, revenue, users, monthly growth, and how many customers come back or stay.",
  },
  acquisition: {
    max: 400,
    about:
      "How the company gets customers today: the channels and what a customer costs to win, as the founder describes it.",
  },
  competition: {
    max: 400,
    about:
      "Who else solves this problem, including what customers do today instead, and why the founder says they win.",
  },
  end_state: {
    max: 300,
    about: "If they win, what they would own. The specific end state the founder describes.",
  },
  flywheel: {
    max: 300,
    about:
      "The loop that makes them stronger as they grow, written as a chain like 'more X → more Y → more X'. Empty if the founder didn't describe one.",
  },
  next_goal: { max: 300, about: "The next milestone the founder is chasing right now." },
  blocker: {
    max: 300,
    about: "What the founder says stands between them and that next milestone.",
  },
  why_now: { max: 600, about: "Why the founder says the timing is right now." },
  round_type: {
    max: 40,
    about: `One of: ${ROUND_TYPES.join(", ")}. Empty if not said.`,
  },
  raise_amount: { max: 80, about: "How much they're raising, e.g. $1.5M." },
  valuation_cap: { max: 80, about: "The valuation cap, e.g. $12M post." },
  discount: { max: 80, about: "The discount, e.g. 20%." },
  min_check: { max: 80, about: "The smallest check they take." },
  deadline: { max: 40, about: "When the round closes." },
} as const satisfies Fields;

const { discount: _discount, ...DEAL_FIELDS_BUT_DISCOUNT } = DEAL_FIELDS;

// What a founder's AI interview can tell us for their application: the deal fields
// (without the discount) plus who the founder is and how they found us.
// Ported from the live site (src/index.js, APPLY_FIELDS).
export const APPLICATION_FIELDS = {
  founder_name: { max: 80, about: "The founder's full name." },
  why_you: {
    max: 600,
    about:
      "Why the founder is the one to build this: what they've lived, built or know, in their words.",
  },
  ...DEAL_FIELDS_BUT_DISCOUNT,
  heard_from: { max: 200, about: "How the founder heard about Stag Hunt." },
} as const satisfies Fields;

// What a recorded call can fill in beyond the first draft: the investor's own side
// (how they found the company, any connection to it) plus the deal fields. Never scores.
// Ported from the live site (src/index.js, FILL_FIELDS).
export const FILL_FIELDS = {
  how_found: {
    max: 1000,
    about:
      "How the investor came to know this founder or company, if it comes up in the conversation (an introduction, a shared school or job, an event). Written from the investor's side, starting with a verb or 'Through'.",
  },
  disclosure: {
    max: 600,
    about:
      "Any connection the investor mentions having to the company: friend of the founder, advisor, employee, existing investor. Empty if none is mentioned.",
  },
  ...DEAL_FIELDS,
} as const satisfies Fields;

export type Fields = Record<string, { max: number; about: string }>;
export type DealField = keyof typeof DEAL_FIELDS;
export type ApplicationField = keyof typeof APPLICATION_FIELDS;
export type FillField = keyof typeof FILL_FIELDS;

export const fieldNames = <F extends Fields>(fields: F) =>
  Object.keys(fields).filter((name): name is keyof F & string => Object.hasOwn(fields, name));

export const DEAL_FIELD_NAMES = fieldNames(DEAL_FIELDS);
export const APPLICATION_FIELD_NAMES = fieldNames(APPLICATION_FIELDS);
export const FILL_FIELD_NAMES = fieldNames(FILL_FIELDS);

const rules = (conversation: string, fields: Fields, extraRules: string[] = []) =>
  `You read the transcript of a conversation between ${conversation}. Fill in facts about the startup using only what was actually said, in plain words, staying close to the founder's own wording.
Rules:
- If something was not clearly said, return an empty string for it. Never guess or infer.
- Never give opinions, judgments or ratings of the company, team or market.
- Keep each answer to one or two short sentences.
${extraRules.map((rule) => `${rule}\n`).join("")}Fields:
${Object.entries(fields)
  .map(([name, { about }]) => `- ${name}: ${about}`)
  .join("\n")}`;

export const DRAFTING_RULES = rules("an investor and a startup founder", DEAL_FIELDS);
export const APPLICATION_RULES = rules(
  "an AI interviewer and a startup founder applying for investment",
  APPLICATION_FIELDS,
);
export const FILL_RULES = rules("an investor and a startup founder", FILL_FIELDS, [
  "- The investor is the person who recorded the call. For how_found and disclosure, use what either person said about how they know each other.",
]);
