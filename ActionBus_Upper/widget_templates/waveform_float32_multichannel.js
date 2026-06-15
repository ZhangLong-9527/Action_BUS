/**
 * 波形图 — 多通道 Float32 BE（同一帧内多个值）
 *
 * 适用场景：一帧 data[] 中连续存放多个 float32，
 *           每个 float 对应波形图一个通道（最多 32 通道）。
 *
 * 示例帧结构（3 轴加速度，12 字节）：
 *   data[0..3]  = Ax (float32 BE)
 *   data[4..7]  = Ay (float32 BE)
 *   data[8..11] = Az (float32 BE)
 */

const FUNC_CODE = 0x20;   // ← 改为实际功能码

if (frame.func !== FUNC_CODE) return;

const channels = [
    { offset: 0,  label: 'Ax', color: '#3b82f6' },
    { offset: 4,  label: 'Ay', color: '#f97316' },
    { offset: 8,  label: 'Az', color: '#10b981' },
    // 继续添加…
];

for (let i = 0; i < channels.length; i++) {
    const { offset, label, color } = channels[i];
    if (offset + 4 > frame.data.length) break;
    const val = readFloat32BE(offset);
    ch(i).push(val, { color, lineWidth: 1.5, label });
}
