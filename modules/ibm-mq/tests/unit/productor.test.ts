// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { publishNext, type PublicationStore } from "../../application/productor";
import { expiryTenths } from "../../legacy/mq-productor/configuracion";
import { readProducerConfig } from "../../legacy/mq-productor/configuracion";
const event = {schemaVersion:1,eventId:'00000000-0000-4000-8000-000000000001',eventType:'TASK_REMINDER_DUE',
  reminderId:'00000000-0000-4000-8000-000000000002',cardId:'00000000-0000-4000-8000-000000000003',
  workspaceId:'00000000-0000-4000-8000-000000000004',scheduleVersion:2,
  occurredAt:'2099-01-01T00:00:00Z',expiresAt:'2099-01-02T00:00:00Z'};
function setup(payload:unknown=event) {
  const store = {claim:vi.fn().mockResolvedValue({eventId:event.eventId,lockToken:'token',payload}),finish:vi.fn().mockResolvedValue(true)} satisfies PublicationStore;
  const broker={publish:vi.fn().mockResolvedValue(undefined)};
  return {store,broker};
}
describe('publicación confirmada',()=>{
  it('espera al broker antes de marcar PUBLISHED',async()=>{
    const {store,broker}=setup();
    broker.publish.mockImplementation(async()=>{expect(store.finish).not.toHaveBeenCalled();});
    expect(await publishNext(store,broker)).toBe('PUBLISHED');
    expect(store.finish).toHaveBeenCalledWith(event.eventId,'token','PUBLISHED');
  });
  it('no publica si no hay evento',async()=>{
    const {store,broker}=setup();store.claim.mockResolvedValue(null);
    expect(await publishNext(store,broker)).toBe('EMPTY');expect(broker.publish).not.toHaveBeenCalled();
  });
  it('rechaza un mensaje inválido sin enviarlo',async()=>{
    const {store,broker}=setup({...event,accessToken:'prohibido'});
    expect(await publishNext(store,broker)).toBe('INVALID');expect(broker.publish).not.toHaveBeenCalled();
  });
  it('un fallo del broker registra RETRY',async()=>{
    const {store,broker}=setup();broker.publish.mockRejectedValue(new Error('fallo'));
    expect(await publishNext(store,broker)).toBe('RETRY');
    expect(store.finish).toHaveBeenCalledWith(event.eventId,'token','RETRY');
  });
  it('si falla BD después del envío no lo registra como fallo MQ',async()=>{
    const {store,broker}=setup();store.finish.mockRejectedValue(new Error('BD'));
    await expect(publishNext(store,broker)).rejects.toThrow('BD');
    expect(store.finish).toHaveBeenCalledTimes(1);
    expect(store.finish).toHaveBeenCalledWith(event.eventId,'token','PUBLISHED');
  });
  it('informa pérdida de reserva',async()=>{
    const {store,broker}=setup();store.finish.mockResolvedValue(false);
    expect(await publishNext(store,broker)).toBe('LEASE_LOST');
  });
  it('convierte TTL a décimas sin hacerlo ilimitado ni redondear hacia arriba',()=>{
    expect(expiryTenths('2026-10-15T00:00:01.099Z',Date.parse('2026-10-15T00:00:00Z'))).toBe(10);
    expect(()=>expiryTenths('2026-10-15T00:00:00Z',Date.parse('2026-10-15T00:00:00Z'))).toThrow();
  });
  it('requiere TLS y no filtra secretos en errores de configuración',()=>{
    expect(()=>readProducerConfig({MQ_PASSWORD:'secreto'})).toThrow('MQ_TLS_CIPHER_SPEC');
    try {readProducerConfig({MQ_PASSWORD:'secreto'});} catch(error) {expect(String(error)).not.toContain('secreto');}
  });
});
