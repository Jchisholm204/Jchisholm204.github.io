---
title: STM32 FreeRTOS ADC + DMA
date: 2024-3-10
categories:
  - ARM Bare Metal
tags:
  - stm32
  - baremetal
  - firmware
  - cmake
  - freertos
author: Jacob
---
## Introduction
In my previous bare metal projects, I wrote driver implementations for UART and CAN bus running on the STM32F4 at the heart of the Vehicle Control Unit being developed for the Queen's Formula EV conversion. One of the last drivers to write before the VCU is ready is the ADC drivers. This article will explore writing the ADC drivers and the accompanying DMA drivers required for efficient access.

#### STM32 F4 ADC
ADC's are hardware units that measure analog voltages and provide digital representations that can be used in software. 
The ADC's onboard the STM32F446 microcontroller provide various features for reading and managing multiple analog channels. To efficiently read the analog voltages on the car, the ADC channels were setup in software such that the ADC readings would be managed by hardware and measured in a continuous circular queue.

#### STM32 F4 DMA
The DMA is another hardware unit onboard the STM32F446 microcontroller. DMA stands for direct memory access. The DMA unit can transfer data between two locations in memory without involvement from the processor. On the STM32F446, DMA transfers can be triggered periodically, by the processor, or directly via an interrupt signal from an onboard peripheral.


## Hardware Abstraction Layer
The first step in writing a driver is to break apart the hardware from the software. As with all of my other drivers, this was done by splitting up the code into multiple sections, starting with the Hardware Abstraction Layer (HAL).

### Initialization
To initialize the ADC peripheral on the STM32, it must first be enabled by the reset and clock control register (RCC). The STM32F446 has 3 ADC peripherals. When initializing the ADC for the first time, most of the functions can be disabled. The most important part of the initialization is ensuring that the ADC is left in the `OFF` state at the end of initialization and that both DMA transfers and continuous requests are enabled. This ensures that ever time the ADC completes a conversion (finishes a measurement) the DMA is notified. Setting the `CONT` bit also ensures that once the ADC finishes all of the reads in the queue, it returns to the start of the list.

```c
/**
 * @brief Initialize ADC Hardware for use with DMA + Continuous Conversions of Sequenced Channels
 * 
 * @param adc The ADC to Initialize
 * @param resolution The resolution of the ADC (in bits)
 * @returns An Error or SYS_OK 
 */
static inline enum SYS_ERROR hal_adc_init(ADC_TypeDef *adc, enum ADC_RESOLUTION resolution){
    if(adc == ADC1) SET_BIT(RCC->APB2ENR, RCC_APB2ENR_ADC1EN);
    if(adc == ADC2) SET_BIT(RCC->APB2ENR, RCC_APB2ENR_ADC2EN);
    if(adc == ADC3) SET_BIT(RCC->APB2ENR, RCC_APB2ENR_ADC3EN);

    // Disable ADC Overrun Interrupt
    CLEAR_BIT(adc->CR1, ADC_CR1_OVRIE);
    // Set ADC Resolution
    SET_BIT(adc->CR1, (uint32_t)(resolution << ADC_CR1_RES_Pos));
    // Disable Analog watchdog
    CLEAR_BIT(adc->CR1, ADC_CR1_AWDEN); // Regular channels
    CLEAR_BIT(adc->CR1, ADC_CR1_AWDEN); // Injected channels
    // Reset Discontinuous Channel selection
    CLEAR_BIT(adc->CR1, ADC_CR1_DISCNUM);
    CLEAR_BIT(adc->CR1, ADC_CR1_JDISCEN);
    // Disable Discontinuous mode on regular channels
    CLEAR_BIT(adc->CR1, ADC_CR1_DISCEN);
    // Disable automatic injected group conversion
    CLEAR_BIT(adc->CR1, ADC_CR1_JAUTO);
    // Set scan mode (Forces the ADC to loop through the Sequence)
    SET_BIT(adc->CR1, ADC_CR1_SCAN);
    // Disable End of Conversion Interrupt for Injected Channels
    CLEAR_BIT(adc->CR1, ADC_CR1_JEOCIE);
    // Disable the Analog Watchdog Interrupt
    CLEAR_BIT(adc->CR1, ADC_CR1_AWDIE);
    // Disable End of Conversion Interrupt
    CLEAR_BIT(adc->CR1, ADC_CR1_EOCIE);
    
    // Reset Software Start bit for regular channels
    CLEAR_BIT(adc->CR2, ADC_CR2_SWSTART);
    // Disable External trigger for regular channels
    CLEAR_BIT(adc->CR2, ADC_CR2_EXTEN);
    // Reset Software start for injected channels
    CLEAR_BIT(adc->CR2, ADC_CR2_JSWSTART);
    // Disable External trigger for injected channels
    CLEAR_BIT(adc->CR2, ADC_CR2_JEXTEN);
    // Set data alignment (Right Align)
    CLEAR_BIT(adc->CR2, ADC_CR2_ALIGN);
    // End of Conversion Bit enable
    SET_BIT(adc->CR2, ADC_CR2_EOCS);
    // Enable DMA + Repeat DMA Requests
    SET_BIT(adc->CR2, ADC_CR2_DMA);
    SET_BIT(adc->CR2, ADC_CR2_DDS);
    // Set Continuous conversion (ADC Loops back to first conversion after completing the Sequence)
    SET_BIT(adc->CR2, ADC_CR2_CONT);

    // Leave ADC Off
    CLEAR_BIT(adc->CR2, ADC_CR2_ADON);

    return SYS_OK;
}
```

