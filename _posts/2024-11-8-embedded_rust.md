---
title: STM32 Embedded Rust
date: 2024-11-8
categories: [Firmware, STM32]
tags: [STM32, Rust]
author: Jacob
image:
  path: /assets/baremetal/RustScreenshot.png
  #lqip: data:image/webp;base64,UklGRpoAAABXRUJQVlA4WAoAAAAQAAAADwAABwAAQUxQSDIAAAARL0AmbZurmr57yyIiqE8oiG0bejIYEQTgqiDA9vqnsUSI6H+oAERp2HZ65qP/VIAWAFZQOCBCAAAA8AEAnQEqEAAIAAVAfCWkAALp8sF8rgRgAP7o9FDvMCkMde9PK7euH5M1m6VWoDXf2FkP3BqV0ZYbO6NA/VFIAAAA
  alt: Embedded Rust Code
---

## Introduction
For some time now I have been interested in improving my Rust skills.
It just so happens that the other day I saw an article on Embedded Rust.
Reading through the documentation for the
[stmrs](https://github.com/stm32-rs/stm32f4xx-hal/tree/master) project,
I was surprised at how simplistic well organized the HAL was.

Wanting to experiment, I installed the required Cargo dependencies and created a project.
Since most of this is documented in the [embedded rust book](https://docs.rust-embedded.org/book/intro/index.html), I wont go into detail about setting up the environment.

## The Code
Below is the code I wrote for this mini project.
It contains only the main function and a single ISR for processing rx interrupts from the USART peripheral.
While it is very simplistic code, blinking an led and echoing the serial port, it was sufficient to allow me to try out the language.

```rust
#![no_main]
#![no_std]

use core::fmt::Write;
use cortex_m_rt::entry;
use stm32f4xx_hal::interrupt;
use stm32f4xx_hal::{self as hal};
use crate::hal::{pac, prelude::*, serial::{Config, Serial}};
use cortex_m::peripheral::NVIC;
use cortex_m::interrupt::Mutex;
use heapless::{String, spsc::Queue};
use core::cell::RefCell;

use panic_probe as _; // panic handler

const BUF_SIZE : usize = 256;

static BUFFER: Mutex<RefCell<Option<String<BUF_SIZE>>>> = Mutex::new(RefCell::new(None));
static USART_QUEUE: Mutex<RefCell<Option<Queue<u8, BUF_SIZE>>>> = Mutex::new(RefCell::new(None));

#[entry]
fn main() -> ! {
    if let (Some(dp), Some(cp)) = (
        pac::Peripherals::take(),
        cortex_m::peripheral::Peripherals::take(),
    ) {
        // Set up the LED
        let gpiob = dp.GPIOB.split();
        let mut led2 = gpiob.pb7.into_push_pull_output();

        let rcc = dp.RCC.constrain();
        let clocks = rcc.cfgr.sysclk(180.MHz()).freeze();

        let mut delay = cp.SYST.delay(&clocks);

        let gpiod = dp.GPIOD.split();
        let tx_pin = gpiod.pd8.into_alternate();
        let rx_pin = gpiod.pd9.into_alternate();

        // Set up USART3 for serial communication
        let mut serial = Serial::new(
            dp.USART3,
            (tx_pin, rx_pin),
            Config::default().baudrate(9600.bps()).wordlength_8(),
            &clocks,
        )
        .unwrap();

        // Enable the RX interrupt for USART3
        serial.listen(stm32f4xx_hal::serial::Event::RxNotEmpty);

        // Enable USART3 interrupt in NVIC
        unsafe {
            NVIC::unmask(pac::Interrupt::USART3);
        }
        // Initialize the buffer and queue for storing received characters
        cortex_m::interrupt::free(|cs| {
            BUFFER.borrow(cs).replace(Some(String::new()));
            USART_QUEUE.borrow(cs).replace(Some(Queue::new()));
        });

        loop {
            // Toggle the LED
            led2.toggle();
            delay.delay_ms(500);

            // Check if we have a complete string in the buffer
            cortex_m::interrupt::free(|cs| {
                if let Some(buffer) = BUFFER.borrow(cs).borrow_mut().as_mut() {
                    if buffer.ends_with('\n') {
                        // Print the complete message and clear the buffer
                        write!(serial, "Received: {}", buffer).unwrap();
                        buffer.clear();
                    }
                }
            });
        }
    }

    loop {}
}

// USART3 interrupt handler
#[interrupt]
fn USART3() {
    cortex_m::interrupt::free(|cs| {
        let usart3 = unsafe { &*pac::USART3::ptr() };
        if usart3.sr.read().rxne().bit_is_set() {
            // Read the received character
            let received = usart3.dr.read().dr().bits() as u8;

            // Access buffer and add the received character
            if let Some(buffer) = BUFFER.borrow(cs).borrow_mut().as_mut() {
                // Only add character if there’s space in the buffer
                if buffer.push(received as char).is_err() {
                    buffer.clear(); // Clear if buffer overflows
                }
            }
        }
    });
}
```

## Problems & Evaluation
Overall, this was a fairly easy project.
I was able to get an led blinking in under an hour (including installing the tools) and it only took me another 35 minutes to get USART working.
That being said, I do have a few notes.

### Problems
Since there are too many to go into depth about, I'm just going give a list:
- No easy way to view RAM/FLASH usage on the microcontroller
- Using the HAL results in no control over chip startup
- No FreeRTOS equivalent: [RTIC](https://rtic.rs/2/book/en/by-example.html) does not have preemption
- Unsafe Blocks: Why would I use Rust if everything ends up in an unsafe block
- Complex Interrupts
- Generally complex code

I will admit that most of these are not valid reasons, but are opinions.

### Evaluation
The purpose of this project was to experience what it was like to write embedded code in rust.
While I did enjoy the project, I'm still unsure of how this would look on a larger scale.
I've had numerous issues in the past with global variables in Rust.
In C, this can be solved with wrapping the variables in a mutex or semaphore.
When I know that this is unnecessary, I don't have to include it.
Whereas in Rust, the compiler will complain.

Given my past experience, I think that I will be sicking to C for the time being.
I have put a lot of time and effort into my C setup/environment, I enjoy using it and working in C.
I also enjoy making my own HAL and drivers. Attempting to transfer my work to a different language would be less learning and more repetition.

