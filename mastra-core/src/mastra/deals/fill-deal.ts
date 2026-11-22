import { dealFiller } from "./deal-filler.ts";
import { draftWorkflow } from "./draft-workflow.ts";
import { FILL_FIELDS } from "./fields.ts";

export const fillDeal = draftWorkflow({
  id: "fill-deal",
  description:
    "Fills the rest of a deal from the transcript of a recorded founder call, including how the investor found it, for the member to check.",
  agent: dealFiller,
  fields: FILL_FIELDS,
});
