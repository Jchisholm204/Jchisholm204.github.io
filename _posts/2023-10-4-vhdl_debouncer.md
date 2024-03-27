---
title: "VHDL: Debouncer"
date: 2023-10-4
categories: [HDL]
tags: [VHDL, FPGA]
author: Jacob
---

Today we will talk about a process called debouncing, what it is used for, and how to implement it on an FPGA using VHDL

## What is Debouncing?

In order to know what debouncing is and its use cases, will first examine something as simple as a button. 
#### The Problem With Buttons
For this example we will look at a simple series circuit where a button is wired in series with a power source and an LED. The normal state of the button is open, therefore when the button is not pressed, the LED is off. Upon pressing the button down, the button reaches its active state, and the LED turns on. To us, this process is instantaneous. When the button was not pressed, the LED was off and as soon as it was pressed, the LED turned on. However, it only *appears* that way to us because of the scale at which we perceive time.
Now lets examine the same situation, but slow it down. One of the possible ways we could do this is with an oscilloscope. If we were to slow down the exact instant we press the button, we wouldn't see the LED instantaneously turn on, but rather we would see it briefly flicker before illuminating. This is because buttons are not made perfectly, so when we press them down the signal, or voltage, coming out of them "bounces" before coming to a solid state value.
While this "bouncing" phenomenon is not a problem for our simple LED circuit, it can become a problem when the button is, for example, designed to trigger a process on a computer. While the expected behavior may be that a process runs once upon the press of the button, the actual behavior may be that the process runs many times.
"Debouncing" is the term used to solve the aforementioned problem.
Now that we know what "bouncing" is, the next two sections discuss ways to "debounce" buttons.
#### Hardware Debouncing
Hardware debouncing is the simplest method to debounce a button. It requires no extra code and can be used on any type of button or switch. Hardware debouncing works based off of the same principles used in RC (Resistor Capacitor) circuits. With hardware debouncing, the button must remain in the on state long enough for the capacitor to charge above the voltage threshold required by the computer. The debounce time, or how long the button must remain on for, can be changed by manipulating the R and C values of the RC circuit.

#### Software Debouncing
In software debouncing, rather than directly triggering a process whenever the button changes state, a timer is started. When the button changes state, the timer is reset. When the timer reaches a certain threshold, the process is then started. The primary benefit of software debouncing is that it can be implemented without any additional hardware. This makes it an ideal solution for situations where the hardware has already been finalized, or cannot easily be modified.

## Debouncing in VHDL
Now that we have examined the purposes and functionality of a debouncer, we will now go over the implementation of a debouncer in VHDL.
The first step in creating a generic debouncer module is to create its entity statement and set up its architecture. 

```vhdl
library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;

entity debounce is
  generic(
    clkFreq : integer := 50e6
  );
  port(
    i_clk    : in  std_logic;
    i_button : in  std_logic;
    o_button : out std_logic
  );
end entity;

architecture behavioral of debounce is

begin
end architecture;
```
Here, I have included signals for the button input, button output, and a clock signal. I have also included a generic input for clock frequency. If the system using this module has a vastly different clock speed, it can cause the debounce time to either be too long, or too short.
Next, I created some internal signals for the counter, button values, and a counter reset signal.
```vhdl
architecture behavioral of debounce is
  signal counter       : integer := 0;
  signal counter_reset : std_logic;
  signal flipflop     : std_logic_vector(1 downto 0);
begin
	counter_reset <= flipflops(0) xor flipflops(1);
end architecture;
```

Note that the counter reset signal is driven by an XOR gate between the two values inside the flip-flop. Therefore, when the button changes its value, the two values in the flip-flop will differ, and the the counter will be reset. But, if both values are the same, the counter reset signal will be driven low.
The final part of the code is the process that drives the flop-flop and the counter. The process runs on every rising edge of the clock tick and increments the counter by one. Once the counter reaches a certain value ($\frac{clk Frequency}{10^2}$) the button output signal is set to the button input signal.

```vhdl
process(i_clk) is
begin
  if(rising_edge(i_clk))     then
	flipflop(1) <= flipflop(0);
	flipflop(0) <= i_button;
	if(counter_reset = '1')        then
	  counter   <= 0;
	elsif (counter < clkFreq/10e2) then
	  counter   <= counter + 1;
	else
	  o_button  <= flipflop(1);
	end if;
  end if;
end process;
```

## Full Code

```vhdl
library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;

entity debounce is
  generic(
    clkFreq : integer := 50e6
  );
  port(
    i_clk    : in  std_logic;
    i_button : in  std_logic;
    o_button : out std_logic
  );
end entity;

architecture behavioral of debounce is
  signal counter       : integer := 0;
  signal counter_reset : std_logic;
  signal flipflop      : std_logic_vector(1 downto 0);
begin

  counter_set <= flipflop(0) xor flipflop(1);

  process(i_clk) is
    begin
      if(rising_edge(i_clk))     then
        flipflop(1) <= flipflop(0);
        flipflop(0) <= i_button;
        if(counter_reset = '1')        then
          counter   <= 0;
        elsif (counter < clkFreq/10e2) then
          counter   <= counter + 1;
        else
          o_button  <= flipflop(1);
        end if;
      end if;
  end process;
end architecture;
```