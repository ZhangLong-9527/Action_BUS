/**
 * ActionBus v3.1 测试任务注册表
 *
 * 功能码清单：
 *   0x01  LED 控制         — 单次，设置 LED1/2 亮灭
 *   0x02  LED 闪烁订阅     — 订阅，指定掩码+间隔持续闪烁，SW=0 停止
 *   0x0A  温度上报订阅     — 订阅，模拟 25°C 基础温度，周期上报
 *   0x0B  IMU 姿态订阅    — 订阅，模拟 Roll/Pitch/Yaw，周期上报
 *   0x0C  ADC 单次读取    — 单次，模拟 0-3 通道 12bit ADC
 *   0x0D  设备状态查询    — 单次，返回运行时间、CPU温度、活跃任务数
 *   0x10  文件接收        — 文件传输（ab_file 协议），LED 可视进度
 *   0x20  Echo 回环测试   — 原样回传 data，用于链路连通性验证
 */

#ifndef TEST_TASKS_H
#define TEST_TASKS_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* 初始化并注册全部测试功能码 */
void TestTasks_Init(void);

/* 放入 main() while(1) 中，驱动定时任务 */
void TestTasks_Loop(void);

#ifdef __cplusplus
}
#endif

#endif /* TEST_TASKS_H */
