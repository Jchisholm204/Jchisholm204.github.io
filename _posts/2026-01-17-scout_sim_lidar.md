---
title: Scout Simulation LiDAR Processing
date: 2026-01-18
categories: [Firmware, Scout]
tags: [STM32, FreeRTOS, Scout]
author: Jacob
hidden: false
math: true
---

Documentation for the "Scout" Simulation LiDAR Processing Task.
This task was used to verify the functionality of the LiDAR design and serve as a framework for implementing the RpLiDAR processing task.

> **WARNING:**
> This module is still under construction.
> Only preliminary testing has been performed, and while this testing was successful, the data processing method is subject to change.
{:.prompt-warning}

## Overview
The Simulation LiDAR task is responsible for processing incoming LiDAR data from the USB interface.
It serves as both a verification of the processing method and as a template for general LiDAR processing.

The task is designed to process data one USB packet at a time.
As packets arrive, their collision vectors are found and added to the global array, and eventually into a single resultant vector representing the most recent collision data.
The final collision vector is then passed to the control task.

## Data Processing

### LiDAR Data Input
Whereas a real LiDAR processing task would handle receiving data from the actual LiDAR sensor, the simulation task reads simulated LiDAR data from the USB interface with the following code snippet.

```c
// Attempt to pull the latest packet from the incoming process queue
static struct udev_pkt_lidar ldrpkt = {0};
if (xQueueReceive(pHndl->usb.rx, &ldrpkt, 100) != pdTRUE) {
    // Input Queue Empty
    printf("Lidar Input Queue Empty\n");
    continue;
}
```

### Local Collision Vector Calculation
After receiving the LiDAR data, the task processes the packet independently to calculate the local collision vector.
This is performed by looping over all points in the packet, using its identifier information to calculate the effective angle for each point.

```c
float sum_x = 0.0f;
float sum_y = 0.0f;
float ground_sum = 0.0f;
float ceil_sum = 0.0f;
int valid_points = 0;
for (int i = 0; i < ldrpkt.hdr.len; i++) {
    float d = (float) ldrpkt.distances[i] / 4000.0f;
    if (d > 45.0f || d < 0.1f) {
        continue;
    }
    valid_points++;
    float angle = udev_lidar_angle(ldrpkt.hdr.sequence, i);
    float weight = 1.0f / d;
    float cos = cosf(angle);
    sum_x += weight * cos;
    if (cos < 0) {
        ground_sum += fabsf(d * cos);
    } else {
        ceil_sum += fabsf(d * cos);
    }
    sum_y += weight * sinf(angle);
}

// Dont bother processing packets with no points
if (valid_points == 0) {
    continue;
}
```

Note that the processing loop ignores out of range points, and LiDAR packets that do not contain any valid points.

### Recording Local Collision Vectors
After calculating the local collision vector, the task adds it into its global array.
This allows LiDAR packets to be received and processed out of order without reordering.

```c
// Add the new resultant sum depending on lidar orientation
if (ldrpkt.hdr.id == eLidarFront) {
    pHndl->sums_front[ldrpkt.hdr.sequence].x = sum_x;
    pHndl->sums_front[ldrpkt.hdr.sequence].y = sum_y;
    pHndl->sums_front[ldrpkt.hdr.sequence].z = 0.0f;
    pHndl->sums_front[ldrpkt.hdr.sequence].w = 0.0f;
}
if (ldrpkt.hdr.id == eLidarVertical) {
    pHndl->sums_vertical[ldrpkt.hdr.sequence].x = 0.0f;
    pHndl->sums_vertical[ldrpkt.hdr.sequence].y = sum_y;
    pHndl->sums_vertical[ldrpkt.hdr.sequence].z = sum_x;
    pHndl->sums_vertical[ldrpkt.hdr.sequence].w = 0.0f;
    pHndl->ceil_sums[ldrpkt.hdr.sequence] = ceil_sum;
    pHndl->ground_sums[ldrpkt.hdr.sequence] = ground_sum;
}
```

### Global Collision Vector Calculation
Finally, the task loops over the local vector array, now containing the newly updated segment, and calculates the global collision vector.
This vector can then be sent to the control task for obstacle avoidance.

```c
// Calculate the collision vector
ctrl_state_t cs;
cs.cv.x = 0;
cs.cv.y = 0;
cs.cv.z = 0;
cs.cv.w = 0;
cs.ground_distance = 0;
cs.ceil_distance = 0;

for (int i = 0; i < UDEV_LIDAR_SEQ_MAX; i++) {
    for (int j = 0; j < 4; j++) {
        cs.cv.data[j] += pHndl->sums_vertical[i].data[j];
        cs.cv.data[j] += pHndl->sums_front[i].data[j];
    }
    cs.ground_distance += pHndl->ground_sums[i];
    cs.ceil_distance += pHndl->ceil_sums[i];
}

// Send CV to control task
xQueueOverwrite(pHndl->cvtx.hndl, &cs);
```