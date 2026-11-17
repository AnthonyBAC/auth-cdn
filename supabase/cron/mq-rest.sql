-- REVIEW AND RUN ONLY ON AN AUTHORIZED ENVIRONMENT AFTER 0009 and 0010.
-- Enable pg_cron/pg_net and Vault in the Supabase dashboard first.
-- In Vault create mq_vercel_base_url (HTTPS origin, no trailing slash) and
-- mq_cron_secret (the same random 32+ character value as MQ_CRON_SECRET in Vercel).
-- Secrets are intentionally absent from this file and from cron.job.command.
-- Schedule only ONE producer/consumer implementation: stop native workers first.

select cron.schedule('authcdn-mq-rest-minute', '* * * * *', $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='mq_vercel_base_url') || '/api/mq/tick',
    headers := jsonb_build_object('Content-Type','application/json','Authorization',
      'Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='mq_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
$job$);

-- Maintenance runs in Postgres even if Vercel is temporarily unreachable.
select cron.schedule('authcdn-mq-maintenance', '* * * * *', $job$
  select public.mq_rest_maintenance();
$job$);

-- Inspect responses as an administrator; avoid SELECT * because HTTP metadata can
-- contain private operational data. pg_net delivery is asynchronous, so cron success
-- only confirms scheduling, not the HTTP response or completion of MQ processing.
select id,status_code,timed_out,error_msg,created from net._http_response order by created desc limit 20;
select public.mq_rest_health();
-- To stop future invocations (does not delete MQ or application data):
-- select cron.unschedule('authcdn-mq-rest-minute');
-- select cron.unschedule('authcdn-mq-maintenance');
