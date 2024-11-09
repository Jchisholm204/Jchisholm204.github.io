---
title: STM32 FreeRTOS ADC + DMA
date: 2024-3-10
categories: [Firmware]
tags: [STM32, CMake, FreeRTOS]
author: Jacob
---
## Introduction
In my previous bare metal projects, I wrote driver implementations for the UART and CAN bus peripherals present on the STM32F4. One of the last drivers to write before the VCU is ready is the ADC drivers. 
This article will explore writing the ADC drivers and the accompanying DMA drivers required for efficient access. Designing the system to use the DMA rather than interrupts gives it the unique advantage of requiring no software intervention during its lifetime.

#### STM32 F4 ADC
ADC's are hardware units that measure analog voltages and provide digital representations that can be used in software. 
The ADC's onboard the STM32F446 microcontroller provide various features for reading and managing multiple analog channels. To efficiently read the analog voltages, the ADC channels were setup in software such that the ADC readings would be managed by hardware and measured in a continuous circular queue.
Writing the code in this manner ensures that barring any physical error with the ADC interface, the most recent voltage reading will always be available to the code at a set location in memory. The exact location is determined by the placement of the ADC array, offset by the bit width and channel number.
#### STM32 F4 DMA
The DMA is another hardware unit onboard the STM32F446 microcontroller. DMA stands for direct memory access. The DMA unit can transfer data between two locations in memory without involvement from the processor. On the STM32F446, DMA transfers can be triggered periodically, by the processor, or directly via an interrupt signal from an onboard peripheral.
In the implementation shown below, the DMA is configured for peripheral to memory transfers driven by peripheral interrupt signals. One of the key limitations of the DMA HAL is that the DMA is setup to ONLY function in this manner. Memory to memory or memory to peripheral transfers would either need a separate initialization function, or the existing function would need to be modified.


## ADC Hardware Abstraction Layer
The first step in writing a driver is to break apart the hardware from the software. As with all of my other drivers, this was done by splitting up the code into multiple sections, starting with the Hardware Abstraction Layer (HAL).

### Initialization
To initialize the ADC peripheral on the STM32, it must first be enabled by the reset and clock control register (RCC). When initializing the ADC for the first time, most of the functions can be disabled.
The most important part of the initialization is ensuring that the ADC is left in the `OFF` state at the end of initialization and that both DMA transfers and continuous requests are enabled. This ensures that ever time the ADC completes a conversion (finishes a measurement) the DMA is notified. Setting the `CONT` bit also ensures that once the ADC finishes all of the reads in the queue, it returns to the start of the list.
The STM32 also supports ADC watchdog and injected channels. Injected channels have been disabled in this implementation. While the watchdog may be configured in the future, it is not part of the current HAL implementation.

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
To read a sequence of analog voltages, the ADC's channels must first be configured in the sequence registers. ADC channels are assigned to certain pins by the chip manufacturer. Each pin capable of connecting to the ADC has its own channel number. 
Channels can be organized in any order and with varying sampling times. To add a channel to the sequence, the function below is used to configure a channel, placing it in one of the available ranks (positions in the hardware array holding the sequence).

