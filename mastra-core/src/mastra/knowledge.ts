import { Knowledge, knowledgeMemoryScopes } from "@mastra/core/knowledge";

import { DEAL_FIELD_NAMES, DEAL_FIELDS } from "./deals/fields.ts";
import { storage } from "./storage.ts";

// Stag Hunt's public rules only. Knowledge is not an isolation boundary yet,
// so member, deal and call data never goes here.
export const RULES_SCOPE = "rules:staghunt";
export const ORG = "org:staghunt";

export const knowledge = new Knowledge({
  id: "stag-hunt",
  name: "Stag Hunt",
  description: "Stag Hunt's principles and how deals are written up.",
  storage,
  scopes: {
    ...knowledgeMemoryScopes(),
    "rules:$orgId": {
      description: "Stag Hunt's public rules",
      belongsTo: "org:$orgId",
      access: [{ principal: "org:$orgId", role: "viewer" }],
    },
  },
});

const PRINCIPLES = `Stag Hunt is a game, not a fund: many hunts on one network, each a group that shares deals. The root principle is agency: Stag Hunt informs choices and never makes them. These rules hold in every hunt, at every size.

- I1 A member sees others' calls on a deal only after making their own.
- I2 A call is immutable once made.
- I3 Every deal has one person who vouches for the founders and handles intros.
- I4 Stag Hunt never holds, pools or moves money. Investors invest directly.
- I5 Always free. No dues, fees, ads or sponsors, from members, founders or anyone else.
- I6 A deal is visible only to hunts it was shared with. Terms never leave them.
- I7 Only the person can share their own record or checks.
- I8 Stag Hunt suggests, never decides. Every choice can be declined, or undone where undoing breaks no lock.
- I9 No deal is ever shown publicly or advertised. Only signed-in members see deals.
- I10 A founder decides who sees their deal. It leaves its home hunt only with the founder's yes.
- I11 Every number drawn from a record is stored and shown with its sample size n.
- I12 Nobody can change a locked call or confirmed outcome without it showing, the operator included.
- I13 Every person can download their own record at any time, in a form anyone can check.
- I14 The code is public, so anyone can check that these rules run as written.
- I15 Anyone can make an account. Nobody approves, nominates or invites people onto the network; admins can only remove.
- I16 A person sees deals only once cleared: a written statement that they're accredited and will keep deals confidential, and, for accounts made after sign-up opened, 30 days since that statement. Whoever brought a deal always sees it.

Source: ARCHITECTURE.md in the public repository.`;

const DEAL_WRITEUP = `A deal is written in the founder's own words. Nothing is guessed, judged or rated. Anything not clearly said stays empty.

${DEAL_FIELD_NAMES.map((name) => `- **${name}** (up to ${DEAL_FIELDS[name].max} characters): ${DEAL_FIELDS[name].about}`).join("\n")}

Related: [[${RULES_SCOPE}#principles]]`;

// Writes the rules into Knowledge. Safe to run on every start: unchanged pages are skipped.
export async function seedKnowledge() {
  const pages = [
    {
      path: "principles",
      name: "Principles",
      description: "The invariants I1 to I16 that hold in every hunt",
      body: PRINCIPLES,
    },
    {
      path: "deal-writeup",
      name: "How a deal is written up",
      description: "The fields of a deal and the rule to use only what was said",
      body: DEAL_WRITEUP,
    },
  ];
  return Promise.all(
    pages.map((page) =>
      knowledge.upsertPage({ scope: RULES_SCOPE, author: "seed:rules", ...page }),
    ),
  );
}
