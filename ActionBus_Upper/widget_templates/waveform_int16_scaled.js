/**
 * 波形图 — Int16 BE × 比例系数（多通道）
 *
 * 适用场景：下位机将浮点数乘以 100 后以 int16 发送，
 *           上位机除以 100 还原真实值。
 *           例如：温度 23.45°C → 发送 2345 (0x09 0x29)
 *                 IMU 角度 Roll=12.34° → 发送 1234
 *
 * 示例帧结构（Roll / Pitch / Yaw，每个 2 字节，共 6 字节）：
 *   data[0..1] = Roll  × 100 (int16 BE)
 *   data[2..3] = Pitch × 100 (int16 BE)
 *   data[4..5] = Yaw   × 100 (int16 BE)
 */

const FUNC_CODE = 0x0B;   // ← 改为实际功能码
const SCALE     = 0.01;   // ← 还原比例，1/100 = 0.01

if (frame.func !== FUNC_CODE) return;
if (frame.data.length < 6) return;

ch(0).push(readInt16BE(0) * SCALE, { color: '#3b82f6', label: 'Roll' });
ch(1).push(readInt16BE(2) * SCALE, { color: '#f97316', label: 'Pitch' });
ch(2).push(readInt16BE(4) * SCALE, { color: '#10b981', label: 'Yaw' });
