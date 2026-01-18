---
title: STM32 Serial (UART) Driver
date: 2026-01-15
categories: [Firmware, Scout]
tags: [STM32, FreeRTOS, Scout]
author: Jacob
hidden: false
math: true
---
**Serial Layer:** A Thread safe STM32F446 UART driver implementation built using FreeRTOS.

This driver is designed to be an updated version of the driver I created two years ago.
The improved driver utilizes the same hardware abstraction layer (HAL) as the previous implementation.

**Improvements:**
- Better thread safety (Initialization can only be called once)
- Better configuration (Global defines are no longer needed)
- Better memory management (Internal memory is kept internal, rather than being allocated in the global scope)
- Stream buffer writes (The new driver can now be written to through a FreeRTOS stream buffer with automatic interrupt based transmission)

## Initialization
Each serial interface can be initialized at most one time on an uninitialized USART (Serial) port.
Any calls to the initialization function on an initialized port will return `NULL`.
This behavior ensures that a Serial port can not accidentally be initialized by a second task, overriding its initial initialization and breaking program behavior.

To initialize a Serial port, the following function can be called.

```c
Serial_t *serial_init(eSerial serial,
                      unsigned long baud,
                      pin_t pin_rx,
                      pin_t pin_tx) {
    if (serial >= eSerialN) {
        return NULL;
    }

    // Retrive handle and ensure handle is not initialized
    Serial_t *pHndl = &SerialPort[serial];
    if (pHndl->state == eSerialOK)
        return NULL;

	// Initialize the hardware
    hal_uart_init(pHndl->UART, baud, pin_tx, pin_rx);
	
	// Create the write mutex
    pHndl->tx_hndl = xSemaphoreCreateMutexStatic(&pHndl->static_tx_semphr);
    if (pHndl->tx_hndl == NULL) {
        pHndl->state = eSerialInitFail;
        return NULL;
    }

    xSemaphoreGive(pHndl->tx_hndl);
    pHndl->state = eSerialOK;

    pHndl->tx_buf = NULL;
    pHndl->rx_buf = NULL;

    return pHndl;
}
```

The Serial initialization function returns a pointer to internal driver memory. 
This pointer can only be returned once through the first call of the initialization function.
Serial initialization can take place in either local or global scope, and the pointer can also be shared with multiple FreeRTOS tasks.

## Reading
To read from the Serial interface, tasks must attach a FreeRTOS Stream Buffer.
This buffer must be set up by the receiving task, and is automatically written to by the Serial device interrupts.
If the buffer is full when a byte is received on the UART interface, the Serial layer will drop the byte.

To attach a read buffer to the Serial interface, the following function can be called, which will initialize the hardware interrupt and add the buffer handle into the Serial data structure.

```c
eSerialError serial_attach(Serial_t *pHndl, StreamBufferHandle_t buf_hndl) {
    if (pHndl == NULL || buf_hndl == NULL)
        return eSerialNULL;
    if (pHndl->state != eSerialOK)
        return pHndl->state;
    if (pHndl->rx_buf == NULL) {
        pHndl->rx_buf = buf_hndl;
        NVIC_EnableIRQ(pHndl->IRQn);
        NVIC_SetPriority(pHndl->IRQn, NVIC_Priority_MIN);
        hal_uart_enable_rxne(pHndl->UART, true);
        return eSerialOK;
    }
    return eSerialSemphr;
}
```

## Writing
There are two ways to write to the serial interface: Direct blocking writes, and through a stream buffer.

### Direct Blocking Writes
If blocking writes are preferred, the following function can be called.
This function will not return until the write has completed.

```c
eSerialError serial_write(Serial_t *pHndl,
                          char *buf,
                          size_t len,
                          TickType_t timeout) {
    if (pHndl == NULL || buf == NULL)
        return eSerialNULL;
    if (pHndl->state != eSerialOK)
        return pHndl->state;
    if (xSemaphoreTake(pHndl->tx_hndl, timeout) == pdTRUE) {
        hal_uart_write_buf(pHndl->UART, buf, len);
        xSemaphoreGive(pHndl->tx_hndl);
        return eSerialOK;
    }
    return eSerialSemphr;
}
```

### Buffering Writes
The Serial driver also supports non-blocking, buffered writes through a FreeRTOS Stream Buffer.

