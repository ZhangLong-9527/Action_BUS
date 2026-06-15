/**
 * ActionBus v3.0 嵌入式通信协议库实现
 *
 * CRC-16/MODBUS: 多项式0x8005, 初值0xFFFF, 大端序
 */

#include "actionbus.h"

/*=============================================*/
/* CRC-16 查表法实现                              */
/*=============================================*/

static const uint16_t crc16_table[256] = {
    0x0000, 0xC0C1, 0xC181, 0x0140, 0xC301, 0x03C0, 0x0280, 0xC241,
    0xC601, 0x06C0, 0x0780, 0xC741, 0x0500, 0xC5C1, 0xC481, 0x0440,
    0xCC01, 0x0CC0, 0x0D80, 0xCD41, 0x0F00, 0xCFC1, 0xCE81, 0x0E40,
    0x0A00, 0xCAC1, 0xCB81, 0x0B40, 0xC901, 0x09C0, 0x0880, 0xC841,
    0xD801, 0x18C0, 0x1980, 0xD941, 0x1B00, 0xDBC1, 0xDA81, 0x1A40,
    0x1E00, 0xDEC1, 0xDF81, 0x1F40, 0xDD01, 0x1DC0, 0x1C80, 0xDC41,
    0x1400, 0xD4C1, 0xD581, 0x1540, 0xD701, 0x17C0, 0x1680, 0xD641,
    0xD201, 0x12C0, 0x1380, 0xD341, 0x1100, 0xD1C1, 0xD081, 0x1040,
    0xF001, 0x30C0, 0x3180, 0xF141, 0x3300, 0xF3C1, 0xF281, 0x3240,
    0x3600, 0xF6C1, 0xF781, 0x3740, 0xF501, 0x35C0, 0x3480, 0xF441,
    0x3C00, 0xFCC1, 0xFD81, 0x3D40, 0xFF01, 0x3FC0, 0x3E80, 0xFE41,
    0xFA01, 0x3AC0, 0x3B80, 0xFB41, 0x3900, 0xF9C1, 0xF881, 0x3840,
    0x2800, 0xE8C1, 0xE981, 0x2940, 0xEB01, 0x2BC0, 0x2A80, 0xEA41,
    0xEE01, 0x2EC0, 0x2F80, 0xEF41, 0x2D00, 0xEDC1, 0xEC81, 0x2C40,
    0xE401, 0x24C0, 0x2580, 0xE541, 0x2700, 0xE7C1, 0xE681, 0x2640,
    0x2200, 0xE2C1, 0xE381, 0x2340, 0xE101, 0x21C0, 0x2080, 0xE041,
    0xA001, 0x60C0, 0x6180, 0xA141, 0x6300, 0xA3C1, 0xA281, 0x6240,
    0x6600, 0xA6C1, 0xA781, 0x6740, 0xA501, 0x65C0, 0x6480, 0xA441,
    0x6C00, 0xACC1, 0xAD81, 0x6D40, 0xAF01, 0x6FC0, 0x6E80, 0xAE41,
    0xAA01, 0x6AC0, 0x6B80, 0xAB41, 0x6900, 0xA9C1, 0xA881, 0x6840,
    0x7800, 0xB8C1, 0xB981, 0x7940, 0xBB01, 0x7BC0, 0x7A80, 0xBA41,
    0xBE01, 0x7EC0, 0x7F80, 0xBF41, 0x7D00, 0xBDC1, 0xBC81, 0x7C40,
    0xB401, 0x74C0, 0x7580, 0xB541, 0x7700, 0xB7C1, 0xB681, 0x7640,
    0x7200, 0xB2C1, 0xB381, 0x7340, 0xB101, 0x71C0, 0x7080, 0xB041,
    0x5000, 0x90C1, 0x9181, 0x5140, 0x9301, 0x53C0, 0x5280, 0x9241,
    0x9601, 0x56C0, 0x5780, 0x9741, 0x5500, 0x95C1, 0x9481, 0x5440,
    0x9C01, 0x5CC0, 0x5D80, 0x9D41, 0x5F00, 0x9FC1, 0x9E81, 0x5E40,
    0x5A00, 0x9AC1, 0x9B81, 0x5B40, 0x9901, 0x59C0, 0x5880, 0x9841,
    0x8801, 0x48C0, 0x4980, 0x8941, 0x4B00, 0x8BC1, 0x8A81, 0x4A40,
    0x4E00, 0x8EC1, 0x8F81, 0x4F40, 0x8D01, 0x4DC0, 0x4C80, 0x8C41,
    0x4400, 0x84C1, 0x8581, 0x4540, 0x8701, 0x47C0, 0x4680, 0x8641,
    0x8201, 0x42C0, 0x4380, 0x8341, 0x4100, 0x81C1, 0x8081, 0x4040,
};

