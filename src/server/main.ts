import { buildServer } from "./app.js";

const port = Number(process.env.PORT ?? 3000);
const app = buildServer({ logger: { level: "info" } });

try {
  await app.listen({ port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
