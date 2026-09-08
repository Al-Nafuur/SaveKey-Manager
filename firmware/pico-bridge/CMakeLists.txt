cmake_minimum_required(VERSION 3.13)

include(pico_sdk_import.cmake)

# Override with -DPICO_BOARD=pico_w if you're prototyping on a Pico W.
set(PICO_BOARD pico CACHE STRING "Board type")

project(pico_bridge C CXX ASM)

set(CMAKE_C_STANDARD 11)
set(CMAKE_CXX_STANDARD 17)

pico_sdk_init()

add_executable(pico_bridge
    src/main.c
    src/i2c_bus.c
)

target_include_directories(pico_bridge PRIVATE src)

# CDC-over-USB stdio: printf() goes out over the virtual COM port instead of
# a UART, so a plain serial terminal is enough to see bring-up output.
pico_enable_stdio_usb(pico_bridge 1)
pico_enable_stdio_uart(pico_bridge 0)

target_link_libraries(pico_bridge
    pico_stdlib
    hardware_i2c
)

pico_add_extra_outputs(pico_bridge)
