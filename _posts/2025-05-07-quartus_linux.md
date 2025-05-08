---
title: "Guide: Using Quartus on Linux"
markdown: kramdown
date: 2025-05-07
categories:
  - HDL
  - Guides
  - Linux
tags:
  - Linux
  - Verilog
author:
  - Jacob
---

Linux and Windows are like two sides of the same coin.
Most programs will function perfectly on either.
Some programs even seem to prefer Linux over Windows.
However, there a few programs that simply refuse to work correctly on Linux, with Altera Quartus being one of them.


Luckily, all of the problems related to running Quartus on Linux are caused by its Graphical Interface (GUI). 
Another lucky fact is the Quartus is capable of functioning without a GUI.
Thus, it is possible to easily use Quartus on Linux. 

>**Note**:
>This guide has been tested on Fedora 40.
>However, it should work on other Linux distributions without issue.
{: .prompt-warning}

The following guide explains how to create, manage, build, and upload a Quartus project to an FPGA without the use of the Quartus GUI.

## Creating a Quartus Project
The first step in creating a Quartus project is to understand the two files Quartus uses to describe its projects.

### Quartus Project Files
The first file is largely useless.
It follows the format `*.qpf`, and only contains the project name under the field `PROJECT_REVISION`.
The only requirement of this file is that the `PROJECT_REVISION` matches the name of this file, and the name of the second Quartus project file.
The contents of this file are shown below, and can be easily copy pasted to create a new project.

```
QUARTUS_VERSION = "13.0"
DATE = "21:29:30  April 01, 2025"

# Revisions

PROJECT_REVISION = "miniSRC"
```


The second file contains all of the information related to the project, including files, pin maps, and the name of the top level entity.
It must share the same name as the first file, and follows the naming format `*.qsf`.
A sample has been included below.

```
set_global_assignment -name FAMILY "Cyclone II"
set_global_assignment -name DEVICE EP2C35F672C6
set_global_assignment -name TOP_LEVEL_ENTITY miniSRC
set_global_assignment -name ORIGINAL_QUARTUS_VERSION "13.0 SP1"
set_global_assignment -name PROJECT_CREATION_TIME_DATE "21:29:30  APRIL 01, 2025"
set_global_assignment -name LAST_QUARTUS_VERSION "13.0 SP1"

set_global_assignment -name VERILOG_FILE miniSRC.v

set_global_assignment -name PROJECT_OUTPUT_DIRECTORY output_files
set_global_assignment -name MIN_CORE_JUNCTION_TEMP 0
set_global_assignment -name MAX_CORE_JUNCTION_TEMP 85
set_global_assignment -name ERROR_CHECK_FREQUENCY_DIVISOR 1

set_location_assignment PIN_N25 -to iSW[0]

set_global_assignment -name PARTITION_NETLIST_TYPE SOURCE -section_id Top
set_global_assignment -name PARTITION_FITTER_PRESERVATION_LEVEL PLACEMENT_AND_ROUTING -section_id Top
set_global_assignment -name PARTITION_COLOR 16764057 -section_id Top
set_global_assignment -name CDF_FILE output_files/Chain1.cdf
set_instance_assignment -name PARTITION_HIERARCHY root_partition -to | -section_id Top
```

#### Setting the Device
The top two lines in the above file tell Quartus which device it is fabricating the code for.

```
set_global_assignment -name FAMILY "Cyclone II"
set_global_assignment -name DEVICE EP2C35F672C6
```

The above project is setup for the Cyclone II onboard my personal DE2 development board.
Note that the device and model number must be an exact match for the target FPGA.

#### Setting the Top Level Entity
The top level entity is the highest design in the project.
All other entities in the design are sub entities of the top level entity.
The name top level entity can be set with the following line:

```
set_global_assignment -name TOP_LEVEL_ENTITY miniSRC
```

In this design, the top level entity is named `miniSRC` and is described by the following Verilog code.