Unless in special circumstances, the ADC resolution should always be set to `ADC_RESOLUTION_12_BIT`. Otherwise the ADC initialization is fairly similar to the other peripherals I've covered.
### Channel Configuration
To read a sequence of analog voltages, the ADC's channels must first be configured. ADC channels are assigned to certain pins by the chip manufacture. Each pin capable of connecting to the ADC has a channel number. 




```c
static inline void hal_can_read(CAN_TypeDef * CAN, can_msg_t * rx_msg){
    // Determine Message ID format (Identifier Extension)
    rx_msg->format = (CAN_RI0R_IDE & CAN->sFIFOMailBox[0].RIR);
    if(rx_msg->format == STANDARD_FORMAT){
        rx_msg->id = (CAN_RI0R_STID & CAN->sFIFOMailBox[0].RIR) >> CAN_TI0R_STID_Pos;
    }
    else{
        rx_msg->id = ((CAN_RI0R_EXID | CAN_RI0R_STID) & CAN->sFIFOMailBox[0].RIR) >> CAN_RI0R_EXID_Pos;
    }

    // Data Frame = 0 | Remote Frame = 1
    rx_msg->type = (CAN_RI0R_RTR & CAN->sFIFOMailBox[0].RIR);

    // Message data length
    rx_msg->len = (CAN_RDT0R_DLC & CAN->sFIFOMailBox[0].RDTR) >> CAN_RDT0R_DLC_Pos;

    // Unload the data
    rx_msg->data[0] = (uint8_t)((CAN_RDL0R_DATA0 & CAN->sFIFOMailBox[0].RDLR) >> CAN_RDL0R_DATA0_Pos);
    rx_msg->data[1] = (uint8_t)((CAN_RDL0R_DATA1 & CAN->sFIFOMailBox[0].RDLR) >> CAN_RDL0R_DATA1_Pos);
    rx_msg->data[2] = (uint8_t)((CAN_RDL0R_DATA2 & CAN->sFIFOMailBox[0].RDLR) >> CAN_RDL0R_DATA2_Pos);
    rx_msg->data[3] = (uint8_t)((CAN_RDL0R_DATA3 & CAN->sFIFOMailBox[0].RDLR) >> CAN_RDL0R_DATA3_Pos);
    rx_msg->data[4] = (uint8_t)((CAN_RDH0R_DATA4 & CAN->sFIFOMailBox[0].RDHR) >> CAN_RDH0R_DATA4_Pos);
    rx_msg->data[5] = (uint8_t)((CAN_RDH0R_DATA5 & CAN->sFIFOMailBox[0].RDHR) >> CAN_RDH0R_DATA5_Pos);
    rx_msg->data[6] = (uint8_t)((CAN_RDH0R_DATA6 & CAN->sFIFOMailBox[0].RDHR) >> CAN_RDH0R_DATA6_Pos);
    rx_msg->data[7] = (uint8_t)((CAN_RDH0R_DATA7 & CAN->sFIFOMailBox[0].RDHR) >> CAN_RDH0R_DATA7_Pos);

    // Release the mailbox to hardware control
    SET_BIT(CAN->RF0R, CAN_RF0R_RFOM0);
}
```

One important note to make is that this code only reads from the first of the three mailboxes. This is because I plan to trigger an interrupt on message reception, thus the other two mailboxes should never be in use.

The HAL also contains a wrapper function to check if the mailbox is full. This function will not be used within the FreeRTOS code, but exists incase a future user wishes to switch to a polling system for message reception.

