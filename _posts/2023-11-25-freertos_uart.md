---
title: STM32 FreeRTOS UART
date: 2023-11-25
categories: [Firmware]
tags: [STM32, CMake, FreeRTOS]
author: Jacob
image:
  path: /assets/baremetal/q23mockecu.jpg
  lqip: data:image/webp;base64,UklGRpoAAABXRUJQVlA4WAoAAAAQAAAADwAABwAAQUxQSDIAAAARL0AmbZurmr57yyIiqE8oiG0bejIYEQTgqiDA9vqnsUSI6H+oAERp2HZ65qP/VIAWAFZQOCBCAAAA8AEAnQEqEAAIAAVAfCWkAALp8sF8rgRgAP7o9FDvMCkMde9PK7euH5M1m6VWoDXf2FkP3BqV0ZYbO6NA/VFIAAAA
  alt: Q23 MockECU designed by Ethan Peterson
hidden: false
---

## Introduction
In my previous bare metal project, I set up a CMake build environment and got FreeRTOS running on my STM32F446 development board. When I did this, I used my previous hardware abstraction layer designed for use with a simple single loop program. Now that the OS has been verified to be running correctly, proper thread safe hardware drivers must be created. Since UART is one of the simplest interfaces on the MCU (Micro Controller Unit) it is where I will start.
## Thread Safe Drivers
When running multiple tasks concurrently, it can become an issue when two or more try to access the same hardware peripheral at the same time. Depending on the type of device being accessed, this can result in errors from an LED being at half brightness to corrupted memory and even odd console errors like the one listed below:

```
// actual
HeHlellol ofr ofmrom ta tskask 12
// expected
Hello from task 1
Hello from task 2
```

In the example above, task 1 and 2 are both trying to write to the console, but since they have the same task priority, the scheduler switches between them periodically causing one task to print out the first few characters before being interrupted by the second task trying to print out its characters. With the use of thread safe hardware drivers, access to the peripheral, in this case the console, is restricted to one task at a time. This reduces the risk of data corruption and also allows for better control flows in the operating system.
## Semaphores
A semaphore is the technical term for the implementation described above. Semaphores act similar to locks, restricting access to one task at a time. Semaphores integrate with the operating system, allowing tasks to be temporarily removed from the scheduler while a required resource is not available and be rescheduled when the resource is freed. In my project, I will be using the Semaphore library provided by the FreeRTOS API. This will prevent tasks from writing conflicting data to a physical resource and allow for better optimization of resources by allowing the OS to manage scheduled tasks rather than polling for available resources. The FreeRTOS API offers three kinds of Semaphores:
- Binary Semaphores - Can be accessed by one task at a time, can be used within interrupts
- Mutex Semaphores - Works the same as binary but provides additional features, cannot be used within interrupts
- Counting Semaphores - Used to access a resources that can handle a limited number of tasks at a time

## OS Implementation
Now that the desired functionality is known, I can use the tools learned in the above section to implement a thread safe writer for the UART interface within my OS. In order to make the driver more portable, I have decided to split the driver into two sections. The first section is the hardware abstraction that I wrote within a previous project. I will mostly be leaving this file unchanged with some minor addition and convention changes. The second section is the interfaces section that will provide an interface between tasks and the hardware section. 
#### Hardware Abstraction
The first step in writing the UART driver is the hardware abstraction. This section of the code provides the UART setup code, and abstractions to write to the UART data register. It also includes code to check if the data register is empty, and enable/disable UART interrupts. The most important functions however are the `init` and `write_buffer` functions. The `init` function is responsible for initializing the UART interface.  It takes a pointer to the UART peripherals memory space and the desired baud rate (transmission speed). Depending on the UART peripheral selected, it initializes the correct GPIO pins and enables the correct registers within the power and clock (RCC) controller.

```c
static inline void hal_uart_init(USART_TypeDef *uart, unsigned long baud) {
  // figure 19. selecting an alternate function (7=spi2/3, usart1..3, uart5, spdif-in)
  uint8_t af = 7;           // Alternate function
  uint16_t rx = 0, tx = 0;  // pins

  if (uart == USART1) RCC->APB2ENR |= BIT(4);
  if (uart == USART2) RCC->APB1ENR |= BIT(17);
  if (uart == USART3) RCC->APB1ENR |= BIT(18);

  if (uart == USART1) tx = PIN('A', 9), rx = PIN('A', 10);
  if (uart == USART2) tx = PIN('A', 2), rx = PIN('A', 3);
  if (uart == USART3) tx = PIN('D', 8), rx = PIN('D', 9);

  gpio_set_mode(tx, GPIO_MODE_AF);
  gpio_set_af(tx, af);
  gpio_set_mode(rx, GPIO_MODE_AF);
  gpio_set_af(rx, af);
  uart->CR1 = 0;                           // Disable this UART
  uart->BRR = APB1_FREQUENCY / baud;                 // FREQ is a UART bus frequency
  uart->CR1 |= BIT(13) | BIT(2) | BIT(3);  // Set UE, RE, TE
}
```

