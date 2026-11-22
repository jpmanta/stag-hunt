import { applicationDrafter } from "./application-drafter.ts";
import { draftWorkflow } from "./draft-workflow.ts";
import { APPLICATION_FIELDS } from "./fields.ts";

export const draftApplication = draftWorkflow({
  id: "draft-application",
  description:
    "Turns the transcript of a founder's AI interview into a draft application for the founder to check.",
  agent: applicationDrafter,
  fields: APPLICATION_FIELDS,
});
