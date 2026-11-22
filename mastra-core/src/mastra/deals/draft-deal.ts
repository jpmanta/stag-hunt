import { draftWorkflow } from "./draft-workflow.ts";
import { dealDrafter } from "./drafter.ts";
import { DEAL_FIELDS } from "./fields.ts";

export const draftDeal = draftWorkflow({
  id: "draft-deal",
  description: "Turns the transcript of a founder call into a draft deal for the member to check.",
  agent: dealDrafter,
  fields: DEAL_FIELDS,
});
