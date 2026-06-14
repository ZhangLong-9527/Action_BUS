/**
 * ActionBus v3.1 测试任务实现
 */

#include "test_tasks.h"
#include "actionbus.h"
#include "ab_file.h"
#include "main.h"
#include "stm32f4xx_hal.h"

/* ============================================================
   硬件映射
   ============================================================ */

#define LED1_PORT  GPIOF
#define LED1_PIN   GPIO_PIN_9
#define LED2_PORT  GPIOF
#define LED2_PIN   GPIO_PIN_10

/* 根据实际接线确认极性：SET=亮 / RESET=灭 */
#define LED_ON   GPIO_PIN_SET
#define LED_OFF  GPIO_PIN_RESET

static void led_write(uint8_t mask, GPIO_PinState state)
{
    if (mask & 0x01) HAL_GPIO_WritePin(LED1_PORT, LED1_PIN, state);
    if (mask & 0x02) HAL_GPIO_WritePin(LED2_PORT, LED2_PIN, state);
}

static void led_toggle(uint8_t mask)
{
    if (mask & 0x01) HAL_GPIO_TogglePin(LED1_PORT, LED1_PIN);
    if (mask & 0x02) HAL_GPIO_TogglePin(LED2_PORT, LED2_PIN);
}

/* ============================================================
   定时任务上下文
   ============================================================ */

typedef struct {
    uint8_t  active;
    uint8_t  mask;
    uint32_t interval_ms;
    uint32_t last_tick;
} LedBlinkCtx_t;

typedef struct {
    uint8_t  active;
    uint32_t interval_ms;
    uint32_t last_tick;
} PeriodicCtx_t;

static LedBlinkCtx_t g_led_blink = {0};
static PeriodicCtx_t g_temp_sub  = {0};
static PeriodicCtx_t g_imu_sub   = {0};

/* ============================================================
   传感器模拟（整数三角波，无需 libm）
   ============================================================ */

/* 模拟温度：23.00 ~ 25.00 °C，周期 12s，单位 0.01°C */
static int16_t sim_temp_c100(void)
{
    uint32_t t     = HAL_GetTick();
    uint32_t phase = t % 12000;
    int32_t  d;
    if (phase < 6000)
        d = (int32_t)phase * 200 / 6000;
    else
        d = 200 - (int32_t)(phase - 6000) * 200 / 6000;
    return (int16_t)(2300 + d);
}

/* Roll：-10.00° ~ +10.00°，周期 6s */
static int16_t sim_roll_100(void)
{
    uint32_t t     = HAL_GetTick();
    uint32_t phase = t % 6000;
    int32_t  d;
    if (phase < 3000)
        d = (int32_t)phase * 2000 / 3000;
    else
        d = 2000 - (int32_t)(phase - 3000) * 2000 / 3000;
    return (int16_t)(d - 1000);
}

/* Pitch：-5.00° ~ +5.00°，周期 4s，相位偏移 1s */
static int16_t sim_pitch_100(void)
{
    uint32_t t     = HAL_GetTick() + 1000;
    uint32_t phase = t % 4000;
    int32_t  d;
    if (phase < 2000)
        d = (int32_t)phase * 1000 / 2000;
    else
        d = 1000 - (int32_t)(phase - 2000) * 1000 / 2000;
    return (int16_t)(d - 500);
}

/* Yaw：缓慢递增，-180.00° ~ +180.00° 环绕，约 0.36°/s */
static int16_t sim_yaw_100(void)
{
    uint32_t t = HAL_GetTick();
    int32_t  y = (int32_t)((t / 100) % 36000);
    if (y > 18000) y -= 36000;
    return (int16_t)y;
}

/* ADC：0-4095 三角波，通道间相位差 2s */
static uint16_t sim_adc(uint8_t ch)
{
    uint32_t t     = HAL_GetTick() + (uint32_t)ch * 2000;
    uint32_t phase = t % 8000;
    uint32_t v;
    if (phase < 4000)
        v = phase * 4095 / 4000;
    else
        v = 4095 - (phase - 4000) * 4095 / 4000;
    return (uint16_t)v;
}