static uint16_t crc16_update(uint16_t crc, const uint8_t *data, size_t length)
{
    for (size_t i = 0; i < length; i++) {
        crc = (uint16_t)((crc >> 8) ^ crc16_table[(crc ^ data[i]) & 0xFF]);
    }
    return crc;
}

uint16_t ActionBus_CRC16(const uint8_t *data, size_t length)
{
    return crc16_update(0xFFFFu, data, length);
}

uint16_t ActionBus_CRC16_Update(uint16_t crc, const uint8_t *data, size_t length)
{
    return crc16_update(crc, data, length);
}

/*=============================================*/
/* 内部状态与注册表                               */
/*=============================================*/

#define AB_MAX_HANDLERS 32

/*
 * 注册表按 func_code 升序紧密排列，前 g_handler_count 项有效。
 * Register() 以插入排序维护顺序，避免 GetRegisteredEntry/List 时的大栈拷贝。
 */
static AbHandlerEntry_t g_handlers[AB_MAX_HANDLERS];
static uint8_t g_handler_count = 0;

/* 解析状态机 */
static AbParseState_t g_parse_state = AB_PARSE_WAIT_HEAD_H;
static AbFrame_t g_rx_frame;
static uint16_t g_rx_crc = 0;
static uint16_t g_rx_data_idx = 0;  /* uint16_t: 最大值261，uint8_t会在len≥250时溢出 */

/* 帧完成标志 */
static volatile uint8_t g_frame_ready = 0;

/* 发送缓冲 (最大263字节) */
static uint8_t g_tx_buf[AB_FRAME_MAX_SIZE];
static uint16_t g_tx_len = 0;

/*
 * 底层发送函数指针。
 * Init() 不清除此值，避免用户必须在每次 Init 后重新注册。
 */
static ActionBus_SendBytes_t g_send_bytes = NULL;

static uint8_t g_device_addr = 0x01;
static uint8_t g_tx_addr = 0x01;

/* 设备ID，最多5字节，Init() 不重置 */
static uint8_t g_device_id[5] = {0x00, 0x00, 0x00, 0x01, 0x01};
static uint8_t g_device_id_len = 5;

/* 运行时间回调，Init() 不重置 */
static ActionBus_GetUptime_t g_get_uptime = NULL;

void ActionBus_SetSendCallback(ActionBus_SendBytes_t send_fn)
{
    g_send_bytes = send_fn;
}

void ActionBus_SetDeviceId(const uint8_t *id, uint8_t len)
{
    if (!id || len == 0 || len > 5) return;
    for (uint8_t i = 0; i < len; i++) {
        g_device_id[i] = id[i];
    }
    g_device_id_len = len;
}

void ActionBus_SetUptimeCallback(ActionBus_GetUptime_t cb)
{
    g_get_uptime = cb;
}

/*=============================================*/
/* 注册表管理                                    */
/*=============================================*/

