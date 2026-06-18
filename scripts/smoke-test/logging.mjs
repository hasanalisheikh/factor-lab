export function log(tag, msg) {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[${ts}] [${tag}] ${msg}`);
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