/* ============================================================
   0x01  LED 控制（单次）
   Data[0]: LED 掩码 (bit0=LED1, bit1=LED2, 0x00=全灭)
   响应: TaskClose
   ============================================================ */
static uint8_t cb_led_ctrl(const AbFrame_t *f, void *ctx)
{
    (void)ctx;
    if (!(f->stat & AB_STAT_SW)) {
        led_write(0x03, LED_OFF);
        ActionBus_TaskClose(0x01);
        return AB_ERR_OK;
    }
    if (f->len < 1) return AB_ERR_LEN_OR_PAYLOAD;

    uint8_t mask = f->data[0] & 0x03;
    led_write(0x03, LED_OFF);    /* 先全灭，再按掩码点亮 */
    led_write(mask, LED_ON);
    ActionBus_TaskClose(0x01);
    return AB_ERR_OK;
}

/* ============================================================
   0x02  LED 闪烁订阅
   SW=1 Data[0]=掩码 Data[1]=间隔×100ms (0=500ms)
   SW=0 停止闪烁
   运行中: 每隔 interval 发送一次 SLAVE_ON 上报当前状态
   ============================================================ */
static uint8_t cb_led_blink(const AbFrame_t *f, void *ctx)
{
    LedBlinkCtx_t *s = (LedBlinkCtx_t *)ctx;

    if (!(f->stat & AB_STAT_SW)) {
        s->active = 0;
        led_write(s->mask, LED_OFF);
        ActionBus_TaskClose(0x02);
        return AB_ERR_OK;
    }
    if (f->len < 2) return AB_ERR_LEN_OR_PAYLOAD;

    s->mask        = f->data[0] & 0x03;
    s->interval_ms = (uint32_t)f->data[1] * 100;
    if (s->interval_ms == 0) s->interval_ms = 500;
    s->last_tick   = HAL_GetTick();
    s->active      = 1;

    /* 立即回报确认 */
    uint8_t rsp[2] = { s->mask, f->data[1] };
    ActionBus_Report(0x02, rsp, 2);
    return AB_ERR_OK;
}

/* ============================================================
   0x0A  温度订阅
   SW=1 Data[0:1]=interval_ms (uint16 BE, 0=1000ms)
   SW=0 停止
   上报: Data[0:1]=温度×100 (int16 BE, 单位 0.01°C)
   ============================================================ */
static uint8_t cb_temp_sub(const AbFrame_t *f, void *ctx)
{
    PeriodicCtx_t *s = (PeriodicCtx_t *)ctx;

    if (!(f->stat & AB_STAT_SW)) {
        s->active = 0;
        ActionBus_TaskClose(0x0A);
        return AB_ERR_OK;
    }

    uint32_t interval = 1000;
    if (f->len >= 2)
        interval = (uint32_t)((f->data[0] << 8) | f->data[1]);
    if (interval < 50) interval = 50;

    s->interval_ms = interval;
    s->last_tick   = HAL_GetTick();
    s->active      = 1;
    return AB_ERR_OK;
}

/* ============================================================
   0x0B  IMU 姿态订阅
   SW=1 Data[0:1]=interval_ms (uint16 BE, 0=100ms)
   SW=0 停止
   上报: [Roll_H Roll_L Pitch_H Pitch_L Yaw_H Yaw_L] (int16 BE, 0.01°)
   ============================================================ */
static uint8_t cb_imu_sub(const AbFrame_t *f, void *ctx)
{
    PeriodicCtx_t *s = (PeriodicCtx_t *)ctx;

    if (!(f->stat & AB_STAT_SW)) {
        s->active = 0;
        ActionBus_TaskClose(0x0B);
        return AB_ERR_OK;
    }

    uint32_t interval = 100;
    if (f->len >= 2)
        interval = (uint32_t)((f->data[0] << 8) | f->data[1]);
    if (interval < 20) interval = 20;

    s->interval_ms = interval;
    s->last_tick   = HAL_GetTick();
    s->active      = 1;
    return AB_ERR_OK;
}

