import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateRoomCode, isValidRoomCode } from '../core/room_code.js';

describe('Room Code Domain Logic', () => {
  it('should generate a 6-character uppercase alphanumeric room code', () => {
    const code = generateRoomCode();
    assert.equal(code.length, 6);
    assert.match(code, /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/);
  });

  it('should not contain ambiguous characters (0, O, 1, I)', () => {
    for (let i = 0; i < 100; i++) {
      const code = generateRoomCode();
      assert.doesNotMatch(code, /[01IOio]/);
    }
  });

  it('should correctly validate room codes', () => {
    assert.equal(isValidRoomCode('ABC234'), true);
    assert.equal(isValidRoomCode('abc234'), true); // case insensitive check
    assert.equal(isValidRoomCode('123456'), false); // contains '1'
    assert.equal(isValidRoomCode('ABC'), false); // too short
    assert.equal(isValidRoomCode('ABCDEFG'), false); // too long
    assert.equal(isValidRoomCode(''), false);
    assert.equal(isValidRoomCode(null), false);
  });
});