The next section of the UART hardware driver is the `write_buffer` function. This function relies on the `write_byte` function, therefore they are both included below.

```c
static inline void hal_uart_write_byte(USART_TypeDef * uart, uint8_t byte) {
  uart->DR = byte;
  while ((uart->SR & USART_SR_TXE) == 0) spin(1);
    
}

static inline void hal_uart_write_buf(USART_TypeDef *uart, char *buf, size_t len){
  while(len-- > 0) hal_uart_write_byte(uart, *(uint8_t *) buf++);
}
```

The code also contains methods for dealing with reading from the buffer and interrupts. Since they are less crucial to this write up, they will not be included here but can still be found in the [hal/uart.h](https://github.com/qfsae/zenith/blob/master/Q24ECU/core/include/hal/hal_uart.h) file hosted on GitHub.

#### Interface
The interface portion of the code houses the abstraction layer that links the tasks into the hardware. This includes the semaphore implementation and the interrupt request handlers for the UART interface. When this code was written, the test board employed only contained one exposed UART port. It is the design intention that parts of this code be replicated in order to accommodate boards with more exposed IO.
In order to group UART ports with their respective semaphores, a `uart_t` type definition was used.

```c
typedef struct uart_t {
  USART_TypeDef *port;
  xSemaphoreHandle semaphore;
  StreamBufferHandle_t rxbuffer;
} uart_t;
```

This type definition also contains a stream buffer that connects the UARTs receive interrupt handler into a task that deals with the data. It is important to note that every UART port must have at most one task that reads from the stream buffer. This is due to the way that the FreeRTOS stream buffer is implemented.
The type definition is externally defined within the `interface_uart.h` file and is properly defined within the `interface_uart.c` file. Interfaces are then initialized within the `os_uart_setup()` function.
```c
/**
 * @brief OS UART Setup handler
 *
 * This function should be called to initalized all onboard UART interfaces.
 * This function should not be called more than once.
 * All UART initialization should happen within this function
 *
 * Called in main
 *
 */
void os_uart_setup(){
  // Enable the UART 2 port and setup its IQR handler
  uart_send_init(&port_uart2, USART2, 250000);
  xSemaphoreGive(port_uart2.semaphore);
  hal_uart_enable_rxne(port_uart2.port, true);
  NVIC_SetPriority(USART2_IRQn, (NVIC_Priority_MIN-10));
  NVIC_EnableIRQ(USART2_IRQn);
}
```
The primary purpose of having the `os_uart_setup()` function is to reduce clutter within the `main.c` file and allow for more organization in the program structure. As seen above, the setup function first invokes the interface setup function to initialize the hardware, semaphore and stream buffer. The hardware is initialized with a baud rate of 250000. Lower baud rates provide more stability at the cost of transmission speed. Since the test environment contains low electronic noise, the highest possible baud rate was selected. The setup function also enables the UART's receive interrupt and sets it up within the ARM NVIC (Nested Vector Interrupt Controller).

The interface code provides two methods to write to the UART port. Both are simple wrappers around the write functions mentioned above in the Hardware section. Where these interfaces differ from the hardware interfaces is that they invoke FreeRTOS semaphore calls to gain access to the UART port before writing to it. If the function cannot gain access to the semaphore before the timer runs out, the function returns an access error and exits without transmitting any data. Since both functions are nearly identical, I have only included the buffer write below:

```c
/**
 * @brief Task Blocking command to send a buffer over uart
 *
 * @param port The uart_t port to use (Must be initialized)
 * @param buf Data Buffer
 * @param len Length of Data Buffer
 * @param timeout The amount of ticks to wait for the interface to become available
 */
static inline int uart_send_buf_blocking(uart_t *port, char* buf, size_t len, TickType_t timeout){
  if(port == NULL)            return UART_ERR_UNDEF;
  if(port->port == NULL)      return UART_ERR_UNDEF;
  if(port->semaphore == NULL) return UART_ERR_UNDEF;
  if(xSemaphoreTake(port->semaphore, timeout) == pdTRUE){
    hal_uart_write_buf(port->port, buf, len);
    xSemaphoreGive(port->semaphore);
    return UART_WRITE_OK;
  }
  return UART_ERR_ACC;
}
```

#### `printf`
Now that the access methods have been completed, the `printf` function can be modified to utilize the semaphore access handler in order to eliminate the error described at the beginning of this report. Previously, the `_write` function relied on by `printf` used the hardware `hal_uart_write_buf` function in order to write data to the console. I have updated it to not only use the new semaphore access handlers, but also to integrate with FreeRTOS and also display what task the console messages are coming from. This produces the result seen below:

```console
Starting System Tasks...
SysTick: 1000
Tsk1: Hello from Task 1!
Tsk2: Hello from Task 2!
SysTick: 2000
```

As seen, not only is the output showing correctly, but it makes debugging significantly easier. The revised `_write` code is shown below:

```c
int _write(int fd, char *ptr, int len) {
  (void) fd, (void) ptr, (void) len;
  if (fd == 1 || fd == 2){
    char * callerID = NULL;
    // Get the name of the task calling printf - Only run if scheduler has been started
    if(xTaskGetSchedulerState() != taskSCHEDULER_NOT_STARTED) callerID = pcTaskGetName(NULL);
    if(port_uart2.port == NULL)          return -1;
    if(port_uart2.semaphore == NULL)     return -1;
    // Take over the debug usart
    if(xSemaphoreTake(port_uart2.semaphore, (TickType_t) 10) == pdTRUE){
      // Write caller ID, followed by ": ", then the argument given to printf
      if(callerID != NULL){
        hal_uart_write_buf(port_uart2.port, callerID, strlen(callerID));
        hal_uart_write_buf(port_uart2.port, ": ", 3);
      }
      hal_uart_write_buf(port_uart2.port, ptr, (size_t) len);
      xSemaphoreGive(port_uart2.semaphore);
    }
  } //hal_uart_write_buf(UART_DEBUG, ptr, (size_t) len);
  return -1;
}
```

#### Interrupt Handler / UART Receive
The final component of the interface is the UART interrupt handler. Every UART interface on the STM32 has its own interrupt function. In order to receive transmissions over the UART bus, an interrupt is used to pull the data out of the hardware register and into a queue. As mentioned above, a FreeRTOS stream buffer queue is used. This is a type of queue specifically designed for transferring data from an interrupt to into a task. Since the interrupt is only triggered on data receive, it does not use the same semaphore methods as described above, rather it quickly fetches the data, and adds it into the queue as seen below.

```c
void USART2_IRQHandler(){
  // Initialize variable to trigger context switch to false (no context switch)
  BaseType_t xHigherPriorityTaskWoken = pdFALSE;

  // Receive the data loaded into the UART DR (data register)
  uint8_t receivedData = 0;
  // use the uart 2 CMSIS define (reduce risk of hanging interrupt)
  receivedData = hal_uart_read_byte(USART2);

  // Add the received data into the rx buffer stream
  xStreamBufferSendFromISR(port_uart2.rxbuffer, &receivedData, sizeof(receivedData), &xHigherPriorityTaskWoken);

  // Check and trigger a context switch if needed
  portYIELD_FROM_ISR(xHigherPriorityTaskWoken);
}
```

One of the most important parts of the interrupt is the `xHigherPriorityTaskWoken` variable. When data is added to the stream buffer, the OS checks if there are any tasks that are currently waiting to receive data from the stream being added to. If such tasks exist, and are higher priority than the task currently running (before the interrupt), then a context switch is triggered upon leaving the interrupt handler.
On the other end of the receive queue, a task waits for data to appear and then acts upon it appropriately. In the example pictured below, the data is simply echoed back over UART for debugging purposes.

```c
void tsk_USART2_Handler(void *param){
  (void)param;
  for(;;){
    uint8_t buf[64];
    size_t bytes = xStreamBufferReceive(port_uart2.rxbuffer, (void*) &buf, 64, portMAX_DELAY);
    printf("%s (%d)\n", buf, bytes);
    // reset the stream buffer
    for (int i = 0; i < 64; i++) buf[i] = 0;
  }
}
```

In the future, this function could be replaced with, for example, a receive driver for a device that operates over UART. This could include sensors such as a GPS or accelerometer, or even another microcontroller.

## Conclusion
Now that I have successfully written the bulk of the FreeRTOS UART driver, several sections can be duplicated in order to expand the driver to support more than one UART interface.
Having come into this project with nearly no understanding of resource handling or semaphores, I feel that I have learned a lot in the making of these drivers. I hope to continue my learning as I progress through building my own system from the ground up.