/* ============================================================
   0x0C  ADC 单次读取
   Data[0]: 通道号 0-3（省略则默认通道 0）
   响应: Data[0]=通道 Data[1:2]=ADC值(uint16 BE, 0-4095)
   ============================================================ */
static uint8_t cb_adc_read(const AbFrame_t *f, void *ctx)
{
    (void)ctx;
    uint8_t  ch  = (f->len >= 1) ? (f->data[0] & 0x03) : 0;
    uint16_t val = sim_adc(ch);
    uint8_t  rsp[3] = { ch, (uint8_t)(val >> 8), (uint8_t)(val & 0xFF) };
    ActionBus_Send_Frame(0x0C, AB_STAT_SLAVE_OFF, rsp, 3);
    return AB_ERR_OK;
}

/* ============================================================
   0x0D  设备状态查询（单次）
   响应: [uptime_ms:4B BE][cpu_temp×100:2B int16 BE]
         [active_tasks:1B][bus_addr:1B]
   ============================================================ */
static uint8_t cb_dev_status(const AbFrame_t *f, void *ctx)
{
    (void)f; (void)ctx;

    uint32_t uptime   = HAL_GetTick();
    int16_t  cpu_temp = sim_temp_c100() + 700; /* CPU 约比环境高 7°C */
    uint8_t  tasks    = (g_led_blink.active ? 1 : 0)
                      + (g_temp_sub.active  ? 1 : 0)
                      + (g_imu_sub.active   ? 1 : 0);

    uint8_t rsp[8];
    rsp[0] = (uint8_t)(uptime >> 24);
    rsp[1] = (uint8_t)(uptime >> 16);
    rsp[2] = (uint8_t)(uptime >>  8);
    rsp[3] = (uint8_t)(uptime);
    rsp[4] = (uint8_t)((uint16_t)cpu_temp >> 8);
    rsp[5] = (uint8_t)((uint16_t)cpu_temp & 0xFF);
    rsp[6] = tasks;
    rsp[7] = ActionBus_GetDeviceAddress();

    ActionBus_Send_Frame(0x0D, AB_STAT_SLAVE_OFF, rsp, 8);
    return AB_ERR_OK;
}

/* ============================================================
   0x10  文件接收（ab_file 协议）
   LED1 接收中常亮，LED2 每收到一包切换，完成后 LED2 亮 3s
   ============================================================ */

static AbFileCtx_t g_file_ctx;
static uint32_t    g_file_done_tick;   /* 完成后 LED2 亮起的时刻 */
static uint8_t     g_file_done_flag;

static uint8_t file_on_ready(AbFileCtx_t *ctx)
{
    (void)ctx;
    g_file_done_flag = 0;
    led_write(0x01, LED_ON);   /* LED1 常亮：传输进行中 */
    led_write(0x02, LED_OFF);
    return AB_ERR_OK;
}

static uint8_t file_on_data(AbFileCtx_t *ctx, uint16_t seq,
                             const uint8_t *data, uint8_t len)
{
    (void)ctx; (void)seq; (void)data; (void)len;
    led_toggle(0x02);          /* LED2 每包闪烁一次 */
    return AB_ERR_OK;
}

static void file_on_done(AbFileCtx_t *ctx)
{
    led_write(0x01, LED_OFF);  /* LED1 灭：传输完成 */
    led_write(0x02, LED_ON);   /* LED2 常亮 3s 表示成功 */
    g_file_done_tick = HAL_GetTick();
    g_file_done_flag = 1;

    /* 上报已接收的字节数 */
    uint32_t n = ctx->written_bytes;
    uint8_t  rsp[4] = {
        (uint8_t)(n >> 24), (uint8_t)(n >> 16),
        (uint8_t)(n >>  8), (uint8_t)(n)
    };
    ActionBus_Report(0x10, rsp, 4);
}

