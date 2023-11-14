---
title: STM32 Bare Metal Blinky
date: 2023-11-11
categories: [ARM Bare Metal]
tags: [stm32, baremetal, firmware]
author: Jacob
image:
  path: /assets/baremetal/q23mockecu.jpg
  lqip: data:image/webp;base64,UklGRpoAAABXRUJQVlA4WAoAAAAQAAAADwAABwAAQUxQSDIAAAARL0AmbZurmr57yyIiqE8oiG0bejIYEQTgqiDA9vqnsUSI6H+oAERp2HZ65qP/VIAWAFZQOCBCAAAA8AEAnQEqEAAIAAVAfCWkAALp8sF8rgRgAP7o9FDvMCkMde9PK7euH5M1m6VWoDXf2FkP3BqV0ZYbO6NA/VFIAAAA
  alt: Responsive rendering of Chirpy theme on multiple devices.
---

## Inspiration

Fascinated with how the Arduino HAL (Hardware Abstraction Layer) works, I decided to learn a little more about bare metal programming. This project is rather simple, but provided me with some basic insight into the inner workings of not only how the Arduino HAL works, but also the basics of how micro-controllers operate.

## Introduction

Having no idea where to start on this project, I followed [this](https://github.com/cpq/bare-metal-programming-guide) Bare Metal Programming Guide I found on GitHub written by Sergey Lyubka. The guide covered nearly everything I needed to know with the exception of a few things. First, the guide was written for using an F429, I only have access to an F446, therefore some of the registers had to be changed. Secondly, I did not have access to an ST-Link while working on this tutorial, therefore I had to use the ARM-GDB command line utility instead of the ST-Link utility. Since this tutorial already exists, I will not repeat it, but simply give a short reap in order to demonstrate what I have learned.

## Micro Controller Boot

The first step in using a new micro controller is to write the startup and linker scripts.

#### The Linker Script

The linker script tells the linker (second half of the compiler) where the bounds of the memory are on the specific micro controller we are using. This ensures two things: First, that the compiled binary will have data in the correct locations, and secondly, that your compiled binary will not exceed the size of the flash memory.

The most important parts of the linker script are the first 6 lines. They specify the entry point and bounds of the flash memory and ram.

```
ENTRY(_reset);
MEMORY {
    /* f446 memory mapping (table 3*/
    flash(rx) : ORIGIN = 0x08000000, LENGTH = 512K
    sram(rwx) : ORIGIN = 0x20000000, LENGTH = 128K
}
```

The entry point is the first function that should run. Here, I have set it to be the `_reset` function. Below the entry point is the memory defines. This tells the linker where flash memory and ram start and end. These values are obtained from the MCU data sheet.

#### The Startup Script

The Startup script is responsible for transferring data out of flash and into ram. In the previous section, we made it the entry point for the system. This is because it is the very first thing that needs to run before our system can do anything else. As seen below, the `_reset` function first copies data out of flash and into ram, and then calls the main function.

```c
// Startup Code
// Loads main function from flash into SRAM on startup
__attribute__((naked, noreturn)) void _reset(void) {
    // menset .bss to zero and copy the .data section to the ram region
    extern long _sbss, _ebss, _sdata, _edata, _sidata;
    for (long *dst = &_sbss; dst < &_ebss; dst++) *dst=0;
    for (long *dst =&_sdata, *src = &_sidata; dst < & _edata;) *dst ++ = *src++;

    main(); // call main()
    for (;;) (void) 0; // infinite loop if main returns
}
```
Note that after the `main` function, the program enters into an infinite loop. This is because the main function should never exit. If the main function does exit, then it can be treated as a hard fault.

## RCC - The Power and Reset Register

The `RCC` register on STM32 micro controllers serves as the power and reset register. It has the capability to turn on and off the power to almost every device internal to the processor. In order to initialize the `RCC` register, we can first create some structs and defines to make accessing it a little bit easier. Note that these structs and macros exist as part of the CMSIS files, but I chose to write these myself in order to better understand how they work.

```c
// Struct for accessing STM32F446 Power Control Module
struct rcc {
    volatile uint32_t CR, PLLCFGR, CFGR, CIR, AHB1RSTR, AHB2RSTR, AHB3RSTR,
        RESERVED0, APB1RSTR, APB2RSTR, RESERVED1[2], AHB1ENR, AHB2ENR, AHB3ENR,
        RESERVED2, APB1ENR, APB2ENR, RESERVED3[2], AHB1LPENR, AHB2LPENR,
        AHB3LPENR, RESERVED4, APB1LPENR, APB2LPENR, RESERVED5[2], BDCR, CSR,
        RESERVED6[2], SSCGR, PLLI2SCFGR;
};

// STM32F446RE RCC Memory Addr
#define RCC ((struct rcc *) 0x4002
```

## GPIO Registers

Now that we have created a register to access the `RCC`, the same principles can be applied to the `GPIO` registers. This produces the following result:

```c
// Macros to make code more readable
#define BIT(x) (1UL << (x))
// Package a pin bank (U8) and pin number (U8) into single package (U16)
#define PIN(bank, num) ((((bank) - 'A') << 8) | (num))
// Retrieve pin number (U8) from pin package (U16)
#define PINNO(pin) (pin & 255)
// Retrieve pin bank (U8) from pin package (U16)
#define PINBANK(pin) (pin >> 8)

// struct for referencing GPIO memory (ex. GPIO bank A)
struct gpio {
    volatile uint32_t MODER, OTYPER, OSPEEDR, PUPDR, IDR, ODR, BSRR, LKR, AFR[2];
};

// Reference memory address for STM32F446RE GPIO banks
#define GPIO(bank) ((struct gpio *) (0x40020000 + 0x400 * (bank)))

// STM32 GPIO Modes (for MODER)
enum GPIO_MODE {
    INPUT, OUTPUT, AF, ANALOG
};
```

I've also included a few additional defines to make life a little easier.
First is the `PIN` define. In order to address a GPIO pin, two pieces of information are needed: The pin bank and the number. All pins on STM32 micro controllers are organized in groups for power saving. By default, these groups are all turned off to save power. Each of these things can be stored as a single 8 bit integer, or, for ease of use, packaged into a single 16 bit integer. The "PIN" definition stores the bank in the upper half of the 16 and the pin number in the lower half.
I've also created an enum for GPIO input and output types. Each type is assigned a number in the STM32F446 data sheet. The numbers are copied into this enum.

## GPIO Write Function

Now I have created methods to access some registers, I will write a simple bit of code to write a digital value to a GPIO pin. 

```c
/**
* @brief Write a Digital Value to a pin
* 
* @param pin PIN(bank, number)
* @param value 
*/
static inline void gpio_write(uint16_t pin, bool value) {
    struct gpio *gpio = GPIO(PINBANK(pin));
    gpio->BSRR = (1U << PINNO(pin)) << (value ? 0 : 16);
}
```

First, we must obtain access to the register that controls the bank for our pin. This can be done with the "GPIO" and "PINBANK" defines created earlier. Once we have access to the correct register, we can either set its output to 1, or reset it to 0. Set or reset depends on writing to either the upper or lower half of the control register as defined in the STM32 Programmers Manual.

## Completing the Code

With all of our functions created, the last step is to enable the correct gpio bank and write some code that blinks the led. My main code has been referenced below. Included in this code is a counter delay function. This simply acts as a delay by blocking the main loop and executing a large count down. It is far from the best method to implement a delay but is simple and works for this purpose.

```c
static inline void count_delay(volatile uint32_t count) {
    while(count--) (void) 0;
}

int main(void){
    uint16_t led1 = PIN('B', 0);
    uint16_t led2 = PIN('B', 1);
    // Turn on the RCC register for pinbank B (same for both leds)
    RCC->AHB1ENR |= BIT(PINBANK(led1));
    gpio_set_mode(led1, OUTPUT);
    gpio_set_mode(led2, OUTPUT);
    for(;;) {
        gpio_write(led1, true);
        gpio_write(led2, false);
        count_delay(999999);
        gpio_write(led1, false);
        gpio_write(led2, true);
        count_delay(999999);
    }
    return 0;
}
```

## Compiling the Code

In order to compile the code, you can call on the arm toolchain, giving it the `main.c` and `link.ld` files, as well as arguments that tell the toolchain to exclude `stdlib` and compile a binary for an M4 processor. This results to the following line:

```
arm-none-eabi-gcc main.c -Tlink.ld -mthumb -mcpu=cortex-m4 --specs nano.specs -nostdlib
```

Since this is a bit of a hassle to do, I created a makefile so that the same result can be completed by typing `make build`.

## Demo

The full codebase is [here on my GitHub](https://github.com/Jchisholm204/bare-metal-programming-guide/tree/main/steps/boot)

{:refdef: style="text-align: center;"}
<div class="container">
  <div class="video">
    <video controls muted style="border-radius: 4px;" width="60%" preload="auto">
      <source src="/assets/baremetal/1hz_blink_alternate.mp4" type="video/mp4">
      Your browser does not support the video tag.
    </video>
  </div>
</div>
{: refdef}