```verilog
module miniSRC(iClk, nRst, ...);
input wire iClk, nRst;
...
endmodule
```

#### Adding Files
Quartus designs are typically quite large and must be split across multiple files.
To add files to the project, the following line can be duplicated:

```
set_global_assignment -name VERILOG_FILE miniSRC.v
```

The above line adds a Verilog file called `miniSRC.v`.
VHDL files can also be added to the project by changing `VERILOG_FILE` to `VHDL_FILE`.

```
set_global_assignment -name VHDL_FILE sampleFile.vhd
```

#### Setting Pin Maps (Location Assignments)
Pin maps connect ports in the top level entity to pins on the FPGA chip.
In Quartus, pin maps are called location assignments.
They can be added to the project with the following line:

```
set_location_assignment PIN_N25 -to iSW[0]
set_location_assignment PIN_N26 -to iSW[1]
set_location_assignment PIN_P25 -to iSW[2]
```

The above location assignment connects the pin `N25` to the zeroth position of the vector `iSW`.

```verilog
input wire [2:0] iSW;
```


## Compiling a Project
Compiling a Quartus project involves three stages: Mapping, Fitting, and Assembling.
The functions must be called in the correct order or errors will occur.
The following function, written in ZSH, executes the necessary Quartus commands to compile the project.

```zsh
# Compile the project
# @param $1 - Project File
function ql_compile() {
    # Check if the project is valid
    if [[ $# -ne 1 ]]; then
        echo "Compile called with an invalid number of arguments"
    fi
    ql_check_project "$1"

    echo "Compiling $1"
    quartus_map "$1"

    echo "Fitting $1"
    quartus_fit "$1"

    echo "Assembling $1"
    quartus_asm "$1"
    return 0
}
```

For more information on the Quartus compilation process, consult the Quartus documentation.

After sourcing the Quartus-Linux file, this function can be directly used to compile a Quartus project.
Additionally, it can be used through the `qmk` function, explained in a later section.
## Uploading to the FPGA
The following function flashes the program to the FPGA.

```zsh
# Flash the program to the development board
# $1 - File to Flash
function ql_flash() {
    if [[ $# -ne 1 ]]; then
        echo "Flash called without a target file"
        return 1
    fi
    quartus_pgm -c USB-Blaster -m JTAG -o "p;$1"
    return 0
}
```

Typically, Quartus stores the compiled "binary" under `./output_files/` with the file format `*.sof`.
Thus, the above function can be called via the following:

```zsh
ql_flash "./output_files/${project::-4}.sof"
```

Again, this function can be easily called via the `qmk` function.
## Quartus Make (QMK)
To make dealing with Quartus projects easier, I created QMK.
QMK is a small ZSH script that works similarly to a Makefile.

### Installing
First, install Quartus from the Altera/Intel website.
Do not attempt to launch Quartus, it will not work.

