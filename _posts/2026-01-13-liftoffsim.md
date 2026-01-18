---
title: Liftoff Autonomous Drone Simulator
date: 2026-01-13
categories: [k, Scout]
tags: [STM32, FreeRTOS, Scout]
author: Jacob
hidden: false
math: true
image:
  path: /assets/capstone/liftoff_splash.png
  alt: Liftoff Simulator Splash Image
---
Liftoff is first-person drone racing simulator designed for human pilots to explore flying.
To test autonomous drone control, I repurposed Liftoff to act as a high-fidelity testing environment.

While liftoff is designed primarily for human pilots, it can be configured to expose basic telemetry data over UDP.
Additionally, the game is written in Unity, allowing further data to be exposed through modifying the game files.
Finally, control input can be supplied to the game through a virtual controller.
Therefore, the game can be used as a hyper-realistic simulator for testing autonomous flight control algorithms.

## Basic Telemetry Output
By default, Liftoff can be configured to expose basic telemetry data.
For a full explanation on how to enable Liftoff's drone telemetry feature, see [this post on the Steam community forum.](https://steamcommunity.com/sharedfiles/filedetails/?id=3160488434)

On Linux, all telemetry data can be exposed by placing the following inside of  `~/.config/unity3d/LuGus Studios/Liftoff/TelemetryConfiguration.json`.

```json
{ 
  "EndPoint": "127.0.0.1:9001", 
  "StreamFormat": [ 
    "Timestamp", 
    "Position", 
    "Attitude", 
    "Velocity", 
    "Gyro", 
    "Input", 
    "Battery", 
    "MotorRPM" 
  ] 
}
```

Liftoff data can then be retrieved reading data from the UDP connection into the following C structure.

```c
#pragma pack(push, 1) // Critical for network packet alignment
typedef struct {
    float timestamp;              // 4 bytes
    float posX, posY, posZ;       // 12 bytes
    float rotW, rotX, rotY, rotZ; // 16 bytes (Quaternions)
    float velX, velY, velZ;       // 12 bytes
    float gyroP, gyroR, gyroY;    // 12 bytes
    float inT, inY, inP, inR;     // 16 bytes
    float batPct, batVolt;        // 8 bytes
    uint8_t motorCount;           // 1 byte
    float motors[4];              // 16 bytes (for a quad)
} lf_telemetry_packet_t;
#pragma pack(pop)
```

Note that the following socket configuration is required to ensure that the most recent packet is always read by the receiving program.

```c
int buffer_size = sizeof(lf_telemetry_packet_t); 
// Only hold one packet's worth of data
setsockopt(tel->sockfd, SOL_SOCKET, SO_RCVBUF, &buffer_size, sizeof(buffer_size));
```

Without the above configuration, the UDP socket buffer may fill up, causing the simulator data to become out of sync with Liftoff.
Through setting the socket buffer to be exactly the size of one packet, the program will always read the latest data sent from Liftoff.

## Mods + Extracting LiDAR Data
To be able to test autonomous flying algorithms, we must be able to retrieve simulated LiDAR data from the game.
While this data is not exposed by default, it can be through injecting a mod into the game.

The following mod exposes two LiDAR streams over a single UDP port.
The LiDAR data is exposed over the following format:

```c
#define N_POINTS 180
#define PORT 9002

struct lidar_packet {
    float front[N_POINTS];
    float vertical[N_POINTS];
};
```

The "front" LiDAR stream refers to the simulated LiDAR mounted on the top of the drone.
This sensor returns a scan of 180 evenly spaced points starting at the front of the drone, wrapping around the right, back, left and returning to the front.
The "vertical" LiDAR stream refers to the simulated LiDAR mounted on the back of the drone.
This sensor is mounted upright, and returns 180 evenly spaced points covering the top, sides, and bottom.

The orientations of the sensors can be reconfigured by changing the mod.
However, they are chosen such that the drone can use the vertical sensor to remain centered within an enclosed space while using the front sensor to avoid obstacles in its path.

