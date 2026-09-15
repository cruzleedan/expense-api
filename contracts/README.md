# OpenAPI compatibility baseline

`openapi.json` is the reviewed baseline for generated paths, components,
security requirements, and servers. `npm run verify:openapi` validates the full
document and rejects any change to those contracts, including potential breaking
changes. This conservative gate also requires review for additive changes; it
does not claim semantic compatibility analysis.

After reviewing an intentional contract change and its client impact, rebuild
and run `node scripts/verify-openapi.mjs --write-baseline`, then review and commit
the generated diff with its work item. CI never refreshes the baseline for you.
Existing semantic/documentation debt is recorded in WORK-0040; it is not silently
fixed or accepted by passing structural validation.
