const { spawnSync } = require("child_process");

const nextBin = require.resolve("next/dist/bin/next");
const result = spawnSync(process.execPath, [nextBin, "build"], {
  stdio: "inherit",
  env: {
    ...process.env,
    NEXT_OUTPUT_MODE: "export",
  },
});

process.exit(result.status ?? 1);
