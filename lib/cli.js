import { parseArgs } from 'node:util';

// Shared by the three CLIs: parse flags, print usage on --help or bad input.
export function parseCli({ usage, options, allowPositionals = true }) {
  let parsed;
  try {
    parsed = parseArgs({
      options: { help: { type: 'boolean', short: 'h' }, ...options },
      allowPositionals,
    });
  } catch (err) {
    fail(err.message, usage);
  }
  if (parsed.values.help) {
    console.log(usage);
    process.exit(0);
  }
  return parsed;
}

export function fail(message, usage) {
  console.error(`error: ${message}`);
  if (usage) console.error(`\n${usage}`);
  process.exit(1);
}

export const utc = (unixSeconds) =>
  new Date(unixSeconds * 1000).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
