#!/usr/bin/env node

import { refreshUpdateCache } from "./update-notifier.mjs";

const cachePath = process.argv[2];
const generation = process.argv[3];
if (cachePath && generation) await refreshUpdateCache(cachePath, { generation }).catch(() => {});
