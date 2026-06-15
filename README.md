# ActionBus v3.1

轻量级主从串行通信协议 + 全栈参考实现。  
协议层运行在 STM32，上位机为 Electron 桌面应用，双向通信基于 CRC-16/MODBUS 校验的二进制帧。

---

## 目录结构

```
ActionBus/
├── ActionBus_Upper/          # Electron 上位机
│   ├── src/
│   │   ├── index.html        # 主界面（帧日志、拓扑图、手动发送栏）
│   │   ├── renderer/app.js   # 渲染进程逻辑
│   │   └── styles/main.css   # 主题系统（8 套主题）
│   ├── main.js               # Electron 主进程
│   ├── preload.js            # 预加载脚本
│   ├── serial_test.py        # Python 自动化测试脚本
│   └── TEST_GUIDE.md         # 详细测试手册
│
├── Stm32Project/ActionBus/   # STM32F407ZET6 固件
│   ├── Core/
│   │   ├── Inc/
│   │   │   ├── actionbus.h   # 协议库头文件
│   │   │   ├── ab_file.h     # 文件传输子协议
│   │   │   └── test_tasks.h  # 测试任务
│   │   └── Src/
│   │       ├── main.c        # 入口（UART 中断接收）
│   │       ├── actionbus.c   # 协议解析 / 发送
│   │       ├── ab_file.c     # 文件传输实现
│   │       └── test_tasks.c  # 8 个测试功能码实现
│   ├── Makefile
│   └── ActionBus.ioc         # CubeMX 工程文件
│
└── README.md                 # 本文件（协议规范 + 项目说明）
```

---

## 硬件

| 项目 | 配置 |
|------|------|
| MCU | STM32F407ZET6，Cortex-M4 @ 168MHz |
| 时钟 | HSE 8MHz，PLLM=4 PLLN=168 PLLP=2 |
| 串口 | USART1，PA9(TX) / PA10(RX)，115200 8N1 |
| LED1 | PF9，高电平亮 |
| LED2 | PF10，高电平亮 |

**接线（USB 串口模块 → STM32）**

```
模块 TX  →  PA10 (USART1_RX)
模块 RX  ←  PA9  (USART1_TX)
模块 GND —  GND
```

---

## 固件

### 编译

```bash
cd Stm32Project/ActionBus
make -j4
```

输出：`build/ActionBus.elf`，约 12KB。

### 烧录

```bash
openocd -f interface/stlink.cfg -f target/stm32f4x.cfg \
        -c "program build/ActionBus.elf verify reset exit"
```

### 已实现功能码

| 功能码 | 名称 | 类型 |
|--------|------|------|
| 0x01 | LED 控制 | 单次 |
| 0x02 | LED 闪烁订阅 | 订阅 |
| 0x0A | 温度上报订阅 | 订阅 |
| 0x0B | IMU 姿态订阅 | 订阅 |
| 0x0C | ADC 单次读取 | 单次 |
| 0x0D | 设备状态查询 | 单次 |
| 0x10 | 文件接收 | 流式 |
| 0x20 | Echo 回环 | 单次 |

### CubeMX 注意事项

所有用户代码必须在 `/* USER CODE BEGIN xxx */` 和 `/* USER CODE END xxx */` 之间，否则重新生成代码时会丢失。

---

## 上位机

### 安装依赖

```bash
cd ActionBus_Upper
npm install
```

> 原生模块（serialport）需要与 Electron 版本匹配，首次安装后执行：
> ```bash
> npx electron-rebuild
> ```

### 启动

```bash
npm start
```

### 界面功能

**标题栏**

| 控件 | 说明 |
|------|------|
| Target | 当前操作的从机地址（十六进制，如 `0x01`） |
| Port / Baud | 串口路径与波特率 |
| Connect | 连接 / 断开 |
| One Click Scan | 扫描总线地址 0x01–0x10，自动发现在线设备 |
| Import Script / Export CSV | 脚本导入与数据导出（预留） |

**左侧面板 — 设备列表**

