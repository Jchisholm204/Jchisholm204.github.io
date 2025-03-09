---
title: QSET Arm Firmware
date: 2025-1-26
categories: [Firmware]
tags: [STM32, QSET, Altium, FreeRTOS]
author: Jacob
image:
  path: /assets/qset/armpcb/final_board.jpg
  alt: Queen's Space Engineering Team Arm Control Board
---

## Introduction
As my first hardware project of the year I designed a control board for the Queen's Space Engineering Team (QSET).
After the board was delivered, I got to work on my first software project of the year: The Firmware.

As discussed in my previous article ([listed here](https://jchisholm204.github.io/posts/qset_armv1/)), the Arm control board is designed to interface with AK Series motors, servos and limit switches on the arm.
To accomplish this, I have designed a USB interface, allowing the arm board to act as an extension of the ROS codebase responsible for the rest of the rover.

## USB Implementation
At first, I attempted to write my own Hardware Abstraction Layer (HAL) and driver for the USB-OTG interface present on STM32 microcontrollers.
However, after realizing the full complexities of the USB protocol, I determined that the project would not complete on schedule and I was better off using a library.
After some research, I imported the [libusb_stm32 library](https://github.com/dmitrystu/libusb_stm32) from dmitrystu.

After following the example code given in the library, I was able to integrate it into my FreeRTOS project with my existing HAL.
Some light modifications later and I ended up with a complete USB device featuring two CDC interfaces built with interface association descriptors.

I will not pretend to know everything there is to know about USB as I did not write this library and it took me some time reading through the USB CDC specifications to make this device work.
Therefore, if you wish to know more about the CDC interface or IAD's, you would be better off reading the official specifications found [here](https://www.usb.org/document-library/class-definitions-communication-devices-12).
Additionally, the USB specification has some interesting information in chapter 5, 8, and 9.
You can find that document [here](https://eater.net/downloads/usb_20.pdf).

USB Operated control board for the QSET 2025 Arm.

- Designed to interface with AK Series motors, servos and limit switches.
- Control interfaces are exposed over a USB CDC interface built with the IAD mechanism.
- Virtual COM port implemented for error feedback through USB CDC (IAD)

### USB Device Specifications
Below are the specifications for the device I have developed.
Interfaces are exposed from the viewpoint of the host as per USB IF specifications.

- Vendor ID: 0xFFFE
- Product ID: 0x0A4D
- Virtual COM port (CDC)
    - NTF Interface Number: 0x00
    - Data Interface Number: 0x01
    - Data RX EP: 0x01
    - Data TX EP: 0x81
    - Maximum Data Packet Size: 0x40
    - NTF EP: 0x82
    - Maximum NTF Packet Size: 0x08
- Control Endpoint (CDC)
    - NTF Interface Number: 0x02
    - Data Interface Number: 0x03
    - Data RX EP: 0x03
    - Data TX EP: 0x83
    - Maximum Data Packet Size: 0x40
    - NTF EP: 0x84
    - Maximum NTF Packet Size: 0x08

### Device Control Packets
To interface with the device, I have designed several control packets that can be interchanged between the device and host.
If attempting to modify these packets, do not include enumerations.
The sizes of enumerations may not be constant across all architectures, which can cause misalignment errors.

#### Device to Host
The device responds to the host with a single 49 byte status packet.
This packet contains limit switch values, and motor information.
The packet structure is shown below:
```c
struct udev_pkt_status {
    // Device Status
    struct udev_status status;
    // Each bit represents a limit switch that is open (0) or closed (1)
    uint8_t limit_sw;
    // Motor Control Response Information
    struct udev_mtr_info mtr[ARM_N_MOTORS];
} __attribute__((packed));
```

#### Host to Device
When sending data from the cost to device, ie control packets, it quickly became apparent that the size of data needed to control a motor far exceeded the 64 byte limit of a USB packet.
Therefore, to keep all packets within a single USB packet, each control packet contains instructions for either one motor or servo.
The control packet structure is shown below:
```c
// Control Packet:
//  From Host to Device
struct udev_pkt_ctrl {
    struct udev_pkt_hdr hdr;
    union{
        uint32_t servo_ctrl;
        // CAN Bus Motor Control
        struct udev_mtr_ctrl mtr_ctrl;
    };
} __attribute__((packed));
```

#### Motor Packets
Motor packets are not designed to be sent outside of a status or control packet.
However, they were separated to use elsewhere in the program.
Motor packets are shown below for completeness:
```c
// Status - Device to Host
struct udev_mtr_info {
    // Motor Temperature (in C)
    uint8_t temp;
    // Motor Current in A/10
    uint8_t current;
    // Motor Position
    float position;
    // Motor Velocity
    float velocity;
} __attribute__((packed));

// Control - Host to Device
struct udev_mtr_ctrl {
    // Motor Position Command
    float position;
    // Motor Velocity Command
    float velocity;
    // Motor Configuration Data
    float kP, kI, kD, kF;
    // Enable this Motor
    uint8_t enable;
} __attribute__((packed));
```

## Motor Control
After much consideration on how to integrate the USB code into motor controllers, I decided that each motor would get its own control task.
Then, the interface between the two would be presented by the motor control task.

### Interface Structure
Each motor maintains its own control structure and data inside of a single structure.
This structure is shown below:
```c
/**
 * @struct _mtrCtrlHndl
 * @brief Motor Control Task Data Structure
 *
 */
typedef struct _mtrCtrlHndl {
    // Motor Identifier
    enum eArmMotors mtr_id;
    // AK Motor
    AkMotor_t akMtr;
    // USB Device Packet Data
    struct udev_mtr_ctrl  udev_ctrl;
    struct udev_mtr_info  udev_info;
    // FreeRTOS Task Information
    TaskHandle_t pTskHndl;
    char pcName[10];
    StackType_t puxStack[MTR_TSK_STACK_SIZE];
    StaticTask_t pxTsk;
} mtrCtrlHndl_t;
```

To initialize a motor control tasks, the function below can be called:
```c
/**
 * @brief Initialize a Motor Control Task
 *
 * @param pHndl Pointer to the memory storing the Task Handle
 * @param mtr_id Motor ID of the motor to control
 * @param mtr_typ Type of the motor to control
 * @param can_id CAN ID of the motor to control
 */
void mtrCtrl_init(mtrCtrlHndl_t *const pHndl, enum eArmMotors mtr_id, enum AKMotorType mtr_typ, uint32_t can_id);
```

Utilizing an existing memory allocation, this function sets up and starts the execution of a motor control task.
While running, the motor controller can be updated with new information and can also be called to retrieve motor status.
These functions are shown below:
```c
/**
 * @brief Update the USB Control Packet
 *
 * @param pHndl Motor Control Handle to update
 * @param pCtrl Pointer to the UDEV Motor Control Data
 */
void mtrCtrl_update(mtrCtrlHndl_t *pHndl, struct udev_mtr_ctrl *pCtrl);

/**
 * @brief Get the latest data from the motor in UDEV format
 *
 * @param pHndl Handle to the motor control task
 * @param pInfo Pointer to the info struct to copy into
 */
void mtrCtrl_getInfo(mtrCtrlHndl_t *pHndl, struct udev_mtr_info *pInfo);
```

### Utilization
The motor control tasks are designed to be run as independent as possible.
In the arm codebase, the motors are first initialized along with the USB task:
```c
// Initialize the motor control Tasks
//           Motor Control Handle,  Joint ID, AK Mtr Type, CAN ID
mtrCtrl_init(&mtrControllers[eJoint1], eJoint1, eAK7010, 0x123);
mtrCtrl_init(&mtrControllers[eJoint2], eJoint2, eAK7010, 0x124);
mtrCtrl_init(&mtrControllers[eJoint3], eJoint3, eAK7010, 0x125);
mtrCtrl_init(&mtrControllers[eJoint4], eJoint4, eAK7010, 0x126);
```

When a USB packet is received, the motor is updated with the following function call:
```c
enum eArmMotors mtr_id = (enum eArmMotors)udev_ctrl.hdr.ctrl_typ;
if(mtr_id >= ARM_N_MOTORS) return;
mtrCtrl_update(&mtrControllers[mtr_id], (struct udev_mtr_ctrl*)&udev_ctrl.mtr_ctrl);
```

Similarly, when status information is requested, it can be retrieved with the following code:
```c
// Get the latest data from the motor
for(enum eArmMotors m = 0; m < ARM_N_MOTORS; m++){
    mtrCtrl_getInfo(&mtrControllers[m], (struct udev_mtr_info*)&udev_info.mtr[m]);
}
```

### Motor Types
On the QSET Arm, there are many different types of AK Motors.
While each motor has the same control interface, different constants are used between them.
To accommodate this, a constants structure has been created along with a static array defining the different motors.
Currently, this has only been updated to support the AK7010 series.

The definition of the struct and AK7010 constants are shown below:
```c
enum AKMotorType{
    eAK7010,
    eAK_N_MOTORS
};

struct AKMotorConfig {
    float pos_min, pos_max;
    float vel_min, vel_max;
    float trq_min, trq_max;
    float kp_min,  kp_max;
    float kd_min,  kd_max;
    float cur_min, cur_max;
    float tmp_min, tmp_max;
};

// AK Motor Configurations - Must be in order of AKMotorType enum
static const struct AKMotorConfig AKConfigs[eAK_N_MOTORS] = {
    // AK70-10 Configuration
    (const struct AKMotorConfig){
        .pos_min = -12.5,
        .pos_max = 12.5,
        .vel_min = -50,
        .vel_max = 50,
        .trq_min = -25,
        .trq_max = 25,
        .kp_min = 0,
        .kp_max = 500,
        .kd_min = 0,
        .kd_max = 5,
        .cur_min = -60,
        .cur_max = 60,
        .tmp_min = -20,
        .tmp_max = 127
    },
};
```

## Servo Interface
To maintain uniformity across the codebase, the servo interface is widely similar to the motor interface.
However, the servos are PWM controlled from a timer interface and have no feedback mechanism.
Therefore, they do not require their own control task.

### Timer PWM HAL
As I did not currently have a PWM interface in my HAL, I started the servo interface by writing one.
As with most timer driven HAL's, writing the PWM interface was relatively simple.
The completed interface contains three functions:
```c
// Initialize a timer for use with PWM
static inline void hal_tim_pwm_init(TIM_TypeDef *pTIM, uint16_t prescaler, uint16_t arr);
// Configure a timer channel for PWM
static inline void hal_tim_pwm_configure_channel(TIM_TypeDef *pTIM, enum eTimCh ch);
// Set the PWM value for a timer channel
static inline void hal_tim_pwm_set(TIM_TypeDef *pTIM, enum eTimCh ch, uint32_t preload);
```

To simplify things I created a timer channel enumeration containing representations for the four channels present in STM32 Timers.

### Servo Control
Presenting nearly identical to the motor interface, the servo control presents an initialization function and a set function.
However, both of these functions are simply wrappers to the HAL.

The first function, shown below, makes calls to `pwm_init` and `pwm_configure_channel` HAL functions.
```c
static void srvCtrl_init(uint16_t pre, uint16_t arr);
```

The second function, also shown below, calls the `hal_tim_pwm_set` function, exchanging arm servo values for timer channel values.
```c
static void srvCtrl_set(enum eArmServos srv, uint32_t val_us)
```

### Servo Initialization and Use
The servos are initialized in the main function, right above the motors.
Utilizing the correct divider and preload values, servo control can be done using microsecond values.
```c
// Initialize the PWM Timer for the servos
srvCtrl_init((PLL_N/PLL_P)-1, 9999);

// Set Servos to default Values - in us
srvCtrl_set(eServo1, 1500);
srvCtrl_set(eServo2, 2500);
srvCtrl_set(eServo3, 2000);
srvCtrl_set(eServo4, 1750);
```

## Limit Switches
The arm board was designed with hardware pull downs.
Thus the limit switches are simply digital inputs.
To conserve space, limit switch values are encoded into a single 8 bit integer that can be sent over USB.
The highest bit of this integer is always 1, encoded as a sort of checksum.

Limit switch code occupies a single header file, the get function is shown below:
```c
/**
 * @brief Get the limit switches state
 *
 * @returns one hot encoding / highest bit always hot
 */
static inline uint8_t lmtSW_get(void){
    uint8_t lsw = 0x00U;
    lsw |= (uint8_t)((uint8_t)gpio_read_idr(PIN_LSW_1) << 0);
    lsw |= (uint8_t)((uint8_t)gpio_read_idr(PIN_LSW_2) << 1);
    lsw |= (uint8_t)((uint8_t)gpio_read_idr(PIN_LSW_3) << 2);
    lsw |= (uint8_t)((uint8_t)gpio_read_idr(PIN_LSW_4) << 3);
    lsw |= (uint8_t)((uint8_t)gpio_read_idr(PIN_LSW_5) << 4);
    lsw |= (uint8_t)((uint8_t)gpio_read_idr(PIN_LSW_6) << 5);
    lsw |= 0x80;
    return lsw;
}
```

## Conclusion
With the firmware now complete, I will move on to writing a kernel driver to replace the existing interface library I have developed.

Check out the full code on my [GitHub Gentry Repository found here.](https://github.com/Jchisholm204/Gentry/tree/main/QSET/ARM_V1)
