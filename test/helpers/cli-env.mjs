// An update the user types asks the npm registry once unless an opt-out is set. The shard runner's preload
// sets the opt-out only in the test process, so a spawned CLI gets it from here.
export const cliEnv = (env) => ({ ...env, LITCLAUDE_NO_UPDATE_CHECK: "1" });
