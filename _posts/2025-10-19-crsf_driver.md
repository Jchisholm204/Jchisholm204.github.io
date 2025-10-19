---
title: Embedded CRSF Driver
date: 2025-10-19
categories: [Firmware]
tags: [STM32, CMake, FreeRTOS]
author: Jacob
---
## Introduction
CRSF (CrossFire) is a high level communication protocol developed by Team Black Sheep (TBS) for transmitting control and telemetry data between a receiver and Flight Controller (FC).
Originally intended for use in TBS devices, the protocol is now implemented in nearly every FC firmware and is used by most off-the-shelf receivers including ExpressLRS and Tracer.


This article will first present an overview of the CRSF protocol, followed by a FreeRTOS compatible implementation based on my own [UART Driver](https://jchisholm204.github.io/posts/freertos_uart/).

## CRSF Protocol Basics
The CRSF protocol supports high speed, low latency communication for both control and telemetry data.
In addition to the several predefined messages, CRSF also supports custom messages with arbitrary data.
However this article will focus on only the base set of messages used for stick commands and telemetry that have already been implemented in the INAV firmware.

### CRSF Packet Framing
The basic structure of each CRSF frame is the same.
It consists of an address, length, type, payload and CRC.

```
<address> <length> <type> <payload ... > <CRC>
```

The address, length, type and CRC and all one byte.
The payload can range from 2 to 62 bytes to accommodate various message formats.

### CRSF Device Address
The device address field, referred to as "address" in the previous section, is largely undocumented.
In researching the protocol, the only documentation found was the following list of device addresses:

| Address | Device Description               |
|----------|----------------------------------|
| 0x00     | Broadcast address                |
| 0x10     | USB Device                       |
| 0x12     | Bluetooth Module                 |
| 0x80     | TBS CORE PNP PRO                 |
| 0x8A     | Reserved                         |
| 0xC0     | PNP PRO digital current sensor   |
| 0xC2     | PNP PRO GPS                      |
| 0xC4     | TBS Blackbox                     |
| 0xC8     | Flight controller                |
| 0xCA     | Reserved                         |
| 0xCC     | Race tag                         |
| 0xEA     | Radio Transmitter                |
| 0xEB     | Reserved                         |
| 0xEC     | Crossfire / UHF receiver         |
| 0xEE     | Crossfire transmitter            |

Regardless, the only device address needed for communicating with a flight controller is `0xC8`.
Both messages received and transmitted to the FC must be prefixed with this address.

### CRSF Message Types
The CRSF protocol can be used for both control and telemetry. 
The following section outlines the base message types used by INAV and Betaflight.
Custom message types can be used, but require implementation on the FC side.

> **NOTE**
> The number next to the each message is its ID.
{:.prompt-tip}

#### RC Message (`0x16`)
The Remote Control (RC) message can be used to transmit stick commands from a device or receiver to the flight controller.
The RC message supports up to 16 RC channels.
Each channel is 11 bits and the 16 channels are packed into a 22 byte format.
The message format is shown below:

```c
struct rc_channels_msg{
	unsigned int chnl1 : 11;
	unsigned int chnl2 : 11;
	unsigned int chnl3 : 11;
	...
	unsigned int chnl16 : 11;
};
```

Many receivers and FC firmware's represent channels using $\mu$s.
CRSF however, uses ticks.
Therefore the following functions must be used to convert between the two measurements.

```c
TICKS_TO_US(x) ((x - 992) * 5 / 8 + 1500) 
US_TO_TICKS(x) ((x - 1500) * 8 / 5 + 992)
```


#### Link Statistics Message (`0x14`)
The link statistics message contains status information for the link between the receiver and the transmitter.
Uplink is the connection between the ground and UAV, downlink is the connection from the UAV to the ground station.

```c
struct __attribute__((packed)) {
    // dBm *-1
    uint8_t uplink_RSSI_1;
    // dBm *-1
    uint8_t uplink_RSSI_2;
    // percent
    uint8_t uplink_quality;
    // uplink SNR (db)
    int8_t uplink_SNR;
    // enum ant 1 = 0, 2
    uint8_t diversity_active_antenna;
    // enum Mode (4fps = 0, 50fps, 150Hz)
    uint8_t RF_mode;
    // enum (0mW, 10mW, 25mW, 100mW, 500mW, 1000mW, 2000mW)
    uint8_t tx_power;
    // dBm * -1
    uint8_t downlink_RSSI;
    // percent
    uint8_t downlink_quality;
    // db
    int8_t downlink_SNR;
} _crsf_link_t;
```

#### Battery Status Message (`0x08`)
The battery status message contains exactly the information one would expect.
Its format is as follows:

```c
typedef struct __attribute__((packed)) {
    // mV * 100
    uint16_t voltage;
    // mA * 100
    uint16_t current;
    // mAh (24 bits)
    unsigned int capacity : 24;
    // percent (0-100]
    uint8_t percent_remaining;
} _crsf_battery_t;
```

#### Flight Mode Message (`0x21`)
The flight mode message contains a null terminated string indicating the current flight mode of the FC.
This field is FC firmware dependent.
For Betaflight, the possible strings are covered under the [Betaflight CRSF Documentation.](https://www.betaflight.com/docs/wiki/guides/current/Telemetry#crossfire-protocol--crsf)

The message format is as follows:
```c
struct crsf_fcmode {
    char mode[];
};
```

#### Attitude Message (`0x1E`)
The attitude message contains the current pitch, yaw, and roll values from the flight controllers IMU.
All angles are represented in integer format, in $\frac{\text{radians}}{10,000}$.

```c
struct crsf_attitude_t{
    int16_t pitch;
    int16_t roll;
    int16_t yaw;
};
```

#### GPS Message (`0x02`)
Finally, the GPS message contains the current GPS information, if the drone has one.
The GPS message format is as follows:

```c
struct crsf_gps {
    // degrees / 10_000_000
    int32_t lattitude;
    // degrees / 10_000_000
    int32_t longitude;
    // km/h / 100
    uint16_t groundspeed;
    // degree / 100
    uint16_t heading;
    // meter - 1000m offset
    uint16_t altitude;
    uint8_t sat_count;
};
```

### CRSF CRC
Each CRSF packet contains a CRC value computed on the type and payload of each frame.
The CRC does NOT include the length or address bytes.
The following is an implementation of the CRSF CRC calculation from the TBS documentation:
```c
unsigned char crc8tab[256] = {
	0x00, 0xD5, 0x7F, 0xAA, 0xFE, 0x2B, 0x81, 0x54, 0x29, 0xFC, 0x56, 0x83, 0xD7, 0x02, 0xA8, 0x7D,
	0x52, 0x87, 0x2D, 0xF8, 0xAC, 0x79, 0xD3, 0x06, 0x7B, 0xAE, 0x04, 0xD1, 0x85, 0x50, 0xFA, 0x2F,
	0xA4, 0x71, 0xDB, 0x0E, 0x5A, 0x8F, 0x25, 0xF0, 0x8D, 0x58, 0xF2, 0x27, 0x73, 0xA6, 0x0C, 0xD9,
	0xF6, 0x23, 0x89, 0x5C, 0x08, 0xDD, 0x77, 0xA2, 0xDF, 0x0A, 0xA0, 0x75, 0x21, 0xF4, 0x5E, 0x8B,
	0x9D, 0x48, 0xE2, 0x37, 0x63, 0xB6, 0x1C, 0xC9, 0xB4, 0x61, 0xCB, 0x1E, 0x4A, 0x9F, 0x35, 0xE0,
	0xCF, 0x1A, 0xB0, 0x65, 0x31, 0xE4, 0x4E, 0x9B, 0xE6, 0x33, 0x99, 0x4C, 0x18, 0xCD, 0x67, 0xB2,
	0x39, 0xEC, 0x46, 0x93, 0xC7, 0x12, 0xB8, 0x6D, 0x10, 0xC5, 0x6F, 0xBA, 0xEE, 0x3B, 0x91, 0x44,
	0x6B, 0xBE, 0x14, 0xC1, 0x95, 0x40, 0xEA, 0x3F, 0x42, 0x97, 0x3D, 0xE8, 0xBC, 0x69, 0xC3, 0x16,
	0xEF, 0x3A, 0x90, 0x45, 0x11, 0xC4, 0x6E, 0xBB, 0xC6, 0x13, 0xB9, 0x6C, 0x38, 0xED, 0x47, 0x92,
	0xBD, 0x68, 0xC2, 0x17, 0x43, 0x96, 0x3C, 0xE9, 0x94, 0x41, 0xEB, 0x3E, 0x6A, 0xBF, 0x15, 0xC0,
	0x4B, 0x9E, 0x34, 0xE1, 0xB5, 0x60, 0xCA, 0x1F, 0x62, 0xB7, 0x1D, 0xC8, 0x9C, 0x49, 0xE3, 0x36,
	0x19, 0xCC, 0x66, 0xB3, 0xE7, 0x32, 0x98, 0x4D, 0x30, 0xE5, 0x4F, 0x9A, 0xCE, 0x1B, 0xB1, 0x64,
	0x72, 0xA7, 0x0D, 0xD8, 0x8C, 0x59, 0xF3, 0x26, 0x5B, 0x8E, 0x24, 0xF1, 0xA5, 0x70, 0xDA, 0x0F,
	0x20, 0xF5, 0x5F, 0x8A, 0xDE, 0x0B, 0xA1, 0x74, 0x09, 0xDC, 0x76, 0xA3, 0xF7, 0x22, 0x88, 0x5D,
	0xD6, 0x03, 0xA9, 0x7C, 0x28, 0xFD, 0x57, 0x82, 0xFF, 0x2A, 0x80, 0x55, 0x01, 0xD4, 0x7E, 0xAB,
	0x84, 0x51, 0xFB, 0x2E, 0x7A, 0xAF, 0x05, 0xD0, 0xAD, 0x78, 0xD2, 0x07, 0x53, 0x86, 0x2C, 0xF9
};

uint8_t crc8(const uint8_t * ptr, uint8_t len) {
	uint8_t crc = 0;
	for (uint8_t i=0; i<len; i++) {
		crc = crc8tab[crc ^ *ptr++];
	}
	return crc;
}
```

For those that would like to implement the CRC calculation themselves, the CRC is an 8 bit CRC with the polynomial $x^7+x^6+x^4+x^2+x^0$.

## Implementation
The CRSF protocol can be run over most busses including UART, I2C, and SBUS.
This article will focus in implementing CRSF over UART.

### Setup
The CRSF layer is designed to be an interface between a user task and the [Serial handler](https://github.com/Jchisholm204/Scout/blob/main/src/control_board/firmware/core/include/drivers/serial.h) implemented earlier.
This means that the CRSF layer will need to lock the interfaces transmit function, and implement a Serial receive buffer.

By default, the Serial driver allows any FreeRTOS task to acquire the transmit semaphore and write to the bus.
While this feature can be incredibly useful things like automated `printf` statements through UART, it can hinder communication protocols like CRSF.
Therefore, the Serial driver must be "locked."
While in a locked state, the transmit semaphore can still be acquired by any FreeRTOS task, but only if the task possesses the `LOCK_KEY`.
In the following code snippets, the `CRSF_SERIAL_LOCK` define is used as the `LOCK_KEY`.
This ensures that the transmit semaphore can still be acquired by any task, but only if the semaphore is acquired through the CRSF layer.

In addition to locking the Serial interface, the CRSF layer must also implement its own Serial receive buffer.
As per the Serial drivers specification, the receive buffer's memory and initialisation must live within the CRSF layer.
Upon receiving a new byte, the Serial driver's interrupt function will append the byte to this buffer.
Therefore, the CRSF layer must repeatedly check this buffer for data, and attempt to parse messages from it.

Following with the common theme used in both the CAN and Serial Drivers, the CRSF layer is implemented as a structure that can be operated on by a set of functions.

The following struct is used to hold all information related to the CRSF layer:

```c
typedef struct CRSF {
    Serial_t* pSerial;

    // Task information (Maybe not needed)
    TaskHandle_t tsk_hndl;
    StaticTask_t tsk_buf;
    StackType_t tsk_stack[configMINIMAL_STACK_SIZE];

    // Recieve Buffer (from serial driver interrupt)
    StreamBufferHandle_t rx_hndl;
    StaticStreamBuffer_t rx_streamBuf;
    uint8_t rx_buf[configMINIMAL_STACK_SIZE];

    SemaphoreHandle_t tx_hndl;
    StaticSemaphore_t static_tx_semphr;

    // CRSF Packets
    struct crsf_packets {
        crsf_link_t link;
        crsf_gps_t gps;
        crsf_battery_t batt;
        crsf_rc_t rc;
        crsf_attitude_t att;
        crsf_fcmode_t mode;
    } pkt;
    eCRSFError state;
} CRSF_t;
```

Seen below is the initialisation routine for the above struct:

```c
eCRSFError crsf_init(CRSF_t* pHndl, Serial_t* pSerial, pin_t srx, pin_t stx) {
    if (!pHndl)
        return eCRSFNULL;
    if (!pSerial)
        return eCRSFNULL;
    pHndl->pSerial = pSerial;

    // Check serial state (must be uninit)
    if (pSerial->state != eSerialNoInit)
        return eCRSFInitFail;
    // Initialize the serial interface
    eSerialError se = serial_init(pSerial, CRSF_BAUD, srx, stx);
    if (se != eSerialOK)
        return eCRSFSerialFail;

    // Ensure nothing else can write to the CRSF serial port
    se = serial_lock(pSerial, CRSF_SERIAL_LOCK);
    if (se != eSerialOK)
        return eCRSFSerialFail;

    // Setup the internal stream buffer for Serial interrupts
    pHndl->rx_hndl = xStreamBufferCreateStatic(
        configMINIMAL_STACK_SIZE, 1, pHndl->rx_buf, &pHndl->rx_streamBuf);

    if (!pHndl->rx_hndl) {
        pHndl->state = eCRSFNoPkt;
        return pHndl->state;
    }

    // Setup the read semaphore
    pHndl->tx_hndl = xSemaphoreCreateMutexStatic(&pHndl->static_tx_semphr);
    if (!pHndl->tx_hndl) {
        pHndl->state = eCRSFSemFail;
        return pHndl->state;
    }

    // Setup the CRSF rx task
    pHndl->tsk_hndl = xTaskCreateStatic(vCRSF_Hndl_tsk,
                                        "CRSF",
                                        configMINIMAL_STACK_SIZE,
                                        (void*) pHndl,
                                        configMAX_PRIORITIES - 2,
                                        pHndl->tsk_stack,
                                        &pHndl->tsk_buf);
    if (!pHndl->tsk_hndl) {
        pHndl->state = eCRSFTskCreateFail;
        return pHndl->state;
    }

    se = serial_attach(pSerial, &pHndl->rx_hndl);
    if (se != eSerialOK) {
        pHndl->state = eCRSFSerialFail;
        return pHndl->state;
    }

	pHndl->state = eCRSFOK;
    return eCRSFOK;
}
```

Similarly to both the CAN and Serial layers, the `_init` function first initialises base structure values, followed by semaphores and buffers, and finally the creates a task handle that can be used to associate buffer callbacks.

### Transmitting Frames
The following function utilises the [Serial driver layer](https://github.com/Jchisholm204/Scout/blob/main/src/control_board/firmware/core/include/drivers/serial.h) to transmit arbitrary CRSF payloads after computing their CRC.

```c
#define CRSF_ADDR 0xC8
eCRSFError _crsf_send_packet(Serial_t* pSerial,
                             uint8_t len,
                             enum eCRSFMsgId type,
                             uint8_t* pData) {
    if (!pSerial)
        return eCRSFNULL;
    if (!pData)
        return eCRSFNULL;

    _crsf_msg_t msg;
    // Addr = CRSF Addr FC
    msg.addr = CRSF_ADDR;
    msg.length = len + 2; // type + payload + crc
    msg.type = (uint8_t) type;

    // Copy data from data to payload
    uint8_t i = 0;
    for (; i < len; i++) {
        msg.pyld[i] = pData[i];
    }

    // CRC includes type and payload
    uint8_t crc = _crsf_crc8(&msg.type, len + 1);
    msg.pyld[i] = crc;

    // Transmit message over UART
    eSerialError e;
    // Relies on Serial transmit semaphore
    e = serial_write_locked(
        pSerial, (void*) &msg, msg.length + 2, 10, CRSF_SERIAL_LOCK);
    // Check that the message was transmitted
    if (e != eSerialOK) {
        // Check for semaphore failures
        if (e == eSerialSemphr) {
            return eCRSFSemFail;
        }
        return eCRSFSerialFail;
    }
    return eCRSFOK;
}
```

The `_crsf_msg_t` type is used to simplify the packing and unpacking of CRSF messages.

```c
typedef struct __attribute__((packed)) {
    uint8_t addr;
    uint8_t length;
    uint8_t type;
    uint8_t pyld[CRSF_DATA_MAXLEN+1];
} _crsf_msg_t;
```

It does not contain a CRC field, but rather adds an extra byte to the payload to allow the CRC to be appended in the correct location.

> **Warning**
> This function assumes that the CRSF payload has already been properly formatted.
{: .prompt-warning }

> **Note**
> The message length must be be the length of the message excluding the address and length bytes.
> This includes the length of the payload, plus one byte for the type, and one byte for the CRC.
> The CRC is computed only on the type and payload.
> The full message transmission length includes the address and length portions of the message.
> Therefore, the transmitted length is 2 bytes longer than the message length.
{: .prompt-tip}

### Receiving Frames
To receive CRSF frames over the Serial driver, the CRSF layer reads incoming data byte by byte, checking for the FC ID (`0x0C8`), which indicates the start of a message.
After receiving the FC ID, the next bytes are assumed to be the length, payload and CRC.
Finally, the `_crsf_recv_packet` function is called to verify the packet CRC and unpack message data.

```c
void vCRSF_Hndl_tsk(void* pvParams) {
    if (!pvParams)
        return;
    CRSF_t* pHndl = (CRSF_t*) pvParams;

    _crsf_msg_t rx_msg;
    uint8_t new_byte;
    uint8_t rx_buf[CRSF_DATA_MAXLEN] = {0};
    uint8_t rx_idx = 0;

    for (;;) {
        // MSG RX Logic
        crsf_msg_t valid_msg;

        // Attempt to pull the new byte
        while (xStreamBufferReceive(pHndl->rx_hndl, &new_byte, 1, 0) == 1) {
            rx_buf[rx_idx++] = new_byte;
            if (rx_idx == 1 && new_byte != CRSF_ADDR) {
                rx_idx = 0;
                continue;
            }
            if (rx_idx == 2 && (new_byte < 2 || new_byte > CRSF_DATA_MAXLEN)) {
                rx_idx = 0;
                continue;
            }
            if (rx_idx >= 2 && rx_idx == rx_buf[1] + 2) {
                eCRSFError e = _crsf_recv_packet((void*)&rx_buf, &valid_msg);
                if (e == eCRSFOK) {
                    switch (valid_msg.id) {
                    case CRSFMsgRC:
                        memcpy(&pHndl->pkt.rc,
                               &valid_msg.rc,
                               sizeof(crsf_rc_t));
                        break;
                    case CRSFMsgLinkStat:
                        memcpy(&pHndl->pkt.link,
                               &valid_msg.link,
                               sizeof(crsf_rc_t));
                        break;
                    case CRSFMsgBatt:
                        memcpy(&pHndl->pkt.batt,
                               &valid_msg.batt,
                               sizeof(crsf_rc_t));
                        break;
                    case CRSFMsgFlightMode:
                        memcpy(&pHndl->pkt.mode,
                               &valid_msg.mode,
                               sizeof(crsf_rc_t));
                    case CRSFMsgAtt:
                        memcpy(&pHndl->pkt.mode,
                               &valid_msg.mode,
                               sizeof(crsf_rc_t));
                        break;
                    }
                }
                rx_idx = 0;
            }
        }

        vTaskDelay(5);
    }
}
```

#### Verifying Frames
Above, the internal `_crsf_recv_packet` function is used to verify and unpack received CRSF frames.
Frame verification involves checking that the address and length are valid values, and that the transmitted CRC matches the expected CRC.
The implementation for packet verification is shown below:

```c
eCRSFError _crsf_recv_packet(_crsf_msg_t* pIn, crsf_msg_t* pOut) {
    if (!pIn || !pOut)
        return eCRSFNULL;
    if (pIn->addr != CRSF_ADDR)
        return eCRSFAddrMisMatch;
    if (pIn->length >= CRSF_DATA_MAXLEN)
        return eCRSFNoPkt;

    // Copy prelim fields
    pOut->id = pIn->type;

    // Check Message CRC
    uint8_t crc_check = _crsf_crc8((void*)&pIn->type, pIn->length - 1);
    uint8_t crc_msg = ((uint8_t*)pIn)[pIn->length + 1];
    if (crc_msg != crc_check)
        return eCRSFCRCErr;
    switch ((enum eCRSFMsgId) pIn->type) {
	...
	}
    return eCRSFOK;
}
```

The above function also contains a switch case for transforming the compressed messages into their usable formats.
For example, attitude messages represent radian angles as rad/10000.
However this data is far more useful as a floating point number.
Additionally, the RC message is sent as packed 11 bit integers.
This format is largely unusable in most code, and is therefore exchanged into the more standard format of 16 bit integers.
Given the simplistic nature of this conversion, it is not shown here.


### User Level Interaction
While the above two sections describe how the CRSF layer handles messages internally, the following section presents the user level API for interacting with the CRSF layer.

Before the CRSF layer can be used, it must be initialised by calling the following function:

```c
eCRSFError crsf_init(CRSF_t* pHndl, Serial_t* pSerial, pin_t srx, pin_t stx);
```

> **Warning**
> The Serial handle passed to the above function must be uninitialised.
> If it is not uninitialised,  `eCRSFInitFail` will be returned.
{:.prompt-warning}

The following functions are available for use by a user level task:

```c
eCRSFError crsf_write_rc(CRSF_t* pHndl, crsf_rc_t* pChannels);
eCRSFError crsf_read_gps(CRSF_t* pHndl, crsf_gps_t* pGPS);
eCRSFError crsf_read_battery(CRSF_t* pHndl, crsf_battery_t* pBattery);
eCRSFError crsf_read_attitude(CRSF_t* pHndl, crsf_attitude_t* pAttitude);
eCRSFError crsf_read_mode(CRSF_t* pHndl, crsf_fcmode_t* pMode);
```

As with the CAN and Serial drivers, each user space function must be passed a pointer to a CRSF device.
Each function will then check the devices status before returning the requested data or executing the requested function.

Currently, the CRSF layer only supports writing RC commands to the FC.
When calling the user space `crsf_write_rc` function, data can be passed as an array of 16 bit integers.
Internally, this function will perform the necessary adjustments including converting $\mu$s values to ticks and compressing the 16 bit values into their 11 bit formats.
Out of range data will not return an error, but will be capped to the minimum and maximum ranges (1000-2000).

All data returned by the CRSF layer is implemented as a copy between an internal and external data structure.
This is because the CRSF protocol sends telemetry data at predefined intervals, eliminating the need for a request-response system.

## Verification
Shown below are several screenshots from the Saleae Logic Analyser, which was used to verify the functionality of the CRSF layer.

### Retransmission
In this test, the program was required to echo decoded CRSF packets onto another Serial interface.

![Echo Mode](/assets/capstone/crsf/echo_mode.png)
![Echo Batt](/assets/capstone/crsf/echo_batt.png)


### RC Transmission

![Inav Configurator](/assets/capstone/crsf/rc_inavconf.png)
![Message Transmission](/assets/capstone/crsf/rc_logic.png)

### Message Parsing

![Battery info from test](/assets/capstone/crsf/parse_terminal.png)
![Battery info from INAV configurator](/assets/capstone/crsf/parse_inavconf.png)