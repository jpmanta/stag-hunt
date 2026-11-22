import { z } from "zod";

// Fails at startup, never halfway through a request, when a setting is missing.
const schema = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  MASTRA_SERVER_TOKEN: z.string().min(32),
});

export const env = schema.parse(process.env);
