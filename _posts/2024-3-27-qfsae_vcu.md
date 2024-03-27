---
title: QFSAE Vehicle Control Unit
date: 2024-3-27
categories: [PCB]
tags: [STM32, FSAE, Altium]
author: Jacob
image:
  path: /assets/fsae/VCU/pcb3d_tilted.png
  alt: Q24 Electric Vehicle Control Unit
---

## Introduction
As the Queen's Formula SAE team continues to transition from internal combustion to electric, one of the most important components to consider is the Vehicle Control Unit, or VCU.
The VCU sits at the heart of the car, responsible for everything from controlling the motor power and throttle control signals down to the coolant system and brake light.

### Internal Combustion
In previous internal combustion cars, the control of the car was split up into two primary control units. The ECU, or engine control unit, interfaced with the sensors and throttle control. The ECU was responsible for all high speed computations and communications including engine timing, shifting, fuel injection and ignition control.
The PDM, or Power Distribution Module, was responsible for controlling power flow throughout the car. With the exception of the starter motor, every electronic device on the car was fed power from one of the PDM's load switches.

### Electric VCU
Upon moving to an electric vehicle, the decision was made to consolidate the ECU and PDM into a single control unit: The VCU. This decision was the result of the IC ECU having to manage and control a large variety of sensors and perform a significant amount of calculations to control the IC engine.
However, inside of an electric vehicle, nearly all of the motor control is delegated out to the inverter. Additionally, accumulator (battery) management must be able to take place outside the car, and is largely completed by the BMS (Battery Management System).
This leaves only two primary responsibilities left over for the VCU: Power Management and Throttle Control.
While this could have been separated into two distinct control boards, the intercommunication required would significantly increase the technical complexity of both boards involved. Thus, the decision was made to use a single board for both tasks.
This board was given the designation of Vehicle Control Unit, and its design is outlined below.

## Schematic Design
Utilizing the old IC wiring harness and the EV block diagram as a guide, the schematic design for the VCU was completed. Before starting, the following basic features that must be present in the board were outlined:
- 24V Compatible
- 24V Load Switches (x8)
	- Inverters
	- BMS
	- Dashboard
- 12V High Current Rail
	- 6 12V Load Switches for legacy 12V sensors and devices such as the transponder
- 5V Rail
	- 6 5V Load Switches for sensors and BSPD
- Analog Inputs
### Top

### MCU

### Power Management
#### Board Power

#### Load Switching

### Inputs and Outputs (IO)

#### Analog

#### Digital

#### Indication and Debug

## PCB Design

### Layout

### Routing

## Board Viewer

## Conclusion
