// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type * as IBM from 'ibmmq';
import { createMqBroker } from './ibm-mq';
import type { ProducerConfig } from './configuracion';
import type { ReminderEvent } from '../../lib/mq/contrato';
const config = {
  MQ_QUEUE_MANAGER:'QM1',MQ_QUEUE:'AVISOS',MQ_CHANNEL:'APP.TLS',MQ_CONNECTION_NAME:'localhost(1414)',
  MQ_USERNAME:'producer',MQ_PASSWORD:'test',MQ_TLS_CIPHER_SPEC:'TLS_AES_256_GCM_SHA384',
  MQ_TLS_PEER_NAME:'CN=broker',MQ_TLS_KEY_REPOSITORY:'/certs/key'
} as ProducerConfig;
const event:ReminderEvent = {schemaVersion:1,eventId:'00000000-0000-4000-8000-000000000001',
  reminderId:'00000000-0000-4000-8000-000000000002',cardId:'00000000-0000-4000-8000-000000000003',
  workspaceId:'00000000-0000-4000-8000-000000000004',eventType:'TASK_REMINDER_DUE',scheduleVersion:1,
  occurredAt:'2099-01-01T00:00:00Z',expiresAt:'2099-01-02T00:00:00Z'};
function setup() {
  class Structure {}
  const mq={
    MQC:{MQCNO_CLIENT_BINDING:1,MQCNO_RECONNECT_DISABLED:2,MQOT_Q:1,MQOO_OUTPUT:1,MQOO_FAIL_IF_QUIESCING:2,
      MQPER_PERSISTENT:1,MQFMT_STRING:'MQSTR',MQPMO_SYNCPOINT:1,MQPMO_SYNC_RESPONSE:2,MQPMO_NEW_MSG_ID:4,MQPMO_FAIL_IF_QUIESCING:8},
    MQCNO:Structure,MQCD:Structure,MQSCO:Structure,MQCSP:Structure,MQOD:Structure,MQMD:Structure,MQPMO:Structure,
    ConnxPromise:vi.fn().mockResolvedValue('connection'),OpenPromise:vi.fn().mockResolvedValue('queue'),
    PutPromise:vi.fn().mockResolvedValue(undefined),Cmit:vi.fn(),Back:vi.fn(),
    ClosePromise:vi.fn().mockResolvedValue(undefined),DiscPromise:vi.fn().mockResolvedValue(undefined)
  };
  return {mq,broker:createMqBroker(mq as unknown as typeof IBM,config)};
}
describe('adaptador nativo IBM MQ (simulado)',()=>{
  it('configura TLS, persistencia y commit después del envío',async()=>{
    const {mq,broker}=setup();
    mq.PutPromise.mockImplementation(async()=>{expect(mq.Cmit).not.toHaveBeenCalled();});
    await broker.publish(event);
    expect(mq.ConnxPromise).toHaveBeenCalledWith('QM1',expect.objectContaining({
      ClientConn:expect.objectContaining({SSLCipherSpec:config.MQ_TLS_CIPHER_SPEC,SSLPeerName:'CN=broker'}),
      SSLConfig:expect.objectContaining({KeyRepository:'/certs/key'})
    }));
    expect(mq.PutPromise).toHaveBeenCalledWith('queue',expect.objectContaining({Persistence:1,CodedCharSetId:1208}),expect.objectContaining({Options:15}),JSON.stringify(event));
    expect(mq.Cmit).toHaveBeenCalledWith('connection');expect(mq.Back).not.toHaveBeenCalled();
  });
  it('hace rollback si falla el envío',async()=>{
    const {mq,broker}=setup();mq.PutPromise.mockRejectedValue(new Error('fallo'));
    await expect(broker.publish(event)).rejects.toThrow('no confirmó');
    expect(mq.Cmit).not.toHaveBeenCalled();expect(mq.Back).toHaveBeenCalled();expect(mq.DiscPromise).toHaveBeenCalled();
  });
  it('un commit fallido no cuenta como publicación confirmada',async()=>{
    const {mq,broker}=setup();mq.Cmit.mockImplementation(()=>{throw new Error('fallo');});
    await expect(broker.publish(event)).rejects.toThrow('no confirmó');expect(mq.Back).toHaveBeenCalled();
  });
  it('no reenvía por un error de limpieza posterior al commit',async()=>{
    const {mq,broker}=setup();mq.ClosePromise.mockRejectedValue(new Error('cierre'));
    await expect(broker.publish(event)).resolves.toBeUndefined();expect(mq.Cmit).toHaveBeenCalled();
  });
  it('no conecta para enviar un evento expirado',async()=>{
    const {mq,broker}=setup();
    await expect(broker.publish({...event,expiresAt:'2000-01-01T00:00:00Z'})).rejects.toThrow('expiró');
    expect(mq.ConnxPromise).not.toHaveBeenCalled();
  });
});