After installing Quartus, clone the qmk repository from [GitHub](https://github.com/Jchisholm204/quartus_linux). 
Then, either source the `quartus_linux.zsh` file, or add the following line to your `zshrc`.

```zsh
source ~/path_to/quartus_linux/quartus_linux.zsh
```
### Usage
To use QMK, first ensure the `quartus_linux.zsh` file is sourced.
QMK is implemented through a single ZSH function.
This function will first search the current directory for Quartus project files.
If it finds a file that matches the Quartus project file format, it attempts to execute the requested action for that project.

QMK was modelled after Makefile, thus QMK commands are similar to that used in most Makefiles.

#### Building
To build a Quartus project, execute the following command with QMK sourced.
```shell
qmk build
```

After executing the command, you should see an output similar to the following:

```shell
MiniSRC on  main [!?] via V
❯ qmk build
1 : ./miniSRC.qpf
Building Quartus Project...
Compiling ./miniSRC.qpf

```

If you do not execute the command from a path containing a Quartus project file, you will be presented with an output similar to the following:

```shell
quartus_linux on  main
❯ qmk build
Quartus project files not found.
Please run this script from the project base directory
```

#### Uploading/Flashing
To flash/upload the project to the board, execute the following command:

```shell
qmk flash
```

>**Warning**
>You must build the project before attempting to flash.
>If the compiled files do not exist, the program will exit without warning.
{: .prompt-danger}

After executing the command, you should see an output similar to the following:

```shell
MiniSRC on  main [!?] via V
❯ qmk flash
1 : ./miniSRC.qpf
Info: *******************************************************************
Info: Running Quartus II 32-bit Programmer
Info: Version 13.0.1 Build 232 06/12/2013 Service Pack 1 SJ Web Edition
Info: Copyright (C) 1991-2013 Altera Corporation. All rights reserved.
Info: Command: quartus_pgm -c USB-Blaster -m JTAG -o p;./output_files/./miniSRC.sof
Info (213045): Using programming cable "USB-Blaster [3-1.1.3]"
Info (213011): Using programming file ./output_files/./miniSRC.sof with checksum 0x00827966 for device EP2C35F672@1
Info (209060): Started Programmer operation at Thu May  8 16:23:11 2025
Info (209016): Configuring device index 1
Info (209017): Device 1 contains JTAG ID code 0x020B40DD
Info (209007): Configuration succeeded -- 1 device(s) configured
Info (209011): Successfully performed operation(s)
Info (209061): Ended Programmer operation at Thu May  8 16:23:13 2025
Info: Quartus II 32-bit Programmer was successful. 0 errors, 0 warnings
Info: Peak virtual memory: 127 megabytes
Info: Processing ended: Thu May  8 16:23:13 2025
Info: Elapsed time: 00:00:03
Info: Total CPU time (on all processors): 00:00:00
```

If a board is not connected, then you will get an output similar to the following:

```shell
MiniSRC on  main [!?] via V took 2s
❯ qmk flash
1 : ./miniSRC.qpf
Error (213013): Programming hardware cable not detected
```
### QMK Code
Below is the code for the main QMK function. 
Feel free to modify this function to suit your own needs.

```zsh
export function qmk(){
    # Get all projects in the working directory
    local project_files=($(find . -type f -path "*.qpf"))

    # Check if there is a project
    if [[ ${#project_files} = 0 ]]; then
        echo "Quartus project files not found."
        echo "Please run this script from the project base directory"
        return 1
    fi

    local project="${project_files[1]}"
    echo "${#project_files[@]} : $project"

    # Test if there is more than one possible project
    if [[ ${#projects[@]} -ge 1 ]]; then
        echo "Multiple Projects Found. Please select one:"
        for ((i = 1; i < ${#projects[@]}+1; i++)); do
            echo "$i.........${projects[$i]}"
        done

        local sel=0
        # Get the user to select which project to use
        while [[ true ]] do
            echo -n "Selection: "
            read sel
            # Checkc if the selection is a number
            if [[ ! "$sel" =~ ^-?[0-9]+$ ]]; then
                echo "That's not a valid number."
                continue
            fi
            # Check that the selection was valid
            if [[ $sel > ${#projects[@]} || $sel = 0 ]]; then
                echo "Oops.. looks like thats not a valid selection"
            else
                # Setup the project name
                project=$projects[$sel]
                break
            fi
        done
    fi # END: Test if there is more than one project

    # Remove the extension from the project name
    #   - Allows it to be used for multiple functions
    #   - Assumes that all project files have the same name
    #       + different extensions
    
    # Options
    if [[ $# = 0 || $1 = "build" ]]; then
        echo "Building Quartus Project..."
        ql_compile "$project"
        return 0
    elif [[ $1 = "flash" ]]; then
        # Test if the output files are present
        if [[ -f "./output_files/${project::-4}.sof" ]]; then
            ql_flash "./output_files/${project::-4}.sof"
        else
            echo "Flash Files not found..."
            return 1
        fi
    fi
}
```

### Feature List
- Building Quartus Projects
- Uploading to FPGAs
- Selecting between multiple projects