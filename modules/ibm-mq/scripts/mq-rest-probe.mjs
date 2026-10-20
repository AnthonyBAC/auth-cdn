// Read-only probe: never POST, DELETE, consume, publish or print message bodies.
// Node 22: node --env-file=.env.local scripts/mq-rest-probe.mjs
const env = process.env;
const nativeHost = env.MQ_CONNECTION_NAME?.match(/^([^()]+)\(\d+\)$/)?.[1];
const base = env.MQ_REST_BASE_URL || (nativeHost?.endsWith('.mq.appdomain.cloud')
  ? `https://web-${nativeHost}/ibmmq/rest/v3` : null);
if (!base || !env.MQ_QUEUE_MANAGER) {
  console.error('Configura MQ_REST_BASE_URL y MQ_QUEUE_MANAGER.'); process.exit(1);
}
const origin = new URL(base);
if (origin.protocol !== 'https:' || origin.username || origin.password || origin.search || origin.hash
  || origin.pathname.replace(/\/$/, '') !== '/ibmmq/rest/v3') {
  console.error('La URL REST debe usar HTTPS y /ibmmq/rest/v3.'); process.exit(1);
}
const checks = [
  ['consumer', env.MQ_USERNAME, env.MQ_PASSWORD, env.MQ_QUEUE || 'AUTHCDN.REMINDERS.Q'],
  ['consumer', env.MQ_USERNAME, env.MQ_PASSWORD, env.MQ_SUMMARY_REQUEST_QUEUE || 'AUTHCDN.SUMMARY.REQUEST.Q'],
  ['producer', env.MQ_PRODUCER_USERNAME, env.MQ_PRODUCER_PASSWORD, env.MQ_SUMMARY_REPLY_QUEUE || 'AUTHCDN.SUMMARY.REPLY.Q']
];
for (const [role, user, password, queue] of checks) {
  if (!user || !password) { console.log(JSON.stringify({ role, error: 'CREDENTIALS_MISSING' })); process.exitCode = 1; continue; }
  try {
    const response = await fetch(`${base.replace(/\/$/, '')}/messaging/qmgr/${encodeURIComponent(env.MQ_QUEUE_MANAGER)}/queue/${encodeURIComponent(queue)}/message`, {
      method: 'GET', redirect: 'error', signal: AbortSignal.timeout(10000),
      headers: { Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`,
        'ibm-mq-rest-csrf-token': 'read-only-probe', Accept: 'text/plain' }
    });
    await response.body?.cancel();
    console.log(JSON.stringify({ role, queue, status: response.status, readable: response.ok, writePermissions: 'NOT_TESTED' }));
    if (!response.ok) process.exitCode = 1;
  } catch { console.log(JSON.stringify({ role, queue, error: 'HTTPS_REQUEST_FAILED' })); process.exitCode = 1; }
}
