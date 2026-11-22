// What a founder call can tell members about a startup, and the longest answer kept for each.
// One source for the drafter's instructions, the cleanup step and the Knowledge page.
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
} as const satisfies Record<string, { max: number; about: string }>;

export type DealField = keyof typeof DEAL_FIELDS;

const isDealField = (name: string): name is DealField => Object.hasOwn(DEAL_FIELDS, name);

export const DEAL_FIELD_NAMES = Object.keys(DEAL_FIELDS).filter(isDealField);

export const DRAFTING_RULES = `You read the transcript of a conversation between an investor and a startup founder. Fill in facts about the startup using only what was actually said, in plain words, staying close to the founder's own wording.
Rules:
- If something was not clearly said, return an empty string for it. Never guess or infer.
- Never give opinions, judgments or ratings of the company, team or market.
- Keep each answer to one or two short sentences.
Fields:
${DEAL_FIELD_NAMES.map((name) => `- ${name}: ${DEAL_FIELDS[name].about}`).join("\n")}`;
