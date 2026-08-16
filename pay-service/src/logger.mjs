function write(level, event, fields = {}) {
  const safe = {};
  for (const [key, value] of Object.entries(fields)) {
    if (/email|ip|authorization|token|signature|payload|contact/i.test(key)) continue;
    safe[key] = value;
  }
  console.log(JSON.stringify({ level, event, ...safe }));
}

export const log = {
  info: (event, fields) => write("info", event, fields),
  warn: (event, fields) => write("warn", event, fields)
};