- 连接串口后，点击侧边栏**「刷新」**按钮，向 Target 地址发送 `0x0D` 状态查询；
  有响应则在列表中创建设备节点，显示地址、uptime、CPU 温度、任务数。
- 点击**「One Click Scan」**自动扫描全总线，所有在线设备依次出现。
- 断开连接后，已发现的设备节点保留但变为灰色离线状态。
- 展开设备节点，可看到该设备支持的全部功能码及描述。

**左侧面板 — 控件库**

将控件卡片拖拽到画布即可实例化对应控件。

**中央画布**

- 控件可自由拖拽、缩放；支持网格吸附。
- **单击**控件 → 选中高亮；**双击**控件 → 打开右侧属性面板。
- 每个显示型控件均通过 JS 脚本驱动，与下位机协议完全解耦。

**右侧属性面板 — 控件配置**

双击画布中的控件后展开：

| 控件类型 | 属性面板内容 |
|----------|------------|
| 开关按键 | ON 帧 / OFF 帧（Func、Stat、Data 十六进制） |
| 滑块 | TX 帧（Func、Stat、Data；`FE` 字节自动替换为当前值 0–255） |
| 波形图 | 绑定脚本 + 历史点数 + 清空 + 导出 CSV |
| XY 散点图 | 绑定脚本（ch(0)=X, ch(1)=Y） |
| 其他显示控件 | 绑定脚本 |

脚本在每次收到帧时触发一次，API 如下：

```javascript
frame.func / .stat / .addr / .data  // 当前帧信息（Uint8Array）
ch(n).push(value, {color?, lineWidth?, label?})  // 推送到第 n 通道
output(value)                        // 等同 ch(0).push(value)
readFloat32BE/LE(offset)             // 4 字节浮点
readInt16BE/LE(offset)               // 2 字节有符号整数
readUint16BE/LE(offset)              // 2 字节无符号整数
readUint32BE(offset) / readInt32BE(offset)
```

参考脚本见 [`ActionBus_Upper/widget_templates/`](ActionBus_Upper/widget_templates/)。

**波形图操作**

| 操作 | 效果 |
|------|------|
| 滚轮 | X 轴缩放（以鼠标位置为锚点） |
| Ctrl + 滚轮 | Y 轴缩放（以鼠标位置为锚点） |
| 左键拖拽 | 平移历史数据（右上角显示偏移量；回到最新数据拖回即可） |
| 标题栏 ↓ 按钮 | 导出当前所有通道数据为 CSV |

**底部日志面板**

- **Frame Log**：原始帧（AA 55 帧头 / 地址 / 功能码 / Stat / 数据 / CRC 分色显示）
- **Decoded Log**：人类可读解码（温度、姿态角、ADC 值等）

**手动发送栏**

- 组帧模式：填写 Func + Data（空格分隔 Hex），自动填入 Target 地址与 CRC 后发送
- 原始模式：直接发送任意 Hex 序列

**主题系统**

点击右上角 ⚙ 图标，可在 8 套主题中切换：深空蓝、极光紫、深海青、暗夜翠、熔岩橙、中国红、琥珀黄、极夜黑。

---

## 测试

详见 [`ActionBus_Upper/TEST_GUIDE.md`](ActionBus_Upper/TEST_GUIDE.md)。

### 快速验证

```bash
# 接好 USB 串口模块（TX→PA10，RX→PA9，GND→GND），烧录固件后执行
python3 ActionBus_Upper/serial_test.py
```

脚本依次测试全部 8 个功能码，输出 PASS / FAIL 汇总。

> **当前状态**：固件测试通过，8 个功能码均验证正常。

---

## 协议规范

### 帧格式

```
┌──────┬──────┬──────┬──────────┬──────┬──────────────────┬─────────────┐
│  AA  │  55  │ Addr │ FuncCode │ Stat │  Data[0..Len-1]  │ CRC_H CRC_L │
│  1B  │  1B  │  1B  │    1B    │  1B  │     Len 字节     │    2B BE    │
└──────┴──────┴──────┴──────────┴──────┴──────────────────┴─────────────┘
总长度 = 6 + Len + 2，最大 263 字节（Len≤255）
```

