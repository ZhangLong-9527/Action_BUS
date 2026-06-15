/**
 * 3D 姿态控件 — Roll / Pitch / Yaw
 *
 * 控件通道映射：
 *   ch(0) = Roll  （横滚，−180° ~ +180°）
 *   ch(1) = Pitch （俯仰，−90°  ~ +90°）
 *   ch(2) = Yaw   （航向，−180° ~ +180°）
 *
 * 脚本将数据解析后分别推入对应通道，控件自动更新数值和进度条。
 *
 * 示例 1：ActionBus IMU 帧（int16 × 100，6 字节）
 */

const FUNC_CODE = 0x0B;

if (frame.func !== FUNC_CODE) return;
if (frame.data.length < 6) return;

ch(0).push(readInt16BE(0) * 0.01);   // Roll
ch(1).push(readInt16BE(2) * 0.01);   // Pitch
ch(2).push(readInt16BE(4) * 0.01);   // Yaw

/* ──────────────────────────────────────────────
 * 示例 2：float32 四元数 → 欧拉角（取消注释使用）
 * ──────────────────────────────────────────────
if (frame.func !== 0x30) return;
if (frame.data.length < 16) return;

const w = readFloat32BE(0), x = readFloat32BE(4);
const y = readFloat32BE(8), z = readFloat32BE(12);

const roll  =  Math.atan2(2*(w*x + y*z), 1 - 2*(x*x + y*y)) * 180 / Math.PI;
const pitch =  Math.asin( Math.max(-1, Math.min(1, 2*(w*y - z*x)))) * 180 / Math.PI;
const yaw   =  Math.atan2(2*(w*z + x*y), 1 - 2*(y*y + z*z)) * 180 / Math.PI;

ch(0).push(roll);
ch(1).push(pitch);
ch(2).push(yaw);
*/
