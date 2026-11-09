import { refreshSessionUpdateCache } from "./automatic-update.mjs";

const [cachePath, generation, registryUrl, currentVersion] = process.argv.slice(2);
if (cachePath && generation && registryUrl) await refreshSessionUpdateCache({ cachePath, generation, registryUrl, currentVersion });
