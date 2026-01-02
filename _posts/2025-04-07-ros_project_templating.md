---
title: ROS Project Templating
markdown: kramdown
date: 2025-09-13
categories:
  - Robotics
tags:
  - ROS
author:
  - Jacob
math: "true"
hidden: true
---

ROS projects can quickly become large and over complicated.
Packages and nodes add up, and maintaining `Makefiles` along with project organisation can become a major challenge.
To make matters worse, the ROS maintainers/creators have no recommended organisational tree or structure of any kind.

This article suggests one possible way to organise a ROS project.

# Packages and Nodes
Packages and Nodes are the primary organisational method provided by the ROS maintainers.
To better understand the relationship between packages and nodes, we can refer to the ROS documentation: "A package is the main unit for organising software in ROS. A node is an executable file with a package."
Following this relationship, we can construct a sample organisational structure.

```
MyPackage
├── MyNode1
└── MyNode2
```

## Naive Approach
From the ROS documentation, each package should have a single `CMakeLists.txt` file.
Given the use of a single build file, one could construct a naive  package structure like follows:

```
MyPackage
├── include
│   ├── my_node1.hpp
│   └── my_node2.hpp
├── src
│   ├── my_node1.cpp
│   └── my_node2.cpp
├── package.xml
└── CMakeLists.txt
```

However, if the above structure is used, code from both nodes will be deeply entangled.
This can quickly lead to numerous issues including packages having large, convoluted build files, difficult to diagnose errors, and decreased portability.

Another possible approach would be to limit each package to contain one node.
However, this approach provides little benefit over the previous approach, requiring an abundance of packages and removing organisational structure from the project.

## A Better Approach
Recapping the previous section, the problems with the naive approach surround the nodes being deeply entangled. 
Fortunately, the smart people who developed CMake have found a way to simplify large build files.
Therefore, the project organisation can be adjusted to as follows:

```
MyPackage
├── MyNode1
│   ├── include
│   ├── src
│   └── build.cmake
├── MyNode2
│   ├── include
│   ├── src
│   └── build.cmake
├── package.xml
└── CMakeLists.txt
```

### Configuring `CMakeLists.txt`
As seen in the above "better" approach, multiple CMake files are used to complete the project compilation.
Each node receives its own `build.cmake` file, specifying how the node should be built.
Each package maintains a single `CMakeLists.txt` file, upholding the requirements of ROS and Colcon.
The following subsection details the construction of these build files.
#### `build.cmake`
Each node maintains its own `build.cmake` file that specifies how the node should be built.
The following is an example of how this file should be created. 

```cmake
# CMake Build File for "Node Name"
# Jacob Chisholm (https://Jchisholm204.github.io)
# version 0.1
# 2025-03-23

# Modify this to align with the "Node Name"
set(NODE node_name)

# Ensure the required packages are avaliable
find_package(ament_cmake REQUIRED)
find_package(rclcpp REQUIRED)
find_package(sensor_msgs REQUIRED)
find_package(cv_bridge REQUIRED)
find_package(OpenCV 4 REQUIRED)

# Gather all sources for this project
file(GLOB_RECURSE PROJECT_SOURCES FOLLOW_SYMLINKS
    ${CMAKE_CURRENT_SOURCE_DIR}/${NODE}/src/*.cpp
)

# Setup Library Dependencies
set(${NODE}_DEPS rclcpp std_msgs sensor_msgs cv_bridge OpenCV)

# Add to include directories
include_directories(${CMAKE_CURRENT_SOURCE_DIR}/${NODE}/include)

# Add this node as an executable 
add_executable(${NODE}
    ${PROJECT_SOURCES}
)

target_include_directories(${NODE} PUBLIC
    $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/${NODE}/include>
    $<INSTALL_INTERFACE:include>
)

# Library dependencies
ament_target_dependencies(${NODE} ${${NODE}_DEPS})

# Install header files
install(
    DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}/${NODE}/include/
    DESTINATION include/${PROJECT_NAME}
)

# Install library files
install(
    TARGETS ${NODE}
    EXPORT export_${NODE}
    DESTINATION lib/${PROJECT_NAME}
)

# Exports
ament_export_include_directories(${CMAKE_CURRENT_SOURCE_DIR}/${NODE}/include)
ament_export_targets(export_${NODE} HAS_LIBRARY_TARGET)
ament_export_dependencies(${${NODE}_DEPS})
```

