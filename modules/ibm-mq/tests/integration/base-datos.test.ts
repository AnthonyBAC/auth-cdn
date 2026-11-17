// @vitest-environment node
import { reminderEventSchema } from '../../domain/contrato';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFile } from 'node:fs/promises';
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';

const db = new PGlite({ extensions: { pgcrypto } });
const owner = '00000000-0000-4000-8000-000000000001';
const editor = '00000000-0000-4000-8000-000000000002';
const viewer = '00000000-0000-4000-8000-000000000003';
const outsider = '00000000-0000-4000-8000-000000000004';
let workspace: string, board: string, list: string, card: string;
const due = '2099-01-03T00:00:00Z', notify = '2099-01-02T00:00:00Z';
const root = new URL('../../../../', import.meta.url);
async function login(user = owner, aal = 'aal1') {
  await db.exec('reset role; set role authenticated');
  await db.query("select set_config('request.jwt.claim.sub',$1,false), set_config('request.jwt.claims',$2,false)", [user, JSON.stringify({ aal })]);
}
async function admin() { await db.exec('reset role'); }
async function schedule(ids: string[] = [], version = 1, dueAt: string | null = due, notifyAt: string | null = notify) {
  return (await db.query<{ result: { schedule_version: number } }>(
    'select schedule_card_reminders($1,$2,$3,$4,$5) as result', [card, version, dueAt, notifyAt, ids]
  )).rows[0].result;
}
async function reminders() {
  await admin();
  return (await db.query<{user_id:string;status:string;kind:string;id:string; schedule_version:number}>(
    'select * from task_reminders where card_id=$1 order by user_id,kind', [card]
  )).rows;
}

beforeAll(async () => {
  // Replica mínima de interfaces Auth. No simula el servicio Auth ni valida JWT reales.
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
  for (const file of ['0001_initial.sql','0002_profile_totp.sql','0003_workspace_invite_rpc.sql','0004_mq_base.sql']) {
    await db.exec(await readFile(new URL(`supabase/migrations/${file}`, root), 'utf8'));
  }
  for (const [id, name] of [[owner,'owner'],[editor,'editor'],[viewer,'viewer'],[outsider,'outsider']]) {
    await db.query('insert into auth.users(id,email) values ($1,$2)',[id, `${name}@example.test`]);
  }
  workspace = (await db.query<{workspace_id:string}>('select workspace_id from memberships where user_id=$1',[owner])).rows[0].workspace_id;
  await db.query("insert into memberships(workspace_id,user_id,role) values ($1,$2,'editor'),($1,$3,'viewer')",[workspace,editor,viewer]);
  board = (await db.query<{id:string}>("insert into boards(workspace_id,title) values ($1,'Tablero') returning id",[workspace])).rows[0].id;
  list = (await db.query<{id:string}>("insert into lists(board_id,title) values ($1,'Lista') returning id",[board])).rows[0].id;
  const legacy = (await db.query<{id:string}>("insert into cards(board_id,list_id,title) values ($1,$2,'Histórica') returning id",[board,list])).rows[0].id;
  await db.exec(await readFile(new URL('supabase/migrations/0005_mq_programacion.sql',root),'utf8'));
  await db.exec(await readFile(new URL('supabase/migrations/0006_mq_scheduler.sql',root),'utf8'));
  await db.exec(await readFile(new URL('supabase/migrations/0007_mq_productor.sql',root),'utf8'));
  expect((await db.query<{created_by_user_id:string|null}>('select created_by_user_id from cards where id=$1',[legacy])).rows[0].created_by_user_id).toBeNull();
}, 30_000);

beforeEach(async () => {
  await admin();
  await db.exec('delete from cards; delete from auth.mfa_factors');
  await db.query("update memberships set status='active' where workspace_id=$1",[workspace]);
  await db.query('update workspaces set archived_at=null where id=$1',[workspace]);
  await db.query('update boards set archived_at=null where id=$1',[board]);
  await db.query('update lists set archived_at=null where id=$1',[list]);
  await login();
  card = (await db.query<{id:string}>("insert into cards(board_id,list_id,title) values ($1,$2,'Informe') returning id",[board,list])).rows[0].id;
});
afterAll(async () => { await db.close(); });

