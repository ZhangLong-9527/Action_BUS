/**
 * XY 散点图控件
 *
 * 通道约定：
 *   ch(0).push(x_value)  X 轴数据
 *   ch(1).push(y_value)  Y 轴数据
 *
 * 注意：两次 push 需在同一帧脚本调用内完成，
 *       控件以最近一对 (x, y) 绘制散点。
 *
 * 典型用途：李萨如图形、相平面图、力-位移曲线等。
 */

/* ── 示例 1：两个 float32 分别作为 X 和 Y ── */
const FUNC_CODE = 0x30;   // ← 改为实际功能码

if (frame.func !== FUNC_CODE) return;
if (frame.data.length < 8) return;

const x = readFloat32BE(0);
const y = readFloat32BE(4);

ch(0).push(x);
ch(1).push(y);

/* ── 示例 2：利用两个通道绘制正弦/余弦圆（纯数学演示） ──
 *   此示例适合在 Echo 或定时帧触发时生成参数曲线
if (frame.func !== 0x20) return;
const t = Date.now() / 1000;
ch(0).push(Math.cos(t));
ch(1).push(Math.sin(t));
*/