To enable non-blocking, buffered writes, first create a buffer using the `serial_create_write_buffer` function.
This function is identical to `xStreamBufferCreateStatic`, but includes extra logic to setup the register the handler with the Serial interface and setup the UART interrupts.

```c
StreamBufferHandle_t serial_create_write_buffer(
    Serial_t *pSerial,
    size_t xBufferSizeBytes,
    size_t xTriggerLevelBytes,
    uint8_t *const pucStreamBufferStorageArea,
    StaticStreamBuffer_t *const pxStaticStreamBuffer) {
    if (!pSerial) {
        return NULL;
    }
    StreamBufferHandle_t hndl =
        xStreamBufferCreateStaticWithCallback(xBufferSizeBytes,
                                              xTriggerLevelBytes,
                                              pucStreamBufferStorageArea,
                                              pxStaticStreamBuffer,
                                              vSerial_RxCallback,
                                              NULL);
    if (!hndl) {
        return NULL;
    }
    pSerial->tx_buf = hndl;
    NVIC_EnableIRQ(pSerial->IRQn);
    NVIC_SetPriority(pSerial->IRQn, NVIC_Priority_MIN);
    return hndl;
}
```

The initialization function also registers a callback function that re-enables the UART interrupt whenever the buffer is written to.
Once enabled, the UART interrupt will drain bytes from the buffer until it is emptied.
Upon writing the last byte in the buffer, the UART interrupt is automatically disabled to conserve processing power.
Given the FreeRTOS Stream Buffer is ISR safe, the interrupt will always be active when the buffer is not empty.

The callback function is shown below:
```c
void vSerial_RxCallback(StreamBufferHandle_t xStreamBuffer,
                        BaseType_t xIsInsideISR,
                        BaseType_t *const pxHigherPriorityTaskWoken) {
    (void) xStreamBuffer;
    (void) xIsInsideISR;
    (void) pxHigherPriorityTaskWoken;
    // Enable all active ports with full buffers
    for (int i = 0; i < eSerialN; i++) {
        // Enable the TX interrupt if the serial state is OK and there is a TX
        // buffer attached, and that buffer contains data elements to be read
        if (SerialPort[i].state == eSerialOK && SerialPort[i].tx_buf != NULL) {

            size_t bytes_avail =
                xStreamBufferBytesAvailable(SerialPort[i].tx_buf);
            if (bytes_avail > 0)
                hal_uart_enable_txne(SerialPort[i].UART, true);
        }
    }
}
```


## ISR (Interrupt Service Routine)
The UART interface uses a single interrupt for both RX and TX events.
All UART interfaces share a generic handler that processes RX, TX, and ORE (Over Run Error) events.

```c
void generic_handler(Serial_t *pHndl) {
    // MUST read status to clear ORE/NF/FE flags
    uint32_t status = hal_uart_read_status(pHndl->UART);
    BaseType_t higher_woken = pdFALSE;

    // Interrupt Generated for Read
    if (status & USART_SR_RXNE || status & USART_SR_ORE) {
        // MUST read input port to clear iPending bit
        uint8_t rx_data = hal_uart_read_byte(pHndl->UART);
        // hal_uart_write_byte(pHndl->UART, rx_data);
        // Check that a handler exists
        if (pHndl->rx_buf == NULL || pHndl->state != eSerialOK) {
            // If there is no handler disable this interrupt
            hal_uart_enable_rxne(pHndl->UART, false);
            return;
        }
        // If a buffer exists, run the interrupt routine
        xStreamBufferSendFromISR(
            pHndl->rx_buf, &rx_data, sizeof(rx_data), &higher_woken);
    }
    if (status & USART_SR_TXE && pHndl->UART->CR1 & USART_CR1_TXEIE) {
        if (pHndl->tx_buf == NULL || pHndl->state != eSerialOK) {
            // If there is no handler disable this interrupt
            hal_uart_enable_txne(pHndl->UART, false);
            return;
        }
        uint8_t tx_data = 0;
        if (xStreamBufferReceiveFromISR(
                pHndl->tx_buf, &tx_data, 1, &higher_woken) == 1) {
            hal_uart_write_byte(pHndl->UART, tx_data);
        } else {
            hal_uart_enable_txne(pHndl->UART, false);
        }
    }
    portYIELD_FROM_ISR(higher_woken);
}
```

If ORE events are not processed, the interrupt will not exit.
The ORE flag is currently ignored, but still must be cleared.
The ORE flag is cleared by first reading the status register, then reading the data register.