```c
/**
 * @brief Get if a CAN message is pending in the CAN bus FIFO
 *
 * @param CAN The CAN bus FIFO to check
 * @returns TRUE if a message is pending
 * @returns FALSE if the FIFO is empty
 */
static inline bool hal_can_read_ready(CAN_TypeDef * CAN)
{
    // Check for pending FIFO 0 messages
    return CAN->RF0R & 0x3UL;
}
```

### Message Transmission
The STM32 CAN interface features three transmission mailboxes that can be configured to either work based on a priority system, or as a hardware managed FIFO. When writing this code, I chose to go with the latter, allowing me to ensure that once a message is deposited in a mailbox, it will be sent in a relatively quickly manner. This avoids the possibility of a lower priority message not making it onto the bus due to higher priority messages being sent first.
When operating in the FIFO mode, a message can be deposited into any of the three mailboxes, and will be timestamped and sent out in order by the hardware. To send a message, the user must select the bus and the transmission mailbox to use. Similarly to the UART transmission code, the mailbox is first checked to ensure it is empty, and then is loaded with the message data. One difference between UART and CAN is that the CAN mailbox must be released to hardware with the Transmit Request bit before the message can be sent.

```c
/**
 * @brief Send a CAN message. Must wait for message to send before attempting another transmission
 * 
 * @param CAN the CAN bus to send on
 * @param tx_msg pointer to the message to send
 * @param mailbox The TX mailbox to use (0..2). Use 0 as default
 * @return uint8_t HAL_CAN_OK or HAL_CAN_xx_ERR on on error
 */
static inline uint8_t hal_can_send(CAN_TypeDef * CAN, can_msg_t * tx_msg, uint8_t mailbox) {
    // Check the mailbox is empty before attempting to send
    if(CAN->sTxMailBox[mailbox].TIR & CAN_TI0R_TXRQ_Msk) return HAL_CAN_MAILBOX_NONEMPTY;
    if(mailbox > 2) return HAL_CAN_MAILBOX_SELRNG_ERR;

    // Create temp variable to store mailbox info
    uint32_t sTxMailBox_TIR = 0;
    if(tx_msg->format == EXTENDED_FORMAT){
        // Extended msg frame format
        sTxMailBox_TIR = (tx_msg->id << CAN_TI0R_EXID_Pos) | CAN_TI0R_IDE;
    }
    else{
        // Standard msg frame format
        sTxMailBox_TIR = (tx_msg->id << CAN_TI0R_STID_Pos);
    }
    
    // Remote frame
    if(tx_msg->type == REMOTE_FRAME){
        SET_BIT(sTxMailBox_TIR, CAN_TI0R_RTR);
    }

    // Clear and set the message length
    CLEAR_BIT(CAN->sTxMailBox[mailbox].TDTR, CAN_TDT0R_DLC);
    SET_BIT(CAN->sTxMailBox[mailbox].TDTR, (tx_msg->len & CAN_TDT0R_DLC));

    // Load the DR's
    CAN->sTxMailBox[mailbox].TDLR = (((uint32_t) tx_msg->data[3] << CAN_TDL0R_DATA3_Pos) | ((uint32_t) tx_msg->data[2] << CAN_TDL0R_DATA2_Pos) | ((uint32_t) tx_msg->data[1] << CAN_TDL0R_DATA1_Pos) | ((uint32_t) tx_msg->data[0] << CAN_TDL0R_DATA0_Pos));
    CAN->sTxMailBox[mailbox].TDHR = (((uint32_t) tx_msg->data[7] << CAN_TDH0R_DATA7_Pos) | ((uint32_t) tx_msg->data[6] << CAN_TDH0R_DATA6_Pos) | ((uint32_t) tx_msg->data[5] << CAN_TDH0R_DATA5_Pos) | ((uint32_t) tx_msg->data[4] << CAN_TDH0R_DATA4_Pos));

    CAN->sTxMailBox[mailbox].TIR = (uint32_t)(sTxMailBox_TIR | CAN_TI0R_TXRQ);
    
    // Return read OK
    return HAL_CAN_OK;

}
```

Again, a wrapper function is provided to see if the mailbox is empty. This function can be polled to check if the message is pending or has been sent.