```c
/**
 * @brief Configure an ADC Channel
 * 
 * @param adc The ADC to Configure
 * @param channel The Channel to Configure
 * @param cycles The Sample Time
 * @param rank The Sequence Rank
 */
static inline void hal_adc_configChannel(ADC_TypeDef *adc, uint8_t channel, enum ADC_SAMPLE_TIME cycles, enum ADC_SEQUENCE rank){
    (void)cycles;
    // Setup Channel Sample Time
    if(channel > 9) { // High Channel Register
                      // Reset Sample Time
        CLEAR_BIT(adc->SMPR1, (uint32_t)(0x7UL << (3U * (uint32_t)(channel-10U))));
        // Set Sample Time
        SET_BIT(adc->SMPR1, (uint32_t)(cycles << (3U * (uint32_t)(channel-10U))));
    }
    else { // Low Channel Register
        CLEAR_BIT(adc->SMPR2, (uint32_t)(0x7UL << (3U * (uint32_t)(channel))));
        SET_BIT(adc->SMPR2, (uint32_t)(cycles << (3U * (uint32_t)(channel))));
    }

    // Add Channel to the Sequence Register
    if(rank < 7U) {
        CLEAR_BIT(adc->SQR3, (uint32_t)(0x1FU << (5U * ((rank) - 1U))));
        SET_BIT(adc->SQR3, (uint32_t)(channel << (5U * ((rank) - 1U))));
    }
    else if(rank < 13U) {
        CLEAR_BIT(adc->SQR2, (uint32_t)(0x1FU << (5U * ((rank) - 7U))));
        SET_BIT(adc->SQR2, (uint32_t)(channel << (5U * ((rank) - 7U))));
    }
    else{
        CLEAR_BIT(adc->SQR1, (uint32_t)(0x1FU << (5U * ((rank) - 13U))));
        SET_BIT(adc->SQR1, (uint32_t)(channel << (5U * ((rank) - 13U))));
    }
}
```

When selecting a channel, the most important thing is consider is the sample rate. Generally, channels with higher impedance require longer sampling times to get a more accurate reading. However, the higher the sample time, the longer it takes to process each channel, resulting in less current readings being present within the system.


Once the channels have been configured, the hardware needs to know the number of channels present in the sequence. This number can be configured through the function below. 

```c
/**
 * @brief Set the ADC Sequence Length
 * 
 * @param adc The ADC to Configure
 * @param len The Length of the Sequence
 */
static inline void hal_adc_set_sequence_len(ADC_TypeDef *adc, uint8_t len){
    CLEAR_BIT(adc->SQR1, ADC_SQR1_L);
    SET_BIT(adc->SQR1, (uint32_t)((len - 1) << ADC_SQR1_L_Pos));
}
```

### Enabling The ADC
Given that the ADC is initialized to the `OFF` state, it must first be enabled before it starts to read the analog channels. To enable the ADC, it must first be turned on with the `ADON` bit present in its control register. 

```c
static inline void hal_adc_enable(ADC_TypeDef *adc){
    if(!READ_BIT(adc->CR2, ADC_CR2_ADON))
        SET_BIT(adc->CR2, ADC_CR2_ADON);
}
```

Once the ADC is enabled, the Software Start bit (`SWSTART`) must be enabled to start analog conversions. This function can also be called on its own to both enable the ADC and start channel conversions.

```c
static inline void hal_adc_startConversions(ADC_TypeDef *adc){
    hal_adc_enable(adc);
    for (unsigned int i = 0; i < (3U * (SYS_FREQUENCY/1000000U)); i++) __asm__("nop");
    SET_BIT(adc->CR2, ADC_CR2_SWSTART);
}
```

Once the ADC has been enabled, it requires a few milliseconds of setup time before it can start converting channels, hence the delay. Once the `SWSTART` bit is set, the ADC will start converting analog channels and notifying the DMA upon each channel completion.


The HAL also provides the following functions for suspending channel conversions and for disabling the ADC.
```c
/**
 * @brief Disable an ADC
 * 
 * @param adc The ADC to Disable
 */
static inline void hal_adc_disable(ADC_TypeDef *adc){
    if(READ_BIT(adc->CR2, ADC_CR2_ADON))
        CLEAR_BIT(adc->CR2, ADC_CR2_ADON);
}
```

```c
/**
 * @brief Stop ADC Conversions
 * 
 * @param adc The ADC to Stop
 */
static inline void hal_adc_stopConversions(ADC_TypeDef *adc){
    CLEAR_BIT(adc->CR2, ADC_CR2_SWSTART);
}
```

## DMA Hardware Abstraction Layer
The STM32F446 features a Direct Memory Access unit that is relatively simple to configure.

### Initialization
To initialize the DMA, both the DMA to use and the 'Stream' to use are required. Different DMA's and Streams map to different memory peripherals depending on the MCU datasheet. Each stream has multiple channels that determine the exact source of the trigger for the data transfer. Once the trigger is setup, all that is required is the memory addresses for the transfers, and how much data to transfer each time.