describe('migraciones MQ y programación atómica', () => {
  it('revierte 0005 y 0004 en ensayo conservando las tarjetas', async () => {
    await admin();
    await db.exec('begin');
    try {
      for (const name of ['0007_mq_productor.sql','0006_mq_scheduler.sql','0005_mq_programacion.sql','0004_mq_base.sql']) {
        const sql = await readFile(new URL(`supabase/rollback/${name}`, root),'utf8');
        await db.exec(sql.replace(/^(begin|commit);$/gm, ''));
      }
      expect((await db.query('select id from cards')).rows).toHaveLength(1);
      expect((await db.query<{name:string|null}>("select to_regclass('public.task_reminders') as name")).rows[0].name).toBeNull();
      expect((await db.query("select column_name from information_schema.columns where table_name='cards' and column_name='created_by_user_id'")).rows).toHaveLength(0);
    } finally {
      await db.exec('rollback');
    }
  });

  it('guarda creador y entrega al creador aunque otro editor programe', async () => {
    await login(editor);
    await schedule();
    const rows = await reminders();
    expect(rows).toHaveLength(2);
    expect(rows.every(r=>r.user_id===owner)).toBe(true);
  });
  it('crea dos tipos de aviso por responsable, sin añadir al creador', async () => {
    await schedule([editor,viewer]);
    expect((await reminders()).map(r=>r.user_id)).toEqual([editor,editor,viewer,viewer]);
  });
  it('repetir el guardado no duplica ni cambia la versión', async () => {
    expect((await schedule([viewer,editor])).schedule_version).toBe(2);
    expect((await schedule([editor,viewer],2)).schedule_version).toBe(2);
    expect(await reminders()).toHaveLength(4);
  });
  it('rechaza externos, duplicados y fechas incorrectas sin modificar nada', async () => {
    await expect(schedule([outsider])).rejects.toMatchObject({code:'22023'});
    await expect(schedule([editor,editor])).rejects.toMatchObject({code:'22023'});
    await expect(schedule([],1,due,null)).rejects.toMatchObject({code:'22023'});
    await expect(schedule([],1,due,due)).rejects.toMatchObject({code:'22023'});
    await expect(schedule([],1,due,'2000-01-01T00:00:00Z')).rejects.toMatchObject({code:'22023'});
    expect((await db.query<{schedule_version:number}>('select schedule_version from cards where id=$1',[card])).rows[0].schedule_version).toBe(1);
    expect(await reminders()).toHaveLength(0);
  });
  it('reprograma, cancela eventos pendientes y conserva publicaciones confirmadas', async () => {
    await schedule([editor,viewer]);
    const old = await reminders();
    await db.query("insert into notification_outbox(reminder_id,payload) values ($1,'{}')",[old[0].id]);
    await db.query("insert into notification_outbox(reminder_id,payload,status,lock_token,locked_until) values ($1,'{}','PROCESSING',gen_random_uuid(),now()+interval '1 minute')",[old[1].id]);
    await db.query("insert into notification_outbox(reminder_id,payload,status,published_at) values ($1,'{}','PUBLISHED',now())",[old[2].id]);
    await login();
    await schedule([owner],2);
    const rows = await reminders();
    expect(rows.filter(r=>r.status==='CANCELLED')).toHaveLength(4);
    expect(rows.filter(r=>r.status==='SCHEDULED').map(r=>r.user_id)).toEqual([owner,owner]);
    const events = (await db.query<{status:string;lock_token:string|null}>('select * from notification_outbox')).rows;
    expect(events.filter(e=>e.status==='CANCELLED' && e.lock_token===null)).toHaveLength(2);
    expect(events.filter(e=>e.status==='PUBLISHED')).toHaveLength(1);
  });
  it('no vuelve a enviar un aviso procesado a un responsable que permanece', async () => {
    await schedule([editor]);
    await admin();
    await db.query("update task_reminders set status='PROCESSED',processed_at=now() where card_id=$1 and kind='TASK_REMINDER_DUE'",[card]);
    await login();
    await schedule([editor,viewer],2);
    const rows = (await reminders()).filter(r=>r.schedule_version===3);
    expect(rows.find(r=>r.user_id===editor && r.kind==='TASK_REMINDER_DUE')?.status).toBe('PROCESSED');
    expect(rows.find(r=>r.user_id===viewer && r.kind==='TASK_REMINDER_DUE')?.status).toBe('SCHEDULED');
  });
  it('quitar todos los responsables vuelve al creador y quitar las fechas cancela avisos', async () => {
    await schedule([editor]);
    await schedule([],2);
    expect((await reminders()).filter(r=>r.status==='SCHEDULED').every(r=>r.user_id===owner)).toBe(true);
    await login();
    await schedule([],3,null,null);
    expect((await reminders()).every(r=>r.status==='CANCELLED')).toBe(true);
  });
  it('completar cancela para todos y bloquea futuras programaciones', async () => {
    await schedule([editor,viewer]);
    await db.query('select complete_card($1,2)',[card]);
    await expect(schedule([editor],3)).rejects.toMatchObject({code:'22023'});
    expect((await reminders()).every(r=>r.status==='CANCELLED')).toBe(true);
    await login();
    await db.query('select complete_card($1,3)',[card]);
    expect((await db.query<{schedule_version:number}>('select schedule_version from cards where id=$1',[card])).rows[0].schedule_version).toBe(3);
  });
  it('archivar con la operación existente cancela los recordatorios', async () => {
    await schedule();
    await db.query('update cards set archived_at=now() where id=$1',[card]);
    expect((await reminders()).every(r=>r.status==='CANCELLED')).toBe(true);
  });
  it('impide escrituras directas de fechas, creador y responsables', async () => {
    await expect(db.query('update cards set due_at=now() where id=$1',[card])).rejects.toMatchObject({code:'42501'});
    await expect(db.query('update cards set created_by_user_id=$1 where id=$2',[editor,card])).rejects.toMatchObject({code:'42501'});
    await expect(db.query('insert into card_assignees(card_id,user_id) values ($1,$2)',[card,editor])).rejects.toMatchObject({code:'42501'});
    await expect(db.query("insert into cards(board_id,list_id,title,created_by_user_id) values ($1,$2,'Falso',$3)",[board,list,editor])).rejects.toMatchObject({code:'42501'});
    await db.query("update cards set title='Actualizado',description='Texto' where id=$1",[card]);
  });
  it('rechaza viewer, externos, anónimo y versión desactualizada', async () => {
    for (const user of [viewer,outsider]) {
      await login(user);
      await expect(schedule()).rejects.toMatchObject({code:'42501'});
    }
    await db.exec('reset role; set role anon');
    await expect(schedule()).rejects.toMatchObject({code:'42501'});
    await login();
    await schedule();
    await expect(schedule([editor],1)).rejects.toMatchObject({code:'40001'});
  });
  it('comprueba MFA incluso al invocar directamente la función SQL', async () => {
    await admin();
    await db.query("insert into auth.mfa_factors(user_id,factor_type,status) values ($1,'totp','verified')",[owner]);
    await login();
    await expect(schedule()).rejects.toMatchObject({code:'42501'});
    await login(owner,'aal2');
    await schedule();
    expect(await reminders()).toHaveLength(2);
  });
  it.each(['workspaces','boards','lists'])('rechaza programación dentro de %s archivado', async (table) => {
    await admin();
    const id = table==='workspaces'?workspace:table==='boards'?board:list;
    await db.query(`update ${table} set archived_at=now() where id=$1`,[id]);
    await login();
    await expect(schedule()).rejects.toMatchObject({code:'42501'});
  });
  it('exige responsable cuando no hay creador conocido o ya no es miembro', async () => {
    await admin();
    await db.query('update cards set created_by_user_id=null where id=$1',[card]);
    await login();
    await expect(schedule()).rejects.toMatchObject({code:'22023'});
    await schedule([editor]);
    await admin();
    await db.query('update cards set created_by_user_id=$1 where id=$2',[outsider,card]);
    await login();
    await expect(schedule([],2)).rejects.toMatchObject({code:'22023'});
  });
  it('RLS aísla avisos y solo permite modificar su fecha de lectura', async () => {
    await schedule([editor]);
    const rows=await reminders();
    const event=(await db.query<{event_id:string}>("insert into notification_outbox(reminder_id,payload) values ($1,'{}') returning event_id",[rows[0].id])).rows[0].event_id;
    await db.query("insert into notifications(event_id,reminder_id,card_id,user_id,message) values ($1,$2,$3,$4,'Aviso')",[event,rows[0].id,card,editor]);
    await expect(db.query("insert into notifications(event_id,card_id,user_id,message) values ($1,$2,$3,'Duplicado')",[event,card,editor])).rejects.toMatchObject({code:'23505'});
    await login(editor);
    expect((await db.query('select * from notifications')).rows).toHaveLength(1);
    await db.exec('update notifications set read_at=now()');
    await expect(db.exec("update notifications set message='Falso'")).rejects.toMatchObject({code:'42501'});
    await expect(db.exec('select * from notification_outbox')).rejects.toMatchObject({code:'42501'});
    await login(viewer);
    expect((await db.query('select * from notifications')).rows).toHaveLength(0);
    expect((await db.query('select * from task_reminders')).rows).toHaveLength(0);
    await admin();
    await db.query("update memberships set status='removed' where workspace_id=$1 and user_id=$2",[workspace,editor]);
    await login(editor);
    expect((await db.query('select * from notifications')).rows).toHaveLength(0);
  });
});


