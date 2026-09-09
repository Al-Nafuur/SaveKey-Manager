#include "pico/stdlib.h"

#include "command.h"
#include "i2c_bus.h"

int main(void) {
    stdio_init_all();
    i2c_bus_init();

    // Give the USB CDC connection a moment to enumerate before the first
    // prints, so early output isn't lost while a terminal/app reconnects.
    sleep_ms(1500);

    command_run_loop();

    return 0;
}