If the above file is reused, only a select few of the parameters need to be changed.

The first and most important parameter to modify is the `NODE` parameter in the first line.
This parameter sets the node name, and is used for gathering dependencies, building, and installing the node.
**NOTE:** The node name **MUST** match the name of the folder in which the node is contained.

The second parameter that must be changed is the `NODE_DEPS` parameter.
This parameter must be set to contain a list of all required dependencies.
Without setting this parameter properly, the node will fail to build.

Finally, the `find_package` lines must be changed to correspond with the `NODE_DEPS` parameter.

#### `CMakeLists.txt`
In providing each node its own `build.cmake` file, the package `CMakeLists.txt` becomes vastly reduced.
An example of how the `CMakeLists.txt` file should be written is shown below:

```cmake
cmake_minimum_required(VERSION 3.8)
project(package_name)

if(CMAKE_COMPILER_IS_GNUCXX OR CMAKE_CXX_COMPILER_ID MATCHES "Clang")
  add_compile_options(-Wall -Wextra -Wpedantic)
endif()

include(my_node1/build.cmake)
include(my_node2/build.cmake)

ament_package()
```

## Package Contents
Now that we have a good way of organising nodes within packages, we need to determine how to group packages and write the `package.xml` file responsible for generating the build order.
### Package Grouping
With this method, a general way to group packages is by their requirements.
For example, most computer vision nodes require the same dependencies.
Therefore, they can be grouped into the same package.
Another possible example of nodes with similar algorithms would be path planning and navigation nodes.

Another possible method of grouping is via physical subsystem.
For example, the low level control node and inverse kinematics (IK) node for an arm could also be grouped together.
### `package.xml`
The following is an example of the `package.xml` file for a package.
Each package must have exactly one `package.xml` file used for generating a build order between packages.
The following is an example `package.xml` file.
The only requirement of this file is that it must contain references for **ALL** of the dependencies for **ALL** of the nodes within the package.

```xml
<?xml version="1.0"?>
<?xml-model href="http://download.ros.org/schema/package_format3.xsd" schematypens="http://www.w3.org/2001/XMLSchema"?>
<package format="3">
  <name>vision</name>
  <version>0.0.0</version>
  <description>TODO: Package description</description>
  <maintainer email="jacobchisholm1010@gmail.com">jacob</maintainer>
  <license>TODO: License declaration</license>

  <buildtool_depend>ament_cmake</buildtool_depend>

  <depend>rclcpp</depend>
  <depend>sensor_msgs</depend>
  <depend>opencv4</depend>
  <depend>cv_bridge</depend>
  <depend>message_filters</depend>
  <depend>geometry_msgs</depend>


  <test_depend>ament_lint_auto</test_depend>
  <test_depend>ament_lint_common</test_depend>

  <export>
    <build_type>ament_cmake</build_type>
  </export>
</package>
```

# Build System
There are two key elements to the ROS build system.
These elements are Colcon and the `package.xml` files used to control build order.
For more information on the `package.xml` files, see the previous section.
In short, if the `package.xml` files are incorrectly set up, the project may experience random failures during the initial build process, or fail to build entirely.
Colcon is the build system use by ROS and is akin to CMake.

Given the complexity and intricacy of the ROS build system, it is often best to interact with it through build scripts and Makefiles.
The following section details how to implement these intermediary build scripts.