```c
/**
 * @brief Get is the Transmit Mailbox is empty
 * @param CAN The CAN bus mailbox to check
 * @param mailbox The TX mailbox to use (0..2). Use 0 as default
 * @return true if the mailbox is empty
 * @return false if the mailbox is pending
 */
static inline bool hal_can_send_ready(CAN_TypeDef * CAN, uint8_t mailbox){
    // Check to see if mailbox is empty
    return !(CAN->sTxMailBox[mailbox].TIR & CAN_TI0R_TXRQ_Msk);
}
```

## FreeRTOS Interface
Exactly like the UART interface, the FreeRTOS interface contains all of the task safe calls to the HAL. The interface also provides the interrupt based message reception code. Most of the code written for the CAN bus was taken from the UART interface with a few key exceptions. First of all, the CAN interface uses a counting semaphore in addition to three binary semaphores for managing the transmit mailboxes. Secondly, the task responsible for managing the message reception loads the messages into a hash table such that they can be accessed by other tasks. This methodology may be changed in the future but it serves fine for now.

### Message Reception
Message reception consists of an interrupt paired with a FreeRTOS task. The interrupt is triggered upon message reception and is designed to move messages from the hardware FIFO into the FreeRTOS stream buffer. 

```c
void CAN1_RX0_IRQHandler(void){
    // Initialize a variable to trigger context switch to false
    BaseType_t xHigherPriorityTaskWoken = pdFALSE;
    // Temp message to store the incoming data
    can_msg_t rx_msg;

    // Utilize the hal to read the data and release the FIFO
    hal_can_read(CAN1, &rx_msg);

    // Send the recieved data into the stream buffer
    xStreamBufferSendFromISR(
            CAN1_RX.streamHandle,     // Streambuffer to send to
            &rx_msg,                  // Data to copy into the buffer
            sizeof(can_msg_t),        // Size of data
            &xHigherPriorityTaskWoken // Checks if any tasks are waiting on buffer
    );

    // Check and trigger a context switch if needed
    portYIELD_FROM_ISR(xHigherPriorityTaskWoken);

}
```

Once a message is loaded into the FreeRTOS stream buffer, it is sorted into a hash table by the receive task. This interrupt/task combination was chosen after having a discussion with Thomas Dean, one of the professors at Queen's University. Initially, I was planning to use either a task or an interrupt for storing the messages. However only using a task came at the disadvantage of possibly missing messages, while only using an interrupt came at the cost of having a lengthy interrupt, which could have caused other problems with the code.
Another choice that was made after my discussion with Thomas Dean was to not block the task on the stream buffer like I did with the UART receiver. As pointed out by Thomas Dean, blocking the task on the stream buffer could result in more resources being used by the scheduler to check if the task needs to run or not. It could also result in a longer period of time being required to wake the task. Therefore the task runs on a preemptive schedule where it is guaranteed to run every 10 milliseconds.
One other benefit to having the task is the ability to timestamp messages. In future iterations of this code, another possibility would be to cycle through the received messages and display some type of error if stale (old) data is detected.

```c
// LOOP waiting for CAN messages
for(;;){
    // LOOP pulling and sorting messages from the streambuffer
    while(xStreamBufferBytesAvailable(CAN1_RX.streamHandle) > 0){
        // Temp message to store the data comming out of the buffer
        can_msg_t msg;
        // Recieve a message from the buffer
        xStreamBufferReceive(
                CAN1_RX.streamHandle, // Stream Buffer Handle
                (void*)&msg,          // Pointer to RX Buffer (void*)
                sizeof(can_msg_t),    // Size of RX Buffer (Shoudl be size of CAN message)
                10                    // Ticks to Wait
        );
        printf("%ld\n", msg.id);
        // Load the message from the streambuffer into the hash table
        CAN1_DATA[can1_hash(msg.id)] = msg;
        // Timestamp the message
        CAN1_DATA[can1_hash(msg.id)].timestamp = xTaskGetTickCount();
        // printf("%d\n", CAN1_DATA[can1_hash(msg.id)].id);
    }
    // while(xStreamBufferBytesAvailable(CAN2_RX.streamHandle) > 0){
    //     // Temp message to store the data comming out of the buffer
    //     can_msg_t msg;
    //     // Recieve a message from the buffer
    //     xStreamBufferReceive(CAN2_RX.streamHandle, (void*)&msg, sizeof(can_msg_t), 10);
    //     CAN2_DATA[can2_hash(msg.id)] = msg;
    //     CAN2_DATA[can2_hash(msg.id)].timestamp = xTaskGetTickCount();
    // }
    vTaskDelay(100);
}
```