describe('detector de avisos pendientes', () => {
  async function enqueue() {
    await db.exec('reset role; set role service_role');
    return (await db.query<{result:{queued:number;cancelled:number;expired:number}}>(
      'select enqueue_due_reminders(100) as result')).rows[0].result;
  }
  async function ready() {
    await schedule();
    await admin();
    await db.query("update task_reminders set notify_at=now()-interval '1 minute' where card_id=$1 and kind='TASK_REMINDER_DUE'",[card]);
  }
  it('prepara un evento válido sin duplicarlo ni publicar antes de la fecha', async () => {
    await schedule();
    expect((await enqueue()).queued).toBe(0);
    await admin();
    await db.query("update task_reminders set notify_at=now()-interval '1 minute' where card_id=$1 and kind='TASK_REMINDER_DUE'",[card]);
    expect((await enqueue()).queued).toBe(1);
    expect((await enqueue()).queued).toBe(0);
    await admin();
    const rows=(await db.query<{payload:unknown;status:string}>('select payload,status from notification_outbox')).rows;
    expect(rows).toHaveLength(1);
    expect(reminderEventSchema.safeParse(rows[0].payload).success).toBe(true);
    expect(rows[0].status).toBe('PENDING');
  });
  it('no prepara avisos de tarjetas completadas', async () => {
    await ready(); await login();
    await db.query('select complete_card($1,2)',[card]);
    expect((await enqueue()).queued).toBe(0);
  });
  it('cancela si se archiva el tablero', async () => {
    await ready();
    await db.query('update boards set archived_at=now() where id=$1',[board]);
    expect(await enqueue()).toEqual({queued:0,cancelled:1,expired:0});
  });
  it('cancela si el destinatario deja de ser miembro', async () => {
    await ready();
    await db.query('delete from memberships where workspace_id=$1 and user_id=$2',[workspace,owner]);
    expect((await enqueue()).cancelled).toBe(1);
    await admin();
    await db.query("insert into memberships(workspace_id,user_id,role) values ($1,$2,'owner')",[workspace,owner]);
  });
  it('marca expirados sin crear eventos', async () => {
    await ready();
    await db.query("update task_reminders set expires_at=now()-interval '10 seconds' where card_id=$1 and kind='TASK_REMINDER_DUE'",[card]);
    expect(await enqueue()).toEqual({queued:0,cancelled:0,expired:1});
  });
  it('respeta el tamaño del lote con varios responsables', async () => {
    await schedule([editor,viewer]); await admin();
    await db.query("update task_reminders set notify_at=now()-interval '1 minute' where card_id=$1 and kind='TASK_REMINDER_DUE'",[card]);
    await db.exec('set role service_role');
    for (let i=0;i<2;i++) {
      const result=(await db.query<{result:{queued:number}}>('select enqueue_due_reminders(1) as result')).rows[0].result;
      expect(result.queued).toBe(1);
    }
    expect((await enqueue()).queued).toBe(0);
    await admin();
    expect((await db.query('select * from notification_outbox')).rows).toHaveLength(2);
  });
  it('revierte el cambio de estado si falla la escritura del evento', async () => {
    await ready();
    await db.exec("alter table notification_outbox add constraint simulated_failure check (false) not valid");
    try {
      await expect(enqueue()).rejects.toMatchObject({code:'23514'});
      await admin();
      expect((await db.query('select * from notification_outbox')).rows).toHaveLength(0);
      const rows=(await db.query<{status:string}>("select status from task_reminders where card_id=$1 and kind='TASK_REMINDER_DUE'",[card])).rows;
      expect(rows[0].status).toBe('SCHEDULED');
    } finally {
      await admin();
      await db.exec('alter table notification_outbox drop constraint simulated_failure');
    }
  });
  it('rechaza llamadas del navegador y lotes inválidos', async () => {
    await expect(db.query('select enqueue_due_reminders(100)')).rejects.toMatchObject({code:'42501'});
    await admin();
    await expect(db.query('select enqueue_due_reminders(0)')).rejects.toMatchObject({code:'22023'});
  });
});

