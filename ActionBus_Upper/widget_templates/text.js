/**
 * 文本标签控件
 *
 * ch(0).push(string) 更新显示文本。
 * 可以推入任何能 String() 转换的值。
 */

/* ── 示例 1：ASCII 字符串（Echo 帧 / 字符串消息） ── */
const FUNC_CODE = 0x20;

if (frame.func !== FUNC_CODE) return;

// 过滤可打印 ASCII（0x20~0x7E）
const text = Array.from(frame.data)
    .filter(b => b >= 0x20 && b <= 0x7E)
    .map(b => String.fromCharCode(b))
    .join('');

ch(0).push(text || `[${frame.data.length}B 非 ASCII]`);

/* ── 示例 2：格式化数值为字符串（取消注释使用） ──
if (frame.func !== 0x0A) return;
const temp = readFloat32BE(0).toFixed(2);
ch(0).push(`温度: ${temp} °C`);
*/

/* ── 示例 3：拼接多个字段 ──
if (frame.func !== 0x0D) return;
if (frame.data.length < 8) return;
const uptime = readUint32BE(0);
const tasks  = frame.data[6];
const addr   = frame.data[7];
ch(0).push(`uptime=${(uptime/1000).toFixed(1)}s  tasks=${tasks}  addr=0x${addr.toString(16).padStart(2,'0')}`);
*/