Please note that I have only posted the receive loop above. For the full code including the task setup, please see the [the appropriate page on GitHub.](https://github.com/qfsae/zenith/blob/master/Q24ECU/core/src/interfaces/interface_can.c)


### Message Transmission
When using an interface like UART, message transmission is rather simple. First you must check to see if the peripheral is ready, then deposit the data into the register, and finally wait for the acknowledgement flag from the hardware to ensure the message was sent. When implementing this system with semaphores, a simple binary semaphore can be used to ensure that only one task can access the transmission register at any given time.
When working with CAN bus, there are three possible transmission registers to choose from. This rather complicates matters...

To solve this problem, I used two methods. First, I employed a counting semaphore to keep track of the number of mailboxes in use. This provides the blocking mechanism for tasks to wait on a mailbox being available. If the counting semaphore has room in it, then it is known that at least one of the three mailboxes is empty.

```c
// Initialize Semaphores for Transmit Mailboxes
CAN1_TX_Semaphore[CAN_TX_SEMAPHORE_COUNT]  = xSemaphoreCreateCountingStatic(
            2, // Number of TX Mailboxes
            0, // Starting Count (Goes up to Max Count)
            &CAN1_TX_SemaphoreBuffer[CAN_TX_SEMAPHORE_COUNT] // Pointer to static Buffer
    );
```

Secondly, I used an array of binary semaphores that are indexed to each of the mailboxes. These act identically to the binary semaphores used in the UART implementation. They are stored in an array so that they can be looped through, but more on that later.

```c
CAN1_TX_Semaphore[CAN_TX_SEMAPHORE_TX0] = 
    xSemaphoreCreateBinaryStatic(&CAN1_TX_SemaphoreBuffer[CAN_TX_SEMAPHORE_TX0]);
xSemaphoreGive(CAN1_TX_Semaphore[CAN_TX_SEMAPHORE_TX0]);

CAN1_TX_Semaphore[CAN_TX_SEMAPHORE_TX1] =
    xSemaphoreCreateBinaryStatic(&CAN1_TX_SemaphoreBuffer[CAN_TX_SEMAPHORE_TX1]);
xSemaphoreGive(CAN1_TX_Semaphore[CAN_TX_SEMAPHORE_TX1]);

CAN1_TX_Semaphore[CAN_TX_SEMAPHORE_TX2] =
    xSemaphoreCreateBinaryStatic(&CAN1_TX_SemaphoreBuffer[CAN_TX_SEMAPHORE_TX2]);
xSemaphoreGive(CAN1_TX_Semaphore[CAN_TX_SEMAPHORE_TX2]);
```

To figure out which mailbox is empty, the binary semaphores can be looped through, checking if each one is available. If the semaphore API returns that it is available, the HAL functions are called and the function waits for the message to be sent before releasing both the binary and counting semaphores.

```c
uint8_t can_send_msg(CAN_TypeDef *CAN, can_msg_t *tx_msg, TickType_t timeout){
    // Check if a transmit mailbox is available
    if(xSemaphoreTake(CAN1_TX_Semaphore[CAN_TX_SEMAPHORE_COUNT], timeout) != pdTRUE){
        // Return failed to aquire TX mailbox
        return HAL_CAN_MAILBOX_NONEMPTY;
    }
    // Attempt to aquire one of the transmit mailboxes
    for(uint8_t i = 1; i < 4; i++){
        if(xSemaphoreTake(CAN1_TX_Semaphore[i], 10) == pdTRUE){
            // Utilize the hal to load the selected mailbox
            hal_can_send(CAN, tx_msg, (i-1)/*mailbox=0..2*/);
            // Wait for mailbox to be empty
            while(!hal_can_send_ready(CAN, (i-1)));
            // Give back the semaphores
            xSemaphoreGive(CAN1_TX_Semaphore[i]);
            xSemaphoreGive(CAN1_TX_Semaphore[CAN_TX_SEMAPHORE_COUNT]);
            // Return OK
            return HAL_CAN_OK;
        }
    }
    return HAL_CAN_FATAL_ERR;
}
```


## Conclusion
Using the UART drivers as a learning experience, I have successfully created a basic interrupt driven and thread safe CAN bus driver. For the future, I would like to have employed a mechanism to automatically release the semaphores upon a mailbox being freed by hardware. I would also like to find a better solution to storing CAN bus messages than a hash table. However for the moment, both of these implementations will work plenty fine for my purposes. Finally, I would like to thank Thomas Dean, a professor at Queen's University who teaches ELEC377: Operating Systems. Even though I am a full year away from being enrolled in his course he was able to share some valuable advice necessary to the completion of this project.