```c
/**
 * @brief Initialize the DMA peripheral
 * 
 * @param dma DMA peripheral to initialize
 * @param stream DMA Stream to initialize
 * @param ch DMA Channel to use
 * @param priority DMA Priority Level
 * @param mem_size DMA Memory Size
 * @param periph_addr Peripheral Address
 * @param mem_addr Memory Address
 */


static inline enum SYS_ERROR hal_dma_init(DMA_TypeDef *dma, DMA_Stream_TypeDef *stream, enum DMA_CHANNEL ch, enum DMA_PRIORITY priority, enum DMA_MEM_SIZE mem_size, volatile void *periph_addr, void *mem_addr, size_t num_transfers) {
    // Enable DMA Clock
    if (dma == DMA1) {
        RCC->AHB1ENR |= RCC_AHB1ENR_DMA1EN;
    } else if (dma == DMA2) {
        RCC->AHB1ENR |= RCC_AHB1ENR_DMA2EN;
    } else {
        return SYS_INVALID_ARG;
    }

    /**             DMA Stream Setup            **/

    // Disable Stream
    CLEAR_BIT(stream->CR, DMA_SxCR_EN);
    // Set Channel
    CLEAR_BIT(stream->CR, DMA_SxCR_CHSEL);
    SET_BIT(stream->CR, (uint32_t)(ch << DMA_SxCR_CHSEL_Pos));

    // Set Peripheral Data Size
    CLEAR_BIT(stream->CR, DMA_SxCR_PSIZE);
    SET_BIT(stream->CR, (uint32_t)(mem_size << DMA_SxCR_PSIZE_Pos));

    // Set Priority Level
    CLEAR_BIT(stream->CR, DMA_SxCR_PL);
    SET_BIT(stream->CR, (uint32_t)(priority << DMA_SxCR_PL_Pos));

    // Setup Memory Increments (Peripheral Increment is disabled, Memory Increment is enabled)
    SET_BIT(stream->CR, DMA_SxCR_MINC);
    CLEAR_BIT(stream->CR, DMA_SxCR_PINC);
    // Setup Circular Mode
    SET_BIT(stream->CR, DMA_SxCR_CIRC);
    // Set Direct Write to Memory (no FIFO)
    CLEAR_BIT(DMA2_Stream0->FCR, DMA_SxFCR_DMDIS);

    // Setup Transfers
    DMA2_Stream0->NDTR = (uint32_t)num_transfers;
    DMA2_Stream0->PAR = (uint32_t)(periph_addr);
    DMA2_Stream0->M0AR = (uint32_t)(mem_addr);

    return SYS_OK;
}
```

It is important to note that the above initialization function assumes that circular transfers will be used and that the DMA will only be required to transfer data from a peripheral to memory. Using circular transfers means that after each transfer, the DMA will increment the memory address by the data length until it reaches the number of transfers. Once it reaches the maximum number of transfers, it loops back to the beginning and starts over again.

### Enabling the DMA
To enable the DMA, the below function can be used. The only restriction on this function is that it should be invoked before the peripheral requesting the transfers is enabled.

```c
static inline void hal_dma_start(DMA_Stream_TypeDef *stream) {
    SET_BIT(stream->CR, DMA_SxCR_EN);
}
```

A similar function is also provided for disabling the DMA.

```c
static inline void hal_dma_stop(DMA_Stream_TypeDef *stream) {
    CLEAR_BIT(stream->CR, DMA_SxCR_EN);
}

```

## FreeRTOS Driver
Exactly like the FreeRTOS drivers before it, the ADC driver contains all of the task safe calls to the HAL. 
However, the ADC driver is written slightly differently from the others. The ADC + DMA driver aims to be a hardware managed interface. This works by utilizing the DMA to transfer data from the ADC's data registers into program memory every time the ADC completes a reading. As such, the most present reading from an ADC channel will always be in the `ADC_READINGS` array.