## Shell Script
ROS nodes are often run across various machines networked together.
Therefore, some packages/nodes may require dependencies only present on some systems.
This functionality could be implemented directly through a Makefile, but is often implemented easier through a bash or zsh script.
The following is a sample ZSH script that can be used for this purpose.

```zsh
#!/bin/zsh

# This Script runs using ZSH!

PKGS_COMMON=("vision" "joystick_controller" "driver")
PKGS_JETSON=()
PKGS_RASBPI=("pix_driver")

HOSTNAME_JETSON="jetson"
HOSTNAME_RASBPI="team2pi"
HOSTNAME=$(hostname)

build() {
    if [[ $# -eq 0 ]]; then
        echo "Build must be called with a list of packages"
        return 1
    fi

    if [[ "$HOSTNAME" == "$HOSTNAME_RASBPI" ]]; then
        export CC=clang-15
        export CXX=clang++-15
    else
        export CC=clang
        export CXX=clang++
    fi


    # Build the packages
    colcon build --packages-select "$@" --cmake-args -DCMAKE_EXPORT_COMPILE_COMMANDS=ON -DCMAKE_BUILD_TYPE=Debug

    # Source Install
    if [[ -f "./install/local_setup.zsh" ]]; then
        source ./install/local_setup.zsh
    fi

    # Symlink the compile commands
    if [[ -f "./build/compile_commands.json" ]]; then
        ln -sf ./build/compile_commands.json ./
    fi
}


if [[ "$HOSTNAME" == "$HOSTNAME_JETSON" ]]; then
    echo "Building ROS Packages for Jetson"
    build "${PKGS_COMMON[@]}" "${PKGS_JETSON[@]}"

elif [[ "$HOSTNAME" == "$HOSTNAME_RASBPI" ]]; then
    echo "Building ROS Packages for Raspberry Pi"
    build "${PKGS_COMMON[@]}" "${PKGS_RASBPI[@]}"

else
    echo "Building ROS Workspace Common Packages"
    build "${PKGS_COMMON[@]}"
fi

```

In the above script, the first few lines detail what packages are specific to certain devices.
The `PKGS_COMMON` variable contains the list of packages that can be built on any system.
Nearing the bottom of the script, the build function is called with a list of packages depending on the hostname of the system.

## Makefile
One could invoke the above build script directly from the command line.
However, having a Makefile is generally useful.
Below is a sample Makefile for this purpose:
```Makefile
clean:
	rm -r ./build ./install ./log
	rm ./compile_commands.json

build:
	./build.sh
```

# Additional Notes
## Clang Formatting
The following is a sample formatting file that could be used for clang formatting:

```
BasedOnStyle: LLVM
IndentWidth: 4
TabWidth: 4
UseTab: Never

# Keep braces consistent and readable
BreakBeforeBraces: Attach
AllowShortBlocksOnASingleLine: false
AllowShortCaseLabelsOnASingleLine: false
AllowShortFunctionsOnASingleLine: InlineOnly
AllowShortIfStatementsOnASingleLine: false
AllowShortLoopsOnASingleLine: false

# Control line length and wrapping
ColumnLimit: 80
PenaltyBreakBeforeFirstCallParameter: 50
PenaltyBreakString: 1000
PenaltyReturnTypeOnItsOwnLine: 200

# Pointer & reference alignment
PointerAlignment: Left
ReferenceAlignment: Left

# Namespace formatting
NamespaceIndentation: None
CompactNamespaces: false

# Include ordering
IncludeBlocks: Regroup
SortIncludes: true

# Other readability tweaks
SpaceAfterCStyleCast: true
SpaceBeforeParens: ControlStatements
SpacesInParentheses: false
SpacesInAngles: false
```

## Neovim Compatibility
To ensure Neovim compatibility, first ensure the project is compiled using Clangd.
To further ensure compatibility the `build/compile-commands.json` file can be symlinked into the base directory of each package.