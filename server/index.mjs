import { createApp } from "./app.mjs";
const { app, close } = createApp({
  database: process.env.SPOOLSIDE_DB || "/data/spoolside.sqlite",
  username: process.env.SPOOLSIDE_USERNAME,
  passwordHash: process.env.SPOOLSIDE_PASSWORD_HASH,
  origin: process.env.SPOOLSIDE_ORIGIN || "https://spoolside.shelbyklein.com",
  secure: true,
  proxyAddress: process.env.SPOOLSIDE_PROXY_ADDRESS,
});
const server = app.listen(Number(process.env.PORT || 3000), "0.0.0.0", () =>
  console.log("Spoolside server listening"),
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () =>
    server.close(() => {
      close();
      process.exit(0);
    }),
  );