### Stat 字节

```
Bit 7 | Bits 6-5 | Bit 4 | Bits 3-1 | Bit 0
 ERR  |  RES(0)  |  DIR  |  RES(0)  |  SW
```

| Stat | 含义 |
|------|------|
| `0x11` | 主机 ON，请求启动 |
| `0x10` | 主机 OFF，请求停止 |
| `0x01` | 从机 ON，运行中 / 确认 |
| `0x00` | 从机 OFF，已停止 / 已完成 |
| `0x80` | 从机错误，Data[0]=错误码 |

### 地址

| 值 | 含义 |
|----|------|
| `0x01–0xFE` | 单播 |
| `0xFF` | 广播（危险操作禁止使用） |

### 功能码空间

| 范围 | 说明 |
|------|------|
| `0x00` | 协议保留 |
| `0x01–0xEF` | 用户空间，`ActionBus_Register()` 注册 |
| `0xF0` | 通用查询（GET_PROTOCOL_VERSION 等） |
| `0xFE` | Action 描述表枚举 |
| `0xF1–0xFD, 0xFF` | 保留 |

### CRC-16/MODBUS

| 参数 | 值 |
|------|----|
| 多项式 | 0x8005（等效反转 0xA001） |
| 初始值 | 0xFFFF |
| 计算范围 | Addr 到最后一个数据字节 |
| 线上字节序 | 大端，CRC_H 先发 |

```c
uint16_t crc16modbus(const uint8_t *data, size_t len) {
    uint16_t crc = 0xFFFF;
    for (size_t i = 0; i < len; i++) {
        crc ^= data[i];
        for (int j = 0; j < 8; j++)
            crc = (crc & 1) ? (crc >> 1) ^ 0xA001 : crc >> 1;
    }
    return crc;
}
```

### 错误码

| 值 | 符号 | 含义 |
|----|------|------|
| 0x01 | AB_ERR_INVALID_PARAMETER | 参数非法 |
| 0x02 | AB_ERR_LEN_OR_PAYLOAD | 长度或载荷错误 |
| 0x03 | AB_ERR_NOT_SUPPORTED | 功能码未注册 |
| 0x04 | AB_ERR_WRONG_STATE | 状态不匹配 |
| 0x05 | AB_ERR_BUSY | 资源忙 |
| 0x06 | AB_ERR_INTERNAL | 内部错误 |
| 0x07 | AB_ERR_PERMISSION | 权限拒绝 |
| 0x08 | AB_ERR_TIMEOUT | 超时 |
| 0x09 | AB_ERR_CRC | 应用层 CRC 错误 |

### C API 速查

```c
// 初始化
void ActionBus_Init(void);
void ActionBus_SetSendCallback(ActionBus_SendBytes_t fn);
void ActionBus_SetDeviceAddress(uint8_t addr);

// 注册功能码
uint8_t ActionBus_Register(uint8_t func, const char *desc,
                            ActionCallback_t cb, void *ctx);

// 接收（在 UART 中断中调用）
void ActionBus_RxHandler(uint8_t byte);

// 主循环处理
void ActionBus_ProcessPending(void);

// 发送
uint8_t ActionBus_Report(uint8_t func, const uint8_t *data, uint8_t len);
uint8_t ActionBus_Send_Frame(uint8_t func, uint8_t stat,
                              const uint8_t *data, uint8_t len);
void    ActionBus_TaskClose(uint8_t func);
```

### 任务模型

| 模式 | 行为 |
|------|------|
| 单次 | 主机 `0x11` → 从机执行 → `ActionBus_TaskClose()` → 发 `0x00` |
| 订阅 | 主机 `0x11` → 从机循环 `ActionBus_Report()` → 主机发 `0x10` → 从机停止 |

---

## 更改日志

### v3.1.2（2026-06-16）