### Initialization
Similar to the other drivers, the initialization function acts as a parameter-less wrapper for the HAL initialization function. The ADC driver initialization also initializes all ADC readings to zero, and sets up the analog pins. 
Before initializing the ADC, the function initializes the DMA, ensuring it will be ready when the ADC starts its conversions. The ADC is then initialized with a 12 bit resolution and the maximum sample rate using the enumerations provided by the HAL. The channels are then configured in the same order they appear in the `ADC_CHANNEL` enumeration in the header file. For testing purposes, only two of the channels have been initialized.

For other projects, it may make sense to rename the channels. The channels in this driver were named based on their physical naming on the VCU V2 PCB.
Once all is configured, the DMA is started, followed by the ADC's start conversions command.

```c
void adc_init(void){
    
    // Zero out ADC Readings
    for(int i = 0; i < ADC_CHANNEL_MAX; i++){
        ADC_READINGS[i] = 0;
    }

    // Reduce the ADC Clock to APB2/8
    SET_BIT(ADC123_COMMON->CCR, 3 << 16);

    // Configure Analog GPIO Pins
    gpio_set_mode(PIN_A5Vin_1, GPIO_MODE_ANALOG);
    gpio_set_mode(PIN_A5Vin_2, GPIO_MODE_ANALOG);

    // Setup DMA for ADC1
    hal_dma_init(DMA2, DMA2_Stream0, DMA_CHANNEL_0, DMA_PRIORITY_LOW, DMA_MEM_SIZE_16, &(ADC1->DR), ADC_READINGS, ADC_CHANNEL_MAX);
    // Setup ADC1
    hal_adc_init(ADC1, ADC_RESOLUTION_12_BIT);
    // Setup Channel Sequence
    hal_adc_configChannel(ADC1, PIN_A5Vin_1_ADCCH, ADC_CYCLES_480, ADC_SQ1);
    hal_adc_configChannel(ADC1, PIN_A5Vin_2_ADCCH, ADC_CYCLES_480, ADC_SQ2);
    // Set Sequence Length
    hal_adc_set_sequence_len(ADC1, ADC_CHANNEL_MAX);

    spin(9999999UL); // Wait for ADC to stabilize

    // Enable the DMA Stream
    hal_dma_start(DMA2_Stream0);
    // Enable ADC and Start Conversions
    hal_adc_startConversions(ADC1);
}
```

Note that special care must be taken when ordering the channels. They must be placed in the same order as they appear in the `ADC_CHANNELS` enumeration, otherwise there will be data misalignment between the hardware and software when attempting to use the ADC's read function mentioned below.

### Reading Channels
Since it is not possible to write to an ADC channel, the driver only needs a read method. To make the method as accessible to outside programmers as possible, an ADC read can be accomplished passing the enumeration with the same name as the physical channel as labeled on the PCB into the following function.

```c
double adc_read(enum ADC_CHANNEL channel){
    // Return obviously bad data if ADC is not enabled
    if(!READ_BIT(ADC1->CR2, ADC_CR2_ADON)) return 123.456;
    // Return 0 if ADC has encountered an overrun
    if(READ_BIT(ADC1->SR, ADC_SR_OVR)) return 0.0;
    // Return 0 if channel is out of range
    if(channel > ADC_CHANNEL_MAX) return 0.0;
    // TODO: add scaling for 12v/5v
    return ADC_READINGS[channel]*3.3/4096.0;
}
```

Note that this function does not actually interface with the ADC's data registers at all. This is because, as discussed earlier, the ADC reads in a continuous loop with the most recent reading always being present within the `ADC_READINGS` array.

When programming with this interface, it is important to check for both zero values, or out of range values. For instance, the maximum voltage allowed on an STM32 ADC pin is 3.3V. Therefore, if the ADC reading being returned is 123.456V, there is an obvious error somewhere in the system. Similarly, in the Formula SAE competition, sensors returning an analog value of 0V must be assumed to be in an error state.