void ActionBus_Init(void)
{
    g_handler_count = 0;
    g_parse_state = AB_PARSE_WAIT_HEAD_H;
    g_frame_ready = 0;
    g_rx_data_idx = 0;

    for (int i = 0; i < AB_MAX_HANDLERS; i++) {
        g_handlers[i].registered = 0;
        g_handlers[i].func_code = 0;
        g_handlers[i].callback = NULL;
        g_handlers[i].context = NULL;
        g_handlers[i].desc[0] = '\0';
    }
}

uint8_t ActionBus_Register(uint8_t func_code, const char *desc,
                            ActionCallback_t callback, void *context)
{
    if (func_code < 0x01 || func_code > AB_FUNCCODE_USER_MAX) {
        return AB_ERR_INVALID_PARAMETER;
    }

    /* 重复检查（表已有序，可提前退出） */
    for (int i = 0; i < g_handler_count; i++) {
        if (g_handlers[i].func_code == func_code) {
            return AB_ERR_INVALID_PARAMETER;
        }
        if (g_handlers[i].func_code > func_code) {
            break;
        }
    }

    if (g_handler_count >= AB_MAX_HANDLERS) {
        return AB_ERR_INTERNAL;
    }

    /* 找到有序插入位置 */
    int insert_at = g_handler_count;
    for (int i = 0; i < g_handler_count; i++) {
        if (g_handlers[i].func_code > func_code) {
            insert_at = i;
            break;
        }
    }

    /* 向右移动腾出一个槽位 */
    for (int i = g_handler_count; i > insert_at; i--) {
        g_handlers[i] = g_handlers[i - 1];
    }

    /* 填充注册项 */
    g_handlers[insert_at].func_code = func_code;
    g_handlers[insert_at].callback = callback;
    g_handlers[insert_at].context = context;
    g_handlers[insert_at].registered = 1;

    if (desc) {
        size_t dlen = 0;
        while (desc[dlen] && dlen < sizeof(g_handlers[insert_at].desc) - 1) {
            g_handlers[insert_at].desc[dlen] = desc[dlen];
            dlen++;
        }
        g_handlers[insert_at].desc[dlen] = '\0';
    } else {
        g_handlers[insert_at].desc[0] = '\0';
    }

    g_handler_count++;
    return AB_ERR_OK;
}

uint8_t ActionBus_IsRegistered(uint8_t func_code)
{
    for (int i = 0; i < g_handler_count; i++) {
        if (g_handlers[i].func_code == func_code) {
            return 1;
        }
        if (g_handlers[i].func_code > func_code) {
            break;
        }
    }
    return 0;
}

uint8_t ActionBus_GetRegisteredList(uint8_t *codes, uint8_t max_codes)
{
    uint8_t count = 0;
    for (int i = 0; i < g_handler_count && count < max_codes; i++) {
        codes[count++] = g_handlers[i].func_code;
    }
    return count;
}

uint8_t ActionBus_GetRegisteredEntry(uint8_t index, uint8_t *func_code,
                                      char *desc_buf, uint8_t desc_buf_size)
{
    if (index >= g_handler_count) {
        return AB_ERR_INVALID_PARAMETER;
    }
    if (func_code) {
        *func_code = g_handlers[index].func_code;
    }
    if (desc_buf && desc_buf_size > 0) {
        size_t i = 0;
        const char *src = g_handlers[index].desc;
        while (src[i] && i < (size_t)desc_buf_size - 1) {
            desc_buf[i] = src[i];
            i++;
        }
        desc_buf[i] = '\0';
    }
    return AB_ERR_OK;
}

void ActionBus_SetDeviceAddress(uint8_t addr)
{
    if (addr <= 0xFE) {
        g_device_addr = addr;
        g_tx_addr = addr;
    }
}

uint8_t ActionBus_GetDeviceAddress(void)
{
    return g_device_addr;
}

/*=============================================*/
/* 发送接口                                      */
/*=============================================*/