**上位机（Electron）**

- **JS 脚本系统重构**：去掉设备功能码旁的「+」硬绑定按钮，改为可视化控件系统。每个控件通过右侧属性面板自由配置，显示型控件绑定用户编写的 JS 脚本，控制型控件（开关 / 滑块）在面板内填写自定义帧参数。
- **右侧属性面板**：双击画布控件弹出，包含脚本编辑器 / 帧配置 / 波形图参数，单击仅选中。
- **滑块简化**：属性面板仅显示一个 TX 帧配置，Data 中 `FE` 字节自动替换为当前滑块值（0–255）。
- **波形图平移**：左键在波形画布拖拽可滚动历史数据，右上角显示当前偏移采样数。
- **鼠标位置感知缩放**：X 轴（滚轮）与 Y 轴（Ctrl+滚轮）均以鼠标指针所在数据点为锚点缩放，不再从边缘跳变。
- **XY 散点图实现**：新增独立 Canvas 渲染，500 点 RingBuffer 存储，自动 X/Y 量程，点透明度从旧→新渐变。
- **性能大幅提升**：
  - 脚本仅在点击「应用」时编译一次（`compileWidgetScript` + `compiledFn` 缓存），不再每帧 `new Function`；
  - 用 `displayWidgets` Set 替代每帧 `querySelectorAll('.canvas-widget')`；
  - DataView 每帧创建一次，不再每控件重复创建；
  - 波形 Canvas 尺寸仅在真正变化时 reset，避免每帧 layout reflow；
  - 脚本运行时异常日志限速 1 次/秒，防止日志栏刷屏。
- **布局加载**：加载 JSON 布局时同步编译脚本，加载后即可立即接收数据。
- **参考脚本库**：新增 `widget_templates/` 目录，包含 14 个覆盖全控件类型的参考 JS 脚本。

### v3.1.1（2026-06-16）

**固件（STM32）**

- **修复 CRC 计算范围**：`actionbus.c` 收发路径的 CRC 均改为从 Addr 字节开始计算，不再包含 AA 55 帧头。修复前 PC 发来的每一帧都因 CRC 不匹配被静默丢弃，导致上位机无响应。
- **新增 `HAL_UART_ErrorCallback`**：解决 UART 溢出 / 帧错误后 RX 中断被 HAL 永久关闭的问题，中断现在在错误后自动重新挂起。

**上位机（Electron）**

- **动态设备列表**：删除硬编码占位节点，改为运行时动态渲染。新增 `deviceRegistry`、`renderDeviceList`、`queryDevice`、`scanDevices` 等实现。
- **「刷新」按钮**：向 Target 地址发 `0x0D` 查询，响应后显示 uptime / CPU 温度 / 任务数。
- **「One Click Scan」**：自动扫描 0x01–0x10，25 台地址逐一查询，在线设备自动入列。
- **设备状态指示**：在线绿点 / 扫描中黄色呼吸 / 离线灰点。
- **「+」按钮**：根据功能码类型自动在画布创建对应控件（波形图、3D 姿态、开关等）。
- **事件委托**：设备节点展开 / 折叠与「+」按钮均通过 `#device-list` 委托处理，动态节点无需手动绑定。
- **waitForResponse 机制**：基于 Promise + 超时的帧等待，`queryDevice` 可 await 特定地址和功能码的回帧。

### v3.1（2026-06-15）

- 新增 ab_file 文件传输子协议（INIT / DATA / END / ABORT）
- 修复发送路径长度溢出（`uint8_t` → `uint16_t`）
- 新增 STM32 测试固件（8 个功能码 + 传感器模拟）
- 新增 Electron 上位机（主题系统、手动发送栏、拖拽布局）

### v3.0（初始版本）

- 确立帧格式与 Stat 字节三位语义（ERR / DIR / SW）
- 功能码空间划分，内置 `0xF0` 查询与 `0xFE` 描述表
- CRC-16/MODBUS 大端校验
- 标准错误码体系