static void file_on_abort(AbFileCtx_t *ctx)
{
    (void)ctx;
    led_write(0x03, LED_OFF);
    g_file_done_flag = 0;
}

/* ============================================================
   0x20  Echo 回环
   原样回传 data，SW=0 关闭
   ============================================================ */
static uint8_t cb_echo(const AbFrame_t *f, void *ctx)
{
    (void)ctx;
    if (!(f->stat & AB_STAT_SW)) {
        ActionBus_TaskClose(0x20);
        return AB_ERR_OK;
    }
    ActionBus_Report(0x20, f->data, f->len);
    return AB_ERR_OK;
}

/* ============================================================
   公共 API
   ============================================================ */

void TestTasks_Init(void)
{
    static const uint8_t dev_id[] = { 0xAB, 0x07, 0x04, 0x01, 0x01 };
    ActionBus_SetDeviceId(dev_id, 5);
    ActionBus_SetDeviceAddress(0x01);
    ActionBus_SetUptimeCallback(HAL_GetTick);

    ActionBus_Register(0x01, "LED Control",           cb_led_ctrl,   NULL);
    ActionBus_Register(0x02, "LED Blink Subscribe",   cb_led_blink,  &g_led_blink);
    ActionBus_Register(0x0A, "Temperature Subscribe", cb_temp_sub,   &g_temp_sub);
    ActionBus_Register(0x0B, "IMU Attitude Subscribe",cb_imu_sub,    &g_imu_sub);
    ActionBus_Register(0x0C, "ADC Channel Read",      cb_adc_read,   NULL);
    ActionBus_Register(0x0D, "Device Status",         cb_dev_status, NULL);
    ActionBus_Register(0x20, "Echo Loopback",         cb_echo,       NULL);

    /* 0x10 由 ab_file 模块接管注册 */
    g_file_ctx.on_ready = file_on_ready;
    g_file_ctx.on_data  = file_on_data;
    g_file_ctx.on_done  = file_on_done;
    g_file_ctx.on_abort = file_on_abort;
    AbFile_Register(&g_file_ctx, 0x10);
}

void TestTasks_Loop(void)
{
    uint32_t now = HAL_GetTick();

    /* --- 0x02 LED 闪烁 --- */
    if (g_led_blink.active &&
        (now - g_led_blink.last_tick >= g_led_blink.interval_ms)) {
        g_led_blink.last_tick = now;
        led_toggle(g_led_blink.mask);
    }

    /* --- 0x0A 温度周期上报 --- */
    if (g_temp_sub.active &&
        (now - g_temp_sub.last_tick >= g_temp_sub.interval_ms)) {
        g_temp_sub.last_tick = now;
        int16_t t   = sim_temp_c100();
        uint8_t rsp[2] = { (uint8_t)((uint16_t)t >> 8), (uint8_t)((uint16_t)t & 0xFF) };
        ActionBus_Report(0x0A, rsp, 2);
    }

    /* --- 0x0B IMU 周期上报 --- */
    if (g_imu_sub.active &&
        (now - g_imu_sub.last_tick >= g_imu_sub.interval_ms)) {
        g_imu_sub.last_tick = now;
        int16_t roll  = sim_roll_100();
        int16_t pitch = sim_pitch_100();
        int16_t yaw   = sim_yaw_100();
        uint8_t rsp[6] = {
            (uint8_t)((uint16_t)roll  >> 8), (uint8_t)((uint16_t)roll  & 0xFF),
            (uint8_t)((uint16_t)pitch >> 8), (uint8_t)((uint16_t)pitch & 0xFF),
            (uint8_t)((uint16_t)yaw   >> 8), (uint8_t)((uint16_t)yaw   & 0xFF),
        };
        ActionBus_Report(0x0B, rsp, 6);
    }

    /* --- 0x10 文件传输完成后 LED2 亮 3s 自动灭 --- */
    if (g_file_done_flag && (now - g_file_done_tick >= 3000)) {
        g_file_done_flag = 0;
        led_write(0x02, LED_OFF);
    }
}
