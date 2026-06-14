"""
ActionBus v3.1 自动测试脚本
用法: python3 serial_test.py [PORT] [BAUD]
默认: /dev/ttyUSB0 115200
"""
import serial, time, sys

PORT = sys.argv[1] if len(sys.argv) > 1 else '/dev/ttyUSB0'
BAUD = int(sys.argv[2]) if len(sys.argv) > 2 else 115200

PASS_N = 0
FAIL_N = 0


def crc16modbus(data):
    crc = 0xFFFF
    for b in data:
        crc ^= b
        for _ in range(8):
            crc = (crc >> 1) ^ 0xA001 if (crc & 1) else crc >> 1
    return crc


def make(addr, func, stat, data=b''):
    data = bytes(data)
    p = bytes([addr, func, stat, len(data)]) + data
    c = crc16modbus(p)
    return b'\xAA\x55' + p + bytes([c >> 8, c & 0xFF])


def recv(ser, timeout=1.2):
    buf = bytearray()
    t0 = time.time()
    while time.time() - t0 < timeout:
        b = ser.read(1)
        if b:
            buf += b
            if (len(buf) >= 2 and buf[0] == 0xAA and buf[1] == 0x55
                    and len(buf) >= 6):
                need = 6 + buf[5] + 2
                if len(buf) >= need:
                    return bytes(buf[:need])
    return None


def check(name, tx, expect_func=None, expect_dlen=None, timeout=1.2):
    global PASS_N, FAIL_N
    ser.write(tx)
    r = recv(ser, timeout)
    ok = r is not None
    if ok and expect_func is not None:
        ok = ok and (r[3] == expect_func)
    if ok and expect_dlen is not None:
        ok = ok and (r[5] == expect_dlen)
    label = "PASS" if ok else "FAIL"
    if ok:
        PASS_N += 1
    else:
        FAIL_N += 1
    rx_str = r.hex(' ').upper() if r else "<无响应>"
    print(f"  [{label}] {name:<32s}  {rx_str}")
    return r


print("=" * 72)
print(f"ActionBus v3.1 自动测试  |  {PORT}  {BAUD}bps")
print("=" * 72)