### Installing The Mod
To install the mod, first download [BepInEx](https://github.com/bepinex/bepinex/releases) from its releases page and follow the install instructions.
On Linux, this consists of extracting the BepInEx folder and placing it inside of  `~/.local/share/Steam/steamapps/common/Liftoff`.
After extracting, create the `plugins` folder inside of the `BepInEx` folder.

#### BePinEx Configuration
Once BepInEx is installed, some configuration values must be changed, the most important of which is ensuring that the mod is hidden from Unity.
Without this, the mod will fail to work.
To hide the mod from Unity, change the `[Chainloader]` section of `BepInEx/config/BepInEx.cfg` to match the following:
```
[Chainloader]

## If enabled, hides BepInEx Manager GameObject from Unity.
## This can fix loading issues in some games that attempt to prevent BepInEx from being loaded.
## Use this only if you know what this option means, as it can affect functionality of some older plugins.
## 
# Setting type: Boolean
# Default value: false
HideManagerGameObject = true
```

Additionally, disabling mod caching has also been found to help resolve some issues.
```
[Caching]

## Enable/disable assembly metadata cache
## Enabling this will speed up discovery of plugins and patchers by caching the metadata of all types BepInEx discovers.
# Setting type: Boolean
# Default value: true
EnableAssemblyCache = false
```

#### Building/Loading the Mod
To start receiving LiDAR data from the game, clone the mod from its [GitHub](https://github.com/Jchisholm204/LiftoffSimulator/tree/main) repository.
Once cloned, build the mod with:

```
cd LidarMod/LiftoffLidar && dotnet build
```

Finally, copy the built executable from the build folder to the BepInEx plugins folder:

```
cp ~/Documents/LiftoffSimulator/LidarMod/LiftoffLidar/bin/Debug/netstandard2.1/LiftoffLidar.dll ~/.local/share/Steam/steamapps/common/Liftoff/BepInEx/plugins`
```

> **WARNING:**
> Do not attempt to symlink the mod.
> Symlinking will cause the mod to fail to load into the game.
{:.prompt-warning}

After completing the above, the game can be launched and the LiDAR data can be received over UDP.
Again, use the aforementioned UDP port configuration to ensure that LiDAR data is not buffered.

### Configuring The Mod
The mod files are open source at [GitHub/Jchisholm204/LiftoffSimulator](https://github.com/Jchisholm204/LiftoffSimulator/blob/main/LidarMod/LiftoffLidar/Plugin.cs).
They can be freely modified to suit any purpose.
The two primary modifications one may choose to make are modifying the number of LiDAR points and changing the mount angles.

#### Changing The Number of LiDAR Points
The number of LiDAR points is configurable with the following constant:

```cs
private const int N_POINTS = 180;
```

Note that changing this number may result in the LiDAR array being larger than a single UDP packet.

#### Changing the LiDAR Angles
To change the LiDAR angles, the following lines can be changed:

```cs
// Scan forward and to the sides
Vector3 direction = Quaternion.AngleAxis(i*(360f/N_POINTS), drone.transform.up) * drone.transform.forward;

...

// Scan up and to the sides
direction = Quaternion.AngleAxis(i*(360f/N_POINTS), drone.transform.forward) * drone.transform.up;
```

Note that Liftoff uses the `XZY` coordinate system, that is Y is upwards.

### Extra Notes
Given that the Liftoff developers cannot be asked to support modding their game, the game object of focus for the LiDAR data was found through trial and error.
This resulted in the `DroneHUD_Custom(Clone)` game object being used as the "mounting" point for the virtual LiDARs.

It is important to note that this game object is tied to the camera angle.
This means that that camera angle must be set to 0 deg by pressing the down arrow after the game launches.


## Game Input / Virtual Controller
The final step in using Liftoff as a simulation tool is to create a mechanism that allows the algorithm to control the virtual drone.
This was done through creating a virtual controller device using the Linux `uinput` library.

To achieve this result, the `joystick` code can be copied from the same GitHub repository as the mod.
The following functions are available and are fairly self explanatory:

```c
enum axis {
    AXIS_THROTTLE = ABS_X,
    AXIS_YAW = ABS_RX,
    AXIS_PITCH = ABS_Z,
    AXIS_ROLL = ABS_Y,
};

extern int joystick_init(struct joystick *joy);
extern int joystick_write(struct joystick *joy, enum axis axis, int value);
extern int joystick_close(struct joystick *joy);
```

## Optional - ROS Nodes
As part of Project Scout, several ROS nodes were written to expose Liftoff Simulator data on the ROS network.
These nodes can be found on the [Scout GitHub Repository.](https://github.com/Jchisholm204/Scout/tree/main/src/simulation)
All nodes related to Liftoff can be found within the `simulation` package.

### Control Node
The control node can be used to inject control data into Liftoff using the virtual controller code from the previous section.
The control node accepts a Quaternion message containing values between -1 and 1 where -1 is the minimum value, 1 is the maximum, and 0 is the center point.

The Quaternion message is processed by the node as follows:
```cpp
joystick_write(&_joy, AXIS_THROTTLE, qt.z * AXIS_MAX);
joystick_write(&_joy, AXIS_YAW, qt.w * AXIS_MAX);
joystick_write(&_joy, AXIS_PITCH, qt.y * AXIS_MAX);
joystick_write(&_joy, AXIS_ROLL, qt.x * AXIS_MAX);
```

### LiDAR Node
The LiDAR node, titled `lidarstreams` publishes the Liftoff LiDAR data as two `LaserScan` messages.
The node can be configured with the following configuration values:

```cpp
this->declare_parameter("lidar_front_name", "lidar_front_frame");
this->declare_parameter("lidar_vertical_name", "lidar_vertical_frame");
this->declare_parameter("pub_rate", 50);
```


### Launch File
To view LiDAR data inside of RVIZ, the following launch script can be used.
This launch file will also load a drone model inside of RVIZ, and setup the control node.

> **WARNING:**
> Do not attempt to launch the `simulation/control` node with a controller plugged in.
> If the control node is launched while a physical controller is connected, it can cause a glitch within the game.
> This glitch will result in no controllers being found.
> To resolve this glitch, close everything and restart.
{:.prompt-warning}

```python
from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument
from launch_ros.actions import Node
from ament_index_python.packages import get_package_share_directory
import os


def generate_launch_description():
    # 1. Setup Paths
    package_dir = get_package_share_directory("simulation")
    urdf_path = os.path.join(package_dir, 'udrf', 'sjtu_drone.urdf')

    with open(urdf_path, 'r') as f:
        robot_desc = f.read()

    return LaunchDescription([
        DeclareLaunchArgument('use_sim_time', default_value='false'),

        # Node: Robot State Publisher (Visualizes the drone)
        Node(
            package='robot_state_publisher',
            executable='robot_state_publisher',
            name='robot_state_publisher',
            parameters=[{'robot_description': robot_desc}]
        ),

        # Node: Static TF for LIDAR 1 (Front/Sides)
        # Arguments: x y z yaw pitch roll parent_frame child_frame
        Node(
            package='tf2_ros',
            executable='static_transform_publisher',
            name='tf_lidar_front',
            arguments=['0.1', '0', '0', '0', '0',
                       '0', 'base_link', 'lidar_front_frame']
        ),

        # Node: Static TF for LIDAR 2 (Above/Below/Sides)
        # We might rotate this one 90 degrees (1.5708 radians) on the pitch or roll axis
        Node(
            package='tf2_ros',
            executable='static_transform_publisher',
            name='tf_lidar_vertical',
            arguments=[
                '--x', '0.15',
                '--y', '0',
                '--z', '0.05',
                '--yaw', '0',
                '--pitch', '-1.5708',
                '--roll', '0',
                '--frame-id', 'base_link',
                '--child-frame-id', 'lidar_vertical_frame'
            ]
        ),

        # Node: Launch RViz
        Node(
            package='rviz2',
            executable='rviz2',
            name='rviz2',
            output='screen',
            arguments=['-d', './rviz_sim.rviz']
        ),
        # Launch the simulation interfaces
        Node(
            package='simulation',
            executable='control',
            name='sim_ctrl',
            ),
        Node(
            package='simulation',
            executable='lidarstreams',
            name='sim_lidar',
            ),
    ])
```