uint8_t ActionBus_Send_Frame(uint8_t func_code, uint8_t stat,
                              const uint8_t *data, uint8_t len)
{
    uint16_t idx = 0;
    g_tx_buf[idx++] = AB_FRAME_HEAD_H;
    g_tx_buf[idx++] = AB_FRAME_HEAD_L;
    g_tx_buf[idx++] = g_tx_addr;
    g_tx_buf[idx++] = func_code;
    g_tx_buf[idx++] = stat;
    g_tx_buf[idx++] = len;

    for (uint8_t i = 0; i < len; i++) {
        g_tx_buf[idx++] = data[i];
    }

    /* CRC 覆盖范围：从 Addr 到最后一个数据字节（不含 AA 55 帧头） */
    uint16_t crc = ActionBus_CRC16(g_tx_buf + 2, idx - 2);
    g_tx_buf[idx++] = (uint8_t)(crc >> 8);
    g_tx_buf[idx++] = (uint8_t)(crc & 0xFF);

    g_tx_len = idx;

    if (g_send_bytes) {
        g_send_bytes(g_tx_buf, g_tx_len);
    }

    return AB_ERR_OK;
}

uint8_t ActionBus_Report(uint8_t func_code, const uint8_t *data, uint8_t len)
{
    return ActionBus_Send_Frame(func_code, AB_STAT_SLAVE_ON, data, len);
}

uint8_t ActionBus_Send_Error(uint8_t func_code, uint8_t err_code,
                              const uint8_t *extra_data, uint8_t extra_len)
{
    /* static 避免在 MCU 栈上分配 255 字节 */
    static uint8_t buf[255];
    buf[0] = err_code;

    uint8_t total = 1;
    if (extra_data && extra_len > 0 && extra_len < 255) {
        for (uint8_t i = 0; i < extra_len && total < 255; i++) {
            buf[total++] = extra_data[i];
        }
    }

    return ActionBus_Send_Frame(func_code, AB_STAT_SLAVE_ERR, buf, total);
}

/*=============================================*/
/* 任务关闭                                      */
/*=============================================*/

void ActionBus_TaskClose(uint8_t func_code)
{
    ActionBus_Send_Frame(func_code, AB_STAT_SLAVE_OFF, NULL, 0);
}

/*=============================================*/
/* 接收状态机                                    */
/*=============================================*/

void ActionBus_RxHandler(uint8_t byte)
{
    g_rx_frame.raw[g_rx_data_idx < AB_FRAME_MAX_SIZE ? g_rx_data_idx : 0] = byte;

    switch (g_parse_state) {
        case AB_PARSE_WAIT_HEAD_H:
            if (byte == AB_FRAME_HEAD_H) {
                g_parse_state = AB_PARSE_WAIT_HEAD_L;
                g_rx_data_idx = 1;
            }
            break;

        case AB_PARSE_WAIT_HEAD_L:
            if (byte == AB_FRAME_HEAD_L) {
                g_parse_state = AB_PARSE_WAIT_ADDR;
                g_rx_data_idx = 2;
            } else {
                g_parse_state = AB_PARSE_WAIT_HEAD_H;
                g_rx_data_idx = 0;
            }
            break;

        case AB_PARSE_WAIT_ADDR:
            g_rx_frame.addr = byte;
            g_parse_state = AB_PARSE_WAIT_FUNC;
            g_rx_data_idx = 3;
            break;

        case AB_PARSE_WAIT_FUNC:
            g_rx_frame.func_code = byte;
            g_parse_state = AB_PARSE_WAIT_STAT;
            g_rx_data_idx = 4;
            break;

        case AB_PARSE_WAIT_STAT:
            g_rx_frame.stat = byte;
            g_parse_state = AB_PARSE_WAIT_LEN;
            g_rx_data_idx = 5;
            break;

        case AB_PARSE_WAIT_LEN:
            g_rx_frame.len = byte;
            g_rx_data_idx = 6;
            if (g_rx_frame.len > 0) {
                g_parse_state = AB_PARSE_WAIT_DATA;
            } else {
                g_parse_state = AB_PARSE_WAIT_CRC_H;
            }
            break;

        case AB_PARSE_WAIT_DATA:
            g_rx_frame.data[g_rx_data_idx - 6] = byte;
            g_rx_data_idx++;
            if ((g_rx_data_idx - 6) >= g_rx_frame.len) {
                g_parse_state = AB_PARSE_WAIT_CRC_H;
            }
            break;

        case AB_PARSE_WAIT_CRC_H:
            g_rx_crc = (uint16_t)byte << 8;
            g_parse_state = AB_PARSE_WAIT_CRC_L;
            break;

        case AB_PARSE_WAIT_CRC_L:
            g_rx_crc |= byte;
            g_rx_data_idx++;

            {
                /* CRC 覆盖范围：raw[2..] 即从 Addr 开始，不含 AA 55 帧头 */
                uint16_t calc_crc = ActionBus_CRC16(g_rx_frame.raw + 2, 4 + g_rx_frame.len);
                if (g_rx_crc == calc_crc) {
                    g_rx_frame.crc = g_rx_crc;   /* 修复：将接收到的 CRC 写回帧结构 */
                    g_frame_ready = 1;
                }
                /* CRC 错误则静默丢弃 */
            }

            g_parse_state = AB_PARSE_WAIT_HEAD_H;
            g_rx_data_idx = 0;
            break;
    }
}

