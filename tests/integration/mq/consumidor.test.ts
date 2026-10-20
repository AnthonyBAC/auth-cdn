// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const db = new PGlite({ extensions: { pgcrypto } });
const owner = '00000000-0000-4000-8000-000000000001';
const otherCard = '00000000-0000-4000-8000-0000000000aa';
const foreignEvent = '00000000-0000-4000-8000-0000000000bb';
let workspace: string, board: string, list: string, card: string;
const due = '2099-01-03T00:00:00Z', notify = '2099-01-02T00:00:00Z';
const root = new URL('../../../', import.meta.url);

async function login(user = owner, aal = 'aal1') {
  await db.exec('reset role; set role authenticated');
  await db.query("select set_config('request.jwt.claim.sub',$1,false), set_config('request.jwt.claims',$2,false)", [user, JSON.stringify({ aal })]);
}
async function admin() { await db.exec('reset role'); }
async function schedule(version = 1, dueAt: string | null = due, notifyAt: string | null = notify) {
  return (await db.query<{ result: { schedule_version: number } }>(
    'select schedule_card_reminders($1,$2,$3,$4,$5) as result', [card, version, dueAt, notifyAt, []]
  )).rows[0].result;
}
async function preparar(kind = 'TASK_REMINDER_DUE') {
  await login();
  await schedule();
  await admin();
  await db.query("update task_reminders set notify_at=now()-interval '1 minute' where card_id=$1 and kind=$2", [card, kind]);
  await db.exec('set role service_role');
  await db.query('select enqueue_due_reminders(100)');
  await admin();
  const row = (await db.query<{ event_id: string; reminder_id: string; payload: Record<string, unknown> }>(
    "select event_id, reminder_id, payload from notification_outbox where reminder_id in (select id from task_reminders where card_id=$1 and kind=$2)", [card, kind]
  )).rows[0];
  return { evento: row.payload, reminderId: row.reminder_id, eventId: row.event_id };
}
async function procesar(evento: unknown) {
  await db.exec('reset role; set role service_role');
  return (await db.query<{ result: { outcome: string; reason?: string } }>(
    'select process_reminder_event($1::jsonb) as result', [JSON.stringify(evento)]
  )).rows[0].result;
}
async function estadoRecordatorio(id: string) {
  await admin();
  return (await db.query<{ status: string; processed_at: string | null }>(
    'select status, processed_at from task_reminders where id=$1', [id]
  )).rows[0];
}
async function notificaciones() {
  await admin();
  return (await db.query<{ event_id: string; user_id: string; message: string }>('select event_id, user_id, message from notifications')).rows;
}

