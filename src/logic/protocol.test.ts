import { describe, expect, it } from 'vitest';
import {
  encodeClient,
  encodeServer,
  isValidRoomCode,
  makeRoomCode,
  normalizeRoomCode,
  parseClient,
  parseServer,
  type NetState,
} from './protocol';

const state: NetState = {
  x: 1.234,
  y: 5,
  z: -3,
  yaw: 1,
  mode: 3,
  vx: 10,
  vy: -2,
  vz: 0,
  ax: 4,
  ay: 60,
  az: 2,
  car: -1,
  carColor: 0,
  attack: -1,
};

describe('protocol', () => {
  it('round-trips messages', () => {
    const m = parseClient(encodeClient({ t: 'state', s: state }));
    expect(m?.t).toBe('state');
    if (m?.t === 'state') expect(m.s.x).toBeCloseTo(1.23);
    const s = parseServer(encodeServer({ t: 'state', id: 2, s: state }));
    expect(s?.t).toBe('state');
    const w = parseServer(
      encodeServer({
        t: 'welcome',
        id: 1,
        time: 123,
        players: [[2, ['#000000', '#ffffff', '#123456']]],
        solved: [5],
      }),
    );
    expect(w).toEqual({
      t: 'welcome',
      id: 1,
      time: 123,
      players: [[2, ['#000000', '#ffffff', '#123456']]],
      solved: [5],
    });
  });

  it('rejects bad input', () => {
    expect(parseClient('nonsense')).toBeNull();
    expect(parseClient(JSON.stringify(['h', ['red', 'blue', 'x']]))).toBeNull();
    expect(parseClient(JSON.stringify(['s', 1, 2]))).toBeNull();
    expect(
      parseClient(JSON.stringify(['s', 1e9, 0, 0, 0, 0, 0, 0, 0, null, null, null, -1, 0, -1])),
    ).toBeNull();
    expect(parseClient('x'.repeat(600))).toBeNull();
  });

  it('codes are easy to type: no Ä/Ö, and fit in the join box', () => {
    for (let i = 0; i < 200; i++) {
      const code = makeRoomCode();
      expect(code).not.toMatch(/[ÄÖ]/);
      expect(code.length).toBeLessThanOrEqual(32);
      expect(normalizeRoomCode(code)).toBe(code);
    }
  });

  it('cleans up typed codes', () => {
    expect(normalizeRoomCode(' tähti köysi 42 ')).toBe('TAHTI-KOYSI-42');
    expect(normalizeRoomCode('salama--varjo_98')).toBe('SALAMA-VARJO-98');
    expect(isValidRoomCode(normalizeRoomCode('kissa varjo 12'))).toBe(true);
  });

  it('makes valid room codes', () => {
    for (let i = 0; i < 50; i++) expect(isValidRoomCode(makeRoomCode())).toBe(true);
    expect(isValidRoomCode('hello')).toBe(false);
  });
});