uint8_t ActionBus_HasFrame(void)
{
    return g_frame_ready;
}

const AbFrame_t *ActionBus_GetFrame(void)
{
    g_frame_ready = 0;
    return &g_rx_frame;
}

/*=============================================*/
/* 主循环轮询                                    */
/*=============================================*/

static void handle_query(const AbFrame_t *frame)
{
    if (frame->len < 1) {
        ActionBus_Send_Error(AB_FUNC_QUERY, AB_ERR_LEN_OR_PAYLOAD, NULL, 0);
        return;
    }

    uint8_t sub = frame->data[0];
    uint8_t rsp[8];
    uint8_t rsp_len = 0;

    switch (sub) {
    case AB_QUERY_GET_PROTOCOL_VERSION:
        rsp[0] = AB_PROTOCOL_MAJOR;
        rsp[1] = AB_PROTOCOL_MINOR;
        rsp_len = 2;
        break;
    case AB_QUERY_GET_DEVICE_ID:
        for (uint8_t i = 0; i < g_device_id_len; i++) {
            rsp[i] = g_device_id[i];
        }
        rsp_len = g_device_id_len;
        break;
    case AB_QUERY_GET_ACTION_COUNT:
        rsp[0] = g_handler_count;
        rsp_len = 1;
        break;
    case AB_QUERY_GET_UPTIME_MS: {
        uint32_t uptime = g_get_uptime ? g_get_uptime() : 0;
        rsp[0] = (uint8_t)(uptime >> 24);
        rsp[1] = (uint8_t)(uptime >> 16);
        rsp[2] = (uint8_t)(uptime >> 8);
        rsp[3] = (uint8_t)(uptime);
        rsp_len = 4;
        break;
    }
    case AB_QUERY_GET_BUS_ADDRESS:
        rsp[0] = g_device_addr;
        rsp_len = 1;
        break;
    default:
        ActionBus_Send_Error(AB_FUNC_QUERY, AB_ERR_NOT_SUPPORTED, NULL, 0);
        return;
    }

    ActionBus_Send_Frame(AB_FUNC_QUERY, AB_STAT_SLAVE_OFF, rsp, rsp_len);
}