describe('reservas y confirmaciones del productor', () => {
  type Lease = {eventId:string;lockToken:string;payload:unknown};
  async function queued() {
    await schedule(); await admin();
    await db.query("update task_reminders set notify_at=now()-interval '1 minute' where card_id=$1 and kind='TASK_REMINDER_DUE'",[card]);
    await db.exec('set role service_role');
    await db.query('select enqueue_due_reminders(100)');
  }
  async function claim() {
    await db.exec('reset role; set role service_role');
    return (await db.query<{result:Lease|null}>('select claim_notification_event() as result')).rows[0].result;
  }
  async function finish(lease:Lease,result='PUBLISHED') {
    return (await db.query<{result:boolean}>('select finish_notification_event($1,$2,$3) as result',
      [lease.eventId,lease.lockToken,result])).rows[0].result;
  }
  it('reserva una vez y solo confirma con el token correcto', async () => {
    await queued(); const lease=(await claim())!;
    expect(lease).not.toBeNull(); expect(await claim()).toBeNull();
    expect(await finish({...lease,lockToken:outsider})).toBe(false);
    expect(await finish(lease)).toBe(true); expect(await finish(lease)).toBe(false);
    await admin();
    const row=(await db.query<{status:string;attempts:number;published_at:unknown}>('select * from notification_outbox')).rows[0];
    expect(row.status).toBe('PUBLISHED');expect(row.attempts).toBe(1);expect(row.published_at).not.toBeNull();
  });
  it('recupera una reserva vencida con el mismo evento y otro token', async () => {
    await queued(); const old=(await claim())!; await admin();
    await db.exec("update notification_outbox set locked_until=now()-interval '1 second'");
    const current=(await claim())!;
    expect(current.eventId).toBe(old.eventId);expect(current.lockToken).not.toBe(old.lockToken);
    expect(await finish(old)).toBe(false);expect(await finish(current)).toBe(true);
  });
  it('aplaza reintentos y se detiene tras cinco intentos', async () => {
    await queued();
    for(let i=1;i<=5;i++) {
      const lease=(await claim())!;expect(lease).not.toBeNull();
      expect(await finish(lease,'RETRY')).toBe(true); expect(await claim()).toBeNull();
      await admin();await db.exec("update notification_outbox set next_attempt_at=now()-interval '1 second'");
    }
    expect(await claim()).toBeNull();await admin();
    expect((await db.query<{status:string}>('select status from notification_outbox')).rows[0].status).toBe('FAILED');
  });
  it('no permite confirmar después de completar la tarjeta', async () => {
    await queued();const lease=(await claim())!;
    await login();await db.query('select complete_card($1,2)',[card]);
    await db.exec('reset role;set role service_role');
    expect(await finish(lease)).toBe(false);expect(await claim()).toBeNull();
  });
  it('revalida el archivado y la expiración antes de reservar', async () => {
    await queued();await admin();await db.query('update boards set archived_at=now() where id=$1',[board]);
    expect(await claim()).toBeNull();await admin();
    expect((await db.query<{status:string}>('select status from notification_outbox')).rows[0].status).toBe('CANCELLED');
  });
  it('expira eventos que caducaron en outbox', async () => {
    await queued();await admin();
    await db.exec("update task_reminders set expires_at=now()-interval '1 second' where status='QUEUED'");
    expect(await claim()).toBeNull();await admin();
    expect((await db.query<{status:string}>('select status from notification_outbox')).rows[0].status).toBe('EXPIRED');
  });
  it('rechaza operaciones de usuarios y resultados inválidos', async () => {
    await expect(db.query('select claim_notification_event()')).rejects.toMatchObject({code:'42501'});
    await expect(db.query("select finish_notification_event($1,$2,'PUBLISHED')",[owner,owner])).rejects.toMatchObject({code:'42501'});
    await admin();
    await expect(db.query("select finish_notification_event($1,$2,'ERROR')",[owner,owner])).rejects.toMatchObject({code:'22023'});
  });
});