beforeAll(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
    create table auth.mfa_factors(id uuid primary key default gen_random_uuid(),user_id uuid,factor_type text,status text);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as
      $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    grant usage on schema public,auth to anon,authenticated,service_role;
    grant execute on all functions in schema auth to anon,authenticated,service_role;
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
  `);
  for (const file of ['0001_initial.sql', '0002_profile_totp.sql', '0003_workspace_invite_rpc.sql', '0004_mq_base.sql', '0005_mq_programacion.sql', '0006_mq_scheduler.sql', '0007_mq_productor.sql', '0008_mq_consumidor.sql', '0009_mq_rest_inbox.sql', '0010_mq_rest_maintenance.sql']) {
    await db.exec(await readFile(new URL(`supabase/migrations/${file}`, root), 'utf8'));
  }
  await db.query('insert into auth.users(id,email) values ($1,$2)', [owner, 'owner@example.test']);
  workspace = (await db.query<{ workspace_id: string }>('select workspace_id from memberships where user_id=$1', [owner])).rows[0].workspace_id;
  board = (await db.query<{ id: string }>("insert into boards(workspace_id,title) values ($1,'Tablero') returning id", [workspace])).rows[0].id;
  list = (await db.query<{ id: string }>("insert into lists(board_id,title) values ($1,'Lista') returning id", [board])).rows[0].id;
}, 30_000);

beforeEach(async () => {
  await admin();
  await db.exec('delete from cards');
  await db.query("update memberships set status='active' where workspace_id=$1", [workspace]);
  await db.query('update workspaces set archived_at=null where id=$1', [workspace]);
  await db.query('update boards set archived_at=null where id=$1', [board]);
  await db.query('update lists set archived_at=null where id=$1', [list]);
  await login();
  card = (await db.query<{ id: string }>("insert into cards(board_id,list_id,title) values ($1,$2,'Informe') returning id", [board, list])).rows[0].id;
});
afterAll(async () => { await db.close(); });

describe('procesamiento de recordatorios del consumidor', () => {
  it('procesa un recordatorio vigente y registra una sola notificación', async () => {
    const { evento, reminderId } = await preparar();
    expect(await procesar(evento)).toEqual({ outcome: 'PROCESSED' });

    const estado = await estadoRecordatorio(reminderId);
    expect(estado.status).toBe('PROCESSED');
    expect(estado.processed_at).not.toBeNull();
    const avisos = await notificaciones();
    expect(avisos).toHaveLength(1);
    expect(avisos[0].user_id).toBe(owner);
    expect(avisos[0].message).toContain('Informe');
  });

  it('es idempotente ante entregas duplicadas del mismo evento', async () => {
    const { evento } = await preparar();
    expect(await procesar(evento)).toEqual({ outcome: 'PROCESSED' });
    expect((await procesar(evento)).outcome).toBe('ALREADY_PROCESSED');
    expect(await notificaciones()).toHaveLength(1);
  });

  it('no duplica si una entrega concurrente ya insertó la notificación', async () => {
    const { evento, reminderId, eventId } = await preparar();
    // Simula que otro consumidor ganó la carrera: notificación ya presente.
    await admin();
    await db.query("insert into notifications(event_id,reminder_id,card_id,user_id,message) values ($1,$2,$3,$4,'previo')", [eventId, reminderId, card, owner]);
    expect((await procesar(evento)).outcome).toBe('PROCESSED');
    expect(await notificaciones()).toHaveLength(1);
  });

  it('cancela si la tarjeta fue completada', async () => {
    const { evento, reminderId } = await preparar();
    await login();
    await db.query('select complete_card($1,2)', [card]);
    expect((await procesar(evento)).outcome).toBe('CANCELLED');
    expect((await estadoRecordatorio(reminderId)).status).toBe('CANCELLED');
  });

  it('cancela si el tablero fue archivado', async () => {
    const { evento, reminderId } = await preparar();
    await admin();
    await db.query('update boards set archived_at=now() where id=$1', [board]);
    expect((await procesar(evento)).outcome).toBe('CANCELLED');
    expect((await estadoRecordatorio(reminderId)).status).toBe('CANCELLED');
  });

  it('rechaza un evento con otra versión de programación', async () => {
    const { evento } = await preparar();
    expect((await procesar({ ...evento, scheduleVersion: 999 })).outcome).toBe('PERMANENT_ERROR');
  });

  it('marca expirado un recordatorio cuya vigencia terminó', async () => {
    const { evento, reminderId } = await preparar();
    await admin();
    await db.query("update task_reminders set expires_at=now()-interval '1 second' where id=$1", [reminderId]);
    expect((await procesar(evento)).outcome).toBe('EXPIRED');
    expect((await estadoRecordatorio(reminderId)).status).toBe('EXPIRED');
  });

  it('cancela si el destinatario deja de ser miembro activo', async () => {
    const { evento, reminderId } = await preparar();
    await admin();
    await db.query("update memberships set status='removed' where workspace_id=$1 and user_id=$2", [workspace, owner]);
    expect((await procesar(evento)).outcome).toBe('CANCELLED');
    expect((await estadoRecordatorio(reminderId)).status).toBe('CANCELLED');
  });

  it('rechaza un evento que apunta a otra tarjeta', async () => {
    const { evento } = await preparar();
    expect((await procesar({ ...evento, cardId: otherCard })).outcome).toBe('PERMANENT_ERROR');
  });

  it('rechaza un eventId que no corresponde al recordatorio sin efectos secundarios', async () => {
    const { evento, reminderId } = await preparar();
    const ajeno = { ...evento, eventId: foreignEvent };

    expect(await procesar(ajeno)).toEqual({ outcome: 'PERMANENT_ERROR', reason: 'EVENT_MISMATCH' });
    expect((await estadoRecordatorio(reminderId)).status).toBe('QUEUED');
    expect(await notificaciones()).toHaveLength(0);
  });

  it('procesa el evento correcto tras rechazar un eventId ajeno', async () => {
    const { evento, reminderId } = await preparar();

    expect((await procesar({ ...evento, eventId: foreignEvent })).outcome).toBe('PERMANENT_ERROR');
    expect(await procesar(evento)).toEqual({ outcome: 'PROCESSED' });

    expect(await notificaciones()).toHaveLength(1);
    expect((await estadoRecordatorio(reminderId)).status).toBe('PROCESSED');
  });

  it('repetir un eventId ajeno no genera efectos secundarios', async () => {
    const { evento, reminderId } = await preparar();
    const ajeno = { ...evento, eventId: foreignEvent };

    expect((await procesar(ajeno)).reason).toBe('EVENT_MISMATCH');
    expect((await procesar(ajeno)).reason).toBe('EVENT_MISMATCH');
    expect(await notificaciones()).toHaveLength(0);
    expect((await estadoRecordatorio(reminderId)).status).toBe('QUEUED');
  });

  it('procesa un evento correcto aunque el outbox ya no exista', async () => {
    const { evento, reminderId } = await preparar();
    await admin();
    await db.query('delete from notification_outbox where reminder_id=$1', [reminderId]);

    expect(await procesar(evento)).toEqual({ outcome: 'PROCESSED' });
    expect(await notificaciones()).toHaveLength(1);
    expect((await estadoRecordatorio(reminderId)).status).toBe('PROCESSED');
  });

  it('devuelve ALREADY_PROCESSED aunque el outbox haya sido eliminado', async () => {
    const { evento, reminderId } = await preparar();
    expect((await procesar(evento)).outcome).toBe('PROCESSED');

    await admin();
    await db.query('delete from notification_outbox where reminder_id=$1', [reminderId]);
    expect((await procesar(evento)).outcome).toBe('ALREADY_PROCESSED');
    expect(await notificaciones()).toHaveLength(1);
  });

  it('no pierde la notificación ante un eventId cruzado entre recordatorios del mismo usuario', async () => {
    const due = await preparar('TASK_REMINDER_DUE');

    // Segundo recordatorio del mismo usuario, en cola y con su propio evento.
    await admin();
    const overdue = (await db.query<{ id: string; card_id: string; schedule_version: number; expires_at: string }>(
      "select id, card_id, schedule_version, expires_at from task_reminders where card_id=$1 and kind='TASK_OVERDUE'", [card]
    )).rows[0];
    const overdueEvent = '00000000-0000-4000-8000-0000000000cc';
    const overduePayload = {
      schemaVersion: 1, eventId: overdueEvent, eventType: 'TASK_OVERDUE',
      reminderId: overdue.id, cardId: overdue.card_id, workspaceId: workspace,
      scheduleVersion: overdue.schedule_version, occurredAt: due.evento.occurredAt, expiresAt: overdue.expires_at,
    };
    await db.query("update task_reminders set status='QUEUED' where id=$1", [overdue.id]);
    await db.query('insert into notification_outbox(event_id,reminder_id,payload) values ($1,$2,$3::jsonb)',
      [overdueEvent, overdue.id, JSON.stringify(overduePayload)]);

    // Intento cruzado: al recordatorio vencido le llega el eventId del preventivo.
    expect((await procesar({ ...overduePayload, eventId: due.eventId })).reason).toBe('EVENT_MISMATCH');
    expect((await estadoRecordatorio(overdue.id)).status).toBe('QUEUED');
    expect(await notificaciones()).toHaveLength(0);

    // El evento correcto del vencido sí notifica.
    expect((await procesar(overduePayload)).outcome).toBe('PROCESSED');
    expect(await notificaciones()).toHaveLength(1);
  });

  it('solo permite invocarla desde service_role', async () => {
    const { evento } = await preparar();
    await login();
    await expect(db.query('select process_reminder_event($1::jsonb)', [JSON.stringify(evento)]))
      .rejects.toMatchObject({ code: '42501' });
  });

  it('reconcilia la expiración en Supabase conservando la confirmación de publicación', async () => {
    const { reminderId, eventId } = await preparar();
    await admin();
    await db.query("update task_reminders set notify_at=now()-interval '2 hours',expires_at=now()-interval '1 hour' where id=$1", [reminderId]);
    await db.query("update notification_outbox set status='PUBLISHED',published_at=now() where event_id=$1", [eventId]);
    await db.exec('set role service_role');
    await db.query('select mq_rest_maintenance()');
    expect((await estadoRecordatorio(reminderId)).status).toBe('EXPIRED');
    expect((await db.query<{status:string}>('select status from notification_outbox where event_id=$1', [eventId])).rows[0].status).toBe('PUBLISHED');
  });

  it('crea una alerta de fallo visible al destinatario sin duplicarla ni abrir acceso ajeno', async () => {
    const { eventId } = await preparar();
    await admin();
    await db.query("update notification_outbox set status='FAILED',last_error='MAX_ATTEMPTS' where event_id=$1", [eventId]);
    await db.exec('set role service_role');
    await db.query('select mq_rest_maintenance()'); await db.query('select mq_rest_maintenance()');
    await login();
    const alerts = (await db.query<{user_id:string;message:string}>('select user_id,message from notifications')).rows;
    expect(alerts).toHaveLength(1); expect(alerts[0].user_id).toBe(owner);
    await login(otherCard); // unrelated identity; no workspace membership
    expect((await db.query('select id from notifications')).rows).toHaveLength(0);
  });

  it('retiene pendientes y cuarentenas y limpia solo los registros técnicos terminados de más de 30 días', async () => {
    await admin();
    const messageId = `ID:${'B'.repeat(48)}`;
    const key = (await db.query<{id:string}>("select mq_rest_capture('QM','Q',$1,'payload',null,null) as id", [messageId])).rows[0].id;
    await db.query("update mq_rest_inbox set created_at=now()-interval '40 days' where id=$1", [key]);
    await db.query('select mq_rest_maintenance()');
    expect((await db.query('select id from mq_rest_inbox')).rows).toHaveLength(1);
    await db.query("update mq_rest_inbox set state='DONE',completed_at=now()-interval '40 days',output=$2::jsonb where id=$1", [key, JSON.stringify({ queue:'CUSTOM.ERRORS', body:'error', purpose:'QUARANTINE' })]);
    await db.query('select mq_rest_maintenance()');
    expect((await db.query('select id from mq_rest_inbox')).rows).toHaveLength(1);
    await db.query('update mq_rest_inbox set output=null where id=$1', [key]);
    await db.query('select mq_rest_maintenance()');
    expect((await db.query('select id from mq_rest_inbox')).rows).toHaveLength(0);
  });
});
