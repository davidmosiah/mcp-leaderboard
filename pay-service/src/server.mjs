import { loadConfig } from "./config.mjs";
import { createApp } from "./app.mjs";
import { log } from "./logger.mjs";

const config = loadConfig();
const app = await createApp({ env: process.env });
app.listen(config.port, "127.0.0.1", () => {
  log.info("listen", { port: config.port });
});