with serial.Serial(PORT, BAUD, timeout=0.1) as ser:
    time.sleep(0.2)
    ser.reset_input_buffer()

    # ── 0x20 Echo ──────────────────────────────────────────────────────
    print("\n[0x20] Echo 回环")
    check("Echo 'Hi!'", make(1, 0x20, 0x11, b'Hi!'), 0x20, 3)
    check("Echo 'AB'",  make(1, 0x20, 0x11, b'AB'),  0x20, 2)
    check("Echo SW=0",  make(1, 0x20, 0x10))

    # ── 0x0D 设备状态 ───────────────────────────────────────────────────
    print("\n[0x0D] 设备状态查询")
    r = check("查询状态", make(1, 0x0D, 0x11), 0x0D, 8)
    if r and r[5] == 8:
        uptime   = int.from_bytes(r[6:10],  'big')
        cpu_temp = int.from_bytes(r[10:12], 'big', signed=True)
        tasks    = r[12]
        addr     = r[13]
        print(f"         uptime={uptime}ms  cpu={cpu_temp/100:.2f}°C  "
              f"tasks={tasks}  addr=0x{addr:02X}")

    # ── 0x01 LED 控制 ───────────────────────────────────────────────────
    print("\n[0x01] LED 控制（观察 PF9/PF10）")
    check("LED1 亮 (PF9)",  make(1, 0x01, 0x11, [0x01]))
    time.sleep(0.6)
    check("LED2 亮 (PF10)", make(1, 0x01, 0x11, [0x02]))
    time.sleep(0.6)
    check("两灯全亮",        make(1, 0x01, 0x11, [0x03]))
    time.sleep(0.6)
    check("全灭 SW=0",       make(1, 0x01, 0x10))
    time.sleep(0.3)

    # ── 0x0C ADC ────────────────────────────────────────────────────────
    print("\n[0x0C] ADC 单次读取")
    for ch in range(4):
        r = check(f"ADC ch{ch}", make(1, 0x0C, 0x11, [ch]), 0x0C, 3)
        if r and r[5] == 3:
            val = int.from_bytes(r[7:9], 'big')
            print(f"         ch{ch} = {val}  ({val/4095*100:.1f}% 满量程)")

    # ── 0x0A 温度订阅 ───────────────────────────────────────────────────
    print("\n[0x0A] 温度订阅")
    check("启动 1000ms 间隔", make(1, 0x0A, 0x11, [0x03, 0xE8]))
    time.sleep(2.5)
    r = recv(ser, timeout=0.1)
    if r and r[3] == 0x0A and r[5] == 2:
        t = int.from_bytes(r[6:8], 'big', signed=True)
        PASS_N += 1
        print(f"  [PASS] 收到上报                          "
              f"{r.hex(' ').upper()}  → {t/100:.2f}°C")
    else:
        FAIL_N += 1
        print("  [FAIL] 未收到温度上报")
    check("停止 SW=0", make(1, 0x0A, 0x10))

    # ── 0x0B IMU 订阅 ───────────────────────────────────────────────────
    print("\n[0x0B] IMU 姿态订阅")
    check("启动 200ms 间隔", make(1, 0x0B, 0x11, [0x00, 0xC8]))
    time.sleep(0.6)
    received = []
    deadline = time.time() + 1.0
    while time.time() < deadline:
        r = recv(ser, timeout=0.05)
        if r and r[3] == 0x0B and r[5] == 6:
            received.append(r)
    if received:
        PASS_N += 1
        r = received[-1]
        roll  = int.from_bytes(r[6:8],   'big', signed=True)
        pitch = int.from_bytes(r[8:10],  'big', signed=True)
        yaw   = int.from_bytes(r[10:12], 'big', signed=True)
        print(f"  [PASS] 收到 {len(received)} 包 IMU 数据  "
              f"Roll={roll/100:.2f}°  Pitch={pitch/100:.2f}°  Yaw={yaw/100:.2f}°")
    else:
        FAIL_N += 1
        print("  [FAIL] 未收到 IMU 上报")
    check("停止 SW=0", make(1, 0x0B, 0x10))

    # ── 0x02 LED 闪烁 ───────────────────────────────────────────────────
    print("\n[0x02] LED 闪烁订阅（观察 LED 闪烁约 2s）")
    check("两灯 500ms 闪烁", make(1, 0x02, 0x11, [0x03, 0x05]), 0x02, 2)
    time.sleep(2.0)
    check("停止闪烁 SW=0",   make(1, 0x02, 0x10))

    # ── 0x10 文件传输 ───────────────────────────────────────────────────
    print("\n[0x10] 文件传输（观察 LED1 常亮，LED2 逐包闪烁）")
    fname   = b'hello.bin'
    payload = bytes(range(16))  # 16 字节测试数据
    check("INIT (16B, hello.bin)",
          make(1, 0x10, 0x11, bytes([0x00, 0x00, len(payload)]) + fname))
    time.sleep(0.1)
    check("DATA seq=0",
          make(1, 0x10, 0x11, bytes([0x01, 0x00, 0x00]) + payload))
    time.sleep(0.1)
    r = check("END", make(1, 0x10, 0x11, [0x02]), 0x10, 4)
    if r and r[5] == 4:
        n = int.from_bytes(r[6:10], 'big')
        print(f"         → 设备已接收 {n} 字节")

print()
print("=" * 72)
print(f"  结果：PASS={PASS_N}  FAIL={FAIL_N}  总计={PASS_N + FAIL_N}")
print("=" * 72)
sys.exit(0 if FAIL_N == 0 else 1)