static void handle_action_desc(const AbFrame_t *frame)
{
    if (frame->len < 1) {
        ActionBus_Send_Error(AB_FUNC_ACTION_DESC, AB_ERR_LEN_OR_PAYLOAD, NULL, 0);
        return;
    }

    uint8_t sub = frame->data[0];

    if (sub == AB_DESC_SCHEMA_VERSION_CMD) {
        uint8_t v = AB_DESC_SCHEMA_VER;
        ActionBus_Send_Frame(AB_FUNC_ACTION_DESC, AB_STAT_SLAVE_OFF, &v, 1);
        return;
    }

    if (sub == AB_DESC_GET_ENTRY) {
        if (frame->len < 2) {
            ActionBus_Send_Error(AB_FUNC_ACTION_DESC, AB_ERR_LEN_OR_PAYLOAD, NULL, 0);
            return;
        }
        uint8_t index = frame->data[1];
        uint8_t func_code = 0;
        char desc[128];
        uint8_t err = ActionBus_GetRegisteredEntry(index, &func_code, desc, sizeof(desc));
        if (err != AB_ERR_OK) {
            ActionBus_Send_Error(AB_FUNC_ACTION_DESC, err, NULL, 0);
            return;
        }

        uint8_t buf[2 + 127];
        size_t dlen = 0;
        while (desc[dlen] && dlen < 127) {
            dlen++;
        }
        buf[0] = func_code;
        buf[1] = (uint8_t)dlen;
        for (size_t i = 0; i < dlen; i++) {
            buf[2 + i] = (uint8_t)desc[i];
        }
        ActionBus_Send_Frame(AB_FUNC_ACTION_DESC, AB_STAT_SLAVE_OFF, buf, (uint8_t)(2 + dlen));
        return;
    }

    ActionBus_Send_Error(AB_FUNC_ACTION_DESC, AB_ERR_NOT_SUPPORTED, NULL, 0);
}

static void dispatch_user_frame(const AbFrame_t *frame)
{
    for (int i = 0; i < g_handler_count; i++) {
        if (g_handlers[i].func_code == frame->func_code) {
            uint8_t ret = g_handlers[i].callback(frame, g_handlers[i].context);
            if (ret != AB_ERR_OK) {
                ActionBus_Send_Error(frame->func_code, ret, NULL, 0);
            }
            return;
        }
        if (g_handlers[i].func_code > frame->func_code) {
            break;
        }
    }

    if (frame->stat & AB_STAT_DIR) {
        ActionBus_Send_Error(frame->func_code, AB_ERR_NOT_SUPPORTED, NULL, 0);
    }
}

void ActionBus_ProcessPending(void)
{
    if (!ActionBus_HasFrame()) {
        return;
    }

    const AbFrame_t *frame = ActionBus_GetFrame();

    if (frame->addr != g_device_addr && frame->addr != AB_ADDR_BROADCAST) {
        return;
    }

    g_tx_addr = (frame->addr == AB_ADDR_BROADCAST) ? g_device_addr : frame->addr;

    if (!(frame->stat & AB_STAT_DIR)) {
        return;
    }

    if (frame->stat & AB_STAT_ERR) {
        return;
    }

    switch (frame->func_code) {
    case AB_FUNC_QUERY:
        handle_query(frame);
        return;
    case AB_FUNC_ACTION_DESC:
        handle_action_desc(frame);
        return;
    default:
        break;
    }

    dispatch_user_frame(frame);
}

void ActionBus_Poll(uint8_t func_code)
{
    if (!ActionBus_HasFrame()) {
        return;
    }

    const AbFrame_t *frame = ActionBus_GetFrame();
    if (frame->func_code != func_code) {
        return;
    }

    if (frame->addr != g_device_addr && frame->addr != AB_ADDR_BROADCAST) {
        return;
    }

    g_tx_addr = (frame->addr == AB_ADDR_BROADCAST) ? g_device_addr : frame->addr;

    /* 与 ProcessPending 保持一致：忽略从机发出或带错误标志的帧 */
    if (!(frame->stat & AB_STAT_DIR) || (frame->stat & AB_STAT_ERR)) {
        return;
    }

    if (frame->func_code == AB_FUNC_QUERY) {
        handle_query(frame);
    } else if (frame->func_code == AB_FUNC_ACTION_DESC) {
        handle_action_desc(frame);
    } else {
        dispatch_user_frame(frame);
    }
}
