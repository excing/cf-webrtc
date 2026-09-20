/**
 * @file room_code.js
 * @description 房间短码生成与校验领域逻辑
 * 使用去歧义字符集 (排除 0, O, 1, I 等易混淆字符)
 */

// 32 个无歧义字符（Crockford's Base32 变体）
const CHARSET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_LENGTH = 6;

/**
 * 生成 6 位大写房间码
 * @returns {string}
 */
export function generateRoomCode() {
  let result = '';
  const randomBytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  for (let i = 0; i < CODE_LENGTH; i++) {
    result += CHARSET[randomBytes[i] % CHARSET.length];
  }
  return result;
}

/**
 * 校验房间码格式是否合法
 * @param {string} code
 * @returns {boolean}
 */
export function isValidRoomCode(code) {
  if (typeof code !== 'string') return false;
  const normalized = code.trim().toUpperCase();
  if (normalized.length !== CODE_LENGTH) return false;
  for (let i = 0; i < CODE_LENGTH; i++) {
    if (!CHARSET.includes(normalized[i])) {
      return false;
    }
  }
  return